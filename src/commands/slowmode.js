// /slowmode seconds:<0-21600> [channel:#channel] : 채널의 슬로우모드를 설정/해제
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { createCommand } = require('../utils/slash');
const { errorEmbed, successEmbed, replyEmbed } = require('../utils/embeds');
const { sendLog } = require('../utils/logger');

const MAX_SECONDS = 21_600;

function formatDuration(seconds) {
  if (seconds === 0) return 'off';
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function supportsSlowmode(channel) {
  return !!channel && typeof channel.setRateLimitPerUser === 'function';
}

module.exports = {
  data: createCommand('slowmode', 'Set or remove slowmode for a channel.')
    .addIntegerOption((option) =>
      option
        .setName('seconds')
        .setDescription('Seconds between messages. Use 0 to remove slowmode.')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(MAX_SECONDS)
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to change. Defaults to this channel.')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread
        )
        .setRequired(false)
    ),
  usage: ['slowmode <seconds> [#channel]'],
  async execute(interaction) {
    const seconds = interaction.options.getInteger('seconds', true);
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;

    if (!supportsSlowmode(channel)) {
      return replyEmbed(
        interaction,
        errorEmbed('Slowmode is not available', 'Slowmode can only be changed in a text channel or thread.')
      );
    }

    const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
    if (!me || !channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
      return replyEmbed(
        interaction,
        errorEmbed('Could not set slowmode', 'The bot needs the Manage Channels permission in that channel.')
      );
    }

    const previousSeconds = channel.rateLimitPerUser ?? 0;
    try {
      await channel.setRateLimitPerUser(seconds, `Slowmode changed by ${interaction.user.username} (${interaction.user.id})`);
    } catch (err) {
      console.warn(`[slowmode] Could not set slowmode for ${channel.id}:`, err);
      return replyEmbed(
        interaction,
        errorEmbed('Could not set slowmode', 'Discord did not allow the slowmode setting to be changed. Please check the bot permissions.')
      );
    }

    await sendLog(interaction.client, {
      title: 'Slowmode changed',
      status: 'info',
      user: interaction.member,
      action: seconds === 0 ? 'Removed slowmode' : 'Set slowmode',
      fields: [
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Previous', value: formatDuration(previousSeconds), inline: true },
        { name: 'New', value: formatDuration(seconds), inline: true },
      ],
    });

    const action = seconds === 0 ? 'removed' : `set to ${formatDuration(seconds)}`;
    return replyEmbed(interaction, successEmbed('Slowmode updated', `Slowmode in <#${channel.id}> has been ${action}.`));
  },
};
