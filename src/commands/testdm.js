const dmTemplates = require('../utils/dmTemplates');
const { createCommand } = require('../utils/slash');
const { successEmbed, errorEmbed, replyEmbed } = require('../utils/embeds');

module.exports = {
  data: createCommand('testdm', 'Send yourself a sample of a punishment DM.')
    .addStringOption((option) =>
      option
        .setName('feature')
        .setDescription('Which feature\'s punishment DM to send.')
        .setRequired(true)
        .addChoices(...dmTemplates.FEATURE_NAMES.map((name) => ({ name, value: name })))
    )
    .addStringOption((option) =>
      option
        .setName('variant')
        .setDescription('Only for mrbeast: ban or timeout (leave empty to send both).')
        .addChoices(...dmTemplates.MRBEAST_VARIANTS.map((name) => ({ name, value: name })))
    ),
  ephemeral: true, // 응답은 명령어를 쓴 사람에게만 보임
  usage: ['testdm <feature>', 'testdm mrbeast <ban|timeout>'],
  async execute(interaction) {
    const feature = interaction.options.getString('feature', true);
    const variant = interaction.options.getString('variant') ?? undefined;

    if (variant && feature !== 'mrbeast') {
      return replyEmbed(interaction, errorEmbed('Invalid usage', 'The variant option is only used with `mrbeast`.'));
    }

    const embeds = dmTemplates.buildTestEmbeds(feature, variant, {
      guildName: interaction.guild.name,
      now: Date.now(),
    });

    try {
      for (const embed of embeds) {
        await interaction.user.send({ embeds: [embed] });
      }
    } catch (err) {
      return replyEmbed(
        interaction,
        errorEmbed(
          'Could not send DM',
          'Please check that your DMs are open (Server menu → Privacy Settings → allow direct messages), then try again.'
        )
      );
    }

    return replyEmbed(interaction, successEmbed('Test DM sent', 'Check your direct messages.'));
  },
};
