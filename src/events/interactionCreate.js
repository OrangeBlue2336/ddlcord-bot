// 슬래시 명령어 실행 처리: 서버 확인 -> 권한 확인 -> "생각 중..." 응답 -> 명령어 실행
// (/help 의 페이지 버튼은 help.js 안에서 처리하므로 여기서는 명령어만 다룸)
const { Events, MessageFlags, GuildMember } = require('discord.js');
const { canUseCommands } = require('../utils/permissions');
const { errorEmbed, replyEmbed } = require('../utils/embeds');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    // 설정된 서버(GUILD_ID) 밖에서는 동작하지 않음 (응답은 해야 하므로 본인에게만 보이는 안내)
    if (interaction.guildId !== process.env.GUILD_ID) {
      return interaction.reply({ content: 'This bot only works in its configured server.', ...EPHEMERAL }).catch(() => {});
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      // 코드에서 지운 명령어가 아직 디스코드에 남아 있는 경우 (npm run deploy:dev 로 다시 등록하면 사라짐)
      return interaction.reply({ content: 'This command is no longer available.', ...EPHEMERAL }).catch(() => {});
    }

    // ---- 권한 확인 (권한이 없으면 나만 보이는 안내로 거절) ----
    // 디스코드의 "관리자에게만 보임" 설정은 화면 표시용이고, 실제 사용 가능 여부는 여기서 한 번 더 확인한다.
    let allowed = true;
    if (command.everyone) {
      // 누구나 사용 (예: /roleicon). 필요한 확인은 명령어 안에서 처리
    } else if (command.developerOnly) {
      allowed = !!process.env.DEVELOPER_ID && interaction.user.id === process.env.DEVELOPER_ID;
    } else {
      const member =
        interaction.member instanceof GuildMember
          ? interaction.member
          : await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      allowed = canUseCommands(member);
    }
    if (!allowed) {
      return interaction
        .reply({ content: 'You do not have permission to use this command.', ...EPHEMERAL })
        .catch(() => {});
    }

    try {
      // 3초 안에 응답하지 않으면 실패로 보이므로, 먼저 "생각 중..." 응답을 해 둔다 (공개/나만 보기도 여기서 결정됨)
      if (command.defer !== false) {
        await interaction.deferReply(command.ephemeral ? EPHEMERAL : undefined);
      }
      await command.execute(interaction, client);
    } catch (err) {
      console.error(`[command:${interaction.commandName}] Error:`, err);
      // 명령어가 실패했는데 아무 반응이 없으면 헷갈리므로 간단히 알림 (DB 연결 문제 등)
      await replyEmbed(
        interaction,
        errorEmbed('Something went wrong', 'The command failed. Please check the bot console for details.'),
        { ephemeral: true }
      ).catch(() => {});
    }
  },
};
