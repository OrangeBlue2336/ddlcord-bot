// 모든 DB 접근은 이 파일을 통해서만 합니다. (MongoDB 사용)
//
// [구조]
// - 자주 읽는 값(기능 on/off 설정, 화이트리스트 역할, 예외 채널)은 시작할 때 메모리로 불러와 캐시합니다.
//   → 읽기 함수(is..., get...)는 기존처럼 "즉시" 값을 돌려줍니다 (메시지마다 DB를 부르지 않기 위함).
// - 값을 바꾸는 함수(set..., add..., remove...)는 DB에 먼저 저장한 뒤 캐시를 갱신합니다. → 반드시 await 로 호출
// - 봇은 1대만 실행한다는 전제입니다 (여러 대가 같은 DB를 쓰면 캐시가 어긋날 수 있음).
const { MongoClient } = require('mongodb');
const config = require('./config');

let client = null;
let database = null;

// 자동 관리 기능 이름 목록
const FEATURES = ['accountage', 'pingspam', 'emojispam', 'samespam', 'mrbeast'];

// 처음 DB를 쓸 때 들어가는 기본 설정값. 이미 값이 있으면 덮어쓰지 않습니다.
const DEFAULT_SETTINGS = {
  accountage_enabled: true,
  pingspam_enabled: true,
  emojispam_enabled: true,
  samespam_enabled: true,
  mrbeast_enabled: true,
  mrbeast_testmode: false,
  keepalive_enabled: false, // Render 슬립 방지 (/keepalive on/off)
};

// ---------- 메모리 캐시 ----------
const cache = {
  settings: new Map(),
  whitelistRoles: new Set(),
  exemptChannels: new Set(),
  knownHashes: new Map(),   // 번호(id) -> { _id, phash, label, added_by, added_at }  (단계 5)
  knownKeywords: new Map(), // 키워드(소문자) -> { _id, word, normalized, added_by, added_at }  (단계 5)
  emojiStrikes: new Map(),  // 유저 ID -> { count, lastAt(밀리초) }  이모지 도배 반복 위반 기록
};

// DB 에 아직 저장 중인 이모지 위반 기록 (종료할 때 마무리까지 기다리기 위함)
const pendingStrikeWrites = new Set();

// 메시지 기록 버퍼 (단계 5): 메시지마다 DB 에 쓰지 않고 모았다가 몇 초마다 한꺼번에 저장
const MESSAGE_BUFFER_MAX = 20_000; // DB 장애가 길어져도 메모리가 무한정 늘지 않게
let messageBuffer = [];
let flushTimer = null;
let flushPromise = null;

function col(name) {
  if (!database) throw new Error('Database is not initialized.');
  return database.collection(name);
}

// 시작 시 1회 호출. 연결 실패 시 에러를 던집니다.
async function init({ uri, dbName }) {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  database = client.db(dbName);
  await database.command({ ping: 1 }); // 실제로 연결되는지 확인

  // 기본 설정값: 아직 없는 항목만 추가
  await col('settings').bulkWrite(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
      updateOne: { filter: { _id: key }, update: { $setOnInsert: { value } }, upsert: true },
    }))
  );

  // 캐시 불러오기
  for (const doc of await col('settings').find().toArray()) cache.settings.set(doc._id, doc.value);
  for (const doc of await col('whitelist_roles').find().toArray()) cache.whitelistRoles.add(doc._id);
  for (const doc of await col('exempt_channels').find().toArray()) cache.exemptChannels.add(doc._id);
  for (const doc of await col('known_hashes').find().toArray()) cache.knownHashes.set(doc._id, doc);
  for (const doc of await col('known_keywords').find().toArray()) cache.knownKeywords.set(doc._id, doc);

  // 메시지 기록: 오래된 기록은 TTL 인덱스로 자동 삭제, 유저별 조회용 인덱스 (각각 따로 시도해서 하나가 실패해도 나머지는 만들어짐)
  try {
    await col('message_log').createIndex(
      { created_at: 1 },
      { expireAfterSeconds: config.imageSpam.messageLogTtlMin * 60 }
    );
  } catch (err) {
    console.warn(`[db] Could not create the message_log TTL index: ${err.message}`);
  }
  try {
    await col('message_log').createIndex({ user_id: 1, created_at: 1 });
  } catch (err) {
    console.warn(`[db] Could not create the message_log user index: ${err.message}`);
  }

  // 이모지 도배 반복 위반 기록: 시간이 지난 기록은 TTL 인덱스로 자동 삭제.
  // (판정은 코드에서 시각을 직접 비교하므로 자동 삭제가 조금 늦어져도 결과는 같습니다)
  const strikeTtlSec = config.emojiSpam.strikeWindowMin * 60;
  try {
    try {
      await col('emoji_strikes').createIndex({ last_at: 1 }, { expireAfterSeconds: strikeTtlSec });
    } catch (err) {
      // 환경변수의 시간을 바꿔서 기존 인덱스와 설정이 달라진 경우: 기존 인덱스의 시간만 고침
      if (err?.code !== 85 && err?.code !== 86) throw err;
      await database.command({
        collMod: 'emoji_strikes',
        index: { keyPattern: { last_at: 1 }, expireAfterSeconds: strikeTtlSec },
      });
    }
  } catch (err) {
    console.warn(`[db] Could not set up the emoji_strikes TTL index: ${err.message}`);
  }
  // 아직 유효한(시간이 안 지난) 기록만 메모리로 불러옴. 실패해도 봇은 계속 시작 (이 경우 기록이 비어 있는 상태로 시작)
  try {
    const since = new Date(Date.now() - config.emojiSpam.strikeWindowMin * 60 * 1000);
    for (const doc of await col('emoji_strikes').find({ last_at: { $gte: since } }).toArray()) {
      cache.emojiStrikes.set(doc._id, { count: doc.count, lastAt: new Date(doc.last_at).getTime() });
    }
  } catch (err) {
    console.warn(`[db] Could not load emoji_strikes: ${err.message}`);
  }

  // 모아 둔 메시지 기록을 주기적으로 DB 에 저장
  flushTimer = setInterval(() => {
    flushMessageLog().catch(() => {});
  }, config.imageSpam.logFlushSec * 1000);
  flushTimer.unref();
}

