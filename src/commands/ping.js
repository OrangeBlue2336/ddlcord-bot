module.exports = {
  name: 'ping',
  description: 'Check that the bot is alive and show its latency.',
  usage: ['ping'],
  async execute(message) {
    // 임베드가 아닌 단순 메시지로 응답 (답장 알림 핑은 끔)
    const sent = await message.reply({
      content: 'Pong! 🏓',
      allowedMentions: { repliedUser: false },
    });

    // 지연시간 = 내 명령어 메시지가 만들어진 시각 ~ 봇 응답이 만들어진 시각 (둘 다 디스코드 서버 시계 기준이라 서버 시간 차이의 영향이 없음)
    const latency = Math.max(0, sent.createdTimestamp - message.createdTimestamp);

    await sent.edit({
      content: `Pong! 🏓 Latency: ${latency}ms`,
      allowedMentions: { repliedUser: false },
    });
  },
};
