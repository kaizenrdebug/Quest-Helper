require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Colors, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Create client with proper intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Setup data directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const FILE = path.join(DATA_DIR, 'users.json');

// Load user data
let users = {};
try {
  users = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};
} catch (error) {
  console.error('Error loading user data:', error);
  users = {};
}

// Save user data
const save = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving user data:', error);
  }
};

// Encryption utilities
const encrypt = text => {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex'));
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
};

const decrypt = hash => {
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(process.env.KEY, 'hex'), Buffer.from(process.env.IV, 'hex'));
    return decipher.update(hash, 'hex', 'utf8') + decipher.final('utf8');
  } catch {
    return null;
  }
};

// Active quests tracking
const activeQuests = new Map();

// Ready event
client.on('ready', () => {
  console.log(`QUEST BOT ONLINE - ${client.user.tag}`);
  
  // Set up commands
  setTimeout(async () => {
    try {
      await client.application.commands.set([
        { 
          name: 'login', 
          description: 'Login with your Discord token', 
          options: [{ 
            name: 'token', 
            type: 3, 
            required: true, 
            description: 'Your Discord account token' 
          }] 
        },
        { 
          name: 'quests', 
          description: 'Show your active quests' 
        },
        { 
          name: 'start', 
          description: 'Start a quest', 
          options: [{ 
            name: 'quest', 
            type: 3, 
            required: true, 
            description: 'Quest name', 
            autocomplete: true 
          }] 
        },
        { 
          name: 'stop', 
          description: 'Stop your current quest' 
        },
        { 
          name: 'notify', 
          description: 'Toggle quest notifications', 
          options: [{ 
            name: 'toggle', 
            type: 3, 
            required: true, 
            description: 'on/off', 
            choices: [
              { name: 'on', value: 'on' },
              { name: 'off', value: 'off' }
            ] 
          }] 
        }
      ]);
      console.log('Commands registered successfully');
    } catch (error) {
      console.error('Error registering commands:', error);
    }
  }, 2000);
});

// Interaction handler
client.on('interactionCreate', async interaction => {
  try {
    // Handle different interaction types
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error('Unhandled interaction error:', error);
    
    // Try to notify user if possible
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ 
          content: '❌ An error occurred while processing your request.', 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: '❌ An error occurred while processing your request.', 
          ephemeral: true 
        });
      }
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
});

// Command handler
async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const userData = users[userId] || {};
  
  try {
    switch (interaction.commandName) {
      case 'login':
        await handleLogin(interaction, userId);
        break;
        
      case 'quests':
        await handleQuests(interaction, userData);
        break;
        
      case 'start':
        await handleStart(interaction, userId, userData);
        break;
        
      case 'stop':
        await handleStop(interaction, userId);
        break;
        
      case 'notify':
        await handleNotify(interaction, userId);
        break;
        
      default:
        await interaction.reply({ 
          content: 'Unknown command', 
          ephemeral: true 
        });
    }
  } catch (error) {
    console.error(`Error handling ${interaction.commandName} command:`, error);
    throw error;
  }
}

// Login command handler
async function handleLogin(interaction, userId) {
  const token = interaction.options.getString('token');
  
  // Basic validation
  if (!token || token.length < 50) {
    return interaction.reply({ 
      content: '❌ Invalid token format', 
      ephemeral: true 
    });
  }
  
  // Save encrypted token
  users[userId] = { 
    token: encrypt(token), 
    notify: users[userId]?.notify || false 
  };
  save();
  
  await interaction.reply({ 
    content: '✅ Logged in successfully! Use `/quests` to view your active quests', 
    flags: MessageFlags.Ephemeral 
  });
}

// Quests command handler
async function handleQuests(interaction, userData) {
  if (!userData.token) {
    return interaction.reply({ 
      content: '❌ Please login first using `/login`', 
      flags: MessageFlags.Ephemeral 
    });
  }
  
  const token = decrypt(userData.token);
  if (!token) {
    return interaction.reply({ 
      content: '❌ Invalid saved token - please login again', 
      flags: MessageFlags.Ephemeral 
    });
  }
  
  try {
    const response = await axios.get('https://discord.com/api/v9/quests', {
      headers: { 
        authorization: token,
        'User-Agent': 'DiscordBot'
      }
    });
    
    const quests = response.data.filter(quest => 
      !quest.user_status?.completed_at && 
      new Date(quest.config.expires_at) > new Date()
    );
    
    const embed = new EmbedBuilder()
      .setTitle('🎯 Active Quests')
      .setColor(Colors.Blurple)
      .setTimestamp();
    
    if (quests.length === 0) {
      embed.setDescription('No active quests available right now');
    } else {
      quests.forEach(quest => {
        const expiresIn = Math.floor(new Date(quest.config.expires_at) / 1000);
        embed.addFields({
          name: quest.config.application.name,
          value: `Expires <t:${expiresIn}:R>`
        });
      });
    }
    
    await interaction.reply({ 
      embeds: [embed], 
      flags: MessageFlags.Ephemeral 
    });
  } catch (error) {
    console.error('Quests API error:', error.response?.data || error.message);
    await interaction.reply({ 
      content: '❌ Failed to fetch quests. Please check your token or try again later.', 
      flags: MessageFlags.Ephemeral 
    });
  }
}

