// 顶栏用户胶囊
import { state } from '../state.js';
import { PERSONAS } from '../config.js';

const avatarEl = document.getElementById('userAvatar');
const nameEl = document.getElementById('userName');

export function updateHeader() {
  const p = state.currentPersona;
  const persona = PERSONAS.find(x => x.id === p.id);
  avatarEl.textContent = p.letter;
  avatarEl.style.background = persona?.color || '#9CA3AF';
  nameEl.textContent = `用户${p.letter}`;
}
