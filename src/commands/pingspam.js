const { createCommand, addOnOffSubcommands } = require('../utils/slash');
const { handleToggle } = require('../utils/toggleCommand');

module.exports = {
  data: addOnOffSubcommands(createCommand('pingspam', 'Detect mass mentions and punish with a timeout.'), 'mention spam detection'),
  usage: ['pingspam on|off'],
  async execute(interaction) {
    return handleToggle(interaction, 'pingspam', 'Mention spam detection');
  },
};
