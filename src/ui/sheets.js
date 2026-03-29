// 底部弹窗组件
import { PERSONAS, TRIP_SCENES, PODCAST_PRESETS } from '../config.js';
import { state } from '../state.js';
import { getJsonViewerHtml } from './messages.js';

const backdrop = document.getElementById('sheetBackdrop');
const sheet = document.getElementById('sheet');

let closeCallback = null;

/** 打开弹窗 */
function openSheet(html, onClose) {
  sheet.innerHTML = html;
  closeCallback = onClose || null;
  requestAnimationFrame(() => {
    backdrop.classList.add('active');
    sheet.classList.add('active');
  });
}

/** 关闭弹窗 */
export function closeSheet() {
  backdrop.classList.remove('active');
  sheet.classList.remove('active');
  if (closeCallback) closeCallback();
  closeCallback = null;
}

// 点击遮罩关闭
backdrop.addEventListener('click', closeSheet);

/** 弹窗头部 HTML (handle + header + divider, matches .pen structure) */
function sheetHeader(title) {
  return `<div class="sheet__handle"></div>
    <div class="sheet__header">
      <span class="sheet__title">${title}</span>
      <button class="sheet__close" data-action="close-sheet"><i class="icon-x"></i></button>
    </div>
    <div class="sheet__divider"></div>`;
}

// 委托关闭按钮
sheet.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-sheet"]')) closeSheet();
});

// ==================== 用户选择弹窗 ====================
export function openUserSheet(onSelect) {
  const items = PERSONAS.map(p => {
    const isActive = state.currentPersona.id === p.id;
    const avatarBg = isActive ? p.color : '#E5E7EB';
    const avatarColor = isActive ? '#fff' : '#6B7280';
    return `<div class="persona-item ${isActive ? 'active' : ''}" data-persona="${p.id}">
      <div class="persona-item__avatar" style="background:${avatarBg};color:${avatarColor}">${p.letter}</div>
      <div class="persona-item__info">
        <div class="persona-item__name">用户${p.letter}：${p.label}</div>
        <div class="persona-item__desc">${p.desc}</div>
      </div>
    </div>`;
  }).join('');

  openSheet(`${sheetHeader('选择用户身份')}<div class="persona-list">${items}</div>`);

  sheet.querySelectorAll('.persona-item').forEach(el => {
    el.addEventListener('click', () => {
      const pid = el.dataset.persona;
      const persona = PERSONAS.find(p => p.id === pid);
      if (persona) {
        onSelect(persona);
        closeSheet();
      }
    });
  });
}

// ==================== 模拟上车弹窗 ====================
export function openBoardingSheet(onTrigger) {
  const chips = TRIP_SCENES.map((s, i) =>
    `<button class="chip ${i === 0 ? 'active' : ''}" data-scene="${s.id}" data-label="${s.label}">${s.label}</button>`
  ).join('');

  openSheet(`${sheetHeader('模拟上车信息')}
    <div style="padding:12px 20px">
      <div class="boarding-section">
        <div class="boarding-section__label">行程类型</div>
        <div class="chip-group">${chips}</div>
      </div>
      <div class="boarding-section">
        <div class="boarding-section__label">行程时间</div>
        <div class="duration-row">
          <input type="number" class="duration-input" id="durationInput" value="30" min="1" max="999" />
          <span class="duration-unit">分钟</span>
        </div>
      </div>
      <button class="trigger-btn" id="triggerBoardBtn">触发上车信号</button>
    </div>`);

  // Chip 单选
  let selectedScene = TRIP_SCENES[0];
  sheet.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sheet.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedScene = { id: chip.dataset.scene, label: chip.dataset.label };
    });
  });

  // 触发按钮
  sheet.querySelector('#triggerBoardBtn').addEventListener('click', () => {
    const duration = parseInt(sheet.querySelector('#durationInput').value) || 30;
    onTrigger(selectedScene, duration);
    closeSheet();
  });
}

// ==================== AI 播客弹窗 ====================
export function openPodcastSheet(onSelectPreset, onGenerateUrl) {
  const presets = PODCAST_PRESETS[state.currentPersona.id] || [];
  const presetItems = presets.map((p, i) =>
    `<div class="preset-item" data-idx="${i}">
      <div class="preset-item__title">${p.title}</div>
      <div class="preset-item__desc">${p.desc}</div>
      <div class="preset-item__dur">约${Math.round(p.duration_sec / 60)}分钟</div>
    </div>`
  ).join('');

  openSheet(`${sheetHeader('选择AI播客内容')}
    <div class="preset-list" style="padding:8px 16px">${presetItems}</div>
    <div class="podcast-url-section" style="padding:4px 16px 8px">
      <div class="podcast-url-label">输入自己想听的（请输入URL）</div>
      <div class="podcast-url-row">
        <input type="url" class="podcast-url-input" id="podcastUrlInput" placeholder="https://mp.weixin.qq.com/s/..." />
        <button class="podcast-gen-btn" id="podcastGenBtn">生成</button>
      </div>
    </div>`);

  // 预设卡片选中态 + 点击
  let selectedIdx = -1;
  sheet.querySelectorAll('.preset-item').forEach(el => {
    el.addEventListener('click', () => {
      // 切换选中
      sheet.querySelectorAll('.preset-item').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      selectedIdx = parseInt(el.dataset.idx);
      // 选中后直接触发
      const preset = presets[selectedIdx];
      if (preset) {
        onSelectPreset(preset);
        closeSheet();
      }
    });
  });

  // URL 生成
  sheet.querySelector('#podcastGenBtn').addEventListener('click', () => {
    const url = sheet.querySelector('#podcastUrlInput').value.trim();
    if (url) {
      onGenerateUrl(url);
      closeSheet();
    }
  });
}

// ==================== JSON 查看弹窗 ====================
export function openJsonSheet(jsonData) {
  const viewerHtml = getJsonViewerHtml(jsonData);
  openSheet(`${sheetHeader('用户传来JSON')}<div style="padding:12px 16px">${viewerHtml}</div>`);
}
