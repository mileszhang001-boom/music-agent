import { useEffect, useState } from 'react'
import { api } from '../api/client'

type CaseRecord = Record<string, unknown>

const STATUS_COLORS: Record<string, string> = {
  '已审核': 'bg-green-100 text-green-700',
  '待审核': 'bg-yellow-100 text-yellow-700',
  '有建议': 'bg-orange-100 text-orange-700',
}

const EDITABLE_FIELDS = [
  { key: 'Case ID', type: 'text', required: true },
  { key: '触发方式', type: 'select', options: ['query', 'auto'] },
  { key: '用户 Query', type: 'text' },
  { key: '偏好风格', type: 'text' },
  { key: '偏好歌手', type: 'text' },
  { key: '偏好语言', type: 'text' },
  { key: '排斥风格', type: 'text' },
  { key: '乘客', type: 'select', options: ['一个人', '两人', '含儿童', '含老人', '含家人', '含同事'] },
  { key: '时间段', type: 'select', options: ['清晨', '早上', '上午', '中午', '下午', '傍晚', '深夜'] },
  { key: '日期类型', type: 'select', options: ['工作日', '周末', '春节假期', '节假日'] },
  { key: '活动场景', type: 'select', options: ['通勤上班', '通勤回家', '长途自驾', '家庭出行', '接送家人', '约会', '午休短驾'] },
  { key: '关键因素', type: 'text' },
  { key: '期望风格方向', type: 'text' },
  { key: '应避免的内容', type: 'text' },
  { key: 'required_actions', type: 'textarea', placeholder: '[{"tool":"switch_recommend_page","args":{"page_index":1}}]' },
  { key: 'acceptable_variants', type: 'textarea', placeholder: '[{"tool":"switch_recommend_qq_cards","args":{"card_names":["欧美榜"]}}]' },
  { key: '审核状态', type: 'select', options: ['待审核', '已审核', '有建议'] },
  { key: '备注', type: 'text' },
]

function hasGoldenAnswer(c: CaseRecord): boolean {
  const r = getField(c, 'required_actions')
  const v = getField(c, 'acceptable_variants')
  return (r.length > 2 || v.length > 2) // 排除空 "[]"
}

function getField(c: CaseRecord, field: string): string {
  const val = c[field]
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (Array.isArray(val))
    return val.map((v) => (typeof v === 'object' && v !== null && 'text' in v ? (v as { text: string }).text : String(v))).join(', ')
  if (typeof val === 'object' && val !== null && 'text' in val) return (val as { text: string }).text
  return String(val)
}

