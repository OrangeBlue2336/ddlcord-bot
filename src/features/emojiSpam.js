// 기능 C: 이모지 도배
// 다음 중 하나라도 만족하면 이모지 도배로 판정합니다 (기준값은 config.js 의 emojiSpam).
//   1. 한 메시지에 이모지 N개 이상 (같은 이모지를 반복해도 모두 셈)
//   2. 같은 채널에서 시간 윈도우 안에 이모지가 포함된 메시지 N개 이상
//   3. 한 메시지에서 같은 이모지를 N개 이상 반복
//   4. 시간 윈도우 안에 보낸 이모지 총 개수가 N개 이상 (메시지를 쪼개 보내거나 채널을 옮겨 다녀도 합산)
// 이모지 = 유니코드 이모지(가족/국기/피부색 같은 조합형은 1개) + 서버 커스텀 이모지(<:이름:ID>, <a:이름:ID>)
// "같은 이모지" 판정: 유니코드는 피부색/변형 문자(FE0F)를 무시하고 비교, 커스텀은 이모지 ID 로 비교
// 예외 채널(/emojispam exempt)과 그 채널의 스레드/포럼 게시글에서는 검사하지 않습니다.
// 처리: 메시지 삭제 → 채널 통보 → 타임아웃 → DM → 로그 (utils/spamPunishment.js 공용)
const emojiRegex = require('emoji-regex');
const config = require('../config');
const db = require('../db');
const { isWhitelisted, isExemptChannel } = require('../utils/permissions');
const { isBeingPunished } = require('../utils/punish');
const { punishSpammer } = require('../utils/spamPunishment');
const { SlidingWindow } = require('../utils/slidingWindow');
const { buildEmojiSpamDM } = require('../utils/dmTemplates');

const cfg = config.emojiSpam;

const UNICODE_EMOJI = emojiRegex();
const CUSTOM_EMOJI = /<a?:\w{1,32}:(\d{17,20})>/g;
const VARIATION_SELECTOR = /\uFE0F/g;
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;

// "유저 + 채널" 별로 이모지 포함 메시지를 기억하는 윈도우 (같은 채널 안에서만 합산)
const tracker = new SlidingWindow(cfg.burstWindowSec * 1000);

// "유저" 별로 이모지 총 개수를 기억하는 윈도우 (모든 채널 합산)
const totalTracker = new SlidingWindow(cfg.totalWindowSec * 1000);

// 유니코드 이모지를 비교하기 쉬운 형태로 통일 (❤ 와 ❤️, 👍 와 👍🏻 를 같은 이모지로 취급)
function normalizeUnicodeEmoji(emoji) {
  return emoji.replace(VARIATION_SELECTOR, '').replace(SKIN_TONE, '');
}

// 메시지 안의 이모지를 분석: total = 전체 개수(반복도 모두 셈), maxSame = 가장 많이 반복된 이모지의 개수
function analyzeEmojis(content) {
  const counts = new Map();
  let total = 0;
  const bump = (key) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  };

  for (const match of content.matchAll(CUSTOM_EMOJI)) bump(`custom:${match[1]}`);

  // 커스텀 이모지를 먼저 걷어내서, 그 안의 글자가 유니코드 이모지로 잘못 세어지지 않게 함
  const withoutCustom = content.replace(CUSTOM_EMOJI, '');
  for (const match of withoutCustom.matchAll(UNICODE_EMOJI)) bump(`unicode:${normalizeUnicodeEmoji(match[0])}`);

  let maxSame = 0;
  for (const count of counts.values()) if (count > maxSame) maxSame = count;
  return { total, maxSame };
}

// 메시지 안의 이모지 개수 (반복도 모두 셈)
function countEmojis(content) {
  return analyzeEmojis(content).total;
}

// 메시지 1개를 검사. 이모지 도배로 처리했거나 처리 중인 유저면 true (이후 다른 기능 검사는 건너뜀)
async function handleMessage(message, client) {
  if (!db.isFeatureEnabled('emojispam')) return false;
  if (!message.content) return false;

  const { total: emojiCount, maxSame } = analyzeEmojis(message.content);
  if (emojiCount === 0) return false; // 이모지가 없는 메시지는 여기서 끝 (가장 흔한 경우)

  if (isExemptChannel(message.channel)) return false; // 예외 채널은 검사·합산 모두 제외

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isWhitelisted(member)) return false;

  const userId = message.author.id;
  if (isBeingPunished(userId)) return true; // 이미 처벌 진행 중 (다른 기능 포함)

  const channelKey = `${userId}:${message.channelId}`;
  const current = { messageId: message.id, channelId: message.channelId };
  const channelEntries = tracker.add(channelKey, current, message.createdTimestamp);
  const totalEntries = totalTracker.add(userId, { ...current, count: emojiCount }, message.createdTimestamp);
  const windowTotal = totalEntries.reduce((sum, e) => sum + e.data.count, 0);

  const reasons = [];
  if (emojiCount >= cfg.perMessageLimit) {
    reasons.push(`Used ${emojiCount} emojis in one message (${cfg.perMessageLimit}+ triggers)`);
  }
  if (maxSame >= cfg.sameEmojiLimit) {
    reasons.push(`Repeated the same emoji ${maxSame} times in one message (${cfg.sameEmojiLimit}+ triggers)`);
  }
  const burst = channelEntries.length >= cfg.burstCount;
  if (burst) {
    reasons.push(`Sent ${channelEntries.length} messages with emojis within ${cfg.burstWindowSec} seconds in the same channel (${cfg.burstCount}+ triggers)`);
  }
  const overTotal = windowTotal >= cfg.totalLimit;
  if (overTotal) {
    reasons.push(`Sent ${windowTotal} emojis in total within ${cfg.totalWindowSec} seconds across all channels (${cfg.totalLimit}+ triggers)`);
  }
  if (!reasons.length) return false;

  // 중복 처벌 방지: 윈도우 기록 비우기 (처벌 진행 잠금은 punishSpammer 가 자동으로 겁니다)
  tracker.clear(channelKey);
  totalTracker.clear(userId);

  // 연속 전송(조건 2) 또는 누적 개수(조건 4) 이면 윈도우 안의 이모지 포함 메시지 전부, 그 외에는 해당 메시지만 삭제
  const targets = [];
  const seen = new Set();
  const addTarget = (t) => {
    if (seen.has(t.messageId)) return;
    seen.add(t.messageId);
    targets.push({ messageId: t.messageId, channelId: t.channelId });
  };
  if (burst) channelEntries.forEach((e) => addTarget(e.data));
  if (overTotal) totalEntries.forEach((e) => addTarget(e.data));
  if (!targets.length) addTarget(current);

  await punishSpammer({
    client,
    message,
    member,
    reasons,
    targets,
    spam: {
      title: 'Emoji spam',
      noticeLabel: 'emoji spam',
      timeoutMin: cfg.timeoutMin,
      buildDM: buildEmojiSpamDM,
    },
  });
  return true;
}

module.exports = { handleMessage, countEmojis, analyzeEmojis };
