// 메시지 수정 이벤트: 수정된 메시지도 이모지 도배 검사를 합니다.
// (규칙에 걸리지 않는 이모지를 먼저 보낸 뒤 도배 내용으로 수정해서 검사를 피하는 것을 막기 위함)
// 현재는 이모지 도배만 검사합니다. 멘션/같은 메시지/스팸 이미지는 수정 메시지를 검사하지 않습니다.
const { Events } = require('discord.js');
const emojiSpam = require('../features/emojiSpam');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage, client) {
    // 내용이나 작성자를 알 수 없는 업데이트(링크 미리보기가 붙는 경우 등)는 무시
    if (newMessage.partial) return;

    // 봇/웹훅 메시지, DM, 다른 서버 메시지는 무시
    if (!newMessage.author || newMessage.author.bot) return;
    if (!newMessage.guild || newMessage.guild.id !== process.env.GUILD_ID) return;

    // 글자가 바뀌지 않은 업데이트(링크 미리보기 등)는 무시. 수정 전 내용을 알 수 없을 때(봇이 기억하지 못하는 옛 메시지)는 검사함
    if (typeof oldMessage.content === 'string' && oldMessage.content === newMessage.content) return;

    try {
      await emojiSpam.handleMessage(newMessage, client, { edited: true });
    } catch (err) {
      console.error('[automod] Error while checking an edited message:', err);
    }
  },
};