export default function CaseManagement() {
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Injection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [injecting, setInjecting] = useState(false)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createFields, setCreateFields] = useState<Record<string, string>>({})

  const loadCases = () => {
    setLoading(true)
    api.getCases()
      .then((d) => setCases(d.cases))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCases() }, [])

  const filtered = filter === 'all'
    ? cases
    : cases.filter((c) => getField(c, '审核状态') === filter)

  // Edit
  const startEdit = (c: CaseRecord) => {
    const rid = String(c.record_id)
    if (editingId === rid) { setEditingId(null); return }
    setEditingId(rid)
    const fields: Record<string, string> = {}
    EDITABLE_FIELDS.forEach((f) => { fields[f.key] = getField(c, f.key) })
    setEditFields(fields)
    setMessage(null)
  }

  const handleSave = async () => {
    if (!editingId) return
    setSaving(true); setMessage(null)
    try {
      await api.updateCase(editingId, editFields)
      setMessage({ type: 'ok', text: '保存成功' })
      setEditingId(null); loadCases()
    } catch (e) { setMessage({ type: 'err', text: (e as Error).message }) }
    finally { setSaving(false) }
  }

  // Create
  const handleCreate = async () => {
    setSaving(true); setMessage(null)
    try {
      await api.createCase(createFields)
      setMessage({ type: 'ok', text: '新增成功，已同步到飞书' })
      setShowCreate(false); setCreateFields({}); loadCases()
    } catch (e) { setMessage({ type: 'err', text: (e as Error).message }) }
    finally { setSaving(false) }
  }

  // Selection
  const toggleCase = (rid: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(rid) ? n.delete(rid) : n.add(rid); return n })
  }
  const toggleAll = () => {
    const reviewedIds = filtered.filter((c) => getField(c, '审核状态') === '已审核').map((c) => String(c.record_id))
    if (selected.size === reviewedIds.length) setSelected(new Set())
    else setSelected(new Set(reviewedIds))
  }

  // Inject
  const handleInject = async () => {
    if (selected.size === 0) return
    const selectedCases = cases.filter((c) => selected.has(String(c.record_id)))
    const noGolden = selectedCases.filter((c) => !hasGoldenAnswer(c)).length
    if (noGolden > 0) {
      const ok = window.confirm(`${noGolden} 个 Case 未标注 Golden Answer，这些 Case 的 Golden Answer 维度将显示为 N/A。\n\n确认继续注入？`)
      if (!ok) return
    }
    setInjecting(true); setMessage(null)
    try {
      const caseIds = selectedCases.map((c) => getField(c, 'Case ID')).filter(Boolean)
      const res = await api.injectCases({ case_ids: caseIds.length ? caseIds : undefined })
      setMessage({ type: 'ok', text: res.message })
    } catch (e) { setMessage({ type: 'err', text: (e as Error).message }) }
    finally { setInjecting(false) }
  }

  if (loading) return <div className="text-gray-500 py-8 text-center">加载中...</div>
  if (error) return <div className="text-red-500 py-8 text-center">加载失败: {error}</div>

  const reviewedCount = filtered.filter((c) => getField(c, '审核状态') === '已审核').length

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">
          评测 <span className="ml-2 text-sm font-normal text-gray-500">({filtered.length})</span>
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {['all', '已审核', '待审核', '有建议'].map((s) => (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                  filter === s ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}>
                {s === 'all' ? '全部' : s}
              </button>
            ))}
          </div>
          <button onClick={() => { setShowCreate(true); setCreateFields({ '审核状态': '待审核', '触发方式': 'query' }) }}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700">
            + 新增 Case
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 border-l-2 border-gray-200 pl-2 mt-1">管理测试用例并注入车端执行，验证推荐效果</p>
      </div>

      {message && (
        <div className={`mb-3 px-4 py-2 rounded text-sm ${message.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Inject bar */}
      {selected.size > 0 && (
        <div className="mb-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-blue-700">已选 {selected.size} 个已审核 Case</span>
          <button onClick={handleInject} disabled={injecting}
            className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300">
            {injecting ? '注入中...' : `注入到车端`}
          </button>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-gray-400 py-12 text-center bg-white rounded-lg border">
          <p className="text-lg mb-2">暂无 Case</p>
          <p className="text-sm">点击「+ 新增 Case」添加测试用例</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left text-gray-500 text-xs whitespace-nowrap">
                <th className="px-2 py-2.5 w-8">
                  <input type="checkbox" checked={selected.size > 0 && selected.size === reviewedCount}
                    onChange={toggleAll} className="rounded" title="全选已审核" />
                </th>
                <th className="px-2 py-2.5 font-medium">ID</th>
                <th className="px-2 py-2.5 font-medium">触发</th>
                <th className="px-2 py-2.5 font-medium">Query / 场景</th>
                <th className="px-2 py-2.5 font-medium">偏好</th>
                <th className="px-2 py-2.5 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => {
                const rid = String(c.record_id)
                const caseId = getField(c, 'Case ID') || `row-${idx}`
                const status = getField(c, '审核状态')
                const isEditing = editingId === rid
                const isReviewed = status === '已审核'

                return (
                  <>
                    <tr key={rid}
                      className={`border-b border-gray-50 cursor-pointer ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      onClick={() => startEdit(c)}>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        {isReviewed && (
                          <input type="checkbox" checked={selected.has(rid)}
                            onChange={() => toggleCase(rid)} className="rounded" />
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">{caseId}</td>
                      <td className="px-2 py-2">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 whitespace-nowrap">
                          {getField(c, '触发方式') || '-'}
                        </span>
                      </td>
                      <td className="px-2 py-2 max-w-[260px] truncate" title={getField(c, '用户 Query') || getField(c, '活动场景')}>
                        {getField(c, '用户 Query') || getField(c, '活动场景') || '-'}
                      </td>
                      <td className="px-2 py-2 text-gray-600 max-w-[160px] truncate" title={[getField(c, '偏好风格'), getField(c, '偏好语言')].filter(Boolean).join(' / ')}>
                        {[getField(c, '偏好风格'), getField(c, '偏好语言')].filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[status] || 'bg-gray-100'}`}>
                          {status || '-'}
                        </span>
                        {' '}
                        {hasGoldenAnswer(c)
                          ? <span className="px-1 py-0.5 rounded text-[10px] bg-green-100 text-green-700">GA</span>
                          : <span className="px-1 py-0.5 rounded text-[10px] bg-orange-100 text-orange-600">GA</span>
                        }
                      </td>
                    </tr>

                    {isEditing && (
                      <tr key={`${rid}-edit`}>
                        <td colSpan={6} className="px-4 py-4 bg-blue-50/50 border-b">
                          <div className="grid grid-cols-3 gap-3">
                            {EDITABLE_FIELDS.map((f) => (
                              <div key={f.key}>
                                <label className="block text-xs font-medium text-gray-500 mb-1">{f.key}</label>
                                {f.type === 'select' ? (
                                  <select value={editFields[f.key] || ''}
                                    onChange={(e) => setEditFields((p) => ({ ...p, [f.key]: e.target.value }))}
                                    className="w-full border rounded px-2 py-1.5 text-sm bg-white">
                                    <option value="">不限</option>
                                    {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                ) : f.type === 'textarea' ? (
                                  <div>
                                    <textarea value={editFields[f.key] || ''}
                                      onChange={(e) => setEditFields((p) => ({ ...p, [f.key]: e.target.value }))}
                                      placeholder={f.placeholder || ''}
                                      rows={2}
                                      className="w-full border rounded px-2 py-1.5 text-xs font-mono bg-white" />
                                    {!editFields[f.key] && (
                                      <p className="text-[10px] text-orange-500 mt-0.5">待补充，否则 Golden Answer 维度将显示 N/A</p>
                                    )}
                                  </div>
                                ) : (
                                  <input type="text" value={editFields[f.key] || ''}
                                    onChange={(e) => setEditFields((p) => ({ ...p, [f.key]: e.target.value }))}
                                    className="w-full border rounded px-2 py-1.5 text-sm" />
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-3 mt-4">
                            <button onClick={handleSave} disabled={saving}
                              className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300">
                              {saving ? '保存中...' : '保存'}
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="px-4 py-1.5 border rounded text-sm text-gray-600 hover:bg-gray-50">取消</button>
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
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[680px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">新增 Case</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-3">
              {EDITABLE_FIELDS.map((f) => (
                <div key={f.key} className={f.key === '用户 Query' || f.key === '备注' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {f.key} {f.required && <span className="text-red-500">*</span>}
                  </label>
                  {f.type === 'select' ? (
                    <select value={createFields[f.key] || ''}
                      onChange={(e) => setCreateFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full border rounded px-3 py-2 text-sm">
                      <option value="">请选择</option>
                      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={createFields[f.key] || ''}
                      onChange={(e) => setCreateFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.key === 'Case ID' ? '如 C001' : ''}
                      className="w-full border rounded px-3 py-2 text-sm" />
                  )}
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={handleCreate} disabled={saving || !createFields['Case ID']}
                className="px-5 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300">
                {saving ? '创建中...' : '确认添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
