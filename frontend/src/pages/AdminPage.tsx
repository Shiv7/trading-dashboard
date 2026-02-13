import { useState, useEffect } from 'react'
import { adminApi, type UserProfile } from '../services/api'

export default function AdminPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [totalElements, setTotalElements] = useState(0)
  const [page, setPage] = useState(0)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadUsers = async () => {
    setLoading(true)
    try {
      const data = await adminApi.getUsers(page, 20)
      setUsers(data.content)
      setTotalElements(data.totalElements)
    } catch {
      setMessage({ type: 'error', text: 'Failed to load users' })
    }
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [page])

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await adminApi.updateUserRole(userId, role)
      loadUsers()
      showMessage('success', 'Role updated')
    } catch {
      showMessage('error', 'Failed to update role')
    }
  }

  const handleToggleEnabled = async (userId: string, enabled: boolean) => {
    try {
      await adminApi.toggleUserEnabled(userId, enabled)
      loadUsers()
      showMessage('success', enabled ? 'User enabled' : 'User disabled')
    } catch {
      showMessage('error', 'Failed to update user')
    }
  }

  const handleDelete = async (userId: string, username: string) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    try {
      await adminApi.deleteUser(userId)
      loadUsers()
      showMessage('success', 'User deleted')
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-white">User Management</h1>
          <p className="text-slate-400 text-sm mt-1">{totalElements} registered users</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${
          message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' :
          'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>{message.text}</div>
      )}

      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left px-6 py-4 text-sm font-medium text-slate-400">User</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-slate-400">Role</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-slate-400">Status</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-slate-400">Joined</th>
              <th className="text-right px-6 py-4 text-sm font-medium text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-slate-700/50">
                  <td colSpan={5} className="px-6 py-4">
                    <div className="h-10 bg-slate-700/30 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-sm font-bold text-slate-900">
                      {u.displayName?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div>
                      <p className="text-white font-medium">{u.displayName || u.username}</p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="VIEWER">Viewer</option>
                    <option value="TRADER">Trader</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </td>
                <td className="px-6 py-4">
                  <button onClick={() => handleToggleEnabled(u.id, !u.enabled)}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      u.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                    {u.enabled ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td className="px-6 py-4 text-sm text-slate-400">
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 text-right">
                  {u.role !== 'ADMIN' && (
                    <button onClick={() => handleDelete(u.id, u.username)}
                      className="text-red-400 hover:text-red-300 text-sm transition-colors">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {totalElements > 20 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700">
            <p className="text-sm text-slate-400">Page {page + 1} of {Math.ceil(totalElements / 20)}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm disabled:opacity-50 hover:bg-slate-600 transition-colors">
                Previous
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * 20 >= totalElements}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm disabled:opacity-50 hover:bg-slate-600 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
