// 기능 D: 스팸 이미지 탐지 (^mrbeast)
//
// [트리거] 같은 유저가 10분 이내에 서로 다른 3개 이상의 채널에 "사진"(정지 이미지 첨부)을 올림
//   - 영상, GIF 는 제외. 링크 미리보기 이미지는 대상 아님(첨부파일만).
//   - 평소에는 "어느 채널에 올렸는지"만 메모리에 가볍게 기록하고, 조건이 되는 순간에만 이미지를 내려받아 검사합니다. (서버 부담 최소화)
// [고유 이미지] pHash 해밍거리 5 이하는 같은 이미지 1장. 고유 이미지가 1~4장이면 검사, 5장 이상이면 검사하지 않음.
// [검사] 고유 이미지마다 ① pHash 가 알려진 해시와 70% 이상 유사 ② OCR 글자에 등록된 키워드가 있음
// [조치] 둘 다 맞음 -> 추방(ban 후 즉시 unban, 최근 1시간 메시지는 ban 옵션으로 삭제)
//        하나만 맞음 -> 최근 1시간 메시지 삭제 + 12시간 타임아웃
//        테스트 모드(^mrbeast testmode on) -> 아무 조치 없이 "걸렸을 것"이라는 로그만 기록
// 해시와 키워드가 하나도 등록되어 있지 않으면 아무 일도 하지 않습니다.
const config = require('../config');
const db = require('../db');
const { isWhitelisted } = require('../utils/permissions');
const { runPunishment, dmStep, isBeingPunished } = require('../utils/punish');
const { deleteMessages } = require('../utils/deleteMessages');
const { sendLog } = require('../utils/logger');
const { SlidingWindow } = require('../utils/slidingWindow');
const imageTools = require('../utils/imageTools');
const { createOcrSession } = require('../utils/ocr');
const { matchKeywords } = require('../utils/textMatch');
const { buildImageSpamBanDM, buildImageSpamTimeoutDM } = require('../utils/dmTemplates');
const { truncate } = require('../utils/embeds');

const cfg = config.imageSpam;

// 유저별로 "최근 10분 안에 사진을 올린 메시지" 기록 (메모리 전용, 채널 합산)
const tracker = new SlidingWindow(cfg.channelWindowMin * 60 * 1000);
const analyzing = new Set();   // 지금 검사 중인 유저 (같은 유저를 동시에 두 번 검사하지 않기 위함)
const cooldowns = new Map();   // userId -> 이 시각(ms)까지 다시 검사하지 않음
let lastOcrWarning = 0;        // "OCR 실패" 경고 로그를 마지막으로 남긴 시각

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 사진 판정 ----------
const STILL_EXT = /\.(png|jpe?g|webp|bmp|avif|heic|heif|tiff?)$/i;

// 정지 이미지 첨부파일인지 (GIF, 영상, SVG 는 제외). ^mrbeast addhash 도 같은 기준을 사용
function isStillImage(attachment) {
  const type = (attachment.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type) return type.startsWith('image/') && type !== 'image/gif' && type !== 'image/svg+xml';
  return STILL_EXT.test(attachment.name ?? '');
}

// ---------- 메시지 기록 (최근 1시간 메시지 삭제용) ----------
// 화이트리스트가 아닌 유저의 모든 메시지를 기록 (ID 만, 내용은 저장하지 않음). 호출 즉시 끝나고 DB 저장은 몇 초 뒤 모아서 처리됨
function trackMessage(message) {
  if (!db.isFeatureEnabled('mrbeast')) return;
  const member = message.member;
  if (!member || isWhitelisted(member)) return;
  db.logMessage({
    messageId: message.id,
    userId: message.author.id,
    channelId: message.channelId,
    time: message.createdTimestamp,
  });
}

// ---------- 1단계: 이미지 내려받아 고유 이미지로 묶기 ----------
async function collectGroups(images, needOcr) {
  const groups = []; // { hash, count, ocrBuffer, prepError }
  const skipped = []; // { reason }

  for (const img of images) {
    if (img.size && img.size > cfg.maxDownloadBytes) {
      skipped.push({ reason: 'file is too large' });
      continue;
    }
    try {
      await imageTools.limitProcessing(async () => {
        const buffer = await imageTools.downloadImage(img.url);
        const hash = await imageTools.computePHash(buffer);

        const same = groups.find((g) => imageTools.hammingDistance(g.hash, hash) <= cfg.dedupeMaxDistance);
        if (same) {
          same.count++;
          return;
        }
        const group = { hash, count: 1, ocrBuffer: null, prepError: null };
        groups.push(group);
        // 고유 이미지가 너무 많으면 어차피 검사하지 않으므로 OCR 용 이미지는 필요할 때만 만듦
        if (needOcr && groups.length <= cfg.maxUniqueImages) {
          try {
            group.ocrBuffer = await imageTools.prepareForOcr(buffer);
          } catch (err) {
            group.prepError = err.message;
          }
        }
      });
    } catch (err) {
      skipped.push({ reason: err.message });
    }
    if (groups.length > cfg.maxUniqueImages) break; // 5장 이상이면 검사하지 않으므로 더 볼 필요 없음
  }
  return { groups, skipped };
}

