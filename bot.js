// bot.js - CLEAN QUEST BOT 2025 (NO EXPRESS, NO CANVAS)
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Colors } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const FILE = path.join(DATA_DIR, 'users.json');
let users = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};

const save = () => fs.writeFileSync(FILE, JSON.stringify(users, null, 2));
const encrypt = t => crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex')).update(t, 'utf8', 'hex') + crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex')).final('hex');
const decrypt = h => crypto.createDecipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex')).update(h, 'hex', 'utf8') + crypto.createDecipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex')).final('utf8');

const active = new Map();

client.once('ready', () => {
  console.log('QUEST BOT ONLINE - FREE NITRO 2025');
  client.application.commands.set([
    { name: 'login', description: 'Login with token', options: [{ name: 'token', type: 3, required: true, description: 'Your token' }] },
    { name: 'quests', description: 'Show quests' },
    { name: 'start', description: 'Start quest', options: [{ name: 'quest', type: 3, required: true, description: 'Quest name', autocomplete: true }] },
    { name: 'stop', description: 'Stop quest' }
  ]);
});

client.on('interactionCreate', async i => {
  if (!i.isCommand() && !i.isAutocomplete()) return;
  const u = users[i.user.id] || {};

  if (i.commandName === 'login') {
    users[i.user.id] = { token: encrypt(i.options.getString('token')), notify: false };
    save();
    return i.reply({ content: 'Logged in! Use /quests', ephemeral: true });
  }

  if (!u.token) return i.reply({ content: 'Use /login first', ephemeral: true });
  const token = decrypt(u.token);

  if (i.commandName === 'quests') {
    const q = (await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } })).data.filter(x => !x.user_status?.completed_at);
    const e = new EmbedBuilder().setTitle('Active Quests').setColor(Colors.Blurple);
    q.forEach(x => e.addFields({ name: x.config.application.name, value: `Expires <t:${Math.floor(new Date(x.config.expires_at)/1000)}:R>` }));
    return i.reply({ embeds: [e] });
  }

  if (i.commandName === 'start') {
    await i.deferReply();
    const quests = (await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } })).data;
    const quest = quests.find(x => x.config.application.name.toLowerCase().includes(i.options.getString('quest').toLowerCase()));
    if (!quest.user_status) await axios.post(`https://discord.com/api/v9/quests/${quest.id}/enroll`, { location: 840 }, { headers: { authorization: token } });

    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('stop').setLabel('STOP').setStyle(ButtonStyle.Danger));
    const msg = await i.editReply({ content: 'Starting quest...', components: [row] });

    const int = setInterval(async () => {
      const res = await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } });
      const q = res.data.find(x => x.id === quest.id);
      const prog = q.user_status?.progress ? Object.values(q.user_status.progress)[0]?.value || 0 : 0;
      await msg.edit({ content: `**${quest.config.application.name}**\nProgress: ${prog}/3600s` + (prog >= 3600 ? '\n**COMPLETED!**' : '') });
      if (prog >= 3600) { clearInterval(int); active.delete(i.user.id); }
    }, 30000);
    active.set(i.user.id, int);
  }

  if (i.isAutocomplete()) {
    const quests = (await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } })).data;
    await i.respond(quests.map(q => ({ name: q.config.application.name, value: q.config.application.name })));
  }
});

client.on('interactionCreate', i => {
  if (i.isButton() && i.customId === 'stop') {
    if (active.has(i.user.id)) clearInterval(active.get(i.user.id));
    active.delete(i.user.id);
    i.update({ content: 'Stopped', components: [] });
  }
});

client.login(process.env.DISCORD_TOKEN);
