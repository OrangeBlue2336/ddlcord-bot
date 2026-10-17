// .env.{dev|prod} 로드 (봇 본체 index.js 와 명령어 등록 스크립트 scripts/deploy-commands.js 가 함께 사용)
//   - .env.{mode} 파일이 있으면 읽고, 없으면 호스팅 서비스(Render 등)의 환경변수를 그대로 사용합니다.
//   - DB 이름을 따로 지정하지 않으면 dev / prod 가 자동으로 분리됩니다 (ddlcord_dev / ddlcord_prod)
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..', '..');

// required: 비어 있으면 안 되는 환경변수 이름 목록, usageHint: 실행 방법을 잘못 썼을 때 보여줄 안내
function loadEnv(mode, { required = [], usageHint = 'Please run with "dev" or "prod".' } = {}) {
  if (mode !== 'dev' && mode !== 'prod') {
    console.error(usageHint);
    process.exit(1);
  }

  const envPath = path.join(ROOT, `.env.${mode}`);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    console.log(`.env.${mode} not found - using environment variables from the hosting service.`);
  }
  process.env.BOT_MODE = mode;
  process.env.MONGODB_DB = process.env.MONGODB_DB || `ddlcord_${mode}`;

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`These required values are empty (check .env.${mode} or your hosting environment variables): ${missing.join(', ')}`);
    process.exit(1);
  }
}

module.exports = { loadEnv };
