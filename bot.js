// bot.js - FULL AUTO RAIDER 2025 (OAuth2 User Auth — No Token Typing)
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();

app.use(session({ secret: process.env.SESSION_SECRET || 'raider2025', resave: false, saveUninitialized: false }));
const PORT = process.env.PORT || 3000;

// DATA
const DATA = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);
const RAIDERS_FILE = path.join(DATA, 'raiders.json');
let raiders = fs.existsSync(RAIDERS_FILE) ? JSON.parse(fs.readFileSync(RAIDERS_FILE)) : {};

const save = () => fs.writeFileSync(RAIDERS_FILE, JSON.stringify(raiders, null, 2));

// OAUTH2 SETTINGS
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `https://your-render-url.onrender.com/callback`;
const BOT_INVITE = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot`;
const OAUTH_URL = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;

client.on('ready', () => {
  console.log(`RAIDER BOT ONLINE — ${Object.keys(raiders).length} accounts connected`);
  client.application.commands.set([
    { name: 'connect', description: 'Connect your account to raid' },
    { name: 'raid', description: 'Start raiding all your servers', options: [{ name: 'message', type: 3, required: false, description: 'Custom spam message' }] },
    { name: 'stats', description: 'Show total raiders' }
  ]);
});

client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === 'connect') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('CONNECT ACCOUNT & START RAIDING')
        .setStyle(ButtonStyle.Link)
        .setURL(OAUTH_URL)
    );
    return i.reply({ content: 'Click below to connect your account\nAfter connecting, you can use /raid', components: [row], ephemeral: true });
  }

  if (i.commandName === 'stats') {
    return i.reply({ content: `**Raiders Connected:** ${Object.keys(raiders).length}`, ephemeral: true });
  }

  if (i.commandName === 'raid') {
    if (!raiders[i.user.id]) return i.reply({ content: 'You must connect your account first with /connect', ephemeral: true });
    
    await i.deferReply({ ephemeral: true });
    const message = i.options.getString('message') || "YOOOOOOOOO @everyone GET RAIDED 🔥🔥🔥";

    let sent = 0;
    try {
      const guilds = await axios.get('https://discord.com/api/v9/users/@me/guilds', { headers: { authorization: raiders[i.user.id].token } });
      for (const g of guilds.data) {
        const channels = await axios.get(`https://discord.com/api/v9/guilds/${g.id}/channels`, { headers: { authorization: raiders[i.user.id].token } });
        const textCh = channels.data.filter(c => c.type === 0);
        for (const ch of textCh.slice(0, 10)) {
          try {
            await axios.post(`https://discord.com/api/v9/channels/${ch.id}/messages`, { content: message }, { headers: { authorization: raiders[i.user.id].token } });
            sent++;
            await new Promise(r => setTimeout(r, 1200));
          } catch {}
        }
      }
    } catch {}
    await i.editReply({ content: `RAID COMPLETE — ${sent} messages sent` });
  }
});

// OAuth2 Callback
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('Error');

  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const user = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
    raiders[user.data.id] = { token: tokenRes.data.access_token };
    save();

    res.send(`
      <h1 style="color:green;text-align:center;margin-top:100px">ACCOUNT CONNECTED SUCCESSFULLY!</h1>
      <p style="text-align:center">You can now use /raid in the bot</p>
      <script>setTimeout(()=>window.close(),3000)</script>
    `);
  } catch (e) {
    res.send('Error — try again');
  }
});

app.listen(PORT);
client.login(process.env.BOT_TOKEN);