async function close() {
  if (flushTimer) clearInterval(flushTimer);
  if (client) {
    await flushMessageLog().catch(() => {});
    await Promise.allSettled([...pendingStrikeWrites]);
    await client.close();
    client = null;
    database = null;
  }
}

// ---------- 설정 (on/off 등) ----------
function getSetting(key) {
  return cache.settings.has(key) ? cache.settings.get(key) : null;
}

async function setSetting(key, value) {
  await col('settings').updateOne({ _id: key }, { $set: { value } }, { upsert: true });
  cache.settings.set(key, value);
}

function isFeatureEnabled(feature) {
  return getSetting(`${feature}_enabled`) === true;
}

async function setFeatureEnabled(feature, enabled) {
  await setSetting(`${feature}_enabled`, !!enabled);
}

function isMrbeastTestMode() {
  return getSetting('mrbeast_testmode') === true;
}

// ---------- 화이트리스트 역할 ----------
function getWhitelistRoleIds() {
  return [...cache.whitelistRoles];
}

function isWhitelistedRole(roleId) {
  return cache.whitelistRoles.has(roleId);
}

// 새로 추가되면 true, 이미 있었으면 false
async function addWhitelistRole(roleId) {
  const result = await col('whitelist_roles').updateOne(
    { _id: roleId },
    { $setOnInsert: { added_at: new Date() } },
    { upsert: true }
  );
  cache.whitelistRoles.add(roleId);
  return result.upsertedCount > 0;
}

// 실제로 삭제되면 true, 원래 없었으면 false
async function removeWhitelistRole(roleId) {
  const result = await col('whitelist_roles').deleteOne({ _id: roleId });
  cache.whitelistRoles.delete(roleId);
  return result.deletedCount > 0;
}

// ---------- 예외 채널 (이모지 도배 + 같은 메시지 도배 공용) ----------
function getSpamExemptChannelIds() {
  return [...cache.exemptChannels];
}

function isSpamExemptChannel(channelId) {
  return cache.exemptChannels.has(channelId);
}

// 새로 추가되면 true, 이미 있었으면 false
async function addSpamExemptChannel(channelId) {
  const result = await col('exempt_channels').updateOne(
    { _id: channelId },
    { $setOnInsert: { added_at: new Date() } },
    { upsert: true }
  );
  cache.exemptChannels.add(channelId);
  return result.upsertedCount > 0;
}

// 실제로 삭제되면 true, 원래 없었으면 false
async function removeSpamExemptChannel(channelId) {
  const result = await col('exempt_channels').deleteOne({ _id: channelId });
  cache.exemptChannels.delete(channelId);
  return result.deletedCount > 0;
}

// ---------- 스팸 이미지 탐지 (단계 5) ----------
async function setMrbeastTestMode(enabled) {
  await setSetting('mrbeast_testmode', !!enabled);
}

