const config = require('../config');
const { handleToggle } = require('../utils/toggleCommand');

module.exports = {
  name: 'accountage',
  description: `Turn the new-account timeout on or off. Accounts younger than ${config.accountAge.minDays} days are timed out until they reach that age.`,
  usage: ['accountage on', 'accountage off'],
  async execute(message, args) {
    return handleToggle(message, args, 'accountage', 'New account timeout');
  },
};
