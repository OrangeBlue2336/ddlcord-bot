// 화이트리스트 / 명령어 권한 체크
const { PermissionFlagsBits } = require('discord.js');
const db = require('../db');

function hasWhitelistedRole(member) {
  return member.roles.cache.some((role) => db.isWhitelistedRole(role.id));
}

// 자동 관리 제외 대상: 봇, 관리자 권한 보유자, ^whitelist 로 등록된 역할 보유자
function isWhitelisted(member) {
  if (!member) return false;
  if (member.user?.bot) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return hasWhitelistedRole(member);
}

// 명령어 사용 가능 대상: 관리자 권한 보유자 + ^whitelist 로 등록된 역할 보유자
function canUseCommands(member) {
  if (!member || member.user?.bot) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return hasWhitelistedRole(member);
}

// 예외 채널 판정 (이모지 도배 + 같은 메시지 도배 공용)
// - 채널 자체가 등록되어 있으면 예외
// - 스레드/포럼 게시글은 부모 채널이 등록되어 있으면 함께 예외
//   (일반 채널의 부모는 "카테고리"이므로 따지지 않음: 카테고리를 등록해도 그 안의 채널은 예외가 되지 않음)
function isExemptChannel(channel) {
  if (!channel) return false;
  if (db.isSpamExemptChannel(channel.id)) return true;
  return !!channel.isThread?.() && !!channel.parentId && db.isSpamExemptChannel(channel.parentId);
}

module.exports = { isWhitelisted, canUseCommands, isExemptChannel };
