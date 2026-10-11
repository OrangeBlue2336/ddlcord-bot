const { Events } = require('discord.js');
const accountAge = require('../features/accountAge');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member, client) {
    if (member.guild.id !== process.env.GUILD_ID) return;
    await accountAge.handleMemberJoin(member, client);
  },
};
