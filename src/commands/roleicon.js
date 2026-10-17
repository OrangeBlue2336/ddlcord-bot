// /roleicon : 부스터 역할 아이콘 설정/제거 (모든 유저가 사용 가능)
//   /roleicon set image:(이미지)  -> 내 부스터 역할의 아이콘을 첨부한 이미지로 변경
//   /roleicon remove              -> 내 부스터 역할의 아이콘 제거
//
// "부스터 역할" 판정: config.roleIcon.guilds[서버ID] 의 아래 기준 역할 ~ 위 기준 역할 "사이"(두 역할 제외)에 있는
// 역할 중 명령어를 쓴 멤버가 가진 역할. 없으면 "찾을 수 없음", 2개 이상이면 관리자 문의 안내 (변경하지 않음)
const { PermissionFlagsBits, GuildFeature } = require('discord.js');
const config = require('../config');
const { createCommand } = require('../utils/slash');
const { infoEmbed, successEmbed, errorEmbed, warnEmbed, replyEmbed, truncate } = require('../utils/embeds');
const { downloadImage } = require('../utils/imageTools');
const { describeError } = require('../utils/describeError');
const { sendLog } = require('../utils/logger');

const cfg = config.roleIcon;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const cooldowns = new Map(); // userId -> 이 시각(ms)까지 사용 불가

// ---------- 이미지 검사 ----------
// 파일 앞부분(매직 넘버)으로 진짜 PNG/JPEG 인지 확인 (확장자만 바꾼 파일 방지)
function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}

// 문제가 없으면 { buffer, name }, 문제가 있으면 { problem: '안내 문구' }
// (슬래시 명령어의 image 옵션은 첨부파일 1개만 받으므로 "첨부 없음/여러 장" 검사는 필요 없음)
async function checkAttachment(file) {
  const extension = (file.name ?? '').split('.').pop()?.toLowerCase() ?? '';
  const allowedText = cfg.allowedExtensions.map((e) => e.toUpperCase()).join(', ');
  if (!cfg.allowedExtensions.includes(extension)) {
    return { problem: `Unsupported file type: \`.${extension || '?'}\`\nAllowed types: ${allowedText}` };
  }
  if (file.size > cfg.maxBytes) {
    return { problem: `The image is too large: ${kb(file.size)}\nThe maximum size is ${kb(cfg.maxBytes)}.` };
  }

  let buffer;
  try {
    // 신고된 크기를 믿지 않고 실제로 내려받아 한 번 더 확인 (한도보다 조금만 더 받아 보고 초과면 거부)
    buffer = await downloadImage(file.url, { maxBytes: cfg.maxBytes + 1 });
  } catch (err) {
    if (/too large/i.test(err.message)) {
      return { problem: `The image is too large. The maximum size is ${kb(cfg.maxBytes)}.` };
    }
    return { problem: `Could not download the image (${err.message}). Please try again.` };
  }
  if (buffer.length > cfg.maxBytes) {
    return { problem: `The image is too large: ${kb(buffer.length)}\nThe maximum size is ${kb(cfg.maxBytes)}.` };
  }
  if (!detectImageType(buffer)) {
    return { problem: `This file is not a real ${allowedText} image (the file content does not match its extension).` };
  }
  return { buffer, name: file.name, size: buffer.length };
}

// ---------- 대상 역할 찾기 ----------
// 반환: { role } | { embed }  (embed 는 그대로 보여줄 안내)
function findTargetRole(interaction, member) {
  const guild = interaction.guild;
  const setting = cfg.guilds[guild.id];
  const adminHint = 'Please contact an administrator.';

  if (!setting?.lowerRoleId || !setting?.upperRoleId) {
    return { embed: errorEmbed('Role icon is not set up', `This server has no role icon settings yet. ${adminHint}`) };
  }
  const lower = guild.roles.cache.get(setting.lowerRoleId);
  const upper = guild.roles.cache.get(setting.upperRoleId);
  if (!lower || !upper || lower.position >= upper.position) {
    console.error(`[roleicon] Invalid role icon settings for server ${guild.id} (a role is missing or the lower role is not below the upper role).`);
    return { embed: errorEmbed('Role icon settings are invalid', `The role icon settings of this server are not correct. ${adminHint}`) };
  }

  // 두 기준 역할 사이에 있고, 멤버가 가지고 있는 역할 (봇/연동 역할은 제외)
  const matches = member.roles.cache.filter(
    (role) => !role.managed && role.position > lower.position && role.position < upper.position
  );

  if (matches.size === 0) {
    return {
      embed: errorEmbed(
        'Booster role not found',
        'You do not have a booster role, so there is no role icon to change.\nOnly server boosters with a custom role can use this command.'
      ),
    };
  }
  if (matches.size > 1) {
    const list = matches.sort((a, b) => b.position - a.position).map((r) => `<@&${r.id}>`).join(', ');
    return {
      embed: warnEmbed(
        'Multiple booster roles found',
        `You have more than one role that could be a booster role, so nothing was changed.\n${list}\n\nPlease contact an administrator.`
      ),
    };
  }
  return { role: matches.first() };
}

