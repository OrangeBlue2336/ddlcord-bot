const { createCommand, addOnOffSubcommands } = require('../utils/slash');
const { handleToggle } = require('../utils/toggleCommand');

module.exports = {
  data: addOnOffSubcommands(createCommand('samespam', 'Detect the same message sent repeatedly.'), 'same-message spam detection'),
  usage: ['samespam on|off'],
  async execute(interaction) {
    // 예외 채널은 /emojispam exempt 로 관리 (이모지 도배와 공용)
    return handleToggle(interaction, 'samespam', 'Same-message spam detection');
  },
};
