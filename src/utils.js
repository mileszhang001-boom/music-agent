// 工具函数

/** 生成 session_id: sess_YYYYMMDD_HHmmss */
export function generateSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `sess_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** hour → period 映射 (INTEGRATION.md) */
export function derivePeriod(hour) {
  if (hour >= 5 && hour <= 8) return 'early_morning';
  if (hour >= 9 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 16) return 'afternoon';
  if (hour >= 17 && hour <= 20) return 'evening';
  return 'late_night'; // 21-4
}

/** 推导 day_type */
export function deriveDayType() {
  const day = new Date().getDay();
  return (day === 0 || day === 6) ? 'weekend' : 'weekday';
}

/** 秒 → mm:ss */
export function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 估算播客时长（分钟）：字数 / 800 */
export function estimatePodcastMinutes(charCount) {
  return Math.max(1, Math.round(charCount / 800));
}

/** 生成唯一 ID */
let _id = 0;
export function uid() {
  return `msg_${Date.now()}_${++_id}`;
}

/** ISO 8601 时间戳 */
export function isoTimestamp() {
  return new Date().toISOString();
}
