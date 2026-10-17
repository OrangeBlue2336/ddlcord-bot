// "/기능 on / off" 하위 명령어의 공통 처리 (accountage, pingspam, emojispam, samespam, mrbeast 가 공유)
const db = require('../db');
const { infoEmbed, successEmbed, replyEmbed } = require('./embeds');

// 하위 명령어 이름(on / off)을 보고 기능을 켜거나 끈다. (mrbeast testmode 는 mrbeast.js 에서 따로 처리)
async function handleToggle(interaction, feature, label) {
  const enable = interaction.options.getSubcommand() === 'on';
  const current = db.isFeatureEnabled(feature);

  if (current === enable) {
    return replyEmbed(interaction, infoEmbed(`Already ${enable ? 'ON' : 'OFF'}`, `${label} is already ${enable ? 'ON' : 'OFF'}.`));
  }

  await db.setFeatureEnabled(feature, enable);
  return replyEmbed(interaction, successEmbed(`${label}: ${enable ? 'ON' : 'OFF'}`, `${label} has been turned ${enable ? 'on' : 'off'}.`));
}

module.exports = { handleToggle };
