// OCR.space 무료 API 호출 (이미지 -> 글자)
//
// 기본 엔진(config.imageSpam.ocrEngine, 현재 3)으로 먼저 호출하고, 실패하면
// 폴백 엔진(config.imageSpam.ocrFallbackEngine, 현재 2)으로 한 번 더 시도합니다.
//   "실패" = 응답 시간 초과, 연결 오류, HTTP 오류(5xx 등), 읽을 수 없는 응답, OCR 처리 오류(월 한도 초과 포함)
//   (API 키가 없는 경우는 다시 시도해도 소용없으므로 폴백 없이 바로 실패)
// 둘 다 실패하면 에러를 던지고, 호출하는 쪽(features/imageSpam.js)이 "OCR 실패"로 기록합니다.
const config = require('../config');
const { createLimiter } = require('./imageTools');

const cfg = config.imageSpam;
const limitOcr = createLimiter(cfg.ocrConcurrency);

// 테스트할 때 다른 주소로 바꿀 수 있게 환경변수로도 지정 가능 (평소에는 설정하지 않음)
const OCR_URL = () => process.env.OCR_SPACE_URL || 'https://api.ocr.space/parse/image';

function errorText(value) {
  if (!value) return '';
  return Array.isArray(value) ? value.join(' ') : String(value);
}

// fatal = true 이면 다른 엔진으로 다시 시도하지 않음
class OcrError extends Error {
  constructor(message, { fatal = false } = {}) {
    super(message);
    this.fatal = fatal;
  }
}

// 엔진 1개로 1번 호출. 성공하면 읽은 글자(없으면 빈 문자열), 실패하면 OcrError
async function callOcr(jpegBuffer, engine, timeoutMs) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) throw new OcrError('OCR_SPACE_API_KEY is not set', { fatal: true });

  const form = new FormData();
  form.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'image.jpg');
  form.append('language', cfg.ocrLanguage);
  form.append('OCREngine', String(engine));
  form.append('isOverlayRequired', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(OCR_URL(), {
      method: 'POST',
      headers: { apikey: apiKey },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new OcrError('OCR request timed out');
    throw new OcrError(`OCR request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new OcrError(`OCR service returned HTTP ${res.status}`);

  let json;
  try {
    json = await res.json();
  } catch {
    throw new OcrError('OCR service returned an unreadable response');
  }

  if (json.IsErroredOnProcessing) {
    throw new OcrError(errorText(json.ErrorMessage) || errorText(json.ErrorDetails) || 'OCR processing error');
  }
  const results = json.ParsedResults;
  if (!Array.isArray(results) || !results.length) {
    throw new OcrError(errorText(json.ErrorMessage) || 'OCR returned no results');
  }
  // FileParseExitCode 1 = 성공
  if (results.every((r) => Number(r.FileParseExitCode) !== 1)) {
    throw new OcrError(errorText(results[0].ErrorMessage) || errorText(results[0].ErrorDetails) || 'OCR could not read the image');
  }
  return results.map((r) => r.ParsedText ?? '').join('\n').trim();
}

// jpegBuffer: 1MB 이하 JPEG.
// 반환: { text, engine, primaryError? }
//   text         읽은 글자 전체 (글자가 없으면 빈 문자열)
//   engine       실제로 결과를 준 엔진 번호
//   primaryError 기본 엔진이 실패해서 폴백 엔진을 썼을 때만 있음 (기본 엔진의 실패 사유)
function ocrImage(jpegBuffer) {
  return limitOcr(async () => {
    const primary = cfg.ocrEngine;
    const fallback = cfg.ocrFallbackEngine;
    try {
      return { text: await callOcr(jpegBuffer, primary, cfg.ocrTimeoutMs), engine: primary };
    } catch (err) {
      if (err.fatal || !fallback || fallback === primary) throw err;

      console.warn(`[ocr] Engine ${primary} failed (${err.message}). Retrying with engine ${fallback}.`);
      try {
        const text = await callOcr(jpegBuffer, fallback, cfg.ocrFallbackTimeoutMs);
        return { text, engine: fallback, primaryError: err.message };
      } catch (fallbackErr) {
        throw new Error(
          `Engine ${primary} failed (${err.message}); fallback engine ${fallback} also failed (${fallbackErr.message})`
        );
      }
    }
  });
}

module.exports = { ocrImage };
