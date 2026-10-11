const config = require('../config');
const db = require('../db');
const keepAlive = require('../utils/keepAlive');
const { infoEmbed, successEmbed, errorEmbed, replyEmbed } = require('../utils/embeds');

module.exports = {
  name: 'keepalive',
  developerOnly: true, // .env 의 DEVELOPER_ID 본인만 사용 (그 외에는 messageCreate 에서 조용히 무시)
  description: `(Developer only) Turn the Render keep-alive self-ping on or off (every ${config.keepAlive.intervalMin} minutes).`,
  usage: ['keepalive on', 'keepalive off'],
  async execute(message, args) {
    const arg = (args[0] ?? '').toLowerCase();
    const running = keepAlive.isRunning();

    if (arg !== 'on' && arg !== 'off') {
      return replyEmbed(
        message,
        errorEmbed('Invalid usage', `Usage: \`^keepalive on\` or \`^keepalive off\`\nKeep-alive is currently **${running ? 'ON' : 'OFF'}**.`)
      );
    }

    if (arg === 'on') {
      if (running) return replyEmbed(message, infoEmbed('Already ON', 'Keep-alive is already running.'));
      await db.setKeepAliveEnabled(true);
      keepAlive.start();
      return replyEmbed(
        message,
        successEmbed('Keep-alive: ON', `The bot will send a request to itself every ${config.keepAlive.intervalMin} minutes. Results are written to the console.`)
      );
    }

    if (!running && !db.isKeepAliveEnabled()) {
      return replyEmbed(message, infoEmbed('Already OFF', 'Keep-alive is already stopped.'));
    }
    await db.setKeepAliveEnabled(false);
    keepAlive.stop();
    return replyEmbed(message, successEmbed('Keep-alive: OFF', 'The self-ping has been stopped.'));
  },
};