// Start command handler
async function handleStart(interaction, userId, userData) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  if (!userData.token) {
    return interaction.editReply('❌ Please login first using `/login`');
  }
  
  const token = decrypt(userData.token);
  if (!token) {
    return interaction.editReply('❌ Invalid saved token - please login again');
  }
  
  const questName = interaction.options.getString('quest').toLowerCase();
  
  try {
    const response = await axios.get('https://discord.com/api/v9/quests', {
      headers: { 
        authorization: token,
        'User-Agent': 'DiscordBot'
      }
    });
    
    const quest = response.data.find(q => 
      q.config.application.name.toLowerCase().includes(questName)
    );
    
    if (!quest) {
      return interaction.editReply('❌ Quest not found. Try using autocomplete for suggestions.');
    }
    
    // Enroll in quest if needed
    if (!quest.user_status) {
      await axios.post(
        `https://discord.com/api/v9/quests/${quest.id}/enroll`,
        { location: 840 },
        { headers: { authorization: token } }
      );
    }
    
    // Create stop button
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('stop_quest')
        .setLabel('⏹️ STOP QUEST')
        .setStyle(ButtonStyle.Danger)
    );
    
    await interaction.editReply({
      content: `✅ Started **${quest.config.application.name}**\nProgress will update every 30 seconds`,
      components: [row]
    });
    
    // Track active quest
    if (activeQuests.has(userId)) {
      clearInterval(activeQuests.get(userId));
    }
    
    const interval = setInterval(async () => {
      try {
        const res = await axios.get('https://discord.com/api/v9/quests', {
          headers: { authorization: token }
        });
        
        const currentQuest = res.data.find(q => q.id === quest.id);
        const progress = currentQuest?.user_status?.progress ? 
          Object.values(currentQuest.user_status.progress)?.value || 0 : 0;
        
        const target = 3600; // Target progress value
        const status = progress >= target ? 
          '✅ COMPLETED!' : 
          `Progress: ${progress}/${target}s`;
        
        // Update message
        try {
          await interaction.editReply({
            content: `**${quest.config.application.name}**\n${status}`,
            components: progress >= target ? [] : [row]
          });
          
          // Clear interval if completed
          if (progress >= target) {
            clearInterval(interval);
            activeQuests.delete(userId);
          }
        } catch (editError) {
          console.error('Error editing reply:', editError);
          clearInterval(interval);
          activeQuests.delete(userId);
        }
      } catch (questError) {
        console.error('Error checking quest progress:', questError);
        clearInterval(interval);
        activeQuests.delete(userId);
        
        try {
          await interaction.editReply({
            content: '❌ Error checking quest progress. Quest tracking stopped.',
            components: []
          });
        } catch (replyError) {
          console.error('Error sending progress error:', replyError);
        }
      }
    }, 30000);
    
    activeQuests.set(userId, interval);
  } catch (error) {
    console.error('Start quest error:', error.response?.data || error.message);
    await interaction.editReply('❌ Failed to start quest. Please try again.');
  }
}

// Stop command handler
async function handleStop(interaction, userId) {
  if (activeQuests.has(userId)) {
    clearInterval(activeQuests.get(userId));
    activeQuests.delete(userId);
    return interaction.reply({ 
      content: '⏹️ Quest tracking stopped', 
      flags: MessageFlags.Ephemeral 
    });
  }
  
  interaction.reply({ 
    content: '❌ No active quest to stop', 
    flags: MessageFlags.Ephemeral 
  });
}

// Notify command handler
async function handleNotify(interaction, userId) {
  const toggle = interaction.options.getString('toggle');
  const isEnabled = toggle === 'on';
  
  if (!users[userId]) {
    users[userId] = { token: null, notify: isEnabled };
  } else {
    users[userId].notify = isEnabled;
  }
  
  save();
  
  interaction.reply({ 
    content: `🔔 Notifications ${isEnabled ? 'enabled' : 'disabled'}`, 
    flags: MessageFlags.Ephemeral 
  });
}

// Autocomplete handler
async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'start') return;
  
  const userId = interaction.user.id;
  const userData = users[userId] || {};
  
  if (!userData.token) {
    await interaction.respond([]);
    return;
  }
  
  const token = decrypt(userData.token);
  if (!token) {
    await interaction.respond([]);
    return;
  }
  
  try {
    const response = await axios.get('https://discord.com/api/v9/quests', {
      headers: { authorization: token }
    });
    
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = response.data
      .filter(quest => 
        !quest.user_status?.completed_at && 
        new Date(quest.config.expires_at) > new Date() &&
        quest.config.application.name.toLowerCase().includes(focused)
      )
      .slice(0, 25)
      .map(quest => ({
        name: quest.config.application.name,
        value: quest.config.application.name
      }));
    
    await interaction.respond(choices);
  } catch (error) {
    console.error('Autocomplete error:', error);
    await interaction.respond([]);
  }
}

// Button handler
async function handleButton(interaction) {
  if (interaction.customId !== 'stop_quest') return;
  
  const userId = interaction.user.id;
  
  if (activeQuests.has(userId)) {
    clearInterval(activeQuests.get(userId));
    activeQuests.delete(userId);
  }
  
  await interaction.update({
    content: '⏹️ Quest stopped manually',
    components: []
  });
}

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Failed to login:', error);
});
