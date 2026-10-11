// ^mrbeast : 스팸 이미지 탐지 관리 (켜기/끄기, 테스트 모드, 알려진 이미지 해시, 키워드)
const config = require('../config');
const db = require('../db');
const { handleToggle } = require('../utils/toggleCommand');
const { infoEmbed, successEmbed, errorEmbed, warnEmbed, replyEmbed, truncate } = require('../utils/embeds');
const imageTools = require('../utils/imageTools');
const { isStillImage } = require('../features/imageSpam');
const { tidyKeyword, normalizeLoose } = require('../utils/textMatch');

const c = config.imageSpam;
const p = config.prefix;
const MAX_HASHES_PER_COMMAND = 5;

const USAGE_LINES = [
  `\`${p}mrbeast on\` / \`${p}mrbeast off\``,
  `\`${p}mrbeast testmode on\` / \`${p}mrbeast testmode off\``,
  `\`${p}mrbeast addhash [label]\` (attach image(s) to the same message)`,
  `\`${p}mrbeast removehash <number>\` / \`${p}mrbeast listhash\``,
  `\`${p}mrbeast addword <word or phrase>\``,
  `\`${p}mrbeast removeword <word or phrase>\` / \`${p}mrbeast listword\``,
];

function usageError(message, extra) {
  return replyEmbed(message, errorEmbed('Invalid usage', `${extra ? `${extra}\n\n` : ''}Usage:\n${USAGE_LINES.join('\n')}`));
}

// ---------- testmode ----------
async function handleTestMode(message, rest) {
  const arg = (rest[0] ?? '').toLowerCase();
  const current = db.isMrbeastTestMode();
  if (arg !== 'on' && arg !== 'off') {
    return usageError(message, `Test mode is currently **${current ? 'ON' : 'OFF'}**.`);
  }
  const enable = arg === 'on';
  if (current === enable) {
    return replyEmbed(message, infoEmbed(`Already ${enable ? 'ON' : 'OFF'}`, `Test mode is already ${enable ? 'ON' : 'OFF'}.`));
  }
  await db.setMrbeastTestMode(enable);
  return replyEmbed(
    message,
    successEmbed(
      `Test mode: ${enable ? 'ON' : 'OFF'}`,
      enable
        ? 'Spam image detection will only write to the log channel. No messages will be deleted and nobody will be punished.'
        : 'Test mode is off. Spam image detection will now really punish users.'
    )
  );
}

// ---------- 해시 ----------
async function handleAddHash(message, rest) {
  const label = rest.join(' ').trim().slice(0, 100);
  const images = [...message.attachments.values()].filter(isStillImage);
  if (!images.length) {
    return usageError(message, 'Attach at least one image (png, jpg or webp; GIFs and videos are not supported) to the same message.');
  }

  const lines = [];
  let added = 0;
  for (const attachment of images.slice(0, MAX_HASHES_PER_COMMAND)) {
    try {
      const hash = await imageTools.limitProcessing(async () => {
        const buffer = await imageTools.downloadImage(attachment.url);
        return imageTools.computePHash(buffer);
      });

      const duplicate = db
        .getKnownHashes()
        .map((k) => ({ k, distance: imageTools.hammingDistance(hash, k.phash) }))
        .find((x) => x.distance <= c.dedupeMaxDistance);
      if (duplicate) {
        lines.push(`⏭️ \`${attachment.name}\`: already registered as #${duplicate.k._id} (${duplicate.distance} bits different)`);
        continue;
      }

      const doc = await db.addKnownHash({ phash: hash, label, addedBy: message.author.id });
      added++;
      lines.push(`✅ \`${attachment.name}\`: registered as **#${doc._id}** (\`${hash}\`)`);
    } catch (err) {
      lines.push(`❌ \`${attachment.name}\`: ${err.message}`);
    }
  }
  if (images.length > MAX_HASHES_PER_COMMAND) {
    lines.push(`Only the first ${MAX_HASHES_PER_COMMAND} images were processed.`);
  }
  const embed = added ? successEmbed('Image hash registration', lines.join('\n')) : warnEmbed('No image hash was registered', lines.join('\n'));
  return replyEmbed(message, embed);
}