// ---------- 서버/봇 조건 ----------
// 문제가 없으면 null, 있으면 안내 문구
async function checkServerAndBot(interaction, role) {
  const guild = interaction.guild;
  if (!guild.features.includes(GuildFeature.RoleIcons)) {
    return 'This server cannot use role icons yet. Role icons require Server Boost Level 2 or higher.';
  }
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'The bot does not have the **Manage Roles** permission. Please contact an administrator.';
  }
  if (role.position >= me.roles.highest.position) {
    return `The bot cannot edit <@&${role.id}> because that role is above the bot's highest role. Please contact an administrator.`;
  }
  return null;
}

// ---------- 하위 명령어 ----------
async function handleSet(interaction, member, role) {
  const checked = await checkAttachment(interaction.options.getAttachment('image', true));
  if (checked.problem) {
    return replyEmbed(interaction, errorEmbed('Could not set the role icon', checked.problem));
  }
  const problem = await checkServerAndBot(interaction, role);
  if (problem) return replyEmbed(interaction, errorEmbed('Could not set the role icon', problem));

  cooldowns.set(interaction.user.id, Date.now() + cfg.cooldownSec * 1000);
  try {
    await role.setIcon(checked.buffer, `Role icon set by ${interaction.user.username} (${interaction.user.id})`);
  } catch (err) {
    console.warn(`[roleicon] setIcon failed: ${describeError(err)}`);
    const reason =
      err?.code === 50035
        ? `Discord rejected the image. Please try a different image (a square PNG or JPG around 64x64 works best).\n\`${truncate(err.message, 300)}\``
        : describeError(err);
    return replyEmbed(interaction, errorEmbed('Could not set the role icon', reason));
  }

  await sendLog(interaction.client, {
    title: 'Role icon changed',
    status: 'info',
    user: member,
    action: 'Set role icon',
    fields: [
      { name: 'Role', value: `<@&${role.id}> (${role.name})`, inline: true },
      { name: 'Image', value: `${truncate(checked.name, 100)} (${kb(checked.size)})`, inline: true },
    ],
  });
  return replyEmbed(interaction, successEmbed('Role icon updated', `The icon of <@&${role.id}> has been changed.`));
}

async function handleRemove(interaction, member, role) {
  if (!role.icon && !role.unicodeEmoji) {
    return replyEmbed(interaction, infoEmbed('No role icon', `<@&${role.id}> does not have an icon, so there is nothing to remove.`));
  }
  const problem = await checkServerAndBot(interaction, role);
  if (problem) return replyEmbed(interaction, errorEmbed('Could not remove the role icon', problem));

  cooldowns.set(interaction.user.id, Date.now() + cfg.cooldownSec * 1000);
  try {
    // 이미지 아이콘과 이모지 아이콘 모두 "역할 아이콘"이므로 둘 다 제거
    await role.edit({
      icon: null,
      ...(role.unicodeEmoji ? { unicodeEmoji: null } : {}),
      reason: `Role icon removed by ${interaction.user.username} (${interaction.user.id})`,
    });
  } catch (err) {
    console.warn(`[roleicon] remove failed: ${describeError(err)}`);
    return replyEmbed(interaction, errorEmbed('Could not remove the role icon', describeError(err)));
  }

  await sendLog(interaction.client, {
    title: 'Role icon removed',
    status: 'info',
    user: member,
    action: 'Removed role icon',
    fields: [{ name: 'Role', value: `<@&${role.id}> (${role.name})`, inline: true }],
  });
  return replyEmbed(interaction, successEmbed('Role icon removed', `The icon of <@&${role.id}> has been removed.`));
}

module.exports = {
  data: createCommand('roleicon', 'Set or remove the icon of your booster role.', { adminOnly: false })
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set your booster role icon (PNG or JPG, max 256 KB).')
        .addAttachmentOption((option) => option.setName('image').setDescription('The icon image (PNG or JPG, max 256 KB).').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove your booster role icon.')),
  everyone: true, // 관리자가 아니어도 누구나 사용 가능
  usage: ['roleicon set (attach PNG/JPG, max 256 KB)', 'roleicon remove'],
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const member = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
    if (!member) return;

    const wait = (cooldowns.get(interaction.user.id) ?? 0) - Date.now();
    if (wait > 0) {
      return replyEmbed(interaction, warnEmbed('Please wait', `You can use this command again in ${Math.ceil(wait / 1000)} seconds.`));
    }

    const found = findTargetRole(interaction, member);
    if (found.embed) return replyEmbed(interaction, found.embed);

    return sub === 'remove' ? handleRemove(interaction, member, found.role) : handleSet(interaction, member, found.role);
  },
};
