// 코드 내 조정용 상수 (임계값 등). 값을 바꾸고 봇을 재시작하면 적용됩니다.
//
// 멤버가 알면 악용할 수 있는 "감지 기준 숫자"(신규 계정 기준, 멘션/이모지/같은 메시지 도배 기준)는
// 코드에 적지 않고 호스팅 서비스의 환경변수(.env.dev / .env.prod 포함)에서 읽습니다.
// 필요한 환경변수 이름은 아래 각 항목 옆에 적혀 있습니다. 값이 비었거나 1 이상의 정수가 아니면
// 봇이 시작할 때 어떤 항목이 문제인지 알려주고 멈춥니다 (index.js).
const envProblems = [];

// 환경변수 NAME 을 1 이상의 정수로 읽음. 문제가 있으면 이름을 envProblems 에 기록하고 NaN 을 돌려줌
function envInt(name) {
  const raw = (process.env[name] ?? '').trim();
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 1) {
    envProblems.push(name);
    return NaN;
  }
  return value;
}

module.exports = {
  envProblems, // 비어 있지 않으면 환경변수 설정에 문제가 있는 것 (index.js 가 확인)
  keepAlive: { intervalMin: 10 }, // Render 슬립 방지용 자기 자신 호출 간격(분)
  startupNotice: { dedupeMin: 10 }, // Render 에서만: 이 시간(분) 안에 "Bot started" 로그가 이미 올라갔으면 또 올리지 않음 (재배포/재시작이 겹칠 때 중복 방지)
  botStatus: 'Looking for spammers', // 봇 로그인 후 표시할 상태 메시지 (프로필의 사용자 지정 상태). 빈 문자열이면 설정하지 않음
  accountAge: { minDays: envInt('ACCOUNT_AGE_MIN_DAYS') }, // 이 일수보다 어린 계정은 타임아웃
  punishment: {
    lateMessageGraceSec: 5,   // 처벌이 끝난 뒤 이 시간(초) 동안 늦게 도착하는 해당 유저의 메시지도 바로 삭제
  },
  pingSpam: {
    userMentionLimit: envInt('PING_USER_MENTION_LIMIT'), // 한 메시지 내 서로 다른 유저 멘션 수
    roleMentionLimit: envInt('PING_ROLE_MENTION_LIMIT'), // 역할 + @everyone + @here 합산
    burstCount: envInt('PING_BURST_COUNT'),              // 멘션 포함 메시지 수
    burstWindowSec: envInt('PING_BURST_WINDOW_SEC'),
    timeoutMin: envInt('PING_TIMEOUT_MIN'),
  },
  emojiSpam: {
    perMessageLimit: envInt('EMOJI_PER_MESSAGE_LIMIT'), // 한 메시지의 이모지 수
    burstCount: envInt('EMOJI_BURST_COUNT'),            // 같은 채널에서 이모지 포함 메시지 수
    burstWindowSec: envInt('EMOJI_BURST_WINDOW_SEC'),
    sameEmojiLimit: envInt('EMOJI_SAME_LIMIT'),         // 한 메시지에서 같은 이모지 반복 수
    totalLimit: envInt('EMOJI_TOTAL_LIMIT'),            // 시간 윈도우 안의 이모지 총합 (모든 채널 합산)
    totalWindowSec: envInt('EMOJI_TOTAL_WINDOW_SEC'),
    timeoutMin: envInt('EMOJI_TIMEOUT_MIN'),       // 타임아웃 시간(분): 첫 위반
    timeoutMin2: envInt('EMOJI_TIMEOUT_2_MIN'),    // 반복 위반 2번째
    timeoutMin3: envInt('EMOJI_TIMEOUT_3_MIN'),    // 반복 위반 3번째 이후 (더 늘어나지 않고 이 시간 유지)
    strikeWindowMin: envInt('EMOJI_STRIKE_WINDOW_MIN'), // 직전 위반으로부터 이 시간(분) 안에 또 위반하면 "반복"으로 계산
  },
  sameMessageSpam: {
    repeatCount: envInt('SAMEMSG_REPEAT_COUNT'),        // 동일 메시지 N개 이상
    windowSec: envInt('SAMEMSG_WINDOW_SEC'),
    timeoutMin: envInt('SAMEMSG_TIMEOUT_MIN'),
  },
  imageSpam: {
    channelCount: 3,          // 서로 다른 채널 수
    channelWindowMin: 10,
    maxUniqueImages: 4,       // 고유 이미지가 이 수 초과면 검사 안 함
    dedupeMaxDistance: 5,     // 고유 이미지 판정용 해밍거리
    hashMatchMaxDistance: 19, // 64비트 중 19비트 이하 차이 = 70%+ 유사
    deleteWindowMin: 60,      // 처벌 시 지울 최근 메시지 범위(분)
    timeoutHours: 12,
    ocrMaxBytes: 1_000_000,   // OCR 로 보내는 이미지 최대 크기 (무료 플랜 한도 1MB)

    // ---- 아래는 서버 부담/동작 조정용 (5단계에서 추가) ----
    maxImagesPerCheck: 10,    // 한 번 검사할 때 계산하는 최근 이미지 수 (많이 올려도 최근 N장까지만)
    maxDownloadBytes: 20_000_000, // 이보다 큰 이미지는 처리하지 않음
    downloadTimeoutMs: 15_000,
    processConcurrency: 2,    // 이미지 다운로드/해시 계산을 동시에 몇 개까지 할지 (Render 무료 CPU 보호)
    ocrEngine: 3,             // 기본 OCR.space 엔진. 3 = 가장 정확하고 업타임이 안정적 (무료 월 1,000건, 엔진 1/2 한도와 별개)
    ocrFallbackEngine: 2,     // 기본 엔진이 실패(응답 없음/오류/한도 초과)하면 이 엔진으로 한 번 더 시도. 0 = 폴백 사용 안 함
    ocrLanguage: 'auto',      // 'auto' = 자동 감지 (엔진 2/3 에서만 가능)
    ocrTimeoutMs: 30_000,         // 기본 엔진(3)의 응답 대기 시간 (엔진 3은 파일이 클수록 느림)
    ocrFallbackTimeoutMs: 20_000, // 폴백 엔진(2)의 응답 대기 시간
    ocrConcurrency: 2,
    ocrWarnCooldownMin: 60,   // "OCR 실패" 경고 로그를 최대 이 간격으로 1번만 남김
    cooldownSec: 30,          // 한 유저를 검사/처벌한 직후 다시 검사하지 않는 시간
    logFlushSec: 5,           // 메시지 기록을 DB 로 모아서 저장하는 간격
    messageLogTtlMin: 65,     // DB 의 메시지 기록 보관 시간 (삭제 범위 60분보다 약간 길게)
  },

  // /roleicon : 부스터 역할 아이콘 설정 (모든 유저가 사용 가능한 명령어)
  roleIcon: {
    maxBytes: 256 * 1024,                 // 이미지 최대 용량 (디스코드 역할 아이콘 제한 256KB)
    allowedExtensions: ['png', 'jpg', 'jpeg'], // 허용 확장자 (역할 아이콘은 움직이지 않는 이미지만 가능)
    cooldownSec: 10,                      // 같은 유저가 연속으로 쓰는 것을 막는 시간 (디스코드 요청 제한 보호)

    // 서버 ID별 설정. "아래 기준 역할"과 "위 기준 역할" 사이(두 역할 자체는 제외)에 있는 역할 중
    // 명령어를 쓴 멤버가 가진 역할의 아이콘을 바꿉니다. 역할 ID 는 역할 우클릭 > ID 복사 (개발자 모드 필요)
    // 테스트 서버와 실제 서버를 모두 적어 두어도 됩니다. 아래는 작성 예시입니다 (실제 값으로 바꿔 주세요).
    guilds: {
         '433877007957360656': {
        lowerRoleId: '585531209711616001', // 아래 기준 역할 (이 역할 "위"에 있는 역할만 대상)
        upperRoleId: '585562952346894338', // 위 기준 역할 (이 역할 "아래"에 있는 역할만 대상)
         },
      // '123456789012345678': {
      //   lowerRoleId: '111111111111111111', // 아래 기준 역할 (이 역할 "위"에 있는 역할만 대상)
      //   upperRoleId: '222222222222222222', // 위 기준 역할 (이 역할 "아래"에 있는 역할만 대상)
      // },
    },
  },
};
