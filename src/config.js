// 코드 내 조정용 상수 (임계값 등). 값을 바꾸고 봇을 재시작하면 적용됩니다.
module.exports = {
  keepAlive: { intervalMin: 10 }, // Render 슬립 방지용 자기 자신 호출 간격(분)
  botStatus: 'Looking for spammers', // 봇 로그인 후 표시할 상태 메시지 (프로필의 사용자 지정 상태). 빈 문자열이면 설정하지 않음
  accountAge: { minDays: 14 },
  punishment: {
    lateMessageGraceSec: 5,   // 처벌이 끝난 뒤 이 시간(초) 동안 늦게 도착하는 해당 유저의 메시지도 바로 삭제
  },
  pingSpam: {
    userMentionLimit: 5,      // 한 메시지 내 서로 다른 유저 멘션 수
    roleMentionLimit: 2,      // 역할 + @everyone + @here 합산
    burstCount: 5,            // 멘션 포함 메시지 수
    burstWindowSec: 15,
    timeoutMin: 30,
  },
  emojiSpam: {
    perMessageLimit: 10,
    burstCount: 10,
    burstWindowSec: 15,
    timeoutMin: 10,
  },
  sameMessageSpam: {
    repeatCount: 5,           // 동일 메시지 N개 이상
    windowSec: 15,
    timeoutMin: 10,
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