// ---------- 2단계: 고유 이미지 1장 검사 (pHash + OCR) ----------
async function evaluateGroup(group, knownHashes, keywords, ocrSession) {
  // ① pHash: 알려진 해시 중 가장 가까운 것
  let best = null;
  for (const known of knownHashes) {
    const distance = imageTools.hammingDistance(group.hash, known.phash);
    if (!best || distance < best.distance) best = { distance, id: known._id, label: known.label };
  }
  const hashMatch = !!best && best.distance <= cfg.hashMatchMaxDistance;

  // ② OCR: 등록된 키워드가 있을 때만 호출 (무료 한도 절약)
  let ocr;
  if (!keywords.length) {
    ocr = { status: 'skipped' };
  } else if (!group.ocrBuffer) {
    ocr = { status: 'failed', error: group.prepError ?? 'Could not prepare the image for OCR' };
  } else {
    try {
      const { text, engine, primaryError } = await ocrSession.ocr(group.ocrBuffer);
      ocr = { status: 'ok', text, engine, primaryError, matched: matchKeywords(text, keywords).map((k) => k.word) };
    } catch (err) {
      ocr = { status: 'failed', error: err.message };
    }
  }
  const ocrMatch = ocr.status === 'ok' && ocr.matched.length > 0;

  const verdict = hashMatch && ocrMatch ? 'ban' : hashMatch || ocrMatch ? 'timeout' : 'none';
  return { group, best, hashMatch, ocr, ocrMatch, verdict };
}

// ---------- 로그용 문구 (짧고 읽기 쉽게) ----------
const hoursText = (h) => `${h} hour${h === 1 ? '' : 's'}`;
const LOG_REASON = 'Detected scam images in multiple channels';

// 이미지마다 2줄만: 가장 가까운 해시 / 일치한 OCR 단어 (기본 엔진이 아닌 엔진이 쓰였을 때만 엔진 번호 표시)
function describeResult(result, index) {
  const { best, ocr } = result;

  const hashLine = best
    ? `Closest hash: #${best.id}${best.label ? ` "${best.label}"` : ''} (${imageTools.similarityPercent(best.distance)}%)`
    : 'Closest hash: none registered';

  let wordLine;
  if (ocr.status === 'skipped') {
    wordLine = 'Matched word: - (OCR skipped, no keywords)';
  } else if (ocr.status === 'failed') {
    wordLine = `Matched word: - (OCR failed: ${truncate(ocr.error, 100)})`;
  } else {
    const words = ocr.matched.length ? ocr.matched.map((w) => `"${w}"`).join(', ') : 'none';
    const engineNote = ocr.engine !== cfg.ocrEngine ? ` (engine ${ocr.engine})` : '';
    wordLine = `Matched word: ${words}${engineNote}`;
  }
  return { name: `Image ${index + 1} (x${result.group.count})`, value: `${hashLine}\n${wordLine}` };
}

function buildFields(results, skipped) {
  const fields = results.map(describeResult);
  if (skipped.length) {
    const reasons = [...new Set(skipped.map((s) => s.reason))].join('; ');
    fields.push({ name: 'Images not processed', value: `${skipped.length} (${truncate(reasons, 200)})` });
  }
  return fields;
}

