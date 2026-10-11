// 이미지 처리 도구 모음 (스팸 이미지 탐지, ^mrbeast addhash 공용)
//   - 이미지 다운로드 (크기/시간 제한)
//   - pHash(64비트 지문) 계산, 해밍거리(서로 다른 비트 수) 계산
//   - OCR 전송용 이미지 만들기 (JPEG, 1MB 이하)
//   - 동시에 몇 개까지만 처리하게 하는 제한기 (Render 무료 플랜의 약한 CPU/메모리 보호)
const sharp = require('sharp');
const config = require('../config');

const cfg = config.imageSpam;

// sharp 가 메모리를 아끼도록: 내부 캐시 끄기, 스레드 1개
sharp.cache(false);
sharp.concurrency(1);

// ---------- 동시 실행 제한기 ----------
// createLimiter(2) -> run(fn): 동시에 최대 2개의 fn 만 실행하고 나머지는 순서대로 대기
function createLimiter(max) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= max || !waiting.length) return;
    running++;
    const { fn, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        running--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      next();
    });
}

// 이미지 다운로드/해시 계산용 제한기 (스팸 이미지 검사와 addhash 가 함께 사용)
const limitProcessing = createLimiter(cfg.processConcurrency);

// ---------- 다운로드 ----------
async function downloadImage(url, { maxBytes = cfg.maxDownloadBytes, timeoutMs = cfg.downloadTimeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('Image is too large');

    // 크기를 넘으면 중간에 끊기
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) {
        controller.abort();
        throw new Error('Image is too large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Download timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- pHash ----------
// 32x32 흑백으로 줄이고 → DCT(주파수 변환) → 왼쪽 위 8x8 만 사용 → 중앙값보다 크면 1, 아니면 0 → 64비트
const SIZE = 32;
const COS = Array.from({ length: 8 }, (_, u) =>
  Array.from({ length: SIZE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)))
);

const INPUT_OPTIONS = { failOn: 'none', limitInputPixels: 60_000_000 };

// 반환: 16자리 16진수 문자열 (예: "e1631d1d2fcc3ec1")
async function computePHash(buffer) {
  const { data } = await sharp(buffer, INPUT_OPTIONS)
    .rotate()
    .flatten({ background: '#ffffff' }) // 투명 배경은 흰색으로
    .greyscale()
    .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowDct = Array.from({ length: SIZE }, () => new Float64Array(8));
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += data[y * SIZE + x] * COS[u][x];
      rowDct[y][u] = sum;
    }
  }
  const coef = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) sum += rowDct[y][u] * COS[v][y];
      coef.push(sum);
    }
  }

  const sorted = coef.slice(1).sort((a, b) => a - b); // 평균 밝기(첫 값)는 제외하고 중앙값 계산
  const median = (sorted[30] + sorted[31]) / 2;
  let bits = '';
  for (let i = 0; i < 64; i++) bits += coef[i] > median ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

// 두 해시에서 서로 다른 비트 수 (0 = 완전히 같음, 64 = 완전히 다름)
function hammingDistance(hashA, hashB) {
  let x = BigInt('0x' + hashA) ^ BigInt('0x' + hashB);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

// 거리 -> 유사도(%)
function similarityPercent(distance) {
  return Math.round((1 - distance / 64) * 100);
}

// ---------- OCR 전송용 이미지 ----------
// 큰 이미지를 JPEG 로 줄여서 maxBytes 이하로 만듦. (OCR.space 무료 플랜은 1MB 제한, webp 미지원)
async function prepareForOcr(buffer, maxBytes = cfg.ocrMaxBytes) {
  for (const width of [2000, 1600, 1200, 900, 700]) {
    for (const quality of [80, 65, 50]) {
      const out = await sharp(buffer, INPUT_OPTIONS)
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (out.length <= maxBytes) return out;
    }
  }
  throw new Error('Could not shrink the image below the OCR size limit');
}

module.exports = {
  createLimiter,
  limitProcessing,
  downloadImage,
  computePHash,
  hammingDistance,
  similarityPercent,
  prepareForOcr,
};
