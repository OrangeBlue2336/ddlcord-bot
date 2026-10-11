const config = require('../config');
const { infoEmbed, replyEmbed } = require('../utils/embeds');

module.exports = {
  name: 'help',
  description: 'Show the list of available commands.',
  usage: ['help'],
  async execute(message, args, client) {
    const embed = infoEmbed(
      'Command list',
      `Prefix: \`${config.prefix}\`\nOnly administrators and whitelisted roles can use these commands.`
    );

    const isDeveloper = !!process.env.DEVELOPER_ID && message.author.id === process.env.DEVELOPER_ID;
    const commands = [...client.commands.values()]
      .filter((cmd) => !cmd.developerOnly || isDeveloper) // 개발자 전용 명령어는 개발자에게만 보임
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const cmd of commands) {
      const usage = (cmd.usage ?? [cmd.name]).map((u) => `\`${config.prefix}${u}\``).join('\n');
      embed.addFields({ name: `${config.prefix}${cmd.name}`, value: `${cmd.description}\n${usage}` });
    }

    await replyEmbed(message, embed);
  },
};
