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

  // 같은 메시지(data.messageId)의 기록이 이미 있으면 그 기록의 내용만 갱신하고(시간은 그대로), 없으면 새로 추가.
  // 메시지 수정(edit)처럼 "이미 센 메시지"가 다시 들어오는 경우에 같은 메시지가 두 번 세어지지 않게 합니다.
  // merge(예전 data, 새 data) 는 갱신할 때 어떤 내용을 남길지 정하는 함수 (생략하면 새 data 로 교체)
  upsert(key, data, time = Date.now(), merge = (_old, next) => next) {
    const list = this._prune(key, time);
    const existing = list.find((e) => e.data.messageId === data.messageId);
    if (existing) existing.data = merge(existing.data, data);
    else list.push({ time, data });
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
