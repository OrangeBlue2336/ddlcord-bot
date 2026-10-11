// Render 호스팅용 keep-alive
// 1) 간단한 웹서버: Render 웹 서비스는 포트를 열어두어야 정상 실행으로 인정됩니다. (항상 켜짐)
// 2) 자기 자신 호출: ^keepalive on 이면 10분마다 자기 주소로 요청을 보내 슬립을 막고, 결과를 콘솔에 남깁니다.
const http = require('http');
const config = require('../config');
const db = require('../db');

let server = null;
let timer = null;

function getPort() {
  return Number(process.env.PORT) || 3000;
}

// Render 가 자동으로 넣어주는 RENDER_EXTERNAL_URL(공개 주소)로 호출해야 "외부 트래픽"으로 인정됩니다.
// 로컬에서는 이 값이 없으므로 localhost 로 호출합니다.
function getTargetUrl() {
  return process.env.RENDER_EXTERNAL_URL || `http://localhost:${getPort()}`;
}

function startServer() {
  if (server) return;
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });
  server.on('error', (err) => {
    console.error(`[keepalive] HTTP server error on port ${getPort()}: ${err.message}`);
  });
  server.listen(getPort(), () => {
    console.log(`[keepalive] HTTP server listening on port ${getPort()}`);
  });
}

async function ping() {
  const url = getTargetUrl();
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    await res.text();
    console.log(`[keepalive] ${new Date().toISOString()} GET ${url} -> ${res.status} (${Date.now() - startedAt}ms)`);
  } catch (err) {
    console.error(`[keepalive] ${new Date().toISOString()} GET ${url} -> FAILED: ${err.message}`);
  }
}

function isRunning() {
  return timer !== null;
}

// 켜기: 즉시 1회 호출 후 정해진 간격(기본 10분)마다 반복
function start() {
  if (timer) return;
  const intervalMs = config.keepAlive.intervalMin * 60 * 1000;
  console.log(`[keepalive] ON - pinging ${getTargetUrl()} every ${config.keepAlive.intervalMin} minutes`);
  ping();
  timer = setInterval(ping, intervalMs);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[keepalive] OFF');
}

// DB 설정을 불러온 뒤 호출: 저장된 설정이 켜짐이면 자동으로 다시 시작
function resume() {
  if (db.isKeepAliveEnabled()) start();
}

function shutdown() {
  stop();
  if (server) server.close();
}

module.exports = { startServer, resume, start, stop, isRunning, shutdown };
