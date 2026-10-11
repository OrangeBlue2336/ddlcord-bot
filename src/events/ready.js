const { Events, PermissionFlagsBits, ActivityType } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { sendLog } = require('../utils/logger');

// 봇이 일하려면 필요한 권한 목록
const REQUIRED_PERMISSIONS = [
  ['ViewChannel', 'View Channels'],
  ['SendMessages', 'Send Messages'],
  ['EmbedLinks', 'Embed Links'],
  ['ReadMessageHistory', 'Read Message History'],
  ['ManageMessages', 'Manage Messages'],
  ['ModerateMembers', 'Timeout Members'],
  ['BanMembers', 'Ban Members'],
  ['ManageRoles', 'Manage Roles'], // ^roleicon 용
];

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(readyClient) {
    console.log(`Logged in as ${readyClient.user.tag} (mode: ${process.env.BOT_MODE})`);

    // 봇 상태 메시지 설정 (실패해도 시작 과정은 계속 진행)
    if (config.botStatus) {
      try {
        readyClient.user.setPresence({
          status: 'online',
          activities: [{ name: config.botStatus, state: config.botStatus, type: ActivityType.Custom }],
        });
      } catch (err) {
        console.warn(`[ready] Could not set the bot status: ${err.message}`);
      }
    }

    const guild = readyClient.guilds.cache.get(process.env.GUILD_ID);
    let permissionText = 'Could not check (the bot is not in the configured server).';
    let missingCount = 1;

    if (guild) {
      const me = await guild.members.fetchMe().catch(() => null);
      if (me) {
        const lines = REQUIRED_PERMISSIONS.map(([key, label]) => {
          const ok = me.permissions.has(PermissionFlagsBits[key]);
          return `${ok ? '✅' : '❌'} ${label}`;
        });
        missingCount = lines.filter((l) => l.startsWith('❌')).length;
        permissionText = lines.join('\n');
      }
    } else {
      console.error('[ready] The bot is not in the server set as GUILD_ID. Check .env and the invite.');
    }

    const featureText = db.FEATURES.map((f) => `${db.isFeatureEnabled(f) ? '🟢' : '🔴'} ${f}`).join('\n');

    await sendLog(readyClient, {
      title: 'Bot started',
      status: missingCount > 0 ? 'warning' : 'info',
      description: 'The bot is online. If you can see this message, the log channel is set up correctly.',
      fields: [
        { name: 'Environment', value: process.env.BOT_MODE, inline: true },
        { name: 'Database', value: `MongoDB (${process.env.MONGODB_DB})`, inline: true },
        { name: 'Features', value: featureText },
        { name: 'Bot permissions (server-wide)', value: permissionText },
      ],
    });
  },
};
