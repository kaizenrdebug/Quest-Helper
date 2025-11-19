require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, AttachmentBuilder, Events, PermissionsBitField, EmbedBuilder, REST, Routes, SlashCommandBuilder, Colors } = require('discord.js');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const ENCRYPT_KEY = Buffer.from(process.env.ENCRYPT_KEY || crypto.randomBytes(32).toString('hex'), 'hex');
const ENCRYPT_IV = Buffer.from(process.env.ENCRYPT_IV || crypto.randomBytes(16).toString('hex'), 'hex');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const QUEST_USERS_FILE = path.join(DATA_DIR, 'quest_users.json');
let questUsers = {};
try { questUsers = JSON.parse(fs.readFileSync(QUEST_USERS_FILE, 'utf8')); } catch {}

const saveQuestUsers = () => fs.writeFileSync(QUEST_USERS_FILE, JSON.stringify(questUsers, null, 2));

const encrypt = text => {
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPT_KEY, ENCRYPT_IV);
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
};
const decrypt = hash => {
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPT_KEY, ENCRYPT_IV);
  return decipher.update(hash, 'hex', 'utf8') + decipher.final('utf8');
};

const activeQuests = new Map();
const questCache = new Map();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message]
});

client.once('ready', async () => {
  console.log(`Quest Bot Ready → ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName('quests').setDescription('Show active quests'),
    new SlashCommandBuilder().setName('start').setDescription('Start a quest').addStringOption(o => o.setName('quest').setDescription('Quest name').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('stop').setDescription('Stop current quest'),
    new SlashCommandBuilder().setName('status').setDescription('Check progress'),
    new SlashCommandBuilder().setName('login').setDescription('Login with your token').addStringOption(o => o.setName('token').setDescription('Your Discord token').setRequired(true)),
    new SlashCommandBuilder().setName('notify').setDescription('Toggle new quest DMs').addStringOption(o => o.setName('toggle').setDescription('on/off').setRequired(true).addChoices({name:'on',value:'on'},{name:'off',value:'off'}))
  ];

  await client.application.commands.set(commands.map(c => c.toJSON()));
  console.log('Quest commands registered');

  setInterval(async () => {
    for (const [id, data] of Object.entries(questUsers)) {
      if (!data.notify || !data.token) continue;
      try {
        const token = decrypt(data.token);
        const res = await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } });
        const quests = res.data.filter(q => !q.user_status?.completed_at && new Date(q.config.expires_at) > new Date());
        for (const q of quests) {
          if (!questCache.has(q.id)) {
            questCache.set(q.id, true);
            const user = await client.users.fetch(id);
            user.send({ embeds: [new EmbedBuilder().setTitle('NEW QUEST!').setDescription(`**${q.config.application.name}**\n${q.config.messages.questName}`).setColor(Colors.Purple).setImage(q.config.assets.artwork_large || null)] });
          }
        }
      } catch {}
    }
  }, 300000);
});

const headers = token => ({ authorization: token, 'content-type': 'application/json' });
const getQuests = async token => (await axios.get('https://discord.com/api/v9/quests', { headers: headers(token) })).data.filter(q => !q.user_status?.completed_at && new Date(q.config.expires_at) > new Date());
const enroll = async (token, id) => axios.post(`https://discord.com/api/v9/quests/${id}/enroll`, { location: 840 }, { headers: headers(token) });

client.on('interactionCreate', async i => {
  if (!i.isCommand() && !i.isAutocomplete() && !i.isButton()) return;

  const userId = i.user.id;
  let data = questUsers[userId];

  if (i.commandName === 'login') {
    const token = i.options.getString('token');
    questUsers[userId] = { token: encrypt(token), notify: false };
    saveQuestUsers();
    return i.reply({ content: 'Successfully logged in! You can now use all quest commands.', ephemeral: true });
  }

  if (!data?.token) return i.reply({ content: 'Use `/login <your_token>` first!', ephemeral: true });
  data.token = decrypt(data.token);

  if (i.commandName === 'quests') {
    const quests = await getQuests(data.token);
    const embed = new EmbedBuilder().setTitle('Active Quests').setColor(Colors.Blurple);
    quests.forEach(q => embed.addFields({ name: q.config.application.name, value: `Expires <t:${Math.floor(new Date(q.config.expires_at)/1000)}:R>` }));
    return i.reply({ embeds: [embed] });
  }

  if (i.commandName === 'start') {
    await i.deferReply();
    const input = i.options.getString('quest').toLowerCase();
    const quests = await getQuests(data.token);
    const quest = quests.find(q => q.config.application.name.toLowerCase().includes(input) || q.id === input);
    if (!quest) return i.editReply('Quest not found');

    if (!quest.user_status) await enroll(data.token, quest.id);

    const target = 3600;
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('stopquest').setLabel('Stop').setStyle(ButtonStyle.Danger));
    const embed = new EmbedBuilder().setTitle('Quest Started').setDescription(quest.config.application.name).addFields({ name: 'Progress', value: '0/' + target + 's' }).setColor(Colors.Green);

    await i.editReply({ embeds: [embed], components: [row] });

    let logs = '';
    const interval = setInterval(async () => {
      const res = await axios.get('https://discord.com/api/v9/quests', { headers: headers(data.token) });
      const q = res.data.find(x => x.id === quest.id);
      const progress = q?.user_status?.progress ? Object.values(q.user_status.progress)[0]?.value || 0 : 0;
      logs += `${progress}s\n`;
      if (logs.split('\n').length > 10) logs = logs.split('\n').slice(-10).join('\n');
      const e = EmbedBuilder.from(embed).spliceFields(0,1,{name:'Progress',value:`${progress}/${target}s`}).addFields({name:'Log',value:`\`\`\`\n${logs}\`\`\``});
      if (progress >= target) e.setTitle('QUEST COMPLETED!').setColor(Colors.Green);
      await i.editReply({ embeds: [e], components: progress >= target ? [] : [row] });
      if (progress >= target) { clearInterval(interval); activeQuests.delete(userId); }
    }, 25000);

    activeQuests.set(userId, interval);
  }

  if (i.commandName === 'stop') {
    if (activeQuests.has(userId)) clearInterval(activeQuests.get(userId));
    activeQuests.delete(userId);
    return i.reply({ content: 'Stopped', ephemeral: true });
  }

  if (i.commandName === 'notify') {
    const on = i.options.getString('toggle') === 'on';
    questUsers[userId] = { ...questUsers[userId], token: encrypt(data.token), notify: on };
    saveQuestUsers();
    return i.reply({ content: on ? 'Notifications ON' : 'OFF', ephemeral: true });
  }

  if (i.isAutocomplete() && i.commandName === 'start') {
    const quests = await getQuests(data.token);
    const focused = i.options.getFocused().toLowerCase();
    await i.respond(quests.filter(q => q.config.application.name.toLowerCase().includes(focused)).slice(0,25).map(q => ({ name: q.config.application.name, value: q.config.application.name })));
  }

  if (i.isButton() && i.customId === 'stopquest') {
    if (activeQuests.has(userId)) clearInterval(activeQuests.get(userId));
    activeQuests.delete(userId);
    await i.update({ content: 'Stopped manually', embeds: [], components: [] });
  }
});

client.login(BOT_TOKEN);
