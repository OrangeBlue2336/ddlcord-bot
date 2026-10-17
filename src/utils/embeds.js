// 명령어 응답용 임베드를 만드는 공용 도우미
const { EmbedBuilder, MessageFlags } = require('discord.js');

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

// 슬래시 명령어에 임베드로 응답한다.
//  - interactionCreate 가 명령어 실행 전에 "생각 중..." 응답(defer)을 이미 해 두므로, 보통은 그 응답을 수정(editReply)한다.
//  - 공개/나만 보기 여부는 defer 할 때 정해진다 (명령어 모듈의 `ephemeral`). 여기서는 바꿀 수 없다.
//  - `defer: false` 명령어처럼 아직 응답 전이면 새로 응답한다 (options.ephemeral 로 나만 보기 지정 가능).
function replyEmbed(interaction, embed, options = {}) {
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
  const extra = options.ephemeral ? { flags: MessageFlags.Ephemeral } : {};
  if (interaction.replied || interaction.deferred) return interaction.followUp({ ...payload, ...extra });
  return interaction.reply({ ...payload, ...extra });
}

module.exports = { COLORS, infoEmbed, successEmbed, errorEmbed, warnEmbed, truncate, replyEmbed };
