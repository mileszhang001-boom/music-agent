// 全局状态管理
const listeners = [];

export const state = {
  currentPersona: { id: 'user_a', label: '欧美流行重度发烧友', letter: 'A' },
  messages: [],       // { type: 'user'|'system'|'status'|'card', ... }
  podcastGenerating: false
};

export function subscribe(fn) {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

export function notify() {
  listeners.forEach(fn => fn(state));
}

export function addMessage(msg) {
  state.messages.push(msg);
  notify();
}

export function updateMessage(id, patch) {
  const msg = state.messages.find(m => m.id === id);
  if (msg) {
    Object.assign(msg, patch);
    notify();
  }
}

export function setPersona(persona) {
  state.currentPersona = persona;
  notify();
}
