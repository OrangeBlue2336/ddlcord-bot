// 슬래시 명령어를 디스코드에 등록한다.
//  - "길드(서버) 명령어"로 등록하므로 몇 초 안에 바로 반영된다 (전역 명령어는 반영이 느릴 수 있음)
//  - 등록은 "덮어쓰기" 방식이라, 코드에서 지운 명령어는 디스코드에서도 사라진다
//  - 사용처: ① scripts/deploy-commands.js (npm run deploy:dev / deploy:prod) ② events/ready.js (prod 는 시작할 때 자동)
const { Routes } = require('discord.js');

// 봇 토큰만으로 애플리케이션 ID 를 조회 (.env 에 따로 적을 필요 없음)
async function fetchApplicationId(rest) {
  const app = await rest.get(Routes.oauth2CurrentApplication());
  return app.id;
}

// commands: loadCommandModules() 가 돌려준 Map. 등록된 명령어 이름 목록을 돌려준다.
async function registerGuildCommands(rest, applicationId, guildId, commands) {
  const body = [...commands.values()].map((command) => command.data.toJSON());
  const result = await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
  return result.map((c) => c.name);
}

// 등록 실패 사유를 알기 쉬운 문장으로 바꾼다
function describeRegisterError(err) {
  if (err?.status === 401) return 'The bot token is not valid (check BOT_TOKEN).';
  if (err?.code === 50001 || err?.status === 403) {
    return 'Missing access. Re-invite the bot to the server with the "bot" AND "applications.commands" scopes (Developer Portal > OAuth2 > URL Generator), and check GUILD_ID.';
  }
  if (err?.code === 10004 || err?.code === 10002) return 'Unknown server or application (check GUILD_ID).';
  return err?.message ?? String(err);
}

module.exports = { fetchApplicationId, registerGuildCommands, describeRegisterError };
