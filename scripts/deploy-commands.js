// 슬래시 명령어를 디스코드 서버에 등록하는 스크립트
//   npm run deploy:dev   (또는 npm run deploy)  -> .env.dev 의 봇/GUILD_ID 서버에 등록
//   npm run deploy:prod                         -> .env.prod 의 봇/GUILD_ID 서버에 등록
// 길드 명령어라서 몇 초 안에 반영됩니다. 봇을 켜 둘 필요는 없습니다.
const { loadEnv } = require('../src/utils/loadEnv');

const mode = process.argv[2];
loadEnv(mode, {
  required: ['BOT_TOKEN', 'GUILD_ID'],
  usageHint: 'Please run "npm run deploy:dev" or "npm run deploy:prod".',
});

const { REST } = require('discord.js');
const { loadCommandModules } = require('../src/utils/commandLoader');
const { fetchApplicationId, registerGuildCommands, describeRegisterError } = require('../src/utils/registerCommands');

async function main() {
  const commands = loadCommandModules();
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  console.log(`Registering ${commands.size} slash commands (${mode}) to server ${process.env.GUILD_ID}...`);
  const applicationId = await fetchApplicationId(rest);
  const names = await registerGuildCommands(rest, applicationId, process.env.GUILD_ID, commands);
  console.log(`Done. Registered: ${names.map((n) => `/${n}`).join(' ')}`);
}

main().catch((err) => {
  console.error(`Could not register the commands: ${describeRegisterError(err)}`);
  process.exit(1);
});
