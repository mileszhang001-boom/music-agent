// 消息区渲染
import { state } from '../state.js';
import { formatDuration } from '../utils.js';

const messageArea = document.getElementById('messageArea');
const emptyState = document.getElementById('emptyState');

/** 高亮 JSON 字符串 (先 escHtml 再匹配 &quot; 分隔符) */
function syntaxHighlight(json) {
  const escaped = escHtml(json);
  return escaped.replace(
    /(&quot;(\\u[\da-fA-F]{4}|\\[^u]|[^\\&])*&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-num';
      if (/^&quot;/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-str';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
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
      wrapper.innerHTML = `<div class="msg-system">${escHtml(msg.text)}</div>`;
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
    bodyHtml = `
      <div class="resp-card__body">
        <div class="resp-card__body-title">${escHtml(msg.sourceTitle)}</div>
        <div class="resp-card__body-desc" style="white-space:pre-line">${escHtml(msg.bodyText)}</div>
        <div class="resp-card__body-meta">${escHtml(msg.metaText)}</div>
      </div>`;
  } else if (cardType === 'recommend') {
    bodyHtml = `
      <div class="resp-card__body" style="white-space:pre-line">${escHtml(msg.bodyText)}</div>
      <div class="resp-card__tags">
        <span class="resp-card__tag resp-card__tag--scene">${escHtml(msg.sceneLabel)}</span>
        <span class="resp-card__tag resp-card__tag--duration">${escHtml(msg.durationLabel)}</span>
      </div>`;
  }

  return `<div class="resp-card">
    <div class="resp-card__header">
      <span class="resp-card__badge ${badgeCls}">${cardType}</span>
      <span class="resp-card__time">${escHtml(msg.timeLabel || '')}</span>
    </div>
    ${bodyHtml}
    <div class="resp-card__footer">
      <div class="resp-card__status">
        <span class="resp-card__dot ${dotCls}"></span>
        <span>${escHtml(msg.statusText)}</span>
      </div>
      <button class="resp-card__json-btn" data-json-id="${msg.id}">查看JSON</button>
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
