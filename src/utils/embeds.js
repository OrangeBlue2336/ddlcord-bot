// 명령어 응답용 임베드를 만드는 공용 도우미
const { EmbedBuilder } = require('discord.js');

const COLORS = {
  info: 0x5865f2,
  success: 0x57f287,
  error: 0xed4245,
  warn: 0xfee75c,
};

function build(color, title, description) {
  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

const infoEmbed = (title, description) => build(COLORS.info, title, description);
const successEmbed = (title, description) => build(COLORS.success, title, description);
const errorEmbed = (title, description) => build(COLORS.error, title, description);
const warnEmbed = (title, description) => build(COLORS.warn, title, description);

// 임베드 필드 값 길이 제한(1024자)을 넘지 않게 자름
function truncate(text, max = 1024) {
  const s = String(text);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// 명령어 메시지에 답장 (답장 알림 핑은 끔)
function replyEmbed(message, embed) {
  return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
}

module.exports = { COLORS, infoEmbed, successEmbed, errorEmbed, warnEmbed, truncate, replyEmbed };
