// JSON 组装 — 严格按 INTEGRATION.md 通用信封格式
import { state } from './state.js';
import { generateSessionId, isoTimestamp, derivePeriod, deriveDayType } from './utils.js';
import { SPEAKERS } from './config.js';

/** 通用信封 */
function envelope(type, payload) {
  return {
    type,
    session_id: generateSessionId(),
    timestamp: isoTimestamp(),
    user_profile: {
      persona_id: state.currentPersona.id,
      persona_label: state.currentPersona.label
    },
    payload
  };
}

/** content JSON — 用户说了一句话 */
export function buildContent(text) {
  return envelope('content', { text });
}

/** recommend JSON — 用户上车 */
export function buildRecommend(sceneId, sceneLabel, durationMin) {
  const hour = new Date().getHours();
  return envelope('recommend', {
    trigger: 'user_enter_car',
    trip: {
      scene_id: sceneId,
      scene_label: sceneLabel,
      duration_min: durationMin
    },
    time_context: {
      hour,
      day_type: deriveDayType(),
      period: derivePeriod(hour)
    }
  });
}

/** postcard JSON — AI 播客完成 */
export function buildPostcard({ sourceType, sourceUrl, sourceTitle, cdnUrl, durationSec }) {
  return envelope('postcard', {
    source: {
      type: sourceType,   // "url" | "preset"
      url: sourceUrl || '',
      title: sourceTitle
    },
    podcast: {
      cdn_url: cdnUrl,
      duration_sec: durationSec,
      format: 'mp3',
      speakers: SPEAKERS.map(s => ({ id: s.id, role: s.role }))
    }
  });
}
