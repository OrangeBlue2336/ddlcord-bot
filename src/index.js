const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');

// ---------- 1. 환경(dev / prod) 선택 및 .env 로드 ----------
const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'prod') {
  console.error('Please start the bot with "npm run dev" (test) or "npm start" (real server).');
  process.exit(1);
}

// .env 파일이 있으면 읽고, 없으면 호스팅 서비스(Render 등)의 환경변수를 그대로 사용
const envPath = path.join(ROOT, `.env.${mode}`);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.log(`.env.${mode} not found - using environment variables from the hosting service.`);
}
process.env.BOT_MODE = mode;
// DB 이름을 따로 지정하지 않으면 dev / prod 가 자동으로 분리됩니다 (ddlcord_dev / ddlcord_prod)
process.env.MONGODB_DB = process.env.MONGODB_DB || `ddlcord_${mode}`;

const required = ['BOT_TOKEN', 'GUILD_ID', 'LOG_CHANNEL_ID', 'MONGODB_URI'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`These required values are empty (check .env.${mode} or your hosting environment variables): ${missing.join(', ')}`);
  process.exit(1);
}
if (!process.env.DEVELOPER_ID) {
  console.warn('DEVELOPER_ID is empty - the ^keepalive command is disabled.');
}

// ---------- 2. 모듈 로드 (환경변수 로드 이후) ----------
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const db = require('./db');
const keepAlive = require('./utils/keepAlive');

async function main() {
  // Render 는 포트가 빨리 열려 있어야 하므로 웹서버를 DB 연결보다 먼저 시작
  keepAlive.startServer();

  // ---------- 3. DB 연결 ----------
  try {
    await db.init({ uri: process.env.MONGODB_URI, dbName: process.env.MONGODB_DB });
    console.log(`[db] Connected to MongoDB (database: ${process.env.MONGODB_DB})`);
  } catch (err) {
    console.error(`[db] Could not connect to MongoDB: ${err.message}`);
    console.error('Hint: check MONGODB_URI (special characters in the password must be URL-encoded) and that Atlas "Network Access" allows this server\'s IP.');
    process.exit(1);
  }
  keepAlive.resume(); // 저장된 keep-alive 설정이 켜짐이면 자동 시작

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,     // 신규 멤버 입장 감지 (특권 인텐트)
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,   // 메시지 내용 읽기 (특권 인텐트)
    ],
  });

  // ---------- 4. 명령어 / 이벤트 자동 로드 ----------
  client.commands = new Collection();

  const commandsDir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsDir, file));
    if (!command.name || typeof command.execute !== 'function') {
      console.warn(`[loader] Skipped commands/${file} (missing name or execute)`);
      continue;
    }
    client.commands.set(command.name, command);
  }

  const eventsDir = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
    const event = require(path.join(eventsDir, file));
    const handler = (...args) =>
      Promise.resolve(event.execute(...args, client)).catch((err) =>
        console.error(`[event:${event.name}] Error:`, err)
      );
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
  }

  console.log(`[loader] Commands: ${[...client.commands.keys()].join(', ')}`);

  // ---------- 5. 예기치 못한 에러로 봇이 꺼지지 않게 ----------
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

  // ---------- 6. 종료 처리 (Ctrl + C) ----------
  async function shutdown() {
    console.log('Shutting down...');
    keepAlive.shutdown();
    client.destroy();
    await db.close().catch(() => {});
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ---------- 7. 로그인 ----------
  client.login(process.env.BOT_TOKEN).catch((err) => {
    console.error('Login failed:', err.message);
    if (/disallowed intents/i.test(err.message)) {
      console.error('Hint: turn on SERVER MEMBERS INTENT and MESSAGE CONTENT INTENT in the Discord Developer Portal (Bot tab).');
    }
    process.exit(1);
  });
}

main();
