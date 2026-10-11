const config = require('../config');
const { handleToggle } = require('../utils/toggleCommand');

const c = config.sameMessageSpam;

module.exports = {
  name: 'samespam',
  description:
    `Turn same-message spam detection on or off. Triggers when the same message is sent ${c.repeatCount}+ times within ${c.windowSec}s (all channels combined; ` +
    `ignoring case and surrounding spaces). Punishment: delete messages + ${c.timeoutMin}-minute timeout. Exempt channels are managed with \`^emojispam exempt\`.`,
  usage: ['samespam on', 'samespam off'],
  async execute(message, args) {
    return handleToggle(message, args, 'samespam', 'Same-message spam detection');
  },
};
