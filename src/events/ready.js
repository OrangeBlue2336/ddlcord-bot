const { Events, PermissionFlagsBits, ActivityType } = require('discord.js');
const config = require('../config');
const db = require('../db');
const { sendLog } = require('../utils/logger');
const { truncate } = require('../utils/embeds');
const { registerGuildCommands, describeRegisterError } = require('../utils/registerCommands');

// 봇이 일하려면 필요한 권한 목록
const REQUIRED_PERMISSIONS = [
  ['ViewChannel', 'View Channels'],
  ['SendMessages', 'Send Messages'],
  ['EmbedLinks', 'Embed Links'],
  ['ReadMessageHistory', 'Read Message History'],
  ['ManageMessages', 'Manage Messages'],
  ['ModerateMembers', 'Timeout Members'],
  ['BanMembers', 'Ban Members'],
  ['ManageRoles', 'Manage Roles'], // /roleicon 용
];

// 슬래시 명령어 자동 등록 여부: 실서버(prod)는 기본 켜짐, 개발(dev)은 기본 꺼짐 (npm run deploy:dev 로 직접 등록)
// 환경변수 AUTO_DEPLOY_COMMANDS=true / false 로 바꿀 수 있음
function shouldAutoRegister() {
  const setting = (process.env.AUTO_DEPLOY_COMMANDS ?? '').trim().toLowerCase();
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  return process.env.BOT_MODE === 'prod';
}

// 시작할 때 슬래시 명령어를 등록하고, 시작 로그에 보여줄 { ok, text } 를 돌려준다 (실패해도 봇은 계속 시작)
async function syncSlashCommands(readyClient) {
  if (!shouldAutoRegister()) {
    return { ok: true, text: 'Not registered at startup. Run "npm run deploy:dev" after changing commands.' };
  }
  try {
    const names = await registerGuildCommands(
      readyClient.rest,
      readyClient.application.id,
      process.env.GUILD_ID,
      readyClient.commands
    );
    console.log(`[commands] Registered ${names.length} slash commands: ${names.map((n) => `/${n}`).join(' ')}`);
    return { ok: true, text: `✅ Registered ${names.length} slash commands at startup.` };
  } catch (err) {
    const reason = describeRegisterError(err);
    console.error(`[commands] Could not register slash commands: ${reason}`);
    return { ok: false, text: `❌ Registration failed: ${reason}` };
  }
}

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

    const commandSync = await syncSlashCommands(readyClient);

    const featureText = db.FEATURES.map((f) => `${db.isFeatureEnabled(f) ? '🟢' : '🔴'} ${f}`).join('\n');

    const hasWarning = missingCount > 0 || !commandSync.ok;

    // Render 에서는 재배포/재시작이 겹쳐 짧은 시간에 여러 번 켜질 수 있어서, 같은 시작 알림이 이미 올라갔으면 건너뜀.
    // (경고가 있는 시작 알림은 놓치면 안 되므로 항상 올림. 내 컴퓨터에서 켤 때는 이 검사를 하지 않음)
    if (process.env.RENDER) {
      const windowMs = config.startupNotice.dedupeMin * 60 * 1000;
      const mayAnnounce = await db.claimStartupNotice(windowMs);
      if (!mayAnnounce && !hasWarning) {
        console.log(`[ready] Skipped the "Bot started" log: one was already posted within the last ${config.startupNotice.dedupeMin} minutes.`);
        return;
      }
    }

    await sendLog(readyClient, {
      title: 'Bot started',
      status: hasWarning ? 'warning' : 'info',
      description: 'The bot is online. If you can see this message, the log channel is set up correctly.',
      fields: [
        { name: 'Environment', value: process.env.BOT_MODE, inline: true },
        { name: 'Database', value: `MongoDB (${process.env.MONGODB_DB})`, inline: true },
        { name: 'Features', value: featureText },
        { name: 'Slash commands', value: truncate(commandSync.text, 1024) },
        { name: 'Bot permissions (server-wide)', value: permissionText },
      ],
    });
  },
};
