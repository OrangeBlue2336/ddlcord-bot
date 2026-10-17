// 기능 C: 이모지 도배
// 다음 중 하나라도 만족하면 이모지 도배로 판정합니다 (기준값은 config.js 의 emojiSpam).
//   1. 한 메시지에 이모지 N개 이상 (같은 이모지를 반복해도 모두 셈)
//   2. 같은 채널에서 시간 윈도우(기본 15초) 안에 이모지가 포함된 메시지 N개 이상
// 이모지 = 유니코드 이모지(가족/국기/피부색 같은 조합형은 1개) + 서버 커스텀 이모지(<:이름:ID>, <a:이름:ID>)
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
const CUSTOM_EMOJI = /<a?:\w{1,32}:\d{17,20}>/g;

// "유저 + 채널" 별로 이모지 포함 메시지를 기억하는 윈도우 (같은 채널 안에서만 합산)
const tracker = new SlidingWindow(cfg.burstWindowSec * 1000);

// 메시지 안의 이모지 개수 (반복도 모두 셈)
function countEmojis(content) {
  const customCount = content.match(CUSTOM_EMOJI)?.length ?? 0;
  // 커스텀 이모지를 먼저 걷어내서, 그 안의 글자가 유니코드 이모지로 잘못 세어지지 않게 함
  const withoutCustom = content.replace(CUSTOM_EMOJI, '');
  const unicodeCount = withoutCustom.match(UNICODE_EMOJI)?.length ?? 0;
  return customCount + unicodeCount;
}

// 메시지 1개를 검사. 이모지 도배로 처리했거나 처리 중인 유저면 true (이후 다른 기능 검사는 건너뜀)
async function handleMessage(message, client) {
  if (!db.isFeatureEnabled('emojispam')) return false;
  if (!message.content) return false;

  const emojiCount = countEmojis(message.content);
  if (emojiCount === 0) return false; // 이모지가 없는 메시지는 여기서 끝 (가장 흔한 경우)

  if (isExemptChannel(message.channel)) return false; // 예외 채널은 검사·합산 모두 제외

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isWhitelisted(member)) return false;

  const userId = message.author.id;
  if (isBeingPunished(userId)) return true; // 이미 처벌 진행 중 (다른 기능 포함)

  const key = `${userId}:${message.channelId}`;
  const current = { messageId: message.id, channelId: message.channelId };
  const entries = tracker.add(key, current, message.createdTimestamp);

  const reasons = [];
  if (emojiCount >= cfg.perMessageLimit) {
    reasons.push(`Used ${emojiCount} emojis in one message (${cfg.perMessageLimit}+ triggers)`);
  }
  const burst = entries.length >= cfg.burstCount;
  if (burst) {
    reasons.push(`Sent ${entries.length} messages with emojis within ${cfg.burstWindowSec} seconds in the same channel (${cfg.burstCount}+ triggers)`);
  }
  if (!reasons.length) return false;

  // 중복 처벌 방지: 이 채널의 윈도우 기록 비우기 (처벌 진행 잠금은 punishSpammer 가 자동으로 겁니다)
  tracker.clear(key);

  // 조건 2 이면 이 채널 윈도우 안의 이모지 포함 메시지 전부, 조건 1 만이면 해당 메시지만 삭제
  const targets = burst ? entries.map((e) => e.data) : [current];

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

module.exports = { handleMessage, countEmojis };
