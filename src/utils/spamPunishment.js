// 도배 계열 기능(멘션 / 이모지 / 같은 메시지)이 공통으로 쓰는 처벌 흐름
// 순서: 메시지 삭제 → 채널 통보 → 타임아웃 → DM → 로그 (각 단계 성공/실패 개별 기록)
// 이미 타임아웃 중인 유저는 삭제만 하고 나머지는 "건너뜀"으로 기록합니다.
const { runPunishment, dmStep } = require('./punish');
const { deleteMessages } = require('./deleteMessages');
const { warnEmbed } = require('./embeds');

/**
 * options:
 *   client, message, member
 *   spam     { title, noticeLabel, timeoutMin, buildDM, onTimeoutApplied }
 *              title        로그 제목 (예: 'Emoji spam')
 *              noticeLabel  채널 통보 문구에 들어갈 이름 (예: 'emoji spam')
 *              timeoutMin   타임아웃 시간(분)
 *              buildDM      ({ guildName, unlockTimestamp }) => DM 임베드
 *              onTimeoutApplied  (선택) 타임아웃이 실제로 적용된 직후에 호출 (이미 타임아웃 중이거나 적용에 실패하면 호출되지 않음)
 *   reasons  감지된 사유 문자열 배열
 *   targets  삭제할 메시지 [{ messageId, channelId }]
 *   extraFields  (선택) 로그 임베드에 덧붙일 필드 [{ name, value, inline }]
 * 주의: 이 함수는 호출 즉시 runPunishment 로 넘어가야 하므로, 호출 전에 await 를 하지 마세요. (처벌 잠금 때문)
 */
function punishSpammer({ client, message, member, spam, reasons, targets, extraFields = [] }) {
  const timeoutMs = spam.timeoutMin * 60 * 1000;
  const unlockTimestamp = Math.floor((Date.now() + timeoutMs) / 1000);
  const alreadyTimedOut = (member.communicationDisabledUntilTimestamp ?? 0) > Date.now();
  const skip = 'user is already timed out';
  const channelIds = [...new Set(targets.map((t) => t.channelId))];

  const steps = [
    { name: 'Delete messages', run: () => deleteMessages(client, targets) },
    alreadyTimedOut
      ? { name: 'Channel notice', skip }
      : {
          name: 'Channel notice',
          run: async () => {
            const notice = warnEmbed(
              null,
              `<@${message.author.id}> has been timed out for ${spam.timeoutMin} minutes for ${spam.noticeLabel}.`
            );
            await message.channel.send({ embeds: [notice], allowedMentions: { parse: [] } });
          },
        },
    alreadyTimedOut
      ? { name: 'Apply timeout', skip }
      : {
          name: 'Apply timeout',
          run: async () => {
            await member.timeout(timeoutMs, spam.title);
            spam.onTimeoutApplied?.();
          },
        },
    alreadyTimedOut
      ? { name: 'Send DM', skip }
      : dmStep(message.author, {
          embeds: [spam.buildDM({ guildName: message.guild.name, unlockTimestamp })],
        }),
  ];

  return runPunishment(client, {
    sweepLateMessages: true, // 처벌이 진행되는 동안 올라온 메시지도 마지막에 삭제
    title: spam.title,
    user: member,
    reason: reasons.join('\n'),
    action: alreadyTimedOut
      ? 'Deleted messages only (user was already timed out)'
      : `Deleted messages + ${spam.timeoutMin}-minute timeout`,
    fields: [
      { name: 'Detected in', value: `<#${message.channelId}>`, inline: true },
      {
        name: 'Messages targeted',
        value: `${targets.length} (in ${channelIds.map((id) => `<#${id}>`).join(', ')})`,
        inline: true,
      },
      ...extraFields,
    ],
    steps,
  });
}

module.exports = { punishSpammer };
