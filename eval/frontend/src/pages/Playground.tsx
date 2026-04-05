import { useState } from 'react'
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts'
import { api, type PlaygroundResponse } from '../api/client'
import { SCORE_DIMENSIONS } from '../types'

const PAGE_OPTIONS = [
  { value: 0, label: '喜马拉雅' },
  { value: 1, label: 'QQ音乐' },
  { value: 2, label: 'AI播客' },
  { value: 3, label: 'AI推荐' },
]

const SCENES = ['', '通勤上班', '通勤回家', '长途自驾', '家庭出行', '约会', '午休短驾']
const PASSENGERS = ['', '一个人', '两人', '含儿童', '含老人', '含家人']
const TIMES = ['', '清晨', '早上', '上午', '中午', '下午', '傍晚', '深夜']

const TOOL_ICONS: Record<string, string> = {
  switch_recommend_page: '📄',
  switch_recommend_qq_cards: '🎵',
  switch_recommend_ximalaya_cards: '🎧',
  query_ai_recommend: '🤖',
}

const PAGE_NAMES: Record<number, string> = { 0: '喜马拉雅', 1: 'QQ音乐', 2: 'AI播客', 3: 'AI推荐' }

function scoreColor(score: number): string {
  if (score < 0) return 'text-gray-400'
  if (score >= 7) return 'text-green-600'
  if (score >= 5) return 'text-yellow-600'
  return 'text-red-600'
}

