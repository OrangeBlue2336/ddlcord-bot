const { ChannelType } = require('discord.js');
const db = require('../db');
const { createCommand, addOnOffSubcommands } = require('../utils/slash');
const { handleToggle } = require('../utils/toggleCommand');
const { infoEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/embeds');

// 예외 채널로 고를 수 있는 채널 종류 (카테고리는 제외. 스레드/포럼 게시글은 부모 채널을 등록하면 함께 예외)
const CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

// 슬래시 명령어는 채널 옵션 하나에 채널 하나만 고를 수 있어서, 여러 개를 한 번에 처리하려고 channel ~ channel5 를 둔다
const CHANNEL_OPTION_NAMES = ['channel', 'channel2', 'channel3', 'channel4', 'channel5'];

function addChannelOptions(sub, { firstRequired }) {
  CHANNEL_OPTION_NAMES.forEach((name, index) => {
    sub.addChannelOption((option) =>
      option
        .setName(name)
        .setDescription(index === 0 ? 'A channel.' : 'Another channel (optional).')
        .addChannelTypes(...CHANNEL_TYPES)
        .setRequired(index === 0 && firstRequired)
    );
  });
  return sub;
}

// 채널 멘션(<#ID>) 또는 채널 ID 숫자이면 ID 를 돌려줌
function parseChannelId(token) {
  const match = /^<#(\d{17,20})>$/.exec(token) ?? /^(\d{17,20})$/.exec(token);
  return match ? match[1] : null;
}

// 고른 채널들과(remove 일 때) channel_id 칸에 적은 ID 들을 모아서 돌려줌
function collectChannelIds(interaction) {
  const ids = [];
  const unreadable = [];
  for (const name of CHANNEL_OPTION_NAMES) {
    const channel = interaction.options.getChannel(name);
    if (channel && !ids.includes(channel.id)) ids.push(channel.id);
  }
  const raw = interaction.options.getString('channel_id');
  for (const token of (raw ?? '').split(/[\s,]+/).filter(Boolean)) {
    const id = parseChannelId(token);
    if (!id) unreadable.push(token);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unreadable };
}

async function handleExempt(interaction) {
  const action = interaction.options.getSubcommand();

  if (action === 'list') {
    const ids = db.getSpamExemptChannelIds();
    const description = ids.length ? ids.map((id) => `<#${id}>`).join('\n') : 'No exempt channels registered.';
    return replyEmbed(
      interaction,
      infoEmbed('Exempt channels', `${description}\n\nThese channels (and their threads/forum posts) are skipped by both emoji spam and same-message spam detection.`)
    );
  }

  const { ids, unreadable } = collectChannelIds(interaction);
  if (!ids.length) {
    const unreadableText = unreadable.length ? `\nCould not read: ${unreadable.map((t) => `\`${t}\``).join(' ')}` : '';
    return replyEmbed(
      interaction,
      errorEmbed('Channel not specified', `Choose at least one \`channel\` (or enter \`channel_id\` for a deleted channel).${unreadableText}`)
    );
  }

  const changed = [];
  const unchanged = [];
  for (const id of ids) {
    const done = action === 'add' ? await db.addSpamExemptChannel(id) : await db.removeSpamExemptChannel(id);
    (done ? changed : unchanged).push(id);
  }

  const lines = [];
  if (changed.length) lines.push(`${action === 'add' ? 'Added' : 'Removed'}: ${changed.map((id) => `<#${id}>`).join(' ')}`);
  if (unchanged.length) lines.push(`${action === 'add' ? 'Already exempt' : 'Was not in the list'}: ${unchanged.map((id) => `<#${id}>`).join(' ')}`);
  if (unreadable.length) lines.push(`Could not read: ${unreadable.map((t) => `\`${t}\``).join(' ')}`);

  const embed = changed.length
    ? successEmbed('Exempt channels updated', lines.join('\n'))
    : unreadable.length
      ? errorEmbed('Nothing changed', lines.join('\n'))
      : infoEmbed('No changes', lines.join('\n'));
  return replyEmbed(interaction, embed);
}

module.exports = {
  data: addOnOffSubcommands(createCommand('emojispam', 'Emoji spam detection and exempt channels.'), 'emoji spam detection').addSubcommandGroup(
    (group) =>
      group
        .setName('exempt')
        .setDescription('Channels skipped by emoji spam and same-message spam detection.')
        .addSubcommand((sub) => addChannelOptions(sub.setName('add').setDescription('Add exempt channels (up to 5 at once).'), { firstRequired: true }))
        .addSubcommand((sub) =>
          addChannelOptions(sub.setName('remove').setDescription('Remove exempt channels (up to 5 at once).'), { firstRequired: false }).addStringOption(
            (option) => option.setName('channel_id').setDescription('Channel ID(s), for channels deleted from the server.').setMaxLength(200)
          )
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('Show the exempt channels.'))
  ),
  usage: ['emojispam on|off', 'emojispam exempt add|remove #channel ...', 'emojispam exempt list'],
  async execute(interaction) {
    if (interaction.options.getSubcommandGroup(false) === 'exempt') return handleExempt(interaction);
    return handleToggle(interaction, 'emojispam', 'Emoji spam detection');
  },
};
