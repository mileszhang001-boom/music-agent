import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TraceItem } from '../types'

const TOOL_COLORS: Record<string, string> = {
  switch_recommend_page: 'bg-blue-100 text-blue-700',
  switch_recommend_qq_cards: 'bg-green-100 text-green-700',
  switch_recommend_ximalaya_cards: 'bg-purple-100 text-purple-700',
  query_ai_recommend: 'bg-orange-100 text-orange-700',
}

function ToolBadge({ name }: { name: string }) {
  const short = name.replace('switch_recommend_', '').replace('query_ai_', 'ai_')
  const color = TOOL_COLORS[name] || 'bg-gray-100 text-gray-600'
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${color}`}>{short}</span>
}

type EnrichedTrace = TraceItem & {
  model?: string
  total_tokens?: number
  has_result?: boolean
  result_total?: number
  scored?: boolean
  hard_pass?: boolean | null
  soft_avg?: number | null
}

export default function TraceList() {
  const [traces, setTraces] = useState<EnrichedTrace[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const limit = 20

  useEffect(() => {
    setLoading(true)
    api.getTraces(limit, page * limit)
      .then((data) => { setTraces(data.items as EnrichedTrace[]); setTotal(data.total) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [page])

  const totalPages = Math.ceil(total / limit)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-800">
          日志 <span className="ml-2 text-sm font-normal text-gray-500">({total})</span>
        </h2>
        <p className="text-xs text-gray-400 border-l-2 border-gray-200 pl-2 mt-1">查看车端上报的每一次推荐决策记录</p>
      </div>

      {loading ? (
        <div className="text-gray-500 py-8 text-center">加载中...</div>
      ) : traces.length === 0 ? (
        <div className="text-gray-400 py-12 text-center">
          <p className="text-lg mb-2">暂无 Trace 数据</p>
          <p className="text-sm">车端上报 Trace 后，数据将显示在这里</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-gray-500 text-xs whitespace-nowrap">
                  <th className="px-2 py-2.5 font-medium">ID</th>
                  <th className="px-2 py-2.5 font-medium">用户输入</th>
                  <th className="px-2 py-2.5 font-medium">Tool Calls</th>
                  <th className="px-2 py-2.5 font-medium text-center">硬</th>
                  <th className="px-2 py-2.5 font-medium text-center">软</th>
                  <th className="px-2 py-2.5 font-medium text-right">模型/延迟</th>
                  <th className="px-2 py-2.5 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((t) => {
                  const toolCalls = Array.isArray(t.tool_calls) ? t.tool_calls : []
                  const userText = (t.user_text || '')
                    .replace(/\（用户偏好：.*?\）/g, '')
                    .replace(/（用户偏好：.*?）/g, '')
                    .replace(/^用户说：/, '')
                    .replace(/^用户想/, '想')
                  return (
                    <tr key={t.trace_id} className="border-b border-gray-50 hover:bg-blue-50/30">
                      <td className="px-2 py-2">
                        <Link to={`/traces/${t.trace_id}`}
                          className="text-blue-600 hover:underline font-mono text-xs">
                          {t.trace_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-2 py-2 max-w-[220px] truncate text-gray-700" title={t.user_text}>
                        {userText.slice(0, 35)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1 flex-nowrap">
                          {toolCalls.map((tc, i) => <ToolBadge key={i} name={tc.function} />)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        {t.scored ? (
                          <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                            t.hard_pass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {t.hard_pass ? 'Pass' : 'Fail'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">...</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {t.scored && t.soft_avg != null ? (
                          <span className={`text-xs font-medium ${
                            t.soft_avg >= 7 ? 'text-green-600' : t.soft_avg >= 5 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {t.soft_avg}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <span className="text-[10px] text-gray-500">{t.model ? t.model.replace('qwen-', 'Q-') : ''}</span>
                        <span className="text-[10px] text-gray-400 ml-1">{t.latency_ms >= 1000 ? `${(t.latency_ms / 1000).toFixed(1)}s` : `${t.latency_ms}ms`}</span>
                      </td>
                      <td className="px-2 py-2 text-gray-400 text-xs whitespace-nowrap">
                        {t.created_at?.replace('T', ' ').slice(5, 16)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1 rounded border text-sm disabled:opacity-40">上一页</button>
              <span className="px-3 py-1 text-sm text-gray-500">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1 rounded border text-sm disabled:opacity-40">下一页</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
