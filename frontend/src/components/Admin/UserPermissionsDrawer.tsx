import { useEffect, useState } from 'react';
import { adminApi, type UserProfile } from '../../services/api';

interface Props {
  user: UserProfile | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function UserPermissionsDrawer({ user, onClose, onSaved }: Props) {
  const [pages, setPages] = useState<Array<{ key: string; label: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    Promise.all([adminApi.getSidebarPages(), adminApi.getUserPermissions(user.id)])
      .then(([list, perms]) => {
        setPages(list);
        setSelected(new Set(perms.allowedPages || []));
      })
      .catch(() => setError('Failed to load permissions'))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(pages.map(p => p.key)));
  const clearAll = () => setSelected(new Set());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.updateUserPermissions(user.id, Array.from(selected));
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col">
        <header className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Page Permissions</h2>
            <p className="text-xs text-slate-400">{user.displayName || user.username}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        {isAdmin && (
          <div className="mx-6 mt-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
            Admins have access to all pages. Editing is disabled.
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : (
            <>
              <div className="flex gap-2 mb-3">
                <button disabled={isAdmin} onClick={selectAll}
                  className="px-3 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 disabled:opacity-40">
                  Select all
                </button>
                <button disabled={isAdmin} onClick={clearAll}
                  className="px-3 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 disabled:opacity-40">
                  Clear all
                </button>
              </div>
              {pages.map(p => (
                <label key={p.key} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-800/50 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isAdmin}
                    checked={selected.has(p.key)}
                    onChange={() => toggle(p.key)}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="text-white text-sm">{p.label}</span>
                  <span className="text-slate-500 text-xs ml-auto">{p.key}</span>
                </label>
              ))}
            </>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <footer className="px-6 py-4 border-t border-slate-700 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600">
            Cancel
          </button>
          <button onClick={save} disabled={saving || isAdmin}
            className="px-4 py-2 bg-amber-500 text-slate-900 font-medium rounded hover:bg-amber-400 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </aside>
    </div>
  );
}
