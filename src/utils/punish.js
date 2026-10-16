// 처벌 처리기: 기능별 단계(DM → 조치 → ...)를 순서대로 실행하고,
// 각 단계의 성공/실패를 개별 기록해서 로그 채널에 한 번에 보냅니다.
// 한 단계가 실패해도 다음 단계는 계속 진행합니다 (예: DM 실패해도 타임아웃은 진행).
const config = require('../config');
const { sendLog } = require('./logger');
const { describeError } = require('./describeError');
const { deleteMessages } = require('./deleteMessages');

/**
 * options:
 *   title, user, reason, action, fields   로그 임베드 내용 (logger.sendLog 참고)
 *   steps   [{ name, run, failText }]  run 은 async 함수. 에러를 던지면 실패, 문자열을 돌려주면 성공 메모
 *           failText 를 주면 실패했을 때 로그에 오류 원문 대신 이 고정 문구를 기록 (DM 단계가 사용)
 *           [{ name, skip: '사유' }]  실행하지 않고 "건너뜀"으로 기록 (예: 이미 타임아웃 중)
 *   sweepLateMessages     true 이면 "처벌이 진행되는 동안" 그 유저가 보낸 메시지도 모아서 처벌 마지막에 삭제 (+ 끝난 뒤 몇 초간 늦게 도착한 메시지도 삭제)
 *   collectLateMessages   (선택) async () => [{ messageId, channelId }]  마지막 정리 때 추가로 지울 메시지를 알려주는 함수 (예: DB 메시지 기록 재조회)
 *   lateSweepQuiet        true 이면 마지막 정리 결과를 로그 단계로 남기지 않고 콘솔에만 출력 (추방처럼 디스코드가 이미 지워 주는 경우)
 * 반환값: [{ name, ok, detail, skipped }]
 */
// 처벌이 진행 중인 유저 목록 (기능이 달라도 공용).
// 처벌 진행 중에 같은 유저가 다른 기능에도 걸려 DM/타임아웃이 이중으로 가는 것을 막습니다.
const activeUsers = new Set();

function isBeingPunished(userId) {
  return activeUsers.has(userId);
}

// ---- 처벌 진행 중에 올라온 메시지 정리 ----
// 처벌은 삭제 → 타임아웃 같은 여러 단계라 1~2초 이상 걸리고(DM, 이미지 검사 등은 더 오래), 그 사이에도 스패머는 계속 메시지를 보냅니다.
// 예전에는 "처벌 진행 중인 유저의 메시지는 무시"만 해서 이 메시지들이 삭제되지 않고 남았습니다.
// 이제 처벌이 진행되는 동안 도착한 메시지를 모아 두었다가 모든 단계(타임아웃 포함)가 끝난 뒤 한꺼번에 지우고,
// 그 뒤 몇 초간 늦게 도착하는 메시지는 도착하는 즉시 지웁니다.
const captures = new Map(); // userId -> { items: Map(messageId -> channelId), graceUntil: null | ms }

/**
 * messageCreate 에서 가장 먼저 호출. 처벌 진행 중이거나 처벌 직후인 유저의 메시지면 처리하고 true 를 돌려줌
 * (true 이면 이후 자동 관리/명령어 처리를 건너뜀)
 */
function interceptPunishedMessage(message, client) {
  const userId = message.author.id;
  const state = captures.get(userId);
  if (!state) return false;

  if (state.graceUntil === null) {
    state.items.set(message.id, message.channelId); // 처벌 진행 중: 모아 뒀다가 마지막에 삭제
    return true;
  }
  if (Date.now() > state.graceUntil) {
    captures.delete(userId);
    return false;
  }
  // 처벌 직후(몇 초): 도착하는 즉시 삭제
  deleteMessages(client, [{ messageId: message.id, channelId: message.channelId }]).catch((err) => {
    console.warn(`[punish] Could not delete a late message from ${userId}: ${describeError(err)}`);
  });
  return true;
}

// 처벌 마지막 단계: 모아 둔 메시지(+ collectLateMessages 가 알려준 메시지)를 삭제하고 "유예 시간" 시작
async function sweepLateMessages(client, userId, options, results) {
  const state = captures.get(userId);
  if (!state) return;

  const done = new Set();
  const details = [];
  let failed = false;
  let total = 0;

  // 지우는 동안 또 도착한 메시지가 있을 수 있어 최대 3번 반복
  for (let round = 0; round < 3; round++) {
    const batch = new Map();
    for (const [messageId, channelId] of state.items) if (!done.has(messageId)) batch.set(messageId, channelId);
    if (options.collectLateMessages) {
      try {
        for (const t of await options.collectLateMessages()) {
          if (!done.has(t.messageId)) batch.set(t.messageId, t.channelId);
        }
      } catch (err) {
        console.warn(`[punish] collectLateMessages failed: ${describeError(err)}`);
      }
    }
    if (!batch.size) break;

    for (const id of batch.keys()) done.add(id);
    total += batch.size;
    try {
      details.push(await deleteMessages(client, [...batch].map(([messageId, channelId]) => ({ messageId, channelId }))));
    } catch (err) {
      failed = true;
      details.push(describeError(err));
    }
  }

  // 모든 삭제가 끝났으니 이제부터는 늦게 도착한 메시지를 바로 지우는 유예 시간
  const graceMs = (config.punishment?.lateMessageGraceSec ?? 5) * 1000;
  state.graceUntil = Date.now() + graceMs;
  setTimeout(() => {
    if (captures.get(userId) === state) captures.delete(userId);
  }, graceMs + 1000).unref();

  if (!total) return;
  if (options.lateSweepQuiet) {
    if (failed) console.warn(`[punish] Late-message cleanup problem for ${userId}: ${details.join('; ')}`);
    return;
  }
  // 로그에는 "처벌 중 올라온 메시지"가 있었을 때만 단계로 추가
  results.push({ name: 'Delete messages sent during punishment', ok: !failed, detail: details.join('; ') });
}

async function runPunishment(client, options) {
  const lockedUserId = (options.user?.user ?? options.user)?.id;
  if (lockedUserId) {
    activeUsers.add(lockedUserId); // 호출 즉시(동기) 잠금 → 기능 쪽에서 runPunishment 호출 전에 await 하지 말 것
    if (options.sweepLateMessages) captures.set(lockedUserId, { items: new Map(), graceUntil: null });
  }
  try {
    return await runSteps(client, options);
  } finally {
    if (lockedUserId) {
      activeUsers.delete(lockedUserId);
      // 정리 단계가 어떤 이유로 실행되지 못했더라도 수집 상태가 영원히 남지 않게 마무리
      const state = captures.get(lockedUserId);
      if (state && state.graceUntil === null) captures.delete(lockedUserId);
    }
  }
}

async function runSteps(client, options) {
  const { steps, sweepLateMessages: _s, collectLateMessages: _c, lateSweepQuiet: _q, ...logOptions } = options;
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

  const sweepUserId = (options.user?.user ?? options.user)?.id;
  if (options.sweepLateMessages && sweepUserId) await sweepLateMessages(client, sweepUserId, options, results);

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

module.exports = { runPunishment, isBeingPunished, interceptPunishedMessage, dmStep, DM_FAIL_TEXT };