// 알려진 사기 이미지 해시 (메모리 캐시)
function getKnownHashes() {
  return [...cache.knownHashes.values()].sort((a, b) => a._id - b._id);
}

// 새 해시 등록 후 부여된 번호(1, 2, 3...)를 돌려줌
async function addKnownHash({ phash, label, addedBy }) {
  const nextId = Math.max(0, ...cache.knownHashes.keys()) + 1;
  const doc = { _id: nextId, phash, label: label || '', added_by: addedBy, added_at: new Date() };
  await col('known_hashes').insertOne(doc);
  cache.knownHashes.set(nextId, doc);
  return doc;
}

// 실제로 삭제되면 true, 없는 번호면 false
async function removeKnownHash(id) {
  const result = await col('known_hashes').deleteOne({ _id: id });
  cache.knownHashes.delete(id);
  return result.deletedCount > 0;
}

// 키워드: word 는 소문자 + 공백 정리한 형태, normalized 는 공백/특수문자까지 제거한 비교용
function getKnownKeywords() {
  return [...cache.knownKeywords.values()].sort((a, b) => a.added_at - b.added_at);
}

// 새로 추가되면 true, 이미 있었으면 false
async function addKnownKeyword({ word, normalized, addedBy }) {
  for (const k of cache.knownKeywords.values()) {
    if (k.word === word || k.normalized === normalized) return false;
  }
  const doc = { _id: word, word, normalized, added_by: addedBy, added_at: new Date() };
  await col('known_keywords').insertOne(doc);
  cache.knownKeywords.set(word, doc);
  return true;
}

// 실제로 삭제되면 true, 원래 없었으면 false
async function removeKnownKeyword(word) {
  const result = await col('known_keywords').deleteOne({ _id: word });
  cache.knownKeywords.delete(word);
  return result.deletedCount > 0;
}

// 해시와 키워드가 모두 비어 있으면 스팸 이미지 탐지는 할 일이 없음
function hasImageSpamRules() {
  return cache.knownHashes.size > 0 || cache.knownKeywords.size > 0;
}

// 메시지 기록 (최근 1시간 메시지 삭제용). 내용은 저장하지 않고 ID 만 저장.
// 호출 즉시 메모리 버퍼에만 넣고(동기), 몇 초마다 한꺼번에 DB 에 저장합니다.
function logMessage({ messageId, userId, channelId, time }) {
  messageBuffer.push({ _id: messageId, user_id: userId, channel_id: channelId, created_at: new Date(time) });
  if (messageBuffer.length > MESSAGE_BUFFER_MAX) messageBuffer = messageBuffer.slice(-MESSAGE_BUFFER_MAX);
}

// 모아 둔 기록을 DB 에 저장. 실패하면 다음 기회에 다시 시도하도록 버퍼에 되돌림
function flushMessageLog() {
  if (flushPromise) return flushPromise;
  if (!messageBuffer.length || !database) return Promise.resolve();
  const batch = messageBuffer;
  messageBuffer = [];
  flushPromise = col('message_log')
    .insertMany(batch, { ordered: false })
    .catch((err) => {
      // 중복 키 오류(이미 저장된 메시지)는 무시, 그 외 오류는 버퍼에 되돌려 재시도
      const onlyDuplicates = err?.writeErrors?.length && err.writeErrors.every((e) => e.code === 11000);
      if (!onlyDuplicates) {
        messageBuffer = batch.concat(messageBuffer).slice(-MESSAGE_BUFFER_MAX);
        console.warn(`[db] Could not save message log (will retry): ${err.message}`);
      }
    })
    .finally(() => {
      flushPromise = null;
    });
  return flushPromise;
}

// 유저가 sinceMs(밀리초 시각) 이후에 보낸 메시지 목록 [{ messageId, channelId }]
async function getRecentUserMessages(userId, sinceMs) {
  await flushMessageLog();
  const since = new Date(sinceMs);
  const docs = await col('message_log')
    .find({ user_id: userId, created_at: { $gte: since } })
    .project({ channel_id: 1 })
    .limit(5000)
    .toArray();
  const found = new Map(docs.map((d) => [d._id, d.channel_id]));
  // DB 저장이 실패해서 버퍼에 남아 있는 기록도 포함
  for (const m of messageBuffer) {
    if (m.user_id === userId && m.created_at >= since) found.set(m._id, m.channel_id);
  }
  return [...found].map(([messageId, channelId]) => ({ messageId, channelId }));
}

