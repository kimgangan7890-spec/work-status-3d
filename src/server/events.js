import { githubError } from './github-budget.js';

// Bus는 전달만 한다. 이벤트 생성·중복 제거·보관은 각각 어댑터와 세션별 저장소 소유다.
export function createEventBus() {
  const listeners = new Set();
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    publish(event) { for (const fn of listeners) fn(structuredClone(event)); },
  };
}
export function createEventJournal(bus, limit = 200) {
  const recent = [], ids = new Set();
  const unsubscribe = bus.subscribe(event => {
    if (ids.has(event.eventId)) return;
    recent.push(event); ids.add(event.eventId);
    while (recent.length > limit) ids.delete(recent.shift().eventId);
  });
  return {
    list(since) {
      const time = since === null || since === undefined || since === '' ? null : Date.parse(since);
      if (time !== null && (!Number.isFinite(time) || typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(since))) throw githubError('BAD_SINCE', 400);
      // 같은 밀리초에 도착한 이벤트를 놓치지 않게 경계를 포함한다. 소비자는 eventId로 합친다.
      return structuredClone(recent.filter(e => time === null || Date.parse(e.observedAt) >= time));
    },
    clear() { recent.length = 0; ids.clear(); },
    removeProject(projectId) { for (let i = recent.length - 1; i >= 0; i--) if (recent[i].projectId === projectId) { ids.delete(recent[i].eventId); recent.splice(i, 1); } },
    close() { unsubscribe(); this.clear(); },
  };
}
