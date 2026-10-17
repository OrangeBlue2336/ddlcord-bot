const { createCommand } = require('../utils/slash');

module.exports = {
  data: createCommand('ping', 'Check that the bot is alive and show its latency.'),
  defer: false, // 지연시간을 재기 위해 "생각 중..." 없이 바로 첫 응답을 보냄
  usage: ['ping'],
  async execute(interaction) {
    // 임베드가 아닌 단순 메시지로 응답
    await interaction.reply({ content: 'Pong! 🏓', allowedMentions: { parse: [] } });
    const sent = await interaction.fetchReply();

    // 지연시간 = 명령어가 만들어진 시각 ~ 봇 응답이 만들어진 시각 (둘 다 디스코드 서버 시계 기준이라 서버 시간 차이의 영향이 없음)
    const latency = Math.max(0, sent.createdTimestamp - interaction.createdTimestamp);

    await interaction.editReply({ content: `Pong! 🏓 Latency: ${latency}ms`, allowedMentions: { parse: [] } });
  },
};