// ---------- 이모지 도배 반복 위반 기록 ----------
// 유저별로 "최근 이모지 도배 처벌 횟수"와 마지막 처벌 시각만 저장합니다 (메시지 내용은 저장하지 않음).
// 직전 처벌로부터 config.emojiSpam.strikeWindowMin 분 안에 또 처벌받으면 횟수가 늘고, 넘기면 1부터 다시 시작합니다.
// 처벌 흐름은 시작하는 즉시 유저를 잠가야 해서 중간에 await 를 쓸 수 없으므로,
// 조회/기록은 메모리에서 즉시(동기) 처리하고 DB 에는 뒤에서 저장합니다.
function isStrikeActive(strike, now) {
  return !!strike && now - strike.lastAt <= config.emojiSpam.strikeWindowMin * 60 * 1000;
}

// 지금 위반하면 몇 번째 위반인지(1부터). 기록은 바꾸지 않음
function getNextEmojiStrikeLevel(userId, now = Date.now()) {
  const strike = cache.emojiStrikes.get(userId);
  return isStrikeActive(strike, now) ? strike.count + 1 : 1;
}

// 이모지 도배 처벌 1회를 기록하고 새 횟수를 돌려줌 (동기). DB 저장은 기다리지 않음
function recordEmojiStrike(userId, now = Date.now()) {
  const count = getNextEmojiStrikeLevel(userId, now);
  cache.emojiStrikes.set(userId, { count, lastAt: now });

  // 시간이 지난 기록은 메모리에서도 정리 (처벌받은 적 있는 유저만 들어 있어 크기가 작음)
  for (const [id, strike] of cache.emojiStrikes) {
    if (!isStrikeActive(strike, now)) cache.emojiStrikes.delete(id);
  }

  try {
    const write = col('emoji_strikes')
      .updateOne({ _id: userId }, { $set: { count, last_at: new Date(now) } }, { upsert: true })
      .catch((err) => console.warn(`[db] Could not save emoji strike for ${userId}: ${err.message}`))
      .finally(() => pendingStrikeWrites.delete(write));
    pendingStrikeWrites.add(write);
  } catch (err) {
    console.warn(`[db] Could not save emoji strike for ${userId}: ${err.message}`);
  }
  return count;
}

// ---------- 시작 알림 중복 방지 ----------
// Render 는 재배포/재시작이 겹치면 봇이 짧은 시간에 여러 번 켜질 수 있습니다. 그때마다 "Bot started" 로그가 올라가지 않도록,
// 마지막으로 시작 알림을 올린 시각을 DB 에 한 번에 한 곳만 기록할 수 있게(원자적으로) 저장합니다.
// 알림을 올려도 되면 true (표식을 갱신함), 이미 windowMs 안에 올라갔으면 false. DB 오류가 나면 알림을 빠뜨리지 않도록 true.
async function claimStartupNotice(windowMs, now = Date.now()) {
  try {
    await col('bot_meta').findOneAndUpdate(
      { _id: 'startup_notice', at: { $lt: new Date(now - windowMs) } },
      { $set: { at: new Date(now) } },
      { upsert: true }
    );
    return true; // 표식이 없었거나 오래된 표식이어서 갱신함
  } catch (err) {
    if (err?.code === 11000) return false; // 최근 표식이 있어서 조건에 맞지 않았고, 새로 만들려다 같은 _id 충돌
    console.warn(`[db] Could not check the startup notice marker: ${err.message}`);
    return true;
  }
}

// ---------- keep-alive (Render 슬립 방지) ----------
function isKeepAliveEnabled() {
  return getSetting('keepalive_enabled') === true;
}

async function setKeepAliveEnabled(enabled) {
  await setSetting('keepalive_enabled', !!enabled);
}

module.exports = {
  FEATURES,
  claimStartupNotice,
  init,
  close,
  getSetting,
  setSetting,
  isFeatureEnabled,
  setFeatureEnabled,
  isMrbeastTestMode,
  setMrbeastTestMode,
  getKnownHashes,
  addKnownHash,
  removeKnownHash,
  getKnownKeywords,
  addKnownKeyword,
  removeKnownKeyword,
  hasImageSpamRules,
  logMessage,
  flushMessageLog,
  getRecentUserMessages,
  getWhitelistRoleIds,
  isWhitelistedRole,
  addWhitelistRole,
  removeWhitelistRole,
  getSpamExemptChannelIds,
  isSpamExemptChannel,
  addSpamExemptChannel,
  removeSpamExemptChannel,
  getNextEmojiStrikeLevel,
  recordEmojiStrike,
  isKeepAliveEnabled,
  setKeepAliveEnabled,
};
