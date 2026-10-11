// 슬라이딩 윈도우 추적기: "N초 이내에 M회" 같은 조건을 계산하는 공용 부품
// (멘션 도배, 이모지 도배, 같은 메시지 도배가 함께 사용합니다)
// 모든 기록은 메모리에만 저장되며, 봇을 재시작하면 사라집니다.
class SlidingWindow {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.entries = new Map(); // key -> [{ time, data }, ...]

    // 오래된 기록이 메모리에 계속 쌓이지 않도록 1분마다 정리
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  // key 의 기록 중 윈도우 안에 있는 것만 남겨서 돌려줌
  _prune(key, now) {
    const list = (this.entries.get(key) ?? []).filter((e) => now - e.time <= this.windowMs);
    if (list.length) this.entries.set(key, list);
    else this.entries.delete(key);
    return list;
  }

  // 기록을 추가하고, 윈도우 안에 남은 기록 전체(방금 추가한 것 포함)를 돌려줌
  add(key, data, time = Date.now()) {
    const list = this._prune(key, time);
    list.push({ time, data });
    this.entries.set(key, list);
    return [...list];
  }

  // 현재 윈도우 안의 기록 조회
  get(key, now = Date.now()) {
    return [...this._prune(key, now)];
  }

  // 해당 key 의 기록을 모두 비움 (처벌 직후 중복 처벌 방지용)
  clear(key) {
    this.entries.delete(key);
  }

  // 모든 key 의 오래된 기록 정리
  sweep(now = Date.now()) {
    for (const key of [...this.entries.keys()]) this._prune(key, now);
  }
}

module.exports = { SlidingWindow };
