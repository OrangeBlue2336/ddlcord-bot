// OCR 로 읽은 글자와 키워드를 비교하는 도우미 (스팸 이미지 탐지, /mrbeast 키워드 명령어 공용)
//
// 비교 방식 (두 가지 중 하나라도 맞으면 일치):
//   1) 대소문자 무시 + 부분 일치           예) "FREE NITRO now" 안에 "free nitro" 가 있음
//   2) 공백/줄바꿈/특수문자를 모두 제거한 뒤 부분 일치   예) OCR 이 "F R E E\nN I T R O" 로 읽어도 일치

// 공백/특수문자를 전부 지운 비교용 문자열 (글자와 숫자만 남김)
function normalizeLoose(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// 키워드를 저장하기 좋은 형태로: 앞뒤 공백 제거, 연속 공백 1개로, 소문자
function tidyKeyword(text) {
  return String(text).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

// keywords: [{ word, normalized }]  →  텍스트 안에서 발견된 키워드 객체 배열
function matchKeywords(text, keywords) {
  const lower = String(text).normalize('NFKC').toLowerCase();
  const loose = normalizeLoose(text);
  return keywords.filter(
    (k) => lower.includes(k.word) || (k.normalized && loose.includes(k.normalized))
  );
}

module.exports = { normalizeLoose, tidyKeyword, matchKeywords };