async function handleRemoveHash(message, rest) {
  const id = /^#?(\d{1,9})$/.exec(rest[0] ?? '');
  if (!id) return usageError(message, 'Please give the hash number shown in the list.');
  const removed = await db.removeKnownHash(Number(id[1]));
  return replyEmbed(
    message,
    removed
      ? successEmbed('Hash removed', `Removed hash #${id[1]}.`)
      : errorEmbed('Not found', `There is no hash #${id[1]}. Use \`${p}mrbeast listhash\` to see the list.`)
  );
}

function handleListHash(message) {
  const hashes = db.getKnownHashes();
  const lines = hashes.map((h) => {
    const label = h.label ? ` ${truncate(h.label, 60)}` : '';
    return `**#${h._id}** \`${h.phash}\`${label} (by <@${h.added_by}>, <t:${Math.floor(h.added_at.getTime() / 1000)}:d>)`;
  });
  return replyEmbed(
    message,
    infoEmbed(`Known image hashes (${hashes.length})`, truncate(lines.join('\n') || 'No image hashes registered.', 4000))
  );
}

// ---------- 키워드 ----------
async function handleAddWord(message, rest) {
  const word = tidyKeyword(rest.join(' '));
  const normalized = normalizeLoose(word);
  if (!word || !normalized) {
    return usageError(message, 'A keyword must contain at least one letter or number.');
  }
  const added = await db.addKnownKeyword({ word, normalized, addedBy: message.author.id });
  if (!added) {
    return replyEmbed(message, infoEmbed('Already registered', `\`${word}\` (or an equivalent keyword) is already in the list.`));
  }
  const warning =
    normalized.length < 4
      ? '\n\nThis keyword is very short and may match harmless images by accident. Test mode is recommended.'
      : '';
  return replyEmbed(
    message,
    successEmbed(
      'Keyword added',
      `Added \`${word}\`.\nMatching ignores case, spaces and punctuation, and partial matches count.${warning}`
    )
  );
}

async function handleRemoveWord(message, rest) {
  const word = tidyKeyword(rest.join(' '));
  if (!word) return usageError(message, 'Please give the keyword to remove.');
  const normalized = normalizeLoose(word);
  const target = db.getKnownKeywords().find((k) => k.word === word || (normalized && k.normalized === normalized));
  const removed = target ? await db.removeKnownKeyword(target.word) : false;
  return replyEmbed(
    message,
    removed
      ? successEmbed('Keyword removed', `Removed \`${target.word}\`.`)
      : errorEmbed('Not found', `\`${word}\` is not in the list. Use \`${p}mrbeast listword\` to see the list.`)
  );
}

function handleListWord(message) {
  const words = db.getKnownKeywords();
  const lines = words.map((k) => `\`${k.word}\` (by <@${k.added_by}>, <t:${Math.floor(k.added_at.getTime() / 1000)}:d>)`);
  return replyEmbed(
    message,
    infoEmbed(`Keywords (${words.length})`, truncate(lines.join('\n') || 'No keywords registered.', 4000))
  );
}

module.exports = {
  name: 'mrbeast',
  description:
    `Spam image detection. Triggers when a user posts images in ${c.channelCount}+ different channels within ${c.channelWindowMin} minutes ` +
    `(GIFs/videos excluded; skipped if there are more than ${c.maxUniqueImages} unique images). Each unique image is checked against known scam image hashes ` +
    `and OCR keywords. Both match: kick (ban + unban, last ${c.deleteWindowMin} min of messages deleted). One match: delete messages + ${c.timeoutHours}-hour timeout. ` +
    'Test mode only writes to the log channel.',
  usage: [
    'mrbeast on',
    'mrbeast off',
    'mrbeast testmode on',
    'mrbeast testmode off',
    'mrbeast addhash [label] (attach image)',
    'mrbeast removehash <number>',
    'mrbeast listhash',
    'mrbeast addword <word or phrase>',
    'mrbeast removeword <word or phrase>',
    'mrbeast listword',
  ],
  async execute(message, args) {
    const sub = (args[0] ?? '').toLowerCase();
    const rest = args.slice(1);
    switch (sub) {
      case 'on':
      case 'off':
        return handleToggle(message, args, 'mrbeast', 'Spam image detection');
      case 'testmode':
        return handleTestMode(message, rest);
      case 'addhash':
        return handleAddHash(message, rest);
      case 'removehash':
        return handleRemoveHash(message, rest);
      case 'listhash':
        return handleListHash(message);
      case 'addword':
        return handleAddWord(message, rest);
      case 'removeword':
        return handleRemoveWord(message, rest);
      case 'listword':
        return handleListWord(message);
      default:
        return usageError(message);
    }
  },
};
