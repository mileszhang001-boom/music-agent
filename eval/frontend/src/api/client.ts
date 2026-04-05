import type { TracesResponse, EvalRun, EvalScore } from '../types'

const BASE = '/api/eval'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || err.message || `HTTP ${res.status}`)
  }
  return res.json()
}

export interface ScoreSummary {
  [dim: string]: { avg: number; min: number; max: number; count: number }
}

export interface RunScoresResponse {
  run: EvalRun
  scores: EvalScore[]
  summary: ScoreSummary & { hard_pass_rate?: { format: number; playability: number } }
}

export const api = {
  // Health
  health: () => request<{ status: string }>('/health'),

  // Traces
  getTraces: (limit = 50, offset = 0) =>
    request<TracesResponse>(`/traces?limit=${limit}&offset=${offset}`),
  getTrace: (traceId: string) => request<Record<string, unknown>>(`/traces/${traceId}`),
  getTraceRaw: (traceId: string) => request<Record<string, unknown>>(`/traces/${traceId}/raw`),
  postTrace: (data: unknown) =>
    request<{ status: string; trace_ids: string[]; received: number }>(
      '/trace',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // Eval runs
  triggerRun: (opts: { trace_ids?: string[]; skip_llm?: boolean; use_thinking?: boolean } = {}) =>
    request<{ status: string; run_id: string }>('/run', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  getScores: (runId: string) => request<RunScoresResponse>(`/scores/${runId}`),
  getHistory: (limit = 50) =>
    request<{ runs: EvalRun[] }>(`/history?limit=${limit}`),
  getAutoScores: (limit = 30) =>
    request<{ scores: EvalScore[]; total: number; summary: ScoreSummary }>(`/auto-scores?limit=${limit}`),
  injectCases: (opts: { case_ids?: string[]; room?: string; interval?: number }) =>
    request<{ status: string; injected: number; cases: { case_id: string; session_id: string; type: string }[]; message: string }>(
      '/inject', { method: 'POST', body: JSON.stringify(opts) }
    ),

  // Cases
  getCases: () => request<{ cases: Record<string, unknown>[]; total: number }>('/cases'),
  getEvalCases: () =>
    request<{ cases: Record<string, unknown>[]; total: number }>('/cases/eval'),
  createCase: (fields: Record<string, unknown>) =>
    request<{ status: string; record_id: string }>('/cases', {
      method: 'POST', body: JSON.stringify({ fields }),
    }),
  updateCase: (recordId: string, fields: Record<string, unknown>) =>
    request<{ status: string }>(`/cases/${recordId}`, {
      method: 'PUT', body: JSON.stringify({ fields }),
    }),

  // Playground
  playground: (req: {
    query: string
    current_page?: number
    qq_cards?: string[]
    xm_cards?: string[]
    user_preference?: string
    scene?: string
    passenger?: string
    time_period?: string
    skip_llm_judge?: boolean
    use_thinking?: boolean
  }) =>
    request<PlaygroundResponse>('/playground', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  // Prompts
  getPromptCurrent: () => request<PromptConfig>('/prompts/current'),
  getPromptVersions: () => request<{ versions: PromptVersionSummary[] }>('/prompts/versions'),
  getPromptVersion: (v: number) => request<PromptConfig>(`/prompts/${v}`),
  savePrompt: (data: { recommend: Record<string, unknown>; note?: string }) =>
    request<{ status: string; version: number }>('/prompts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deployPrompt: (version: number, room = 'car_001') =>
    request<{ status: string; version: number; deployed: boolean }>('/prompts/deploy', {
      method: 'POST',
      body: JSON.stringify({ version, room }),
    }),
  rollbackPrompt: (version: number) =>
    request<{ status: string; version: number }>('/prompts/rollback', {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),
}

export interface PromptConfig {
  version: number
  created_at: string
  note: string
  recommend: {
    system_prompt: string
    tools: Record<string, { description: string; params: Record<string, string> }>
    pages: Record<string, { name: string; description: string }>
    qq_cards: Record<string, { displayName: string; description: string; keywords: string }>
    xm_cards: Record<string, { displayName: string; description: string; keywords: string }>
  }
}

export interface PromptVersionSummary {
  version: number
  created_at: string
  note: string
  prompt_length: number
  is_current: boolean
}

export interface PlaygroundResponse {
  trace_id: string
  tool_calls: { function: string; arguments: Record<string, unknown> }[]
  latency_ms: number
  scores: Record<string, number>
  hard_pass: boolean
  reasoning: Record<string, string>
  user_message: string
  model: string
}
