import { useEffect, useState } from 'react'

// Week 1: prove the SPA can reach the backend. The full role-based shell
// (login, nav, per-role screens) is Week 2 per docs/roadmap.md.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

interface Health {
  status: string
  service: string
  version: string
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-3xl font-bold">Hospital Management System</h1>
      <p className="text-slate-600">Week 1 scaffold — backend connectivity check:</p>

      {health && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-center">
          <p className="font-mono text-lg text-emerald-700">
            {health.service} v{health.version} — {health.status}
          </p>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-center">
          <p className="text-red-700">API unreachable: {error}</p>
          <p className="mt-1 text-sm text-red-500">
            Is the backend running? <code>uvicorn app.main:app --reload</code>
          </p>
        </div>
      )}
    </main>
  )
}