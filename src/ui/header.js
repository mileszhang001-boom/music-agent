// 顶栏用户胶囊
import { state } from '../state.js';

const avatarEl = document.getElementById('userAvatar');
const nameEl = document.getElementById('userName');

export function updateHeader() {
  const p = state.currentPersona;
  avatarEl.textContent = p.letter;
  nameEl.textContent = `用户${p.letter}`;
}
