// 디스코드 오류를 로그에 쓰기 좋은 "알기 쉬운 사유"로 바꿔주는 도우미
//
// 자주 보는 오류 코드는 아래 표에서 설명을 바꾸고, 표에 없으면 원문을 그대로 사용합니다.
// (DM 발송 실패는 사유가 헷갈리게 나오므로 이 표를 쓰지 않고 punish.js 의 dmStep 고정 문구를 사용합니다.)
// (새로운 오류가 로그에 자주 나오면 이 표에 한 줄 추가하면 됩니다.)
const KNOWN_ERRORS = {
  50013: "Missing permissions. Check the bot's permissions in that channel (and, for timeouts and bans, that the bot's role is above the target's highest role)",
  50001: 'Missing access. The bot cannot see that channel',
  10003: 'Unknown channel. The channel no longer exists',
  10007: 'Unknown member. The user is no longer in the server',
  10008: 'Unknown message. It was already deleted',
  50034: 'Messages older than 14 days cannot be bulk deleted',
};

// 오류 코드(숫자)는 문제 추적에 쓸 수 있도록 뒤에 괄호로 남깁니다.
function describeError(err) {
  const code = err?.code;
  const known = KNOWN_ERRORS[code];
  if (known) return `${known} (code ${code})`;

  const message = err?.message ?? String(err);
  return code ? `${message} (code ${code})` : message;
}

module.exports = { describeError };
