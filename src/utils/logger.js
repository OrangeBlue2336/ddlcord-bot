// 로그 채널에 임베드로 기록하는 기록기
const { EmbedBuilder } = require('discord.js');
const { COLORS, truncate } = require('./embeds');

const STATUS_STYLE = {
  success: { color: COLORS.success, icon: '✅', label: 'Success' },
  failure: { color: COLORS.error, icon: '❌', label: 'Failed' },
  partial: { color: COLORS.warn, icon: '⚠️', label: 'Partially succeeded' },
  warning: { color: COLORS.warn, icon: '⚠️', label: 'Warning' },
  info: { color: COLORS.info, icon: 'ℹ️', label: 'Info' },
};

function deriveStatus(steps) {
  const okCount = steps.filter((s) => s.ok).length;
  if (okCount === steps.length) return 'success';
  if (okCount === 0) return 'failure';
  return 'partial';
}

function formatUser(userOrMember) {
  const user = userOrMember.user ?? userOrMember;
  return `<@${user.id}> (${user.username})\nID: ${user.id}`;
}

/**
 * 로그 채널에 임베드 전송.
 * options:
 *   title          제목
 *   status         'success' | 'failure' | 'partial' | 'warning' | 'info' (생략하면 steps로 자동 판정)
 *   user           대상 유저 (User 또는 GuildMember)
 *   reason         사유
 *   action         취해진 조치
 *   steps          [{ name, ok, detail, skipped }]  단계별 성공/실패/건너뜀
 *   failureReason  실패 사유
 *   description    본문
 *   fields         [{ name, value, inline }]  추가 필드
 *   image          { attachment, name } - 로그 임베드에 첨부할 이미지
 * 전송에 실패하면 콘솔에 에러를 출력하고 false 를 반환합니다.
 */
async function sendLog(client, options = {}) {
  try {
    const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Log channel was not found or is not a text channel.');
    }

    const hasSteps = Array.isArray(options.steps) && options.steps.length > 0;
    const status = options.status ?? (hasSteps ? deriveStatus(options.steps) : 'info');
    const style = STATUS_STYLE[status];

    const embed = new EmbedBuilder()
      .setColor(style.color)
      .setTitle(truncate(`${style.icon} ${options.title ?? 'Log'}`, 256))
      .setTimestamp()
      .setFooter({ text: `Mode: ${process.env.BOT_MODE ?? 'unknown'}` });

    if (options.description) embed.setDescription(truncate(options.description, 4096));

    const fields = [];
    if (options.user) fields.push({ name: 'User', value: formatUser(options.user), inline: true });
    if (options.reason) fields.push({ name: 'Reason', value: truncate(options.reason), inline: true });
    if (options.action) fields.push({ name: 'Action', value: truncate(options.action), inline: true });
    if (hasSteps) {
      const lines = options.steps.map(
        (s) => `${s.skipped ? '⏭️' : s.ok ? '✅' : '❌'} ${s.name}${s.detail ? ` - ${s.detail}` : ''}`
      );
      fields.push({ name: 'Steps', value: truncate(lines.join('\n')) });
    }
    if (['success', 'failure', 'partial'].includes(status)) {
      fields.push({ name: 'Result', value: style.label, inline: true });
    }
    if (options.failureReason) {
      fields.push({ name: 'Failure reason', value: truncate(options.failureReason) });
    }
    if (Array.isArray(options.fields)) {
      for (const f of options.fields) {
        fields.push({
          name: truncate(f.name, 256),
          value: truncate(f.value || '-'),
          inline: !!f.inline,
        });
      }
    }
    if (fields.length) embed.addFields(fields.slice(0, 25));
    if (options.image?.attachment && options.image?.name) {
      embed.setImage(`attachment://${options.image.name}`);
    }

    await channel.send({
      embeds: [embed],
      ...(options.image?.attachment && options.image?.name
        ? { files: [{ attachment: options.image.attachment, name: options.image.name }] }
        : {}),
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (err) {
    console.error('[logger] Failed to send log embed:', err.message, '| title:', options.title);
    return false;
  }
}

module.exports = { sendLog };
