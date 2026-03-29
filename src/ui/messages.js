// 消息区渲染
import { state } from '../state.js';
import { formatDuration } from '../utils.js';

const messageArea = document.getElementById('messageArea');
const emptyState = document.getElementById('emptyState');

/** 高亮 JSON — 逐字符状态机，避免 HTML 实体正则问题 */
function syntaxHighlight(json) {
  let html = '';
  let i = 0;
  while (i < json.length) {
    const ch = json[i];
    if (ch === '"') {
      // 读取完整字符串
      let str = '"';
      i++;
      while (i < json.length) {
        if (json[i] === '\\') { str += json[i] + (json[i + 1] || ''); i += 2; continue; }
        str += json[i];
        if (json[i] === '"') { i++; break; }
        i++;
      }
      // 判断是 key 还是 value：key 后面紧跟 :
      let j = i;
      while (j < json.length && (json[j] === ' ' || json[j] === '\n')) j++;
      const cls = json[j] === ':' ? 'json-key' : 'json-str';
      html += `<span class="${cls}">${escHtml(str)}</span>`;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let num = '';
      while (i < json.length && /[\d.eE+\-]/.test(json[i])) { num += json[i]; i++; }
      html += `<span class="json-num">${num}</span>`;
    } else if (json.slice(i, i + 4) === 'true') {
      html += `<span class="json-num">true</span>`; i += 4;
    } else if (json.slice(i, i + 5) === 'false') {
      html += `<span class="json-num">false</span>`; i += 5;
    } else if (json.slice(i, i + 4) === 'null') {
      html += `<span class="json-num">null</span>`; i += 4;
    } else {
      html += `<span class="json-punct">${escHtml(ch)}</span>`;
      i++;
    }
  }
  return html;
}

/** 渲染全部消息 */
export function renderMessages() {
  // 保留 emptyState 的引用
  const hasMessages = state.messages.length > 0;
  emptyState.style.display = hasMessages ? 'none' : '';

  // 移除旧的消息 DOM（保留 emptyState）
  const existingMsgs = messageArea.querySelectorAll('.msg-item');
  existingMsgs.forEach(el => el.remove());

  state.messages.forEach(msg => {
    const el = createMessageEl(msg);
    messageArea.appendChild(el);
  });

  // 滚动到底部
  requestAnimationFrame(() => {
    messageArea.scrollTop = messageArea.scrollHeight;
  });
}

function createMessageEl(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-item';
  wrapper.dataset.id = msg.id;

  switch (msg.type) {
    case 'user':
      wrapper.innerHTML = `<div class="msg-bubble msg-bubble--user">${escHtml(msg.text)}</div>`;
      break;

    case 'system':
      if (msg.divider) {
        wrapper.innerHTML = `<div class="msg-divider"><span class="msg-divider__text">${escHtml(msg.text)}</span></div>`;
      } else {
        wrapper.innerHTML = `<div class="msg-system">${escHtml(msg.text)}</div>`;
      }
      break;

    case 'status':
      wrapper.innerHTML = renderStatus(msg);
      break;

    case 'card':
      wrapper.innerHTML = renderCard(msg);
      break;
  }

  return wrapper;
}

function renderStatus(msg) {
  const isSuccess = msg.phase === 'success';
  const cls = isSuccess ? 'msg-status--success' : 'msg-status--progress';
  const iconCls = isSuccess ? 'icon-check-circle' : 'icon-loader msg-status__icon--spin';
  return `<div class="msg-status ${cls}">
    <i class="${iconCls} msg-status__icon"></i>
    <span>${escHtml(msg.text)}</span>
  </div>`;
}

function renderCard(msg) {
  const cardType = msg.cardType; // content | postcard | recommend
  const badgeCls = `resp-card__badge--${cardType}`;
  const dotCls = `resp-card__dot--${getDotClass(msg)}`;

  let bodyHtml = '';

  if (cardType === 'content') {
    bodyHtml = `<div class="resp-card__body">${escHtml(msg.bodyText)}</div>`;
  } else if (cardType === 'postcard') {
    const linkHtml = msg.sourceUrl
      ? `<div class="resp-card__body-link">原链接：<a href="${escHtml(msg.sourceUrl)}" target="_blank" rel="noopener">${escHtml(msg.sourceUrl.length > 40 ? msg.sourceUrl.slice(0, 40) + '...' : msg.sourceUrl)}</a></div>`
      : '';
    bodyHtml = `
      <div class="resp-card__body">
        <div class="resp-card__body-title">${escHtml(msg.sourceTitle)}</div>
        <div class="resp-card__body-desc">${escHtml(msg.bodyText)}</div>
        <div class="resp-card__body-meta">${escHtml(msg.metaText)}</div>
        ${linkHtml}
      </div>`;
  } else if (cardType === 'recommend') {
    bodyHtml = `
      <div class="resp-card__body">${escHtml(msg.bodyText)}</div>
      <div class="resp-card__tags">
        <span class="resp-card__tag resp-card__tag--persona">${escHtml(msg.personaLabel || '')}</span>
      </div>
      <div class="resp-card__tags">
        <span class="resp-card__tag resp-card__tag--scene">${escHtml(msg.sceneLabel)}</span>
        <span class="resp-card__tag resp-card__tag--duration">${escHtml(msg.durationLabel)}</span>
      </div>`;
  }

  return `<div class="resp-card">
    <div class="resp-card__header">
      <span class="resp-card__badge ${badgeCls}">${cardType}</span>
    </div>
    ${bodyHtml}
    <div class="resp-card__footer">
      <div class="resp-card__status">
        <span class="resp-card__dot ${dotCls}"></span>
        <span>${escHtml(msg.statusText)}</span>
      </div>
      <div class="resp-card__actions">
        ${msg.ackStatus === 'error' ? `<button class="resp-card__retry-btn" data-retry-id="${msg.id}">重试</button>` : ''}
        <button class="resp-card__json-btn" data-json-id="${msg.id}">查看JSON</button>
      </div>
    </div>
  </div>`;
}

function getDotClass(msg) {
  if (msg.ackStatus === 'ok') return msg.cardType;
  if (msg.ackStatus === 'error') return 'error';
  return 'pending';
}

function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

/** 获取 JSON 弹窗内容 HTML */
export function getJsonViewerHtml(jsonData) {
  const formatted = JSON.stringify(jsonData, null, 2);
  return `<div class="json-viewer">${syntaxHighlight(formatted)}</div>`;
}
