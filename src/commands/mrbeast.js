// /mrbeast : 스팸 이미지 탐지 관리 (켜기/끄기, 테스트 모드, 알려진 이미지 해시, 키워드)
const db = require('../db');
const config = require('../config');
const { createCommand, addOnOffSubcommands } = require('../utils/slash');
const { handleToggle } = require('../utils/toggleCommand');
const { infoEmbed, successEmbed, errorEmbed, warnEmbed, replyEmbed, truncate } = require('../utils/embeds');
const imageTools = require('../utils/imageTools');
const { isStillImage } = require('../features/imageSpam');
const { tidyKeyword, normalizeLoose } = require('../utils/textMatch');

const c = config.imageSpam;
const IMAGE_OPTION_NAMES = ['image1', 'image2', 'image3', 'image4', 'image5']; // 한 번에 최대 5장

const invalid = (interaction, text) => replyEmbed(interaction, errorEmbed('Invalid input', text));

// ---------- testmode ----------
async function handleTestMode(interaction) {
  const enable = interaction.options.getSubcommand() === 'on';
  const current = db.isMrbeastTestMode();
  if (current === enable) {
    return replyEmbed(interaction, infoEmbed(`Already ${enable ? 'ON' : 'OFF'}`, `Test mode is already ${enable ? 'ON' : 'OFF'}.`));
  }
  await db.setMrbeastTestMode(enable);
  return replyEmbed(
    interaction,
    successEmbed(
      `Test mode: ${enable ? 'ON' : 'OFF'}`,
      enable
        ? 'Spam image detection will only write to the log channel. No messages will be deleted and nobody will be punished.'
        : 'Test mode is off. Spam image detection will now really punish users.'
    )
  );
}

// ---------- 해시 ----------
async function handleAddHash(interaction) {
  const label = (interaction.options.getString('label') ?? '').trim().slice(0, 100);
  const attachments = IMAGE_OPTION_NAMES.map((name) => interaction.options.getAttachment(name)).filter(Boolean);
  const images = attachments.filter(isStillImage);
  if (!images.length) {
    return invalid(interaction, 'Attach at least one still image (png, jpg or webp). GIFs, SVGs and videos are not supported.');
  }

  const lines = [];
  let added = 0;
  for (const attachment of images) {
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

      const doc = await db.addKnownHash({ phash: hash, label, addedBy: interaction.user.id });
      added++;
      lines.push(`✅ \`${attachment.name}\`: registered as **#${doc._id}** (\`${hash}\`)`);
    } catch (err) {
      lines.push(`❌ \`${attachment.name}\`: ${err.message}`);
    }
  }
  const skipped = attachments.length - images.length;
  if (skipped) lines.push(`${skipped} file(s) were skipped because they are not still images.`);
  const embed = added ? successEmbed('Image hash registration', lines.join('\n')) : warnEmbed('No image hash was registered', lines.join('\n'));
  return replyEmbed(interaction, embed);
}

async function handleRemoveHash(interaction) {
  const number = interaction.options.getInteger('number', true);
  const removed = await db.removeKnownHash(number);
  return replyEmbed(
    interaction,
    removed
      ? successEmbed('Hash removed', `Removed hash #${number}.`)
      : errorEmbed('Not found', `There is no hash #${number}. Use \`/mrbeast listhash\` to see the list.`)
  );
}

function handleListHash(interaction) {
  const hashes = db.getKnownHashes();
  const lines = hashes.map((h) => {
    const label = h.label ? ` ${truncate(h.label, 60)}` : '';
    return `**#${h._id}** \`${h.phash}\`${label} (by <@${h.added_by}>, <t:${Math.floor(h.added_at.getTime() / 1000)}:d>)`;
  });
  return replyEmbed(
    interaction,
    infoEmbed(`Known image hashes (${hashes.length})`, truncate(lines.join('\n') || 'No image hashes registered.', 4000))
  );
}

// ---------- 키워드 ----------
async function handleAddWord(interaction) {
  const word = tidyKeyword(interaction.options.getString('word', true));
  const normalized = normalizeLoose(word);
  if (!word || !normalized) {
    return invalid(interaction, 'A keyword must contain at least one letter or number.');
  }
  const added = await db.addKnownKeyword({ word, normalized, addedBy: interaction.user.id });
  if (!added) {
    return replyEmbed(interaction, infoEmbed('Already registered', `\`${word}\` (or an equivalent keyword) is already in the list.`));
  }
  const warning =
    normalized.length < 4
      ? '\n\nThis keyword is very short and may match harmless images by accident. Test mode is recommended.'
      : '';
  return replyEmbed(
    interaction,
    successEmbed(
      'Keyword added',
      `Added \`${word}\`.\nMatching ignores case, spaces and punctuation, and partial matches count.${warning}`
    )
  );
}

