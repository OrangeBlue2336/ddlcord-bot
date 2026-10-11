const { Events } = require('discord.js');
const config = require('../config');
const { canUseCommands } = require('../utils/permissions');
const { errorEmbed, replyEmbed } = require('../utils/embeds');
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

    // ---- 자동 관리 (먼저 감지된 기능 하나만 처리하고 나머지는 건너뜀) ----
    try {
      if (await pingSpam.handleMessage(message, client)) return;
      if (await emojiSpam.handleMessage(message, client)) return;
      if (await sameMessageSpam.handleMessage(message, client)) return;
      if (await imageSpam.handleMessage(message, client)) return;
    } catch (err) {
      console.error('[automod] Error while checking message:', err);
    }

    // ---- 명령어 처리 ----
    if (!message.content.startsWith(config.prefix)) return;

    const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
    const commandName = (args.shift() ?? '').toLowerCase();
    const command = client.commands.get(commandName);
    if (!command) return;

    if (command.developerOnly) {
      // 개발자 전용: .env 의 DEVELOPER_ID 와 같은 사람만 사용 (관리자라도 아니면 조용히 무시)
      if (!process.env.DEVELOPER_ID || message.author.id !== process.env.DEVELOPER_ID) return;
    } else {
      const member =
        message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
      if (!canUseCommands(member)) return; // 권한 없으면 조용히 무시
    }

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error(`[command:${commandName}] Error:`, err);
      // 명령어가 실패했는데 아무 반응이 없으면 헷갈리므로 간단히 알림 (DB 연결 문제 등)
      await replyEmbed(
        message,
        errorEmbed('Something went wrong', 'The command failed. Please check the bot console for details.')
      ).catch(() => {});
    }
  },
};