// ---------- 처벌 ----------
// 주의: 이 두 함수는 runPunishment 를 "바로" 호출해야 합니다 (처벌 잠금 때문에 호출 전에 await 금지)
function punishBan({ client, message, member, reason, fields }) {
  const userId = member.id;
  const guild = message.guild;
  let banned = false;

  return runPunishment(client, {
    // 디스코드의 ban 삭제가 놓친 메시지가 있을 경우를 대비한 안전장치 (메시지 기록을 다시 조회해 지움, 결과는 콘솔에만 기록)
    sweepLateMessages: true,
    lateSweepQuiet: true,
    collectLateMessages: () => db.getRecentUserMessages(userId, Date.now() - cfg.deleteWindowMin * 60 * 1000),
    title: 'Image spam (softbanned)',
    user: member,
    reason,
    action: 'Softbanned',
    fields,
    steps: [
      dmStep(message.author, { embeds: [buildImageSpamBanDM({ guildName: guild.name })] }),
      {
        name: 'Ban + delete recent messages',
        run: async () => {
          await guild.members.ban(userId, {
            deleteMessageSeconds: cfg.deleteWindowMin * 60,
            reason: 'Spam image detected (automatic)',
          });
          banned = true;
          return `Discord deleted the last ${cfg.deleteWindowMin} minutes of messages`;
        },
      },
      {
        name: 'Unban',
        run: async () => {
          if (!banned) return 'Not needed (the ban did not succeed)';
          let lastError;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await guild.members.unban(userId, 'Automatic unban after spam image kick');
              return undefined;
            } catch (err) {
              lastError = err;
              await sleep(1000);
            }
          }
          throw lastError; // 3번 실패하면 로그에 실패로 남김 (유저가 밴 상태로 남아 있으니 수동 해제 필요)
        },
      },
    ],
  });
}

function punishTimeout({ client, message, member, reason, fields, targets }) {
  const timeoutMs = cfg.timeoutHours * 60 * 60 * 1000;
  const unlockTimestamp = Math.floor((Date.now() + timeoutMs) / 1000);
  const alreadyTimedOut = (member.communicationDisabledUntilTimestamp ?? 0) > Date.now();
  const skip = 'user is already timed out';
  const userId = member.id;
  const alreadyTargeted = new Set(targets.map((t) => t.messageId));

  return runPunishment(client, {
    // 처벌(DM, 삭제, 타임아웃)이 진행되는 동안 올라온 메시지는 타임아웃까지 끝난 뒤 한 번 더 찾아서 지움
    sweepLateMessages: true,
    collectLateMessages: async () => {
      const fresh = await db.getRecentUserMessages(userId, Date.now() - cfg.deleteWindowMin * 60 * 1000);
      return fresh.filter((t) => !alreadyTargeted.has(t.messageId));
    },
    title: 'Image spam (timeout)',
    user: member,
    reason,
    action: alreadyTimedOut ? 'Deleted messages only (already timed out)' : `Timed out for ${hoursText(cfg.timeoutHours)}`,
    fields,
    steps: [
      alreadyTimedOut
        ? { name: 'Send DM', skip }
        : dmStep(message.author, { embeds: [buildImageSpamTimeoutDM({ guildName: message.guild.name, unlockTimestamp })] }),
      { name: 'Delete messages', run: () => deleteMessages(client, targets) },
      alreadyTimedOut
        ? { name: 'Apply timeout', skip }
        : {
            name: 'Apply timeout',
            run: async () => {
              await member.timeout(timeoutMs, 'Spam image detected (automatic)');
            },
          },
    ],
  });
}

// OCR 이 실패했는데 해시로도 걸리지 않은 경우: 한도 초과 같은 문제를 알 수 있게 경고만 남김 (1시간에 1번)
async function warnOcrFailure(client, member, results) {
  const failed = results.find((r) => r.ocr.status === 'failed');
  if (!failed) return;
  // 일부 이미지만 실패했고 다른 이미지에서는 글자를 읽었다면(예: 엔진 3 성공, 엔진 2 실패) 읽은 글자만으로 검사한 것이므로 경고하지 않음
  if (results.some((r) => r.ocr.status === 'ok')) return;
  if (Date.now() - lastOcrWarning < cfg.ocrWarnCooldownMin * 60 * 1000) return;
  lastOcrWarning = Date.now();
  await sendLog(client, {
    title: 'Image spam check: OCR failed',
    status: 'warning',
    user: member,
    description:
      'The OCR service could not read an image, so only the image hash could be compared. ' +
      'No match was found, so no action was taken. (This warning is shown at most once per hour.)',
    fields: [{ name: 'OCR error', value: failed.ocr.error }],
  });
}

