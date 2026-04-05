import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { diffLines } from 'diff'
import { api, type PromptConfig, type PromptVersionSummary } from '../api/client'

type Rec = PromptConfig['recommend']
type ToolEntry = { description: string; params: Record<string, string> }
type CardEntry = { displayName: string; description: string; keywords: string }

type Tab = 'edit' | 'diff' | 'history'

export default function PromptEditor() {
  const navigate = useNavigate()
  const [versions, setVersions] = useState<PromptVersionSummary[]>([])
  const [config, setConfig] = useState<PromptConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [tab, setTab] = useState<Tab>('edit')

  // Diff state
  const [diffBase, setDiffBase] = useState<number | null>(null)
  const [diffTarget, setDiffTarget] = useState<number | null>(null)
  const [diffResult, setDiffResult] = useState<{ added?: boolean; removed?: boolean; value: string }[]>([])

  // Edited state
  const [prompt, setPrompt] = useState('')
  const [tools, setTools] = useState<Record<string, ToolEntry>>({})
  const [qqCards, setQqCards] = useState<Record<string, CardEntry>>({})
  const [xmCards, setXmCards] = useState<Record<string, CardEntry>>({})

  const loadVersions = () => { api.getPromptVersions().then((d) => setVersions(d.versions)).catch(() => {}) }

  const loadConfig = (version?: number) => {
    setLoading(true)
    const p = version != null ? api.getPromptVersion(version) : api.getPromptCurrent()
    p.then((cfg) => {
      setConfig(cfg)
      const rec = cfg.recommend || {} as Rec
      setPrompt(rec.system_prompt || '')
      setTools(rec.tools || {})
      setQqCards(rec.qq_cards || {})
      setXmCards(rec.xm_cards || {})
    })
      .catch((e) => setMessage({ type: 'err', text: e.message }))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadVersions(); loadConfig() }, [])

  // Compute diff when selections change
  useEffect(() => {
    if (tab !== 'diff' || diffBase == null || diffTarget == null) return
    Promise.all([api.getPromptVersion(diffBase), api.getPromptVersion(diffTarget)])
      .then(([a, b]) => {
        const textA = JSON.stringify(a.recommend, null, 2)
        const textB = JSON.stringify(b.recommend, null, 2)
        setDiffResult(diffLines(textA, textB))
      })
      .catch(() => setDiffResult([]))
  }, [tab, diffBase, diffTarget])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const rec: Record<string, unknown> = {
        system_prompt: prompt, tools, pages: config?.recommend?.pages || {},
        qq_cards: qqCards, xm_cards: xmCards,
      }
      const { version } = await api.savePrompt({
        recommend: rec,
        note: note || `编辑于 ${new Date().toLocaleString()}`,
      })
      setMessage({ type: 'ok', text: `已保存为 v${version}` })
      setNote('')
      loadVersions()
      loadConfig(version)
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleDeploy = async () => {
    if (!config) return
    setDeploying(true)
    setMessage(null)
    try {
      const res = await api.deployPrompt(config.version)
      setMessage({
        type: res.deployed ? 'ok' : 'err',
        text: res.deployed ? `v${config.version} 已部署到车端` : `v${config.version} 已激活，车端推送失败`,
      })
      loadVersions()
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setDeploying(false)
    }
  }

  const handleRollback = async (version: number) => {
    try {
      await api.rollbackPrompt(version)
      setMessage({ type: 'ok', text: `已回滚到 v${version}` })
      loadVersions()
      loadConfig(version)
      setTab('edit')
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    }
  }

  const updateToolField = (toolName: string, field: string, value: string) => {
    setTools((prev) => {
      const tool = { ...prev[toolName] }
      if (field === 'description') tool.description = value
      else tool.params = { ...tool.params, [field]: value }
      return { ...prev, [toolName]: tool }
    })
  }

  const updateCard = (type: 'qq' | 'xm', cardId: string, field: 'description' | 'keywords', value: string) => {
    const setter = type === 'qq' ? setQqCards : setXmCards
    setter((prev) => ({ ...prev, [cardId]: { ...prev[cardId], [field]: value } }))
  }

  if (loading) return <div className="text-gray-500 py-8 text-center">加载中...</div>

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">优化</h2>
          <p className="text-xs text-gray-400 border-l-2 border-gray-200 pl-2 mt-1">编辑推荐 Prompt 配置，版本对比，一键部署到车端</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={config?.version ?? 0}
            onChange={(e) => loadConfig(Number(e.target.value))}
            className="border rounded px-3 py-1.5 text-sm">
            <option value={0}>默认版本 (v0)</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} {v.is_current ? '★' : ''} — {v.note?.slice(0, 25) || '无备注'}
              </option>
            ))}
          </select>
          <button onClick={() => navigate('/playground')}
            className="px-3 py-1.5 text-sm border rounded text-gray-600 hover:bg-gray-50">
            去 Playground 测试
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${message.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {([['edit', '编辑'], ['diff', 'Diff 对比'], ['history', '版本历史']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Edit */}
      {tab === 'edit' && (
        <>
          {/* System Prompt */}
          <div className="bg-white rounded-lg border mb-4">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-600">System Prompt</h3>
              <span className="text-xs text-gray-400">{prompt.length} 字符</span>
            </div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
              rows={18} spellCheck={false}
              className="w-full px-4 py-3 text-sm font-mono leading-relaxed resize-y outline-none" />
          </div>

          {/* Tools */}
          <div className="bg-white rounded-lg border mb-4">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h3 className="text-sm font-medium text-gray-600">Tool 配置</h3>
            </div>
            <div className="divide-y">
              {Object.entries(tools).map(([name, tool]) => (
                <div key={name} className="px-4 py-3">
                  <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{name}</span>
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="text-[10px] text-gray-400">description</label>
                      <input type="text" value={tool.description}
                        onChange={(e) => updateToolField(name, 'description', e.target.value)}
                        className="w-full border rounded px-3 py-1.5 text-sm" />
                    </div>
                    {Object.entries(tool.params || {}).map(([pname, pdesc]) => (
                      <div key={pname}>
                        <label className="text-[10px] text-gray-400">params.{pname}</label>
                        <input type="text" value={pdesc}
                          onChange={(e) => updateToolField(name, pname, e.target.value)}
                          className="w-full border rounded px-3 py-1.5 text-sm text-gray-600" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <CardEditor title="QQ 卡片" cards={qqCards} type="qq" onUpdate={updateCard} />
            <CardEditor title="喜马卡片" cards={xmCards} type="xm" onUpdate={updateCard} />
          </div>

          {/* Actions */}
          <div className="bg-white rounded-lg border p-4 flex items-center gap-4">
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="版本备注（可选）" className="flex-1 border rounded px-3 py-2 text-sm" />
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 disabled:bg-blue-300">
              {saving ? '保存中...' : '保存新版本'}
            </button>
            <button onClick={handleDeploy} disabled={deploying || !config?.version}
              className="px-5 py-2 bg-green-600 text-white rounded font-medium text-sm hover:bg-green-700 disabled:bg-green-300">
              {deploying ? '部署中...' : `部署 v${config?.version ?? 0}`}
            </button>
          </div>

          {/* JSON Preview */}
          <div className="bg-white rounded-lg border mt-4">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-600">JSON 预览</h3>
              <span className="text-xs text-gray-400">部署时发送给车端的完整配置</span>
            </div>
            <pre className="px-4 py-3 text-xs font-mono leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto text-gray-700 bg-gray-50">
              {JSON.stringify({
                type: "prompt_update", version: config?.version ?? 0,
                recommend: { system_prompt: prompt, tools, pages: config?.recommend?.pages || {}, qq_cards: qqCards, xm_cards: xmCards }
              }, null, 2)}
            </pre>
          </div>
        </>
      )}

      {/* Tab: Diff */}
      {tab === 'diff' && (
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-4">
            <span className="text-sm text-gray-600">对比:</span>
            <select value={diffBase ?? ''} onChange={(e) => setDiffBase(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm">
              <option value="">选择基准版本</option>
              {versions.map((v) => <option key={v.version} value={v.version}>v{v.version} {v.note?.slice(0, 15)}</option>)}
            </select>
            <span className="text-gray-400">→</span>
            <select value={diffTarget ?? ''} onChange={(e) => setDiffTarget(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm">
              <option value="">选择对比版本</option>
              {versions.map((v) => <option key={v.version} value={v.version}>v{v.version} {v.note?.slice(0, 15)}</option>)}
            </select>
          </div>
          {diffResult.length > 0 ? (
            <pre className="px-4 py-3 text-xs font-mono leading-relaxed overflow-auto max-h-[600px]">
              {diffResult.map((part, i) => (
                <span key={i} className={
                  part.added ? 'bg-green-100 text-green-800' :
                  part.removed ? 'bg-red-100 text-red-800 line-through' :
                  'text-gray-600'
                }>{part.value}</span>
              ))}
            </pre>
          ) : (
            <div className="px-4 py-12 text-center text-gray-400 text-sm">
              选择两个版本查看差异
            </div>
          )}
        </div>
      )}

      {/* Tab: History */}
      {tab === 'history' && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left text-gray-500 text-xs">
                <th className="px-4 py-2.5 font-medium w-16">版本</th>
                <th className="px-4 py-2.5 font-medium">备注</th>
                <th className="px-4 py-2.5 font-medium w-20">Prompt</th>
                <th className="px-4 py-2.5 font-medium w-36">时间</th>
                <th className="px-4 py-2.5 font-medium w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {versions.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">暂无版本</td></tr>
              ) : versions.map((v) => (
                <tr key={v.version} className={`border-b border-gray-50 ${v.is_current ? 'bg-blue-50/30' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    v{v.version}
                    {v.is_current && <span className="ml-1 text-blue-600">★</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{v.note || '-'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{v.prompt_length} 字符</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{v.created_at?.replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-4 py-2.5 flex gap-2">
                    <button onClick={() => { loadConfig(v.version); setTab('edit') }}
                      className="text-blue-600 hover:underline text-xs">查看</button>
                    {!v.is_current && (
                      <button onClick={() => handleRollback(v.version)}
                        className="text-orange-600 hover:underline text-xs">回滚到此版本</button>
                    )}
                    <button onClick={() => { setDiffBase(v.version); setDiffTarget(versions[0]?.version); setTab('diff') }}
                      className="text-gray-500 hover:underline text-xs">对比最新</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CardEditor({ title, cards, type, onUpdate }: {
  title: string; cards: Record<string, CardEntry>; type: 'qq' | 'xm'
  onUpdate: (type: 'qq' | 'xm', id: string, field: 'description' | 'keywords', val: string) => void
}) {
  return (
    <div className="bg-white rounded-lg border">
      <div className="px-4 py-3 border-b bg-gray-50">
        <h3 className="text-sm font-medium text-gray-600">{title} ({Object.keys(cards).length})</h3>
      </div>
      <div className="divide-y max-h-80 overflow-y-auto">
        {Object.entries(cards).map(([id, card]) => (
          <div key={id} className="px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-700">{card.displayName}</span>
              <span className="text-[10px] text-gray-400 font-mono">{id}</span>
            </div>
            <input type="text" value={card.description} placeholder="描述"
              onChange={(e) => onUpdate(type, id, 'description', e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs mt-1" />
            <input type="text" value={card.keywords} placeholder="关键词"
              onChange={(e) => onUpdate(type, id, 'keywords', e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs mt-1 text-gray-500" />
          </div>
        ))}
      </div>
    </div>
  )
}
