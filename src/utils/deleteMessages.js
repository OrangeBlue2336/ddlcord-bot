// 위반 메시지 삭제 공용 도우미 (모든 자동 관리 기능이 함께 사용합니다)
//
// 디스코드의 "일괄 삭제(bulk delete)" API 를 사용해 빠르게 지웁니다.
//   - 한 번에 2~100개까지, 같은 채널의 메시지만 지울 수 있음 → 채널별로 묶고 100개씩 나눠서 호출
//   - 14일이 지난 메시지는 일괄 삭제를 거부함 → 그런 메시지는 개별 삭제로 처리 (안전장치)
//   - 채널이 여러 개여도 모든 채널을 동시에 처리
// 필요한 봇 권한: 각 채널에서 "메시지 관리"
const { SnowflakeUtil } = require('discord.js');
const { describeError } = require('./describeError');

const BULK_MAX = 100; // 디스코드 일괄 삭제 1회 최대 개수
// 디스코드 제한은 14일이지만 시간 오차를 고려해 13일을 넘은 메시지는 개별 삭제로 처리
const BULK_MAX_AGE_MS = 13 * 24 * 60 * 60 * 1000;

/**
 * targets: [{ messageId, channelId }, ...]  (채널이 달라도 되고, 중복 메시지는 자동으로 1개로 처리)
 * 성공하면 "Deleted 5/5 in 3 channels" 같은 요약 문자열을 돌려주고,
 * 하나라도 실패하면 "Deleted 4/5. Failed: 사유 (x1)" 에러를 던집니다. (처벌 로그에 단계 실패로 기록됨)
 */
async function deleteMessages(client, targets) {
  // 1) 중복 제거 + 채널별로 묶기
  const byChannel = new Map();
  const seen = new Set();
  for (const t of targets) {
    if (seen.has(t.messageId)) continue;
    seen.add(t.messageId);
    if (!byChannel.has(t.channelId)) byChannel.set(t.channelId, []);
    byChannel.get(t.channelId).push(t.messageId);
  }
  const total = seen.size;
  if (total === 0) return 'Nothing to delete';

  // 2) 삭제 작업 목록 만들기
  const now = Date.now();
  const jobs = [];
  for (const [channelId, ids] of byChannel) {
    const recent = [];
    const old = [];
    for (const id of ids) {
      (now - SnowflakeUtil.timestampFrom(id) < BULK_MAX_AGE_MS ? recent : old).push(id);
    }

    // 최근 메시지: 100개씩 일괄 삭제 (discord.js 는 1개만 남으면 알아서 개별 삭제로 처리)
    for (let i = 0; i < recent.length; i += BULK_MAX) {
      const chunk = recent.slice(i, i + BULK_MAX);
      jobs.push({
        count: chunk.length,
        run: async () => {
          const channel = await client.channels.fetch(channelId);
          if (typeof channel?.bulkDelete !== 'function') throw new Error('This channel does not support deleting messages');
          await channel.bulkDelete(chunk, false);
        },
      });
    }

    // 오래된 메시지: 개별 삭제
    for (const id of old) {
      jobs.push({
        count: 1,
        run: async () => {
          const channel = await client.channels.fetch(channelId);
          await channel.messages.delete(id);
        },
      });
    }
  }

  // 3) 전부 동시에 실행하고 결과 집계
  const results = await Promise.allSettled(jobs.map((job) => job.run()));

  let deleted = 0;
  const failures = new Map(); // 실패 사유 -> 실패한 메시지 수
  results.forEach((result, i) => {
    const { count } = jobs[i];
    if (result.status === 'fulfilled') {
      deleted += count;
    } else if (result.reason?.code === 10008 && count === 1) {
      deleted += 1; // 10008 = Unknown Message (이미 삭제됨) → 목적 달성
    } else {
      const text = describeError(result.reason);
      failures.set(text, (failures.get(text) ?? 0) + count);
    }
  });

  if (failures.size) {
    const summary = [...failures].map(([text, n]) => `${text} (x${n})`).join('; ');
    throw new Error(`Deleted ${deleted}/${total}. Failed: ${summary}`);
  }

  const channelCount = byChannel.size;
  return `Deleted ${deleted}/${total} in ${channelCount} channel${channelCount === 1 ? '' : 's'}`;
}

module.exports = { deleteMessages };
