// 처벌 처리기: 기능별 단계(DM → 조치 → ...)를 순서대로 실행하고,
// 각 단계의 성공/실패를 개별 기록해서 로그 채널에 한 번에 보냅니다.
// 한 단계가 실패해도 다음 단계는 계속 진행합니다 (예: DM 실패해도 타임아웃은 진행).
const { sendLog } = require('./logger');
const { describeError } = require('./describeError');

/**
 * options:
 *   title, user, reason, action, fields   로그 임베드 내용 (logger.sendLog 참고)
 *   steps   [{ name, run, failText }]  run 은 async 함수. 에러를 던지면 실패, 문자열을 돌려주면 성공 메모
 *           failText 를 주면 실패했을 때 로그에 오류 원문 대신 이 고정 문구를 기록 (DM 단계가 사용)
 *           [{ name, skip: '사유' }]  실행하지 않고 "건너뜀"으로 기록 (예: 이미 타임아웃 중)
 * 반환값: [{ name, ok, detail, skipped }]
 */
// 처벌이 진행 중인 유저 목록 (기능이 달라도 공용).
// 처벌 진행 중에 같은 유저가 다른 기능에도 걸려 DM/타임아웃이 이중으로 가는 것을 막습니다.
const activeUsers = new Set();

function isBeingPunished(userId) {
  return activeUsers.has(userId);
}

async function runPunishment(client, options) {
  const lockedUserId = (options.user?.user ?? options.user)?.id;
  if (lockedUserId) activeUsers.add(lockedUserId); // 호출 즉시(동기) 잠금 → 기능 쪽에서 runPunishment 호출 전에 await 하지 말 것
  try {
    return await runSteps(client, options);
  } finally {
    if (lockedUserId) activeUsers.delete(lockedUserId);
  }
}

async function runSteps(client, options) {
  const { steps, ...logOptions } = options;
  const results = [];

  for (const step of steps) {
    if (step.skip) {
      results.push({ name: step.name, ok: true, skipped: true, detail: `skipped: ${step.skip}` });
      continue;
    }
    try {
      const detail = await step.run();
      results.push({ name: step.name, ok: true, detail: detail || undefined });
    } catch (err) {
      if (step.failText) {
        // 로그 채널에는 고정 문구만 남기고, 실제 사유는 개발자가 볼 수 있게 콘솔에만 출력
        console.warn(`[punish] "${step.name}" failed: ${describeError(err)}`);
        results.push({ name: step.name, ok: false, detail: step.failText });
      } else {
        results.push({ name: step.name, ok: false, detail: describeError(err) });
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  const userId = (options.user?.user ?? options.user)?.id ?? 'unknown';
  console.log(
    `[punish] ${options.title} | user ${userId} | ` +
      results.map((r) => `${r.name}:${r.skipped ? 'skipped' : r.ok ? 'ok' : 'FAILED'}`).join(', ')
  );

  await sendLog(client, {
    ...logOptions,
    steps: results,
    failureReason: failed.length ? failed.map((f) => `${f.name}: ${f.detail}`).join('\n') : undefined,
  });

  return results;
}

// DM 발송 단계 (모든 기능이 공용으로 사용).
// DM 실패 사유는 디스코드가 상황에 따라 헷갈리는 문구/코드를 돌려주므로(예: 같은 서버에 있는데도 "no mutual guilds"),
// 사유와 상관없이 항상 같은 고정 문구로 기록합니다.
const DM_FAIL_TEXT = 'Cannot send messages to this user.';

// user: DM 을 받을 User 또는 GuildMember,  payload: { embeds: [...] }
function dmStep(user, payload) {
  return {
    name: 'Send DM',
    failText: DM_FAIL_TEXT,
    run: async () => {
      await user.send(payload);
    },
  };
}

module.exports = { runPunishment, isBeingPunished, dmStep, DM_FAIL_TEXT };
