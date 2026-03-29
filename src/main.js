// 入口：初始化 app、绑定事件、实现六条交互链路
import { state, subscribe, addMessage, updateMessage, setPersona } from './state.js';
import { uid } from './utils.js';
import { buildContent, buildRecommend, buildPostcard } from './json-builder.js';
import { sendAndWaitAck, initConnection, getConnectionStatus, onConnectionChange } from './api.js';
import { generatePodcast } from './podcast.js';
import { updateHeader } from './ui/header.js';
import { renderMessages } from './ui/messages.js';
import { openUserSheet, openBoardingSheet, openPodcastSheet, openJsonSheet } from './ui/sheets.js';
import { formatDuration } from './utils.js';

// ========== DOM 引用 ==========
const inputField = document.getElementById('inputField');
const sendBtn = document.getElementById('sendBtn');
const boardingBtn = document.getElementById('boardingBtn');
const podcastBtn = document.getElementById('podcastBtn');
const messageArea = document.getElementById('messageArea');
const userCapsule = document.getElementById('userCapsule');

// 存储每条消息对应的 JSON 数据（用于「查看JSON」）
const jsonStore = {};

// 统一状态文案
function successText() { return '已发送至车端'; }
function failText(reason) { return `发送失败，${reason || '未知错误'}`; }
function statusFromResult(result) {
  return result.success ? successText() : failText(result.message);
}

// ========== 状态订阅 ==========
subscribe(() => {
  updateHeader();
  renderMessages();
});

// 初始渲染
updateHeader();
renderMessages();

// ========== 连接状态条（自动连接，无手动配置） ==========
const connBar = document.getElementById('connBar');
const connText = document.getElementById('connText');

const STATUS_MAP = {
  mock:         { cls: '',          text: '演示模式（未连接车端）' },
  connecting:   { cls: '',          text: '正在连接车端...' },
  connected:    { cls: 'connected', text: '已连接车端' },
  disconnected: { cls: '',          text: '连接断开，正在重连...' }
};

function updateConnBar() {
  const status = getConnectionStatus();
  const cfg = STATUS_MAP[status];
  connBar.className = 'conn-bar' + (cfg.cls ? ' ' + cfg.cls : '');
  connText.textContent = cfg.text;
}

onConnectionChange(updateConnBar);
updateConnBar();

// 页面加载时自动连接
initConnection();

// ========== 输入框 ==========
inputField.addEventListener('input', () => {
  sendBtn.disabled = !inputField.value.trim();
});

inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing && inputField.value.trim()) {
    handleSendContent();
  }
});

sendBtn.addEventListener('click', () => {
  if (inputField.value.trim()) handleSendContent();
});

// ========== 链路 A：用户切换 ==========
userCapsule.addEventListener('click', () => {
  openUserSheet((persona) => {
    setPersona({
      id: persona.id,
      label: persona.label,
      letter: persona.letter
    });
    addMessage({
      id: uid(),
      type: 'system',
      text: `— 已切换至用户${persona.letter} —`,
      divider: true
    });
  });
});

// ========== 链路 B：文字输入 → content JSON ==========
async function handleSendContent() {
  const text = inputField.value.trim();
  inputField.value = '';
  sendBtn.disabled = true;

  // 用户气泡
  addMessage({ id: uid(), type: 'user', text });

  // 组装 JSON
  const json = buildContent(text);
  const cardId = uid();
  jsonStore[cardId] = json;

  // 反馈卡片
  addMessage({
    id: cardId,
    type: 'card',
    cardType: 'content',
    bodyText: '您的需求已收到！将在车端显示效果',
    statusText: '发送中...',
    ackStatus: 'pending'
  });

  const result = await sendAndWaitAck(json);
  updateMessage(cardId, {
    statusText: statusFromResult(result),
    ackStatus: result.success ? 'ok' : 'error'
  });
}

// ========== 链路 C：触发上车 → recommend JSON ==========
boardingBtn.addEventListener('click', () => {
  openBoardingSheet(async (scene, duration) => {
    // 系统消息
    addMessage({ id: uid(), type: 'system', text: '— 触发上车事件 —' });

    // 组装 JSON
    const json = buildRecommend(scene.id, scene.label, duration);
    const cardId = uid();
    jsonStore[cardId] = json;

    // recommend 反馈卡片
    const persona = state.currentPersona;
    addMessage({
      id: cardId,
      type: 'card',
      cardType: 'recommend',
      bodyText: '用户上车了！需要推荐适合用户和当前场景的最佳内容',
      personaLabel: persona.label,
      sceneLabel: scene.label,
      durationLabel: `${duration}分钟`,
      statusText: '发送中...',
      ackStatus: 'pending'
    });

    const result = await sendAndWaitAck(json);
    updateMessage(cardId, {
      statusText: statusFromResult(result),
      ackStatus: result.success ? 'ok' : 'error'
    });
  });
});