export default function Playground() {
  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [preference, setPreference] = useState('')
  const [scene, setScene] = useState('')
  const [passenger, setPassenger] = useState('')
  const [timePeriod, setTimePeriod] = useState('')
  const [skipJudge, setSkipJudge] = useState(false)
  const [useThinking, setUseThinking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PlaygroundResponse | null>(null)
  const [error, setError] = useState('')

  const handleRun = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await api.playground({
        query: query.trim(),
        current_page: currentPage,
        user_preference: preference,
        scene,
        passenger,
        time_period: timePeriod,
        skip_llm_judge: skipJudge,
        use_thinking: useThinking,
      })
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const radarData = result
    ? SCORE_DIMENSIONS.filter((d) => !d.hard).map((dim) => ({
        dimension: dim.label,
        score: Math.max(0, result.scores[dim.key] ?? 0),
        fullMark: 10,
      }))
    : []

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">模拟</h2>
        <p className="text-xs text-gray-400 border-l-2 border-gray-200 pl-2 mt-1">构造任意场景即时测试，秒级验证 Prompt 调优效果</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Input panel */}
        <div className="col-span-1 space-y-4">
          {/* Query */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">用户输入</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="来点欧美音乐 / 我想听播客 / 推荐点好听的..."
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
            />
          </div>

          {/* Current page */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">当前页面</label>
            <select
              value={currentPage}
              onChange={(e) => setCurrentPage(Number(e.target.value))}
              className="w-full border rounded px-3 py-1.5 text-sm"
            >
              {PAGE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Preference */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">用户偏好</label>
            <input
              type="text"
              value={preference}
              onChange={(e) => setPreference(e.target.value)}
              placeholder="欧美流行、民谣、古典..."
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
          </div>

          {/* Scene selectors */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">场景</label>
              <select value={scene} onChange={(e) => setScene(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm">
                {SCENES.map((s) => <option key={s} value={s}>{s || '不限'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">乘客</label>
              <select value={passenger} onChange={(e) => setPassenger(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm">
                {PASSENGERS.map((p) => <option key={p} value={p}>{p || '不限'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">时间段</label>
              <select value={timePeriod} onChange={(e) => setTimePeriod(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm">
                {TIMES.map((t) => <option key={t} value={t}>{t || '不限'}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input type="checkbox" checked={skipJudge}
                  onChange={(e) => { setSkipJudge(e.target.checked); if (e.target.checked) setUseThinking(false) }} className="rounded" />
                跳过 LLM 评分
              </label>
            </div>
          </div>

          {/* 深度思考模式 */}
          {!skipJudge && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useThinking}
                  onChange={(e) => setUseThinking(e.target.checked)} className="rounded accent-purple-600" />
                <span className="font-medium text-purple-700">深度思考模式</span>
              </label>
              <p className="text-xs text-purple-500 mt-1 ml-6">启用后评分更精准、理由更充分，但每次耗时约 30 秒</p>
            </div>
          )}

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={loading || !query.trim()}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '运行中...' : '运行'}
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Right: Results */}
        <div className="col-span-2">
          {!result && !loading && (
            <div className="h-full flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-lg mb-1">输入 query 并点击运行</p>
                <p className="text-sm">LLM 将返回 tool_calls，系统自动 6 维评分</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="inline-block w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mb-3" />
                <p>正在调用 LLM + 评分...</p>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Tool calls */}
              <div className="bg-white rounded-lg border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-600">
                    Tool Calls
                    <span className="ml-2 text-gray-400 font-normal">
                      {result.latency_ms}ms · {result.model}
                    </span>
                  </h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    result.hard_pass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {result.hard_pass ? '硬约束通过' : '硬约束失败'}
                  </span>
                </div>
                <div className="space-y-2">
                  {result.tool_calls.map((tc, i) => {
                    const args = tc.arguments
                    let desc = ''
                    if (tc.function === 'switch_recommend_page') {
                      desc = `→ ${PAGE_NAMES[args.page_index as number] || `页面${args.page_index}`}`
                    } else if (tc.function.includes('qq_cards')) {
                      desc = `→ ${(args.card_names as string[])?.join(', ')}`
                    } else if (tc.function.includes('ximalaya_cards')) {
                      desc = `→ ${(args.card_names as string[])?.join(', ')}`
                    } else if (tc.function === 'query_ai_recommend') {
                      desc = `→ "${args.query}"`
                    }
                    return (
                      <div key={i} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                        <span className="text-lg">{TOOL_ICONS[tc.function] || '⚙️'}</span>
                        <div>
                          <span className="font-mono text-xs text-gray-700">{tc.function}</span>
                          <span className="ml-2 text-sm text-gray-500">{desc}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Scores: radar + list */}
              <div className="grid grid-cols-2 gap-4">
                {/* Radar */}
                <div className="bg-white rounded-lg border p-4">
                  {radarData.some((d) => d.score > 0) ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fontSize: 9 }} />
                        <Radar dataKey="score" stroke="#3b82f6" fill="#3b82f6"
                          fillOpacity={0.2} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
                      LLM 评分已跳过
                    </div>
                  )}
                </div>

                {/* Score list */}
                <div className="bg-white rounded-lg border p-4 space-y-2">
                  {SCORE_DIMENSIONS.map((dim) => {
                    const val = result.scores[dim.key] ?? -1
                    const display = dim.hard
                      ? (val >= 1 ? 'Pass' : 'Fail')
                      : (val >= 0 ? `${val.toFixed(1)}/10` : '-')
                    return (
                      <div key={dim.key} className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">{dim.label}</span>
                        <span className={`text-sm font-medium ${
                          dim.hard
                            ? (val >= 1 ? 'text-green-600' : 'text-red-600')
                            : scoreColor(val)
                        }`}>
                          {display}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Reasoning */}
              {result.reasoning && Object.keys(result.reasoning).length > 0 && (
                <div className="bg-white rounded-lg border p-4">
                  <h3 className="text-sm font-medium text-gray-600 mb-2">评分理由</h3>
                  <div className="space-y-2">
                    {Object.entries(result.reasoning).map(([dim, reason]) => (
                      <div key={dim} className="text-xs">
                        <span className="font-medium text-gray-500">{dim}</span>
                        <p className="text-gray-600 mt-0.5">{reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
