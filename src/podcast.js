// 豆包播客生成 — 调用服务端 API（SSE 流式进度）
// 服务端代理连接豆包 WSS（浏览器不支持自定义 WS Header）

const PODCAST_API = import.meta.env.VITE_RELAY_URL
  ? new URL(import.meta.env.VITE_RELAY_URL).origin.replace('wss://', 'https://').replace('ws://', 'http://') + '/api/podcast'
  : '';

/**
 * 生成播客（实时路径）
 * @param {string} url - 文章 URL
 * @param {object} callbacks
 *   - onPhase1()           链接已收到
 *   - onPhase2(elapsed)    已开始生成
 *   - onProgress(info)     进度 {round, text} 或 {audioKB}
 *   - onComplete(result)   完成 {audioUrl, durationSec, rounds, elapsed}
 *   - onError(message)     失败
 */
export async function generatePodcast(url, callbacks = {}) {
  if (!PODCAST_API) {
    throw new Error('播客 API 未配置');
  }

  const res = await fetch(PODCAST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  // 解析 SSE 流
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留未完成的行

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        switch (currentEvent) {
          case 'phase':
            if (data.phase === 1 && callbacks.onPhase1) callbacks.onPhase1();
            if (data.phase === 2 && callbacks.onPhase2) callbacks.onPhase2(data.elapsed);
            break;
          case 'progress':
            if (callbacks.onProgress) callbacks.onProgress(data);
            break;
          case 'complete':
            if (callbacks.onComplete) callbacks.onComplete(data);
            return data;
          case 'error':
            throw new Error(data.message || '生成失败');
        }
      }
    }
  }

  throw new Error('流意外结束');
}
