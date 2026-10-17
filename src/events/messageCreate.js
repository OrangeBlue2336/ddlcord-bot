// 메시지 이벤트: 자동 관리(도배/스팸 이미지) 검사 전용. 명령어는 슬래시 명령어라서 events/interactionCreate.js 가 처리합니다.
const { Events } = require('discord.js');
const { interceptPunishedMessage } = require('../utils/punish');
const pingSpam = require('../features/pingSpam');
const emojiSpam = require('../features/emojiSpam');
const sameMessageSpam = require('../features/sameMessageSpam');
const imageSpam = require('../features/imageSpam');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    // 봇/웹훅 메시지, DM, 다른 서버 메시지는 무시
    if (message.author.bot) return;
    if (!message.guild || message.guild.id !== process.env.GUILD_ID) return;

    // 스팸 이미지 처벌 시 최근 1시간 메시지를 지우기 위해 메시지 ID 를 기록 (즉시 끝나는 가벼운 작업)
    try {
      imageSpam.trackMessage(message);
    } catch (err) {
      console.error('[automod] Error while recording the message:', err);
    }

    // 처벌이 진행 중이거나 막 끝난 유저의 메시지는 여기서 모아 삭제 (타임아웃이 적용되기 전에 보낸 메시지가 남지 않도록)
    try {
      if (interceptPunishedMessage(message, client)) return;
    } catch (err) {
      console.error('[automod] Error while handling a message from a punished user:', err);
    }

    // ---- 자동 관리 (먼저 감지된 기능 하나만 처리하고 나머지는 건너뜀) ----
    try {
      if (await pingSpam.handleMessage(message, client)) return;
      if (await emojiSpam.handleMessage(message, client)) return;
      if (await sameMessageSpam.handleMessage(message, client)) return;
      if (await imageSpam.handleMessage(message, client)) return;
    } catch (err) {
      console.error('[automod] Error while checking message:', err);
    }
  },
};
