const db = require('../db');
const { infoEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/embeds');

// 멘션(@역할) 또는 역할 ID 숫자에서 역할 ID를 꺼냄
function resolveRoleId(message, arg) {
  const mentioned = message.mentions.roles.first();
  if (mentioned) return mentioned.id;
  if (arg && /^\d{17,20}$/.test(arg)) return arg;
  return null;
}

module.exports = {
  name: 'whitelist',
  description: 'Manage whitelisted roles. Whitelisted roles are skipped by auto-moderation and can use bot commands.',
  usage: ['whitelist add @role', 'whitelist remove @role', 'whitelist list'],
  async execute(message, args) {
    const sub = (args[0] ?? '').toLowerCase();

    if (sub === 'list') {
      const roleIds = db.getWhitelistRoleIds();
      const description = roleIds.length
        ? roleIds.map((id) => `<@&${id}>`).join('\n')
        : 'No whitelisted roles registered.\nAdministrators are always whitelisted.';
      return replyEmbed(message, infoEmbed('Whitelisted roles', description));
    }

    if (sub === 'add' || sub === 'remove') {
      const roleId = resolveRoleId(message, args[1]);
      if (!roleId) {
        return replyEmbed(
          message,
          errorEmbed('Role not specified', `Usage: \`^whitelist ${sub} @role\` (a role ID also works)`)
        );
      }

      if (sub === 'add') {
        if (!message.guild.roles.cache.has(roleId)) {
          return replyEmbed(message, errorEmbed('Role not found', 'That role does not exist in this server.'));
        }
        const added = await db.addWhitelistRole(roleId);
        return replyEmbed(
          message,
          added
            ? successEmbed('Role whitelisted', `<@&${roleId}> is now whitelisted. Members with this role are skipped by auto-moderation and can use bot commands.`)
            : infoEmbed('Already whitelisted', `<@&${roleId}> is already in the whitelist.`)
        );
      }

      const removed = await db.removeWhitelistRole(roleId);
      return replyEmbed(
        message,
        removed
          ? successEmbed('Role removed from whitelist', `<@&${roleId}> is no longer whitelisted.`)
          : infoEmbed('Not in the whitelist', `<@&${roleId}> was not in the whitelist.`)
      );
    }

    return replyEmbed(
      message,
      errorEmbed('Invalid usage', 'Usage:\n`^whitelist add @role`\n`^whitelist remove @role`\n`^whitelist list`')
    );
  },
};
