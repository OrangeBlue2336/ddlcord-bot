const config = require('../config');
const db = require('../db');
const { handleToggle } = require('../utils/toggleCommand');
const { infoEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/embeds');

const c = config.emojiSpam;

// 인자 하나가 채널 멘션(<#ID>) 또는 채널 ID 숫자이면 ID 를 돌려줌
function parseChannelId(arg) {
  const match = /^<#(\d{17,20})>$/.exec(arg) ?? /^(\d{17,20})$/.exec(arg);
  return match ? match[1] : null;
}

async function handleExempt(message, rest, client) {
  const action = (rest[0] ?? '').toLowerCase();

  if (action === 'list') {
    const ids = db.getSpamExemptChannelIds();
    const description = ids.length
      ? ids.map((id) => `<#${id}>`).join('\n')
      : 'No exempt channels registered.';
    return replyEmbed(
      message,
      infoEmbed('Exempt channels', `${description}\n\nThese channels (and their threads/forum posts) are skipped by both emoji spam and same-message spam detection.`)
    );
  }

  if (action === 'add' || action === 'remove') {
    const tokens = rest.slice(1);
    const ids = [];
    const unreadable = [];
    for (const token of tokens) {
      const id = parseChannelId(token);
      if (!id) unreadable.push(token);
      else if (!ids.includes(id)) ids.push(id);
    }
    if (!ids.length) {
      const unreadableText = unreadable.length ? `\nCould not read: ${unreadable.map((t) => `\`${t}\``).join(' ')}` : '';
      return replyEmbed(
        message,
        errorEmbed('Channel not specified', `Usage: \`^emojispam exempt ${action} #channel [#channel2 ...]\` (a channel ID also works)${unreadableText}`)
      );
    }

    const changed = [];
    const unchanged = [];
    const notFound = [];
    for (const id of ids) {
      if (action === 'add') {
        const channel = await client.channels.fetch(id).catch(() => null);
        if (!channel || channel.guildId !== message.guild.id) {
          notFound.push(id);
        } else if (await db.addSpamExemptChannel(id)) {
          changed.push(id);
        } else {
          unchanged.push(id);
        }
      } else if (await db.removeSpamExemptChannel(id)) {
        changed.push(id);
      } else {
        unchanged.push(id);
      }
    }

    const lines = [];
    if (changed.length) lines.push(`${action === 'add' ? 'Added' : 'Removed'}: ${changed.map((id) => `<#${id}>`).join(' ')}`);
    if (unchanged.length) lines.push(`${action === 'add' ? 'Already exempt' : 'Was not in the list'}: ${unchanged.map((id) => `<#${id}>`).join(' ')}`);
    if (notFound.length) lines.push(`Not found in this server: ${notFound.map((id) => `\`${id}\``).join(' ')}`);
    if (unreadable.length) lines.push(`Could not read: ${unreadable.map((t) => `\`${t}\``).join(' ')}`);

    const embed = changed.length
      ? successEmbed('Exempt channels updated', lines.join('\n'))
      : notFound.length || unreadable.length
        ? errorEmbed('Nothing changed', lines.join('\n'))
        : infoEmbed('No changes', lines.join('\n'));
    return replyEmbed(message, embed);
  }

  return replyEmbed(
    message,
    errorEmbed('Invalid usage', 'Usage:\n`^emojispam exempt add #channel [#channel2 ...]`\n`^emojispam exempt remove #channel [#channel2 ...]`\n`^emojispam exempt list`')
  );
}

module.exports = {
  name: 'emojispam',
  description:
    `Turn emoji spam detection on or off (${c.perMessageLimit}+ emojis in one message, or ${c.burstCount}+ messages with emojis within ${c.burstWindowSec}s in the same channel; ` +
    `${c.timeoutMin}-minute timeout). Exempt channels (and their threads/forum posts) are also skipped by same-message spam detection.`,
  usage: [
    'emojispam on',
    'emojispam off',
    'emojispam exempt add #channel [#channel2 ...]',
    'emojispam exempt remove #channel [#channel2 ...]',
    'emojispam exempt list',
  ],
  async execute(message, args, client) {
    const sub = (args[0] ?? '').toLowerCase();
    if (sub === 'exempt') return handleExempt(message, args.slice(1), client);
    return handleToggle(message, args, 'emojispam', 'Emoji spam detection');
  },
};
