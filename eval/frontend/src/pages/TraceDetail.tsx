import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client'

const PAGE_NAMES: Record<number, string> = {
  0: '喜马拉雅', 1: 'QQ音乐', 2: 'AI播客', 3: 'AI推荐',
}

const TOOL_ICONS: Record<string, string> = {
  switch_recommend_page: '📄',
  switch_recommend_qq_cards: '🎵',
  switch_recommend_ximalaya_cards: '🎧',
  query_ai_recommend: '🤖',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyData = Record<string, any>

export default function TraceDetail() {
  const { traceId } = useParams()
  const [data, setData] = useState<AnyData | null>(null)
  const [rawData, setRawData] = useState<AnyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRaw, setShowRaw] = useState(false)
  const [loadingRaw, setLoadingRaw] = useState(false)

  useEffect(() => {
    if (!traceId) return
    setLoading(true)
    api.getTrace(traceId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [traceId])

  const handleShowRaw = () => {
    if (rawData) { setShowRaw(!showRaw); return }
    if (!traceId) return
    setLoadingRaw(true)
    api.getTraceRaw(traceId)
      .then((d) => { setRawData(d); setShowRaw(true) })
      .catch(() => setShowRaw(false))
      .finally(() => setLoadingRaw(false))
  }

  if (loading) return <div className="text-gray-500 py-8 text-center">加载中...</div>
  if (!data) return <div className="text-red-500 py-8 text-center">Trace 未找到</div>

  const toolCalls = Array.isArray(data.tool_calls) ? data.tool_calls : []
  const usage = data.usage || {}
  const uiState = data.ui_state || {}
  const resultItems = data.result_items
  const actions = Array.isArray(data.actions) ? data.actions : []

  // 归一化 result_state：兼容旧数据字段名（ximalaya_cards / qq_card_names）
  const _rs = data.result_state || {}
  const resultState = {
    ..._rs,
    page: typeof _rs.page === 'string' ? parseInt(_rs.page, 10) : (_rs.page ?? 0),
    page_name: _rs.page_name || PAGE_NAMES[_rs.page] || '',
    qq_cards: _rs.qq_cards || (Array.isArray(_rs.qq_card_names) ? _rs.qq_card_names : (_rs.qq_card_names || '').split(',').map((s: string) => s.trim()).filter(Boolean)),
    xm_cards: _rs.xm_cards || (Array.isArray(_rs.ximalaya_cards) ? _rs.ximalaya_cards : (_rs.ximalaya_cards || '').split(',').map((s: string) => s.trim()).filter(Boolean)),
  }

  return (
    <div className="max-w-4xl">
      <Link to="/traces" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
        &larr; 返回列表
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">日志详情</h2>
          <span className="font-mono text-xs text-gray-400">{data.trace_id}</span>
        </div>
        <div className="flex gap-2">
          {data.model && (
            <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
              {data.model}
            </span>
          )}
          <span className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
            {data.latency_ms}ms
          </span>
        </div>
      </div>

      {/* Meta cards row */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <MetaCard label="模式" value={data.mode || '-'} />
        <MetaCard label="延迟" value={`${data.latency_ms}ms`} />
        <MetaCard label="Token 用量" value={
          usage.total_tokens
            ? `${usage.prompt_tokens || '?'} + ${usage.completion_tokens || '?'} = ${usage.total_tokens}`
            : '-'
        } />
        <MetaCard label="Prompt 指纹" value={data.prompt_fingerprint || '-'} mono />
        <MetaCard label="关联 Case" value={data.case_id || '无'} />
      </div>

      {/* User input */}
      <Section title="用户输入">
        <p className="text-gray-800">{data.user_text}</p>
      </Section>

      {/* UI State: Before → After */}
      <Section title="UI 状态">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">操作前</p>
            <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
              <div><span className="text-gray-500">页面:</span> <span className="font-medium">{uiState.page_name || PAGE_NAMES[uiState.page] || '-'} ({uiState.page})</span></div>
              {uiState.page === 1 && uiState.qq_cards?.length > 0 && (
                <div><span className="text-gray-500">QQ卡片:</span> {uiState.qq_cards.join(', ')}</div>
              )}
              {uiState.page === 0 && uiState.xm_cards?.length > 0 && (
                <div><span className="text-gray-500">喜马卡片:</span> {uiState.xm_cards.join(', ')}</div>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">操作后</p>
            {Object.keys(resultState).length > 0 ? (
              <div className="bg-green-50 rounded p-3 text-sm space-y-1">
                <div><span className="text-gray-500">页面:</span> <span className="font-medium">{resultState.page_name || PAGE_NAMES[resultState.page] || '-'} ({resultState.page})</span></div>
                {resultState.page === 1 && resultState.qq_cards?.length > 0 && (
                  <div><span className="text-gray-500">QQ卡片:</span> {resultState.qq_cards.join(', ')}</div>
                )}
                {resultState.page === 0 && resultState.xm_cards?.length > 0 && (
                  <div><span className="text-gray-500">喜马卡片:</span> {resultState.xm_cards.join(', ')}</div>
                )}
                {resultState.page === 3 && resultItems && (
                  <div><span className="text-gray-500">推荐内容:</span> {
                    [
                      ...(resultItems.netease_items || []).map((it: AnyData) => `${it.title} - ${it.artist}`),
                      ...(resultItems.ximalaya_items || []).map((it: AnyData) => it.title),
                    ].slice(0, 5).join(', ') || '加载中...'
                  }</div>
                )}
              </div>
            ) : (
              <div className="bg-gray-50 rounded p-3 text-sm text-gray-400">无状态数据</div>
            )}
          </div>
        </div>
      </Section>

      {/* Tool Calls */}
      <Section title={`Tool Calls (${toolCalls.length})`}>
        <div className="space-y-2">
          {toolCalls.map((tc: AnyData, i: number) => {
            const args = tc.arguments || {}
            let desc = ''
            if (tc.function === 'switch_recommend_page') {
              const idx = args.page_index as number
              desc = `切换到 ${PAGE_NAMES[idx] || `页面${idx}`}`
            } else if (tc.function === 'switch_recommend_qq_cards') {
              desc = `选择: ${(args.card_names as string[])?.join(', ') || '-'}`
            } else if (tc.function === 'switch_recommend_ximalaya_cards') {
              desc = `选择: ${(args.card_names as string[])?.join(', ') || '-'}`
            } else if (tc.function === 'query_ai_recommend') {
              desc = `"${args.query || ''}"`
            }
            const success = actions[i]?.success
            return (
              <div key={i} className="flex items-start gap-3 p-3 bg-white border rounded-lg">
                <span className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-sm shrink-0">
                  {TOOL_ICONS[tc.function] || '⚙️'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-700">{tc.function}</span>
                    {success !== undefined && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${success ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {success ? '成功' : '失败'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Result Items (AI Recommend) */}
      {resultItems && (
        <Section title={`推荐结果 (${resultItems.total_items} 项, ${resultItems.fetch_latency_ms}ms)`}>
          {/* Netease */}
          {resultItems.netease_items?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-500 mb-2">网易云音乐 ({resultItems.netease_count})</p>
              <table className="w-full text-sm border rounded overflow-hidden">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2 w-8">#</th>
                    <th className="px-3 py-2">歌曲</th>
                    <th className="px-3 py-2">歌手</th>
                    <th className="px-3 py-2 text-right w-16">时长</th>
                  </tr>
                </thead>
                <tbody>
                  {resultItems.netease_items.map((item: AnyData, i: number) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-700">{item.title}</td>
                      <td className="px-3 py-2 text-gray-500">{item.artist}</td>
                      <td className="px-3 py-2 text-right text-gray-400 text-xs">
                        {item.duration_sec ? `${Math.floor(item.duration_sec / 60)}:${String(item.duration_sec % 60).padStart(2, '0')}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Ximalaya */}
          {resultItems.ximalaya_items?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">喜马拉雅 ({resultItems.ximalaya_count})</p>
              <table className="w-full text-sm border rounded overflow-hidden">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2 w-8">#</th>
                    <th className="px-3 py-2">标题</th>
                    <th className="px-3 py-2">描述</th>
                    <th className="px-3 py-2 text-right w-16">时长</th>
                  </tr>
                </thead>
                <tbody>
                  {resultItems.ximalaya_items.map((item: AnyData, i: number) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-700">{item.title}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{item.subtitle || '-'}</td>
                      <td className="px-3 py-2 text-right text-gray-400 text-xs">
                        {item.duration_sec ? `${Math.floor(item.duration_sec / 60)}:${String(item.duration_sec % 60).padStart(2, '0')}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* Score */}
      <ScoreSection score={data.score} />

      {/* Raw JSON */}
      <div className="mt-6">
        <button
          onClick={handleShowRaw}
          disabled={loadingRaw}
          className="text-sm text-blue-600 hover:underline"
        >
          {loadingRaw ? '加载中...' : showRaw ? '隐藏原始 JSON' : '查看原始 JSON（完整车端上报数据）'}
        </button>
        {showRaw && rawData && (
          <pre className="mt-2 bg-gray-900 text-green-300 rounded-lg p-4 overflow-x-auto text-xs leading-relaxed max-h-[600px] overflow-y-auto">
            {JSON.stringify(rawData, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      <div className="bg-white rounded-lg border p-4">{children}</div>
    </div>
  )
}

function MetaCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white rounded-lg border px-3 py-2.5">
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-medium text-gray-700 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

const DIMS = [
  { key: 'format_score', label: '格式正确性', hard: true },
  { key: 'playability_score', label: '可执行性', hard: true },
  { key: 'key_factor_score', label: '关键因素捕获', hard: false },
  { key: 'preference_score', label: '用户偏好匹配', hard: false },
  { key: 'scene_score', label: '场景契合度', hard: false },
  { key: 'action_logic_score', label: '操作逻辑性', hard: false },
]

function ScoreSection({ score }: { score: AnyData | null }) {
  if (!score) {
    return (
      <Section title="评分">
        <p className="text-gray-400 text-sm">评分中，请稍候刷新...</p>
      </Section>
    )
  }

  const reasoning = typeof score.reasoning === 'object' ? score.reasoning : {}

  return (
    <Section title="评分结果">
      <div className="grid grid-cols-6 gap-3 mb-4">
        {DIMS.map((dim) => {
          const val = score[dim.key] ?? -1
          const display = dim.hard
            ? (val >= 1 ? 'Pass' : 'Fail')
            : (val >= 0 ? val.toFixed(1) : '-')
          const color = dim.hard
            ? (val >= 1 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50')
            : val >= 7 ? 'text-green-600 bg-green-50'
            : val >= 5 ? 'text-yellow-600 bg-yellow-50'
            : val >= 0 ? 'text-red-600 bg-red-50'
            : 'text-gray-400 bg-gray-50'
          return (
            <div key={dim.key} className={`rounded-lg p-3 text-center ${color}`}>
              <p className="text-[10px] opacity-70 mb-1">{dim.label}</p>
              <p className="text-lg font-bold">{display}</p>
            </div>
          )
        })}
      </div>
      {Object.keys(reasoning).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-400">评分理由</p>
          {Object.entries(reasoning as Record<string, string>).map(([dim, reason]) => (
            <div key={dim} className="text-xs">
              <span className="font-medium text-gray-600">{dim}</span>
              <p className="text-gray-500 mt-0.5 leading-relaxed">{reason}</p>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
