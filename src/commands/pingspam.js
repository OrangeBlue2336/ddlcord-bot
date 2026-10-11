const config = require('../config');
const { handleToggle } = require('../utils/toggleCommand');

const c = config.pingSpam;

module.exports = {
  name: 'pingspam',
  description:
    `Turn mention spam detection on or off. Triggers on ${c.userMentionLimit}+ different users or ${c.roleMentionLimit}+ roles/@everyone/@here in one message, ` +
    `or ${c.burstCount}+ messages with mentions within ${c.burstWindowSec}s. Punishment: delete messages + ${c.timeoutMin}-minute timeout.`,
  usage: ['pingspam on', 'pingspam off'],
  async execute(message, args) {
    return handleToggle(message, args, 'pingspam', 'Mention spam detection');
  },
};
