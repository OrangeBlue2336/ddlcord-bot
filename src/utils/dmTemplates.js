// 제재 DM 임베드를 만드는 함수 모음.
// 실제 제재 코드와 /testdm 이 "같은 함수"를 쓰게 해서, 테스트 DM과 실제 DM이 달라지지 않게 합니다.
//
// 모든 기능의 DM 문구가 완성되었습니다. (신규 계정, 멘션 도배, 이모지 도배, 같은 메시지 도배, 스팸 이미지 추방/타임아웃)
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { COLORS } = require('./embeds');

const MRBEAST_VARIANTS = ['ban', 'timeout'];

// ---------- 기능 A: 신규 계정 ----------
// unlockTimestamp: 타임아웃이 풀리는 시각 (유닉스 초)
function buildAccountAgeDM({ guildName, unlockTimestamp }) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`You have been timed out in ${guildName}`)
    .setDescription(
      'For security reasons, our server requires all accounts to be at least 14 days old, so you have been timed out ' +
        `until <t:${unlockTimestamp}:F>.\n\n` +
        'This is an automatic measure applied to new accounts. If you wish to be un-timed out sooner, please open a ModMail ticket in our server.'
    )
    .setFooter({ text: 'Automated message by bot. Replies are not monitored.' });
}

// /testdm accountage 용 예시 값: 계정이 5일 13시간 전에 만들어졌다고 가정 → 8일 11시간 타임아웃
function buildAccountAgeTestDM(ctx) {
  const now = ctx.now ?? Date.now();
  const createdMs = now - (5 * 24 + 13) * 60 * 60 * 1000;
  const unlockMs = createdMs + config.accountAge.minDays * 24 * 60 * 60 * 1000;
  return buildAccountAgeDM({
    guildName: ctx.guildName ?? 'this server',
    unlockTimestamp: Math.floor(unlockMs / 1000),
  });
}

// ---------- 기능 B: 멘션 도배 ----------
// unlockTimestamp: 타임아웃이 풀리는 시각 (유닉스 초)
function buildPingSpamDM({ guildName, unlockTimestamp }) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`You have been timed out in ${guildName}`)
    .setDescription(
      'Your recent messages were detected as mention spam, so you have been timed out ' +
        `until <t:${unlockTimestamp}:F>.\n\n` +
        'This is an automatic action. Please avoid mass-mentioning users or roles.'
    )
    .setFooter({ text: 'Automated message by bot. Replies are not monitored.' });
}

// /testdm pingspam 용 예시 값: 명령어 실행 시점 + 타임아웃 시간(config.pingSpam.timeoutMin)
function buildPingSpamTestDM(ctx) {
  const now = ctx.now ?? Date.now();
  return buildPingSpamDM({
    guildName: ctx.guildName ?? 'this server',
    unlockTimestamp: Math.floor((now + config.pingSpam.timeoutMin * 60 * 1000) / 1000),
  });
}

// ---------- 기능 C: 이모지 도배 ----------
// unlockTimestamp: 타임아웃이 풀리는 시각 (유닉스 초)
function buildEmojiSpamDM({ guildName, unlockTimestamp }) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`You have been timed out in ${guildName}`)
    .setDescription(
      'Your recent messages were detected as emoji spam, so you have been timed out ' +
        `until <t:${unlockTimestamp}:F>.\n\n` +
        'This is an automatic action. Please avoid sending large numbers of emojis.'
    )
    .setFooter({ text: 'Automated message by bot. Replies are not monitored.' });
}

// /testdm emojispam 용 예시 값: 명령어 실행 시점 + 타임아웃 시간(config.emojiSpam.timeoutMin)
function buildEmojiSpamTestDM(ctx) {
  const now = ctx.now ?? Date.now();
  return buildEmojiSpamDM({
    guildName: ctx.guildName ?? 'this server',
    unlockTimestamp: Math.floor((now + config.emojiSpam.timeoutMin * 60 * 1000) / 1000),
  });
}

