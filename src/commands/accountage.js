const { createCommand, addOnOffSubcommands } = require('../utils/slash');
const { handleToggle } = require('../utils/toggleCommand');

module.exports = {
  data: addOnOffSubcommands(createCommand('accountage', 'Timeout members whose account is too new.'), 'the new account timeout'),
  usage: ['accountage on|off'],
  async execute(interaction) {
    return handleToggle(interaction, 'accountage', 'New account timeout');
  },
};
