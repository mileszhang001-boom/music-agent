import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid,
} from 'recharts'
import { api, type RunScoresResponse } from '../api/client'
import type { EvalRun, DimKey } from '../types'
import { SCORE_DIMENSIONS } from '../types'

const DIM_COLORS: Record<string, string> = {
  format_score: '#10b981',
  playability_score: '#3b82f6',
  key_factor_score: '#f59e0b',
  preference_score: '#8b5cf6',
  scene_score: '#ec4899',
  action_logic_score: '#06b6d4',
}

function scoreColor(score: number, hard: boolean): string {
  if (hard) return score >= 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
  if (score < 0) return 'bg-gray-100 text-gray-400'
  if (score >= 7) return 'bg-green-100 text-green-700'
  if (score >= 5) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

export default function ScoreDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [runs, setRuns] = useState<EvalRun[]>([])
  const [selectedRun, setSelectedRun] = useState<string>('')
  const [data, setData] = useState<RunScoresResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // Load history
  useEffect(() => {
    api.getHistory().then((d) => {
      setRuns(d.runs)
      const paramRun = searchParams.get('run')
      if (paramRun) setSelectedRun(paramRun)
      else setSelectedRun('auto')  // 默认显示自动评分
    })
  }, [])

  // Load scores when run changes
  useEffect(() => {
    if (!selectedRun) return
    setLoading(true)
    if (selectedRun === 'auto') {
      // 加载自动评分
      api.getAutoScores(50)
        .then((d) => {
          setData({
            run: { run_id: 'auto', timestamp: '', prompt_fingerprint: '', case_count: d.total, avg_score: null, status: 'completed' },
            scores: d.scores,
            summary: d.summary as RunScoresResponse['summary'],
          })
        })
        .catch(() => setData(null))
        .finally(() => setLoading(false))
      return
    }
    api.getScores(selectedRun)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [selectedRun])

  // Radar data
  const radarData = data?.summary
    ? SCORE_DIMENSIONS.filter((d) => !d.hard).map((dim) => {
        const s = data.summary[dim.key]
        return { dimension: dim.label, score: s?.avg ?? 0, fullMark: 10 }
      })
    : []

  // Trend data (all runs)
  const [trendData, setTrendData] = useState<Record<string, unknown>[]>([])
  useEffect(() => {
    if (runs.length < 2) return
    // Load scores for recent runs (up to 10) for trend
    const recentRuns = runs.slice(0, 10).reverse()
    Promise.all(recentRuns.map((r) => api.getScores(r.run_id).catch(() => null)))
      .then((results) => {
        const points: Record<string, unknown>[] = []
        results.forEach((res, i) => {
          if (!res) return
          const point: Record<string, unknown> = {
            name: recentRuns[i].run_id.replace('run_', '').slice(0, 13),
          }
          SCORE_DIMENSIONS.filter((d) => !d.hard).forEach((dim) => {
            const s = res.summary[dim.key]
            point[dim.label] = s?.avg ?? null
          })
          points.push(point)
        })
        setTrendData(points)
      })
  }, [runs])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">看板</h2>
          <p className="text-xs text-gray-400 border-l-2 border-gray-200 pl-2 mt-1">一眼看清推荐系统各维度的评分表现和趋势变化</p>
        </div>
        <select
          value={selectedRun}
          onChange={(e) => {
            setSelectedRun(e.target.value)
            setSearchParams({ run: e.target.value })
          }}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="auto">自动评分（实时）</option>
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {r.run_id.replace('run_', '')} ({r.case_count} traces, {r.status})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 py-8 text-center">加载中...</div>
      ) : !data ? (
        <div className="text-gray-400 py-12 text-center">
          <p className="text-lg mb-2">暂无评测数据</p>
          <p className="text-sm">前往「评测执行」页面触发一轮评测</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-400">Traces</p>
              <p className="text-2xl font-bold">{data.run.case_count}</p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-400">格式通过率</p>
              <p className="text-2xl font-bold">
                {((data.summary.hard_pass_rate?.format ?? 0) * 100).toFixed(0)}%
              </p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-400">可执行通过率</p>
              <p className="text-2xl font-bold">
                {((data.summary.hard_pass_rate?.playability ?? 0) * 100).toFixed(0)}%
              </p>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <p className="text-xs text-gray-400">软指标均分</p>
              <p className="text-2xl font-bold">
                {data.run.avg_score?.toFixed(1) ?? '-'}
              </p>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Radar */}
            <div className="bg-white rounded-lg border p-4">
              <h3 className="text-sm font-medium text-gray-600 mb-2">4 维雷达图</h3>
              {radarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Radar
                      dataKey="score"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                  无软指标数据
                </div>
              )}
            </div>

            {/* Trend */}
            <div className="bg-white rounded-lg border p-4">
              <h3 className="text-sm font-medium text-gray-600 mb-2">趋势</h3>
              {trendData.length > 1 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {SCORE_DIMENSIONS.filter((d) => !d.hard).map((dim) => (
                      <Line
                        key={dim.key}
                        type="monotone"
                        dataKey={dim.label}
                        stroke={DIM_COLORS[dim.key]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">
                  需要至少 2 次评测才能显示趋势
                </div>
              )}
            </div>
          </div>

          {/* Heatmap table */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left">
                  <th className="px-3 py-2.5 font-medium text-gray-600 w-28">Trace</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">用户输入</th>
                  {SCORE_DIMENSIONS.map((dim) => (
                    <th
                      key={dim.key}
                      className="px-2 py-2.5 font-medium text-gray-600 text-center w-20"
                    >
                      {dim.label}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-medium text-gray-600 w-16 text-center">
                    延迟
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.scores.map((score) => {
                  const isExpanded = expandedRow === score.trace_id
                  return (
                    <>
                      <tr
                        key={score.trace_id}
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() =>
                          setExpandedRow(isExpanded ? null : score.trace_id)
                        }
                      >
                        <td className="px-3 py-2 font-mono text-xs text-blue-600">
                          {score.trace_id.slice(0, 12)}
                        </td>
                        <td className="px-3 py-2 max-w-xs truncate text-gray-700">
                          {(score as unknown as Record<string, string>).user_text || score.case_id || '-'}
                        </td>
                        {SCORE_DIMENSIONS.map((dim) => {
                          const val = score[dim.key as DimKey]
                          const display =
                            val < 0 ? '-' : dim.hard ? (val >= 1 ? 'Pass' : 'Fail') : val.toFixed(1)
                          return (
                            <td key={dim.key} className="px-2 py-2 text-center">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${scoreColor(val, dim.hard)}`}
                              >
                                {display}
                              </span>
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-center text-gray-500 font-mono text-xs">
                          {score.latency_ms}ms
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${score.trace_id}-detail`}>
                          <td colSpan={8} className="px-4 py-3 bg-gray-50">
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              {typeof score.reasoning === 'object' && score.reasoning
                                ? Object.entries(score.reasoning as Record<string, string>).map(
                                    ([dim, reason]) => (
                                      <div key={dim}>
                                        <span className="font-medium text-gray-600">{dim}</span>
                                        <p className="text-gray-500 mt-0.5">{reason}</p>
                                      </div>
                                    )
                                  )
                                : (
                                  <div className="col-span-2 text-gray-400">
                                    无评分理由
                                  </div>
                                )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
