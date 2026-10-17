// src/commands 폴더의 명령어 모듈을 불러오는 공용 함수 (봇 시작, 명령어 등록 스크립트가 함께 사용)
//
// 명령어 모듈 규칙 (자세한 내용은 plan.md "슬래시 명령어 규칙"):
//   data            (필수) utils/slash.js 의 createCommand() 로 만든 SlashCommandBuilder
//   execute         (필수) async (interaction, client) => {}
//   everyone        true 이면 누구나 사용 (이때 createCommand 에 { adminOnly: false } 도 줄 것)
//   developerOnly   true 이면 .env 의 DEVELOPER_ID 본인만 사용
//   ephemeral       true 이면 응답이 명령어를 쓴 사람에게만 보임 (기본은 채널에 공개)
//   defer           false 이면 자동으로 "생각 중..." 응답을 하지 않음 (직접 첫 응답을 보내는 명령어용, 기본 true)
//   usage           (선택) ['name sub|sub ...'] /help 의 "Other" 페이지 표시용
const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function loadCommandModules() {
  const commands = new Map();

  for (const file of fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(COMMANDS_DIR, file));
    const name = command.data?.name;
    if (!name || typeof command.execute !== 'function') {
      console.warn(`[loader] Skipped commands/${file} (it needs "data" and "execute")`);
      continue;
    }
    if (commands.has(name)) {
      console.warn(`[loader] Skipped commands/${file} (the command name "${name}" is already used)`);
      continue;
    }

    // 표시 설정과 권한 규칙이 어긋나면 알려준다 (새 명령어를 만들 때 실수 방지)
    const hiddenFromMembers = command.data.default_member_permissions != null;
    if (command.everyone && hiddenFromMembers) {
      console.warn(`[loader] /${name} is marked "everyone" but is hidden from non-admins. Use createCommand(..., { adminOnly: false }).`);
    }
    if (!command.everyone && !hiddenFromMembers) {
      console.warn(`[loader] /${name} is visible to everyone but only admins/whitelisted roles can use it. Use createCommand(...) without adminOnly: false.`);
    }

    commands.set(name, command);
  }
  return commands;
}

module.exports = { loadCommandModules };
