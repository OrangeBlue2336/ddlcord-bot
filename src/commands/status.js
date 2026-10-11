const db = require('../db');
const { infoEmbed, replyEmbed, truncate } = require('../utils/embeds');

const FEATURE_LABELS = {
  accountage: 'New account timeout',
  pingspam: 'Mention spam',
  emojispam: 'Emoji spam',
  samespam: 'Same-message spam',
  mrbeast: 'Spam image detection',
};

module.exports = {
  name: 'status',
  description: 'Show the current on/off state of each feature, test mode, exempt channels, and whitelisted roles.',
  usage: ['status'],
  async execute(message) {
    const featureLines = db.FEATURES.map(
      (f) => `${db.isFeatureEnabled(f) ? '🟢 ON ' : '🔴 OFF'}  \`${f}\` — ${FEATURE_LABELS[f]}`
    );

    const channelIds = db.getSpamExemptChannelIds();
    const roleIds = db.getWhitelistRoleIds();

    const embed = infoEmbed('Bot status').addFields(
      { name: 'Auto-moderation features', value: featureLines.join('\n') },
      {
        name: 'Spam image test mode',
        value: db.isMrbeastTestMode() ? '🟢 ON (log only, no punishment)' : '🔴 OFF',
      },
      {
        name: 'Spam image rules',
        value: `${db.getKnownHashes().length} image hashes, ${db.getKnownKeywords().length} keywords`,
      },
      {
        name: 'Exempt channels (emoji spam & same-message spam)',
        value: truncate(channelIds.length ? channelIds.map((id) => `<#${id}>`).join('\n') : 'None'),
      },
      {
        name: 'Whitelisted roles',
        value: truncate(roleIds.length ? roleIds.map((id) => `<@&${id}>`).join('\n') : 'None'),
      }
    );

    await replyEmbed(message, embed);
  },
};