// ---------- 기능 E: 같은 메시지 도배 ----------
// unlockTimestamp: 타임아웃이 풀리는 시각 (유닉스 초)
function buildSameMessageSpamDM({ guildName, unlockTimestamp }) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`You have been timed out in ${guildName}`)
    .setDescription(
      'You sent the same message repeatedly, which was detected as spam, so you have been timed out ' +
        `until <t:${unlockTimestamp}:F>.\n\n` +
        'This is an automatic action. Please avoid sending the same message over and over.'
    )
    .setFooter({ text: 'Automated message by bot. Replies are not monitored.' });
}

// /testdm samespam 용 예시 값: 명령어 실행 시점 + 타임아웃 시간(config.sameMessageSpam.timeoutMin)
function buildSameMessageSpamTestDM(ctx) {
  const now = ctx.now ?? Date.now();
  return buildSameMessageSpamDM({
    guildName: ctx.guildName ?? 'this server',
    unlockTimestamp: Math.floor((now + config.sameMessageSpam.timeoutMin * 60 * 1000) / 1000),
  });
}

// ---------- 기능 D: 스팸 이미지 ----------
const SECURE_ACCOUNT_TEXT =
  'If your account has been compromised, please change your password and enable two-factor authentication.';

// 추방용 (ban 후 즉시 unban). 실제 추방 "전에" 발송됩니다.
function buildImageSpamBanDM({ guildName }) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`You have been kicked from ${guildName}`)
    .setDescription(
      'You sent an image that was detected as a likely scam image, so you have been kicked from the server. You may join back after recovering your account.\n\n' +
        `This is an automatic action. ${SECURE_ACCOUNT_TEXT}`
    )
    .setFooter({ text: 'Automated message by bot. Replies are not monitored.' });
}

// 타임아웃용. unlockTimestamp: 타임아웃이 풀리는 시각 (유닉스 초)
function buildImageSpamTimeoutDM({ guildName, unlockTimestamp }) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`You have been timed out in ${guildName}`)
    .setDescription(
      'You sent an image that was detected as a likely scam image, so you have been timed out ' +
        `until <t:${unlockTimestamp}:F> and your recent messages were deleted.\n\n` +
        `This is an automatic action. ${SECURE_ACCOUNT_TEXT}`
    )
    .setFooter({ text: 'Automated message by bot. Replies are not monitored.' });
}

// /testdm mrbeast timeout 용 예시 값: 명령어 실행 시점 + 타임아웃 시간(config.imageSpam.timeoutHours)
function buildImageSpamTimeoutTestDM(ctx) {
  const now = ctx.now ?? Date.now();
  return buildImageSpamTimeoutDM({
    guildName: ctx.guildName ?? 'this server',
    unlockTimestamp: Math.floor((now + config.imageSpam.timeoutHours * 60 * 60 * 1000) / 1000),
  });
}

// /testdm 용 등록부: 기능 이름 -> (variant, ctx) => [임베드, ...]
// ctx = { guildName, now }
const testTemplates = {
  accountage: (variant, ctx) => [buildAccountAgeTestDM(ctx)],
  pingspam: (variant, ctx) => [buildPingSpamTestDM(ctx)],
  emojispam: (variant, ctx) => [buildEmojiSpamTestDM(ctx)],
  samespam: (variant, ctx) => [buildSameMessageSpamTestDM(ctx)],
  // mrbeast 는 DM이 두 종류(ban / timeout). 종류를 생략하면 둘 다 보냄
  mrbeast: (variant, ctx) => {
    const ban = buildImageSpamBanDM({ guildName: ctx.guildName ?? 'this server' });
    if (variant === 'ban') return [ban];
    if (variant === 'timeout') return [buildImageSpamTimeoutTestDM(ctx)];
    return [ban, buildImageSpamTimeoutTestDM(ctx)];
  },
};

const FEATURE_NAMES = Object.keys(testTemplates);

// 해당 기능의 테스트 DM 임베드 배열을 돌려줌 (없는 기능이면 null)
function buildTestEmbeds(feature, variant, ctx = {}) {
  const build = testTemplates[feature];
  return build ? build(variant, ctx) : null;
}

module.exports = { FEATURE_NAMES, MRBEAST_VARIANTS, buildTestEmbeds, buildAccountAgeDM, buildPingSpamDM, buildEmojiSpamDM, buildSameMessageSpamDM, buildImageSpamBanDM, buildImageSpamTimeoutDM };