// ---------- 검사 전체 흐름 ----------
async function runCheck({ client, message, member, entries }) {
  const userId = message.author.id;
  const knownHashes = db.getKnownHashes();
  const keywords = db.getKnownKeywords();

  // 최근 이미지 N장만 검사 (한꺼번에 아주 많이 올려도 서버가 버벅이지 않도록)
  const images = entries.flatMap((e) => e.data.images).slice(-cfg.maxImagesPerCheck);
  const { groups, skipped } = await collectGroups(images, keywords.length > 0);

  if (!groups.length) {
    console.log(`[imageSpam] user ${userId}: no image could be processed (${skipped.map((s) => s.reason).join('; ')})`);
    return false;
  }
  if (groups.length > cfg.maxUniqueImages) {
    console.log(`[imageSpam] user ${userId}: ${groups.length}+ unique images, skipping the check`);
    return false;
  }

  // 이 검사 전용 OCR 세션: 엔진 3 은 첫 이미지에만 쓰고 나머지 이미지는 엔진 2 를 씀 (엔진 3 의 429 오류 방지)
  const ocrSession = createOcrSession();
  const results = await Promise.all(groups.map((g) => evaluateGroup(g, knownHashes, keywords, ocrSession)));
  const verdict = results.some((r) => r.verdict === 'ban') ? 'ban' : results.some((r) => r.verdict === 'timeout') ? 'timeout' : 'none';

  if (verdict === 'none') {
    await warnOcrFailure(client, member, results);
    return false;
  }

  const reason = LOG_REASON;
  const fields = buildFields(results, skipped);

  // ---- 테스트 모드: 로그만 남기고 끝 ----
  if (db.isMrbeastTestMode()) {
    await sendLog(client, {
      title: 'Image spam (TEST MODE)',
      status: 'info',
      user: member,
      description: 'Test mode is ON. No messages were deleted, no DM was sent, and no punishment was applied.',
      reason,
      action: verdict === 'ban' ? 'Would have softbanned' : `Would have timed out for ${hoursText(cfg.timeoutHours)}`,
      fields,
    });
    return false;
  }

  // ---- 실제 처벌 ----
  // 처벌 준비 중에 다른 기능이 같은 유저를 처벌하고 있으면 끝날 때까지 잠깐 기다림 (DM/타임아웃 이중 발송 방지)
  for (let i = 0; i < 20 && isBeingPunished(userId); i++) await sleep(500);

  // 삭제 대상(최근 1시간 메시지) 조회. 추방은 ban 옵션이 지우므로 필요 없음
  let targets = [];
  if (verdict === 'timeout') {
    try {
      targets = await db.getRecentUserMessages(userId, Date.now() - cfg.deleteWindowMin * 60 * 1000);
    } catch (err) {
      console.warn(`[imageSpam] Could not read the message log: ${err.message}`);
    }
    for (const e of entries) targets.push({ messageId: e.data.messageId, channelId: e.data.channelId });
  }

  // 검사하는 동안 상태가 바뀌었을 수 있으므로 멤버 정보를 새로 가져옴
  const freshMember = await message.guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (!freshMember) {
    await sendLog(client, {
      title: 'Image spam detected, but the user already left',
      status: 'warning',
      reason,
      description: `User ID: ${userId}. No action was taken because the user is no longer in the server.`,
      fields,
    });
    return false;
  }

  // 여기부터 runPunishment 호출까지 await 금지 (처벌 잠금)
  if (isBeingPunished(userId)) return true;
  const args = { client, message, member: freshMember, reason, fields };
  if (verdict === 'ban') await punishBan(args);
  else await punishTimeout({ ...args, targets });
  return true;
}

// 메시지 1개를 검사. 처벌했거나 처벌 진행 중인 유저면 true (이후 검사를 건너뜀)
async function handleMessage(message, client) {
  if (!db.isFeatureEnabled('mrbeast')) return false;
  if (!db.hasImageSpamRules()) return false; // 해시/키워드가 하나도 없으면 할 일이 없음

  const images = [...message.attachments.values()].filter(isStillImage);
  if (!images.length) return false;

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isWhitelisted(member)) return false;

  const userId = message.author.id;
  if (isBeingPunished(userId)) return true;

  const entry = {
    messageId: message.id,
    channelId: message.channelId,
    images: images.map((a) => ({ id: a.id, url: a.url, name: a.name, size: a.size })),
  };
  const entries = tracker.add(userId, entry, message.createdTimestamp);

  const channelCount = new Set(entries.map((e) => e.data.channelId)).size;
  if (channelCount < cfg.channelCount) return false;

  // 이미 검사 중이거나 직전에 검사했다면 기록만 쌓아 두고 나중에 판단
  if (analyzing.has(userId)) return false;
  if ((cooldowns.get(userId) ?? 0) > Date.now()) return false;

  analyzing.add(userId);
  tracker.clear(userId); // 지금까지의 기록으로 검사하고, 검사 중에 올라오는 메시지는 새로 기록
  try {
    return await runCheck({ client, message, member, entries });
  } catch (err) {
    console.error('[imageSpam] Error during check:', err);
    return false;
  } finally {
    analyzing.delete(userId);
    cooldowns.set(userId, Date.now() + cfg.cooldownSec * 1000);
  }
}

module.exports = { handleMessage, trackMessage, isStillImage };
