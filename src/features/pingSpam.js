// 기능 B: 멘션 도배
// 다음 중 하나라도 만족하면 멘션 도배로 판정합니다 (기준값은 config.js 의 pingSpam).
//   1. 한 메시지에 서로 다른 유저 N명 이상 멘션
//   2. 한 메시지에 서로 다른 역할 N개 이상 멘션 (@everyone, @here 도 역할 1개로 취급)
//   3. 시간 윈도우(기본 15초) 안에 멘션이 포함된 메시지 N개 이상 (모든 채널 합산)
// 처리 순서: 메시지 삭제 → 채널 통보 → 타임아웃 → DM → 로그 (utils/spamPunishment.js 공용)
const config = require('../config');
const db = require('../db');
const { isWhitelisted } = require('../utils/permissions');
const { isBeingPunished } = require('../utils/punish');
const { punishSpammer } = require('../utils/spamPunishment');
const { SlidingWindow } = require('../utils/slidingWindow');
const { buildPingSpamDM } = require('../utils/dmTemplates');

const cfg = config.pingSpam;

// 유저별로 "멘션이 포함된 메시지"를 기억하는 윈도우 (메모리)
const tracker = new SlidingWindow(cfg.burstWindowSec * 1000);
// 메시지에서 "직접 입력한" 멘션만 셉니다.
// - 답장(Reply)의 자동 멘션은 메시지 본문에 <@id> 가 없으므로 자동으로 제외됩니다.
// - 권한이 없어 실제로는 핑이 되지 않는 @everyone/@here 는 세지 않습니다.
function extractMentions(message) {
  const content = message.content ?? '';

  const userIds = new Set();
  for (const m of content.matchAll(/<@!?(\d{17,20})>/g)) {
    if (message.mentions.users.has(m[1])) userIds.add(m[1]);
  }

  const roleIds = new Set();
  for (const m of content.matchAll(/<@&(\d{17,20})>/g)) {
    if (message.mentions.roles.has(m[1])) roleIds.add(m[1]);
  }

  const everyone = message.mentions.everyone && content.includes('@everyone');
  const here = message.mentions.everyone && content.includes('@here');

  // 같은 역할을 여러 번 써도 1개로 계산
  const roleCount = roleIds.size + (everyone ? 1 : 0) + (here ? 1 : 0);
  const userCount = userIds.size;
  return { userCount, roleCount, hasAny: userCount + roleCount > 0 };
}

// 메시지 1개를 검사. 멘션 도배로 처리했거나 처리 중인 유저면 true (이후 다른 기능 검사는 건너뜀)
async function handleMessage(message, client) {
  if (!db.isFeatureEnabled('pingspam')) return false;

  const mentions = extractMentions(message);
  if (!mentions.hasAny) return false; // 멘션이 없는 메시지는 여기서 끝 (가장 흔한 경우)

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isWhitelisted(member)) return false;

  const userId = message.author.id;
  if (isBeingPunished(userId)) return true; // 이미 처벌 진행 중 (다른 기능 포함)

  const current = { messageId: message.id, channelId: message.channelId };
  const entries = tracker.add(userId, current, message.createdTimestamp);

  const reasons = [];
  if (mentions.userCount >= cfg.userMentionLimit) {
    reasons.push(`Mentioned ${mentions.userCount} different users in one message (${cfg.userMentionLimit}+ triggers)`);
  }
  if (mentions.roleCount >= cfg.roleMentionLimit) {
    reasons.push(`Mentioned ${mentions.roleCount} different roles/@everyone/@here in one message (${cfg.roleMentionLimit}+ triggers)`);
  }
  const burst = entries.length >= cfg.burstCount;
  if (burst) {
    reasons.push(`Sent ${entries.length} messages with mentions within ${cfg.burstWindowSec} seconds (${cfg.burstCount}+ triggers)`);
  }
  if (!reasons.length) return false;

  // 중복 처벌 방지: 해당 유저의 윈도우 기록 비우기 (처벌 진행 잠금은 punishSpammer 가 자동으로 겁니다)
  tracker.clear(userId);

  // 조건 3 이면 윈도우 안의 멘션 포함 메시지 전부, 조건 1·2 만이면 해당 메시지만 삭제
  const targets = burst ? entries.map((e) => e.data) : [current];

  await punishSpammer({
    client,
    message,
    member,
    reasons,
    targets,
    spam: {
      title: 'Mention spam',
      noticeLabel: 'mention spam',
      timeoutMin: cfg.timeoutMin,
      buildDM: buildPingSpamDM,
    },
  });
  return true;
}

module.exports = { handleMessage };