// ========== 链路 D+E：AI 播客 ==========
podcastBtn.addEventListener('click', () => {
  openPodcastSheet(
    // 预设路径
    async (preset) => {
      // 绿色成功状态
      addMessage({
        id: uid(),
        type: 'status',
        phase: 'success',
        text: '生成完成！请在车端查看播客详情'
      });

      // 组装 postcard JSON
      const json = buildPostcard({
        sourceType: 'preset',
        sourceUrl: preset.source_url,
        sourceTitle: preset.title,
        cdnUrl: preset.cdn_url,
        durationSec: preset.duration_sec
      });
      const cardId = uid();
      jsonStore[cardId] = json;

      // postcard 反馈卡片
      addMessage({
        id: cardId,
        type: 'card',
        cardType: 'postcard',
        sourceTitle: preset.title,
        sourceUrl: preset.source_url,
        bodyText: '两位AI主播为你深度解读这篇文章，涵盖核心观点和延伸信息',
        metaText: `时长 ${formatDuration(preset.duration_sec)} · MP3 · 96kbps`,
        statusText: '发送中...',
        ackStatus: 'pending'
      });

      const result = await sendAndWaitAck(json);
      updateMessage(cardId, {
        statusText: statusFromResult(result),
        ackStatus: result.success ? 'ok' : 'error'
      });
    },
    // 实时生成路径 — 调用服务端豆包 API
    async (url) => {
      // 用户气泡
      addMessage({ id: uid(), type: 'user', text: url });

      // 阶段1：链接已收到
      const statusId = uid();
      addMessage({
        id: statusId,
        type: 'status',
        phase: 'progress',
        text: '链接已收到！正在生成播客...'
      });

      let articleTitle = '';
      let articleDesc = '';

      try {
        const result = await generatePodcast(url, {
          onPhase1() { },
          onPhase2() {
            updateMessage(statusId, { phase: 'progress', text: '已开始生成，完成后会提醒您' });
          },
          onMeta({ title, desc }) {
            articleTitle = title;
            articleDesc = desc;
            if (title) {
              updateMessage(statusId, { phase: 'progress', text: `正在生成「${title.slice(0, 20)}」...` });
            }
          },
          onProgress(info) {
            if (info.round) {
              updateMessage(statusId, { phase: 'progress', text: `正在生成第 ${info.round} 段...` });
            }
          },
          onComplete() { }
        });

        // 用服务端返回的标题（如有）
        const title = result.title || articleTitle || '播客';
        const desc = result.desc || articleDesc || '';
        const cached = result.cached;

        // 阶段3
        updateMessage(statusId, {
          phase: 'success',
          text: cached ? '播客已就绪！请在车端查看详情' : '生成完成！请在车端查看播客详情'
        });

        // 组装 postcard JSON — audioUrl 指向服务端持久存储
        const baseUrl = new URL(import.meta.env.VITE_RELAY_URL).origin.replace('wss://', 'https://').replace('ws://', 'http://');
        const json = buildPostcard({
          sourceType: 'url',
          sourceUrl: url,
          sourceTitle: title,
          cdnUrl: baseUrl + '/api/podcast' + result.audioUrl,
          durationSec: Math.round(result.durationSec)
        });
        const cardId = uid();
        jsonStore[cardId] = json;

        addMessage({
          id: cardId,
          type: 'card',
          cardType: 'postcard',
          sourceTitle: title,
          sourceUrl: url,
          bodyText: desc || '两位AI主播为你深度解读这篇文章，涵盖核心观点和延伸信息',
          metaText: `时长 ${formatDuration(Math.round(result.durationSec))} · MP3 · 96kbps`,
          statusText: '发送中...',
          ackStatus: 'pending'
        });

        const ackResult = await sendAndWaitAck(json);
        updateMessage(cardId, {
          statusText: statusFromResult(ackResult),
          ackStatus: ackResult.success ? 'ok' : 'error'
        });
      } catch (err) {
        updateMessage(statusId, { phase: 'progress', text: `生成失败：${err.message}` });
      }
    }
  );
});

// ========== 链路 F：查看 JSON + 重试（事件委托） ==========
messageArea.addEventListener('click', async (e) => {
  // 查看 JSON
  const jsonBtn = e.target.closest('.resp-card__json-btn');
  if (jsonBtn) {
    const jsonData = jsonStore[jsonBtn.dataset.jsonId];
    if (jsonData) openJsonSheet(jsonData);
    return;
  }

  // 重试发送（不重新生成播客，直接重发已有 JSON）
  const retryBtn = e.target.closest('.resp-card__retry-btn');
  if (retryBtn) {
    const msgId = retryBtn.dataset.retryId;
    const jsonData = jsonStore[msgId];
    if (!jsonData) return;

    // 更新状态为发送中
    updateMessage(msgId, { statusText: '发送中...', ackStatus: 'pending' });

    const result = await sendAndWaitAck(jsonData);
    updateMessage(msgId, {
      statusText: statusFromResult(result),
      ackStatus: result.success ? 'ok' : 'error'
    });
  }
});
