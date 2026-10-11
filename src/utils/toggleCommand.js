// "^기능 on / off" 명령어의 공통 처리 (accountage, pingspam, emojispam, samespam, mrbeast 가 공유)
const config = require('../config');
const db = require('../db');
const { infoEmbed, successEmbed, errorEmbed, replyEmbed } = require('./embeds');

async function handleToggle(message, args, feature, label) {
  const arg = (args[0] ?? '').toLowerCase();
  const current = db.isFeatureEnabled(feature);
  const p = config.prefix;

  if (arg !== 'on' && arg !== 'off') {
    return replyEmbed(
      message,
      errorEmbed(
        'Invalid usage',
        `Usage: \`${p}${feature} on\` or \`${p}${feature} off\`\n${label} is currently **${current ? 'ON' : 'OFF'}**.`
      )
    );
  }

  const enable = arg === 'on';
  if (current === enable) {
    return replyEmbed(message, infoEmbed(`Already ${enable ? 'ON' : 'OFF'}`, `${label} is already ${enable ? 'ON' : 'OFF'}.`));
  }

  await db.setFeatureEnabled(feature, enable);
  return replyEmbed(message, successEmbed(`${label}: ${enable ? 'ON' : 'OFF'}`, `${label} has been turned ${enable ? 'on' : 'off'}.`));
}

module.exports = { handleToggle };
