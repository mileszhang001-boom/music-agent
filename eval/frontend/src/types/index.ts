export interface ToolCall {
  function: string
  arguments: Record<string, unknown>
}

export interface TraceItem {
  trace_id: string
  timestamp: number
  mode: string
  user_text: string
  tool_calls: ToolCall[] | string
  latency_ms: number
  prompt_fingerprint: string
  case_id: string | null
  created_at: string
}

export interface TracesResponse {
  total: number
  items: TraceItem[]
  limit: number
  offset: number
}

export interface EvalScore {
  id: number
  run_id: string
  trace_id: string
  case_id: string | null
  format_score: number
  playability_score: number
  executability_score: number
  golden_score: number
  key_factor_score: number
  preference_score: number
  scene_score: number
  action_logic_score: number
  result_quality_score: number
  latency_ms: number
  reasoning: string | Record<string, string>
}

// 8 维度定义 (v2.0)
export const SCORE_DIMENSIONS = [
  { key: 'format_score', label: '格式', hard: true, level: 'L1' },
  { key: 'executability_score', label: '可执行', hard: true, level: 'L1' },
  { key: 'golden_score', label: 'Golden', hard: false, level: 'L2' },
  { key: 'key_factor_score', label: '关键因素', hard: false, level: 'L3' },
  { key: 'preference_score', label: '偏好', hard: false, level: 'L3' },
  { key: 'scene_score', label: '场景', hard: false, level: 'L3' },
  { key: 'action_logic_score', label: '逻辑', hard: false, level: 'L3' },
  { key: 'result_quality_score', label: '结果', hard: false, level: 'L3' },
] as const

/** 获取评分值，兼容 executability/playability 新旧字段 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getScore(data: any, key: string): number {
  if (key === 'executability_score') {
    return data.executability_score ?? data.playability_score ?? -1
  }
  return data[key] ?? -1
}

/** 判断分数是否为 N/A (-1 表示未评分或不适用) */
export function isNA(score: number): boolean {
  return score < 0
}

export type DimKey = (typeof SCORE_DIMENSIONS)[number]['key']

export interface EvalRun {
  run_id: string
  timestamp: string
  prompt_fingerprint: string
  case_count: number
  avg_score: number | null
  status: 'pending' | 'running' | 'completed' | 'failed'
}
