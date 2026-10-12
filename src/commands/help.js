const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');
const { infoEmbed } = require('../utils/embeds');

const PAGE_TIMEOUT_MS = 300_000; // 이 시간이 지나면 버튼이 비활성화됨

// ---- ^help 에 표시할 요약 (페이지 구성 + 한 줄 설명 + 짧은 사용법) ----
// 새 명령어를 만들었을 때 여기에 등록하지 않아도 "Other" 페이지에 자동으로 나타남 (명령어 파일의 description/usage 사용).
// 명령어 파일의 긴 description 은 그대로 두고, ^help 에서만 짧게 보여줌.
const PAGES = [
  {
    title: 'Auto-moderation',
    commands: ['accountage', 'pingspam', 'emojispam', 'samespam', 'mrbeast'],
  },
  {
    title: 'Management',
    commands: ['whitelist', 'status', 'testdm', 'keepalive'],
  },
  {
    title: 'General',
    commands: ['ping', 'roleicon', 'help'],
  },
];

const SUMMARIES = {
  accountage: {
    summary: `Timeout new accounts younger than ${config.accountAge.minDays} days.`,
    usage: ['accountage on|off'],
  },
  pingspam: {
    summary: 'Detect mass mentions and punish with a timeout.',
    usage: ['pingspam on|off'],
  },
  emojispam: {
    summary: 'Detect emoji spam. Exempt channels also apply to same-message spam.',
    usage: ['emojispam on|off', 'emojispam exempt add|remove #channel ...', 'emojispam exempt list'],
  },
  samespam: {
    summary: 'Detect the same message sent repeatedly.',
    usage: ['samespam on|off'],
  },
  mrbeast: {
    summary: 'Detect scam images posted across channels (image hashes + OCR keywords).',
    usage: [
      'mrbeast on|off',
      'mrbeast testmode on|off',
      'mrbeast addhash [label] (attach image)',
      'mrbeast removehash <number>',
      'mrbeast addword <word or phrase>',
      'mrbeast removeword <word or phrase>',
      'mrbeast listhash | listword',
    ],
  },
  whitelist: {
    summary: 'Manage roles that skip auto-moderation and can use commands.',
    usage: ['whitelist add|remove @role', 'whitelist list'],
  },
  status: {
    summary: 'Show feature on/off states, test mode, exempt channels and whitelisted roles.',
    usage: ['status'],
  },
  testdm: {
    summary: 'Send yourself a sample of a punishment DM.',
    usage: ['testdm <feature>', 'testdm mrbeast ban|timeout'],
  },
  keepalive: {
    summary: '(Developer only) Keep-alive self-ping for Render.',
    usage: ['keepalive on|off'],
  },
  ping: {
    summary: 'Check that the bot is alive and show its latency.',
    usage: ['ping'],
  },
  roleicon: {
    summary: 'Set or remove your booster role icon (anyone can use).',
    usage: ['roleicon (attach PNG/JPG, max 256 KB)', 'roleicon remove'],
  },
  help: {
    summary: 'Show this command list.',
    usage: ['help'],
  },
};

// 명령어 하나를 임베드 필드로 변환
function toField(cmd) {
  const info = SUMMARIES[cmd.name] ?? {
    summary: cmd.description ?? '',
    usage: cmd.usage ?? [cmd.name],
  };
  const usage = info.usage.map((u) => `\`${config.prefix}${u}\``).join('\n');
  return { name: `${config.prefix}${cmd.name}`, value: `${info.summary}\n${usage}` };
}

// 이 사용자에게 보여줄 페이지 목록을 만든다 (개발자 전용 명령어는 개발자에게만, 빈 페이지는 제외)
function buildPages(client, isDeveloper) {
  const visible = new Map(
    [...client.commands.values()]
      .filter((cmd) => !cmd.developerOnly || isDeveloper)
      .map((cmd) => [cmd.name, cmd])
  );

  const pages = [];
  for (const page of PAGES) {
    const cmds = page.commands.map((name) => visible.get(name)).filter(Boolean);
    cmds.forEach((cmd) => visible.delete(cmd.name));
    if (cmds.length) pages.push({ title: page.title, cmds });
  }

  // 위 목록에 없는 새 명령어는 마지막 "Other" 페이지로
  const others = [...visible.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (others.length) pages.push({ title: 'Other', cmds: others });
  return pages;
}

function buildEmbed(pages, index) {
  const page = pages[index];
  const embed = infoEmbed(
    `Command list - ${page.title}`,
    `Prefix: \`${config.prefix}\` | Only administrators and whitelisted roles can use these commands (except where noted).`
  );
  embed.addFields(page.cmds.map(toField));
  embed.setFooter({ text: `Page ${index + 1}/${pages.length}` });
  return embed;
}

function buildButtons(index, total, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('help_prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || index === 0),
    new ButtonBuilder()
      .setCustomId('help_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || index === total - 1)
  );
}

module.exports = {
  name: 'help',
  description: 'Show the list of available commands.',
  usage: ['help'],
  async execute(message, args, client) {
    const isDeveloper = !!process.env.DEVELOPER_ID && message.author.id === process.env.DEVELOPER_ID;
    const pages = buildPages(client, isDeveloper);
    if (pages.length === 0) return;

    let index = 0;
    const reply = await message.reply({
      embeds: [buildEmbed(pages, index)],
      components: pages.length > 1 ? [buildButtons(index, pages.length)] : [],
      allowedMentions: { repliedUser: false },
    });
    if (pages.length <= 1) return;

    // 명령어를 친 사람만 버튼으로 페이지를 넘길 수 있음
    const collector = reply.createMessageComponentCollector({ time: PAGE_TIMEOUT_MS });

    collector.on('collect', async (interaction) => {
      try {
        if (interaction.user.id !== message.author.id) {
          return await interaction.reply({
            content: 'Only the person who ran this command can use these buttons.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (interaction.customId === 'help_prev') index = Math.max(0, index - 1);
        else if (interaction.customId === 'help_next') index = Math.min(pages.length - 1, index + 1);

        await interaction.update({
          embeds: [buildEmbed(pages, index)],
          components: [buildButtons(index, pages.length)],
        });
      } catch (err) {
        console.error('[command:help] Button error:', err);
      }
    });

    // 시간이 지나면 버튼을 비활성화
    collector.on('end', () => {
      reply.edit({ components: [buildButtons(index, pages.length, true)] }).catch(() => {});
    });
  },
};
