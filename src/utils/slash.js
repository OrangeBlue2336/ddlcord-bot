// 슬래시 명령어 정의용 공용 도우미 (모든 commands/*.js 가 사용)
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ApplicationIntegrationType,
} = require('discord.js');

// 슬래시 명령어의 기본 틀을 만든다.
//  - 서버(길드)에서만 사용 가능 (DM 에서는 안 보임)
//  - adminOnly: true(기본)이면 "관리자 권한이 있는 사람에게만 보이게" 설정한다.
//    (화이트리스트 역할 등 다른 역할에게 보이게 하려면 디스코드 서버 설정 > 연동 > 이 봇 > 명령어에서 직접 허용해야 한다)
//  - adminOnly: false 는 모두에게 보이는 명령어용 (명령어 모듈에도 `everyone: true` 를 함께 적을 것)
// 주의: 슬래시 명령어 설명(description)은 100자 이하여야 한다.
function createCommand(name, description, { adminOnly = true } = {}) {
  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  if (adminOnly) builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  return builder;
}

// "on / off" 하위 명령어 두 개를 붙인다. what: 설명 문구에 들어갈 대상 (예: 'the new account timeout')
function addOnOffSubcommands(builder, what) {
  return builder
    .addSubcommand((sub) => sub.setName('on').setDescription(`Turn ${what} on.`))
    .addSubcommand((sub) => sub.setName('off').setDescription(`Turn ${what} off.`));
}

module.exports = { createCommand, addOnOffSubcommands };