async function handleRemoveWord(interaction) {
  const word = tidyKeyword(interaction.options.getString('word', true));
  if (!word) return invalid(interaction, 'Please give the keyword to remove.');
  const normalized = normalizeLoose(word);
  const target = db.getKnownKeywords().find((k) => k.word === word || (normalized && k.normalized === normalized));
  const removed = target ? await db.removeKnownKeyword(target.word) : false;
  return replyEmbed(
    interaction,
    removed
      ? successEmbed('Keyword removed', `Removed \`${target.word}\`.`)
      : errorEmbed('Not found', `\`${word}\` is not in the list. Use \`/mrbeast listword\` to see the list.`)
  );
}

function handleListWord(interaction) {
  const words = db.getKnownKeywords();
  const lines = words.map((k) => `\`${k.word}\` (by <@${k.added_by}>, <t:${Math.floor(k.added_at.getTime() / 1000)}:d>)`);
  return replyEmbed(
    interaction,
    infoEmbed(`Keywords (${words.length})`, truncate(lines.join('\n') || 'No keywords registered.', 4000))
  );
}

// ---------- 명령어 정의 ----------
const data = addOnOffSubcommands(createCommand('mrbeast', 'Spam image detection: on/off, test mode, image hashes, keywords.'), 'spam image detection')
  .addSubcommandGroup((group) =>
    addOnOffSubcommands(group.setName('testmode').setDescription('Test mode: only write to the log channel, punish nobody.'), 'test mode')
  )
  .addSubcommand((sub) => {
    sub.setName('addhash').setDescription('Register known scam image(s) by attaching them.');
    // 필수 옵션이 선택 옵션보다 앞에 와야 한다 (image1 필수, 나머지 선택, 마지막에 label)
    IMAGE_OPTION_NAMES.forEach((name, index) => {
      sub.addAttachmentOption((option) =>
        option.setName(name).setDescription(index === 0 ? 'A scam image (png, jpg, webp).' : 'Another image (optional).').setRequired(index === 0)
      );
    });
    return sub.addStringOption((option) => option.setName('label').setDescription('A note shown in the list (optional).').setMaxLength(100));
  })
  .addSubcommand((sub) =>
    sub
      .setName('removehash')
      .setDescription('Remove a registered image hash by its number.')
      .addIntegerOption((option) =>
        option.setName('number').setDescription('The hash number shown in /mrbeast listhash.').setRequired(true).setMinValue(1).setMaxValue(999999999)
      )
  )
  .addSubcommand((sub) => sub.setName('listhash').setDescription('Show the registered image hashes.'))
  .addSubcommand((sub) =>
    sub
      .setName('addword')
      .setDescription('Register a scam keyword or phrase (matched in OCR text).')
      .addStringOption((option) => option.setName('word').setDescription('The word or phrase.').setRequired(true).setMaxLength(200))
  )
  .addSubcommand((sub) =>
    sub
      .setName('removeword')
      .setDescription('Remove a registered keyword or phrase.')
      .addStringOption((option) => option.setName('word').setDescription('The word or phrase to remove.').setRequired(true).setMaxLength(200))
  )
  .addSubcommand((sub) => sub.setName('listword').setDescription('Show the registered keywords.'));

module.exports = {
  data,
  usage: [
    'mrbeast on|off',
    'mrbeast testmode on|off',
    'mrbeast addhash (attach image) [label]',
    'mrbeast removehash <number>',
    'mrbeast addword <word or phrase>',
    'mrbeast removeword <word or phrase>',
    'mrbeast listhash | listword',
  ],
  async execute(interaction) {
    if (interaction.options.getSubcommandGroup(false) === 'testmode') return handleTestMode(interaction);

    switch (interaction.options.getSubcommand()) {
      case 'on':
      case 'off':
        return handleToggle(interaction, 'mrbeast', 'Spam image detection');
      case 'addhash':
        return handleAddHash(interaction);
      case 'removehash':
        return handleRemoveHash(interaction);
      case 'listhash':
        return handleListHash(interaction);
      case 'addword':
        return handleAddWord(interaction);
      case 'removeword':
        return handleRemoveWord(interaction);
      case 'listword':
        return handleListWord(interaction);
      default:
        return invalid(interaction, 'Unknown subcommand.');
    }
  },
};
