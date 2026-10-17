const config = require('../config');
const db = require('../db');
const keepAlive = require('../utils/keepAlive');
const { createCommand, addOnOffSubcommands } = require('../utils/slash');
const { infoEmbed, successEmbed, replyEmbed } = require('../utils/embeds');

module.exports = {
  data: addOnOffSubcommands(
    createCommand('keepalive', '(Developer only) Render keep-alive self-ping.'),
    `the keep-alive self-ping (every ${config.keepAlive.intervalMin} min)`
  ),
  developerOnly: true, // .env 의 DEVELOPER_ID 본인만 사용 (그 외에는 interactionCreate 가 거절)
  usage: ['keepalive on|off'],
  async execute(interaction) {
    const turnOn = interaction.options.getSubcommand() === 'on';
    const running = keepAlive.isRunning();

    if (turnOn) {
      if (running) return replyEmbed(interaction, infoEmbed('Already ON', 'Keep-alive is already running.'));
      await db.setKeepAliveEnabled(true);
      keepAlive.start();
      return replyEmbed(
        interaction,
        successEmbed('Keep-alive: ON', `The bot will send a request to itself every ${config.keepAlive.intervalMin} minutes. Results are written to the console.`)
      );
    }

    if (!running && !db.isKeepAliveEnabled()) {
      return replyEmbed(interaction, infoEmbed('Already OFF', 'Keep-alive is already stopped.'));
    }
    await db.setKeepAliveEnabled(false);
    keepAlive.stop();
    return replyEmbed(interaction, successEmbed('Keep-alive: OFF', 'The self-ping has been stopped.'));
  },
};
