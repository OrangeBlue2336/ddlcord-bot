const dmTemplates = require('../utils/dmTemplates');
const { successEmbed, errorEmbed, replyEmbed } = require('../utils/embeds');

const USAGE = `\`^testdm <${dmTemplates.FEATURE_NAMES.join('|')}>\`\nFor mrbeast you can add \`ban\` or \`timeout\`: \`^testdm mrbeast ban\``;

module.exports = {
  name: 'testdm',
  description: 'Send yourself a test copy of the punishment DM for a feature.',
  usage: ['testdm <feature>', 'testdm mrbeast <ban|timeout>'],
  async execute(message, args) {
    const feature = (args[0] ?? '').toLowerCase();
    const variant = (args[1] ?? '').toLowerCase() || undefined;

    if (!dmTemplates.FEATURE_NAMES.includes(feature)) {
      return replyEmbed(message, errorEmbed('Invalid usage', `Usage: ${USAGE}`));
    }
    if (feature === 'mrbeast' && variant && !dmTemplates.MRBEAST_VARIANTS.includes(variant)) {
      return replyEmbed(message, errorEmbed('Invalid usage', `Usage: ${USAGE}`));
    }

    const embeds = dmTemplates.buildTestEmbeds(feature, variant, {
      guildName: message.guild.name,
      now: Date.now(),
    });

    try {
      for (const embed of embeds) {
        await message.author.send({ embeds: [embed] });
      }
    } catch (err) {
      return replyEmbed(
        message,
        errorEmbed(
          'Could not send DM',
          'Please check that your DMs are open (Server menu → Privacy Settings → allow direct messages), then try again.'
        )
      );
    }

    return replyEmbed(message, successEmbed('Test DM sent', 'Check your direct messages.'));
  },
};
