require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Colors } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message]
});

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const FILE = path.join(DATA_DIR, 'users.json');
let users = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};

const save = () => fs.writeFileSync(FILE, JSON.stringify(users, null, 2));

const encrypt = t => {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex'));
  return cipher.update(t, 'utf8', 'hex') + cipher.final('hex');
};
const decrypt = h => {
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex'));
    return decipher.update(h, 'hex', 'utf8') + decipher.final('utf8');
  } catch { return null; }
};

const active = new Map();

client.on('ready', () => {
  console.log('QUEST BOT 100% ONLINE — FREE NITRO 2025');
  client.application.commands.set([
    { name: 'login', description: 'Login with token', options: [{ name: 'token', type: 3, required: true, description: 'Your token' }] },
    { name: 'quests', description: 'Show active quests' },
    { name: 'start', description: 'Start quest', options: [{ name: 'quest', type: 3, required: true, description: 'Quest name', autocomplete: true }] },
    { name: 'stop', description: 'Stop quest' },
    { name: 'notify', description: 'Toggle new quest DMs', options: [{ name: 'toggle', type: 3, required: true, description: 'on/off', choices: [{name:'on',value:'on'},{name:'off',value:'off'}] }] }
  ]);
});

client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand() && !i.isAutocomplete() && !i.isButton()) return;

  const u = users[i.user.id] || {};

  if (i.isChatInputCommand()) {
    if (i.commandName === 'login') {
      users[i.user.id] = { token: encrypt(i.options.getString('token')), notify: false };
      save();
      return i.reply({ content: 'Logged in! Use /quests', ephemeral: true });
    }

    if (!u.token) return i.reply({ content: 'Use /login first', ephemeral: true });
    const token = decrypt(u.token);
    if (!token) return i.reply({ content: 'Invalid saved token — login again', ephemeral: true });

    if (i.commandName === 'quests') {
      const res = await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } });
      const quests = res.data.filter(q => !q.user_status?.completed_at && new Date(q.config.expires_at) > new Date());
      const e = new EmbedBuilder().setTitle('Active Quests').setColor(Colors.Blurple);
      quests.forEach(q => e.addFields({ name: q.config.application.name, value: `Expires <t:${Math.floor(new Date(q.config.expires_at)/1000)}:R>` }));
      if (quests.length === 0) e.setDescription('No active quests right now');
      return i.reply({ embeds: [e], ephemeral: true });
    }

    if (i.commandName === 'start') {
      await i.deferReply({ ephemeral: true });
      const input = i.options.getString('quest').toLowerCase();
      const res = await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } });
      const quest = res.data.find(q => q.config.application.name.toLowerCase().includes(input));
      if (!quest) return i.editReply('Quest not found');

      if (!quest.user_status) await axios.post(`https://discord.com/api/v9/quests/${quest.id}/enroll`, { location: 840 }, { headers: { authorization: token } });

      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('stop_quest').setLabel('STOP QUEST').setStyle(ButtonStyle.Danger));
      await i.editReply({ content: `Started **${quest.config.application.name}**\nProgress will update every 30s`, components: [row] });

      const interval = setInterval(async () => {
        try {
          const r = await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } });
          const q = r.data.find(x => x.id === quest.id);
          const prog = q?.user_status?.progress ? Object.values(q.user_status.progress)[0]?.value || 0 : 0;
          const target = 3600;
          await i.editReply({ content: `**${quest.config.application.name}**\nProgress: ${prog}/${target}s${prog >= target ? ' — COMPLETED!' : ''}`, components: prog >= target ? [] : [row] });
          if (prog >= target) { clearInterval(interval); active.delete(i.user.id); }
        } catch {}
      }, 30000);
      active.set(i.user.id, interval);
    }

    if (i.commandName === 'stop') {
      if (active.has(i.user.id)) { clearInterval(active.get(i.user.id)); active.delete(i.user.id); }
      return i.reply({ content: 'Quest stopped', ephemeral: true });
    }

    if (i.commandName === 'notify') {
      users[i.user.id].notify = i.options.getString('toggle') === 'on';
      save();
      return i.reply({ content: 'Notifications ' + (users[i.user.id].notify ? 'ON' : 'OFF'), ephemeral: true });
    }
  }

  if (i.isAutocomplete() && i.commandName === 'start') {
    const token = decrypt(u.token);
    if (!token) return;
    const res = await axios.get('https://discord.com/api/v9/quests', { headers: { authorization: token } });
    const focused = i.options.getFocused().toLowerCase();
    await i.respond(res.data.filter(q => q.config.application.name.toLowerCase().includes(focused)).slice(0,25).map(q => ({ name: q.config.application.name, value: q.config.application.name })));
  }

  if (i.isButton() && i.customId === 'stop_quest') {
    if (active.has(i.user.id)) { clearInterval(active.get(i.user.id)); active.delete(i.user.id); }
    await i.update({ content: 'Quest stopped manually', components: [] });
  }
});

client.login(process.env.DISCORD_TOKEN);
