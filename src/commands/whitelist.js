const db = require('../db');
const { createCommand } = require('../utils/slash');
const { infoEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/embeds');

// remove 에서 삭제된 역할(선택 목록에 안 나옴)을 지울 수 있도록 역할 ID 를 직접 적는 칸도 둔다
const ID_PATTERN = /^\d{17,20}$/;

module.exports = {
  data: createCommand('whitelist', 'Manage roles that skip auto-moderation and can use commands.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Whitelist a role.')
        .addRoleOption((option) => option.setName('role').setDescription('The role to whitelist.').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a role from the whitelist.')
        .addRoleOption((option) => option.setName('role').setDescription('The role to remove.'))
        .addStringOption((option) =>
          option.setName('role_id').setDescription('Role ID, for a role that was deleted from the server.').setMaxLength(20)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the whitelisted roles.')),
  usage: ['whitelist add|remove @role', 'whitelist list'],
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const roleIds = db.getWhitelistRoleIds();
      const description = roleIds.length
        ? roleIds.map((id) => `<@&${id}>`).join('\n')
        : 'No whitelisted roles registered.\nAdministrators are always whitelisted.';
      return replyEmbed(interaction, infoEmbed('Whitelisted roles', description));
    }

    if (sub === 'add') {
      const role = interaction.options.getRole('role', true);
      // @everyone 을 등록하면 모든 멤버가 자동 관리에서 제외되므로 막는다
      if (role.id === interaction.guild.id) {
        return replyEmbed(interaction, errorEmbed('Not allowed', 'The @everyone role cannot be whitelisted because it would disable auto-moderation for everyone.'));
      }
      if (!interaction.guild.roles.cache.has(role.id)) {
        return replyEmbed(interaction, errorEmbed('Role not found', 'That role does not exist in this server.'));
      }
      const added = await db.addWhitelistRole(role.id);
      return replyEmbed(
        interaction,
        added
          ? successEmbed('Role whitelisted', `<@&${role.id}> is now whitelisted. Members with this role are skipped by auto-moderation and can use bot commands.`)
          : infoEmbed('Already whitelisted', `<@&${role.id}> is already in the whitelist.`)
      );
    }

    // remove
    const role = interaction.options.getRole('role');
    const rawId = (interaction.options.getString('role_id') ?? '').trim();
    const roleId = role?.id ?? (ID_PATTERN.test(rawId) ? rawId : null);
    if (!roleId) {
      return replyEmbed(
        interaction,
        errorEmbed('Role not specified', 'Choose a `role`, or enter the `role_id` of a deleted role (17-20 digits).')
      );
    }
    const removed = await db.removeWhitelistRole(roleId);
    return replyEmbed(
      interaction,
      removed
        ? successEmbed('Role removed from whitelist', `<@&${roleId}> is no longer whitelisted.`)
        : infoEmbed('Not in the whitelist', `<@&${roleId}> was not in the whitelist.`)
    );
  },
};
