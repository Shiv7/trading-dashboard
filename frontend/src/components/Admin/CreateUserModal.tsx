import { useEffect, useState } from 'react'
import { adminApi } from '../../services/api'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (username: string) => void
}

export default function CreateUserModal({ open, onClose, onCreated }: Props) {
  const [pages, setPages] = useState<Array<{ key: string; label: string }>>([])
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'TRADER' | 'VIEWER'>('TRADER')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    adminApi.getSidebarPages().then(setPages).catch(() => setError('Failed to load pages'))
  }, [open])

  useEffect(() => {
    if (!open) {
      setUsername(''); setEmail(''); setDisplayName(''); setPassword('')
      setRole('TRADER'); setSelected(new Set()); setError(null)
    }
  }, [open])

  if (!open) return null

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const selectAll = () => setSelected(new Set(pages.map(p => p.key)))
  const clearAll = () => setSelected(new Set())

  const submit = async () => {
    setError(null)
    if (!username.trim() || !email.trim() || password.length < 6) {
      setError('Username, email, and password (6+ chars) are required')
      return
    }
    setSaving(true)
    try {
      await adminApi.createUser({
        username: username.trim(),
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
        role,
        allowedPages: Array.from(selected),
      })
      onCreated(username.trim())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Create New User</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Username *</label>
              <input value={username} onChange={e => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Display Name</label>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Role</label>
              <select value={role} onChange={e => setRole(e.target.value as 'TRADER' | 'VIEWER')}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none">
                <option value="TRADER">Trader</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Password * (min 6 chars)</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400">Page Permissions</label>
              <div className="flex gap-2">
                <button type="button" onClick={selectAll}
                  className="px-2 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600">Select all</button>
                <button type="button" onClick={clearAll}
                  className="px-2 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600">Clear</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto border border-slate-700 rounded-lg p-2">
              {pages.map(p => (
                <label key={p.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800/50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)}
                    className="w-4 h-4 accent-amber-500" />
                  <span className="text-white text-sm">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <footer className="px-6 py-4 border-t border-slate-700 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 bg-amber-500 text-slate-900 font-medium rounded hover:bg-amber-400 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create User'}
          </button>
        </footer>
      </div>
    </div>
  )
}
