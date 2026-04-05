import { Routes, Route, NavLink } from 'react-router-dom'
import TraceList from './pages/TraceList'
import TraceDetail from './pages/TraceDetail'
import ScoreDashboard from './pages/ScoreDashboard'
import CaseManagement from './pages/CaseManagement'
import Playground from './pages/Playground'
import PromptEditor from './pages/PromptEditor'

const NAV_ITEMS = [
  { to: '/scores', label: '看板' },
  { to: '/cases', label: '评测' },
  { to: '/traces', label: '日志' },
  { to: '/prompts', label: '优化' },
  { to: '/playground', label: '模拟' },
]

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <nav className="w-56 bg-white border-r border-gray-200 p-4 flex flex-col gap-1 shrink-0">
        <h1 className="text-lg font-bold text-gray-800 mb-4 px-2">
          AI 音乐评测
        </h1>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `px-3 py-2 text-sm rounded transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        <Routes>
          <Route path="/" element={<ScoreDashboard />} />
          <Route path="/scores" element={<ScoreDashboard />} />
          <Route path="/traces" element={<TraceList />} />
          <Route path="/traces/:traceId" element={<TraceDetail />} />
          <Route path="/cases" element={<CaseManagement />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/prompts" element={<PromptEditor />} />
        </Routes>
      </main>
    </div>
  )
}
