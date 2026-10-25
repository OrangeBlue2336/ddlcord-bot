// 기능 E: 같은 메시지 도배
// 같은 유저가 시간 윈도우 안에 "동일한 메시지"를 N개 이상 보내면 도배로 판정합니다.
//   - 채널 무관: 같은 채널에서 5번이든, 여러 채널을 돌아다니며 합쳐서 5번이든 동일하게 감지합니다.
//   - 동일 메시지 판정: 앞뒤 공백을 제거하고 대소문자를 무시한 글자가 같으면 같은 메시지 ("Hello" = "hello ")
//   - 텍스트가 없는 메시지(첨부파일/스티커만)는 대상이 아닙니다. 첨부파일은 비교하지 않습니다.
//   - 예외 채널(/emojispam exempt)과 그 채널의 스레드/포럼 게시글의 메시지는 검사·합산에서 제외합니다.
// 처리: 메시지 삭제(모든 채널) → 채널 통보 → 타임아웃 → DM → 로그 (utils/spamPunishment.js 공용)
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { isWhitelisted, isExemptChannel } = require('../utils/permissions');
const { isBeingPunished } = require('../utils/punish');
const { punishSpammer } = require('../utils/spamPunishment');
const { SlidingWindow } = require('../utils/slidingWindow');
const { buildSameMessageSpamDM } = require('../utils/dmTemplates');
const { truncate } = require('../utils/embeds');

const cfg = config.sameMessageSpam;

// "유저 + 메시지 내용" 별로 메시지를 기억하는 윈도우 (모든 채널 합산)
const tracker = new SlidingWindow(cfg.windowSec * 1000);

// 비교용 문자열: 앞뒤 공백 제거 + 소문자
function normalize(content) {
  return content.trim().toLowerCase();
}

// 메모리를 아끼기 위해 긴 메시지는 해시(짧은 지문)로 바꿔서 key 로 사용
function fingerprint(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// 메시지 1개를 검사. 같은 메시지 도배로 처리했거나 처리 중인 유저면 true (이후 다른 기능 검사는 건너뜀)
async function handleMessage(message, client) {
  if (!db.isFeatureEnabled('samespam')) return false;

  const normalized = normalize(message.content ?? '');
  if (!normalized) return false; // 텍스트가 없는 메시지는 대상 아님

  if (isExemptChannel(message.channel)) return false; // 예외 채널은 검사·합산 모두 제외

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isWhitelisted(member)) return false;

  const userId = message.author.id;
  if (isBeingPunished(userId)) return true; // 이미 처벌 진행 중 (다른 기능 포함)

  const key = `${userId}:${fingerprint(normalized)}`;
  const entries = tracker.add(key, { messageId: message.id, channelId: message.channelId }, message.createdTimestamp);
  if (entries.length < cfg.repeatCount) return false;

  // 중복 처벌 방지: 이 내용의 윈도우 기록 비우기 (처벌 진행 잠금은 punishSpammer 가 자동으로 겁니다)
  tracker.clear(key);

  const channelCount = new Set(entries.map((e) => e.data.channelId)).size;
  const reasons = [
    `Sent the same message ${entries.length} times within ${cfg.windowSec} seconds ` +
      `across ${channelCount} channel${channelCount === 1 ? '' : 's'} (${cfg.repeatCount}+ triggers)`,
  ];

  await punishSpammer({
    client,
    message,
    member,
    reasons,
    targets: entries.map((e) => e.data), // 윈도우 안의 같은 메시지 전부 (모든 채널)
    extraFields: [{ name: 'Message', value: truncate(message.content.trim(), 300) }],
    spam: {
      title: 'Same-message spam',
      noticeLabel: 'same-message spam',
      timeoutMin: cfg.timeoutMin,
      buildDM: buildSameMessageSpamDM,
    },
  });
  return true;
}

module.exports = { handleMessage, normalize };
