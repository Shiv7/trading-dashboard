import React, { useState, useEffect } from 'react'
import { fetchJson, putJson } from '../../services/api'

interface TradeEntry {
  id: string
  tradeId: string
  scripCode: string
  companyName: string
  side: string
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  pnlPercent: number
  rMultiple: number
  exitReason: string
  entryTime: string
  exitTime: string
  durationMinutes: number
  strategy: string
  notes: string
  tags: string[]
  status: string
}

interface WalletJournalTabProps {
  walletType: 'PAPER' | 'REAL'
}

export default function WalletJournalTab({ walletType }: WalletJournalTabProps) {
  const [journal, setJournal] = useState<TradeEntry[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')

  useEffect(() => {
    loadJournal()
  }, [walletType, page])

  const loadJournal = async () => {
    setLoading(true)
    try {
      const data = await fetchJson<{ content: TradeEntry[] }>(`/pnl/trade-journal?walletType=${walletType}&page=${page}&size=20`)
      setJournal(data.content || [])
    } catch {
      setJournal([])
    }
    setLoading(false)
  }

  const handleSaveNotes = async (tradeId: string) => {
    try {
      await putJson(`/pnl/trade-journal/${tradeId}/notes`, { notes: notesText })
      setEditingNotes(null)
      loadJournal()
    } catch { /* ignore */ }
  }

  const formatCurrency = (n: number) => {
    n = Number(n) || 0
    const sign = n > 0 ? '+' : n < 0 ? '-' : ''
    const abs = Math.abs(n)
    if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L'
    if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(1) + 'K'
    return sign + '₹' + abs.toFixed(0)
  }

  const formatPct = (n: number) => {
    n = Number(n) || 0
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
  }

  if (loading) {
    return (
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden animate-pulse">
        <div className="px-6 py-4 border-b border-slate-700"><div className="h-6 w-40 bg-slate-700/30 rounded" /></div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="px-6 py-4 border-b border-slate-700/50"><div className="h-8 bg-slate-700/30 rounded" /></div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Trade Journal</h2>
        <span className="text-xs text-slate-500">{journal.length} trades</span>
      </div>

      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
        {journal.length > 0 ? (
          <>
            {/* Mobile Card Layout */}
            <div className="md:hidden divide-y divide-slate-700/50">
              {journal.map(trade => (
                <React.Fragment key={trade.id}>
                  <div
                    onClick={() => setExpandedTrade(expandedTrade === trade.id ? null : trade.id)}
                    className="px-3 py-3 active:bg-slate-700/20 transition-colors cursor-pointer"
                  >
                    {/* Row 1: Stock + P&L */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-white font-medium truncate">{trade.companyName || trade.scripCode}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${
                            trade.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}>{trade.side}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {trade.exitTime ? new Date(trade.exitTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}
                          {trade.exitReason && <span className="ml-2 text-slate-400">{trade.exitReason}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-bold font-mono tabular-nums ${(trade.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatCurrency(trade.pnl ?? 0)}
                        </div>
                        <div className={`text-[10px] font-mono ${(trade.rMultiple || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(trade.rMultiple ?? 0).toFixed(1)}R
                        </div>
                      </div>
                    </div>
                    {/* Row 2: Entry/Exit prices */}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
                      <span>Entry: <span className="text-slate-300 font-mono">{trade.entryPrice?.toFixed(2)}</span></span>
                      <span>Exit: <span className="text-slate-300 font-mono">{trade.exitPrice?.toFixed(2)}</span></span>
                    </div>
                  </div>
                  {expandedTrade === trade.id && (
                    <div className="px-3 py-3 bg-slate-900/50 border-b border-slate-700/50">
                      <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                        <div><span className="text-slate-500">Duration:</span> <span className="text-white">{trade.durationMinutes}m</span></div>
                        <div>
                          <span className="text-slate-500">Strategy:</span>{' '}
                          <span className={`font-medium ${
                            trade.strategy === 'FUDKII' ? 'text-orange-400'
                            : trade.strategy === 'FUKAA' ? 'text-amber-400'
                            : trade.strategy === 'PIVOT' ? 'text-blue-400'
                            : 'text-white'
                          }`}>{trade.strategy}</span>
                        </div>
                        <div><span className="text-slate-500">P&L %:</span> <span className={(trade.pnlPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatPct(trade.pnlPercent ?? 0)}</span></div>
                        <div><span className="text-slate-500">Qty:</span> <span className="text-white">{trade.quantity}</span></div>
                      </div>
                      {trade.tags?.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {trade.tags.map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded text-[10px]">{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2">
                        <label className="text-[10px] text-slate-500 block mb-1">Notes</label>
                        {editingNotes === trade.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={notesText}
                              onChange={e => setNotesText(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500 resize-none"
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <button onClick={() => handleSaveNotes(trade.id)} className="px-3 py-1.5 bg-amber-500 text-slate-900 rounded text-xs font-medium flex-1">Save</button>
                              <button onClick={() => setEditingNotes(null)} className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded text-xs flex-1">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <p
                            onClick={(e) => { e.stopPropagation(); setEditingNotes(trade.id); setNotesText(trade.notes || '') }}
                            className="text-xs text-slate-400 cursor-pointer hover:text-white transition-colors min-h-[24px]"
                          >
                            {trade.notes || 'Tap to add notes...'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Desktop Table Layout */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Stock</th>
                    <th className="text-left px-4 py-3">Side</th>
                    <th className="text-right px-4 py-3">Entry</th>
                    <th className="text-right px-4 py-3">Exit</th>
                    <th className="text-right px-4 py-3">P&L</th>
                    <th className="text-right px-4 py-3">R</th>
                    <th className="text-left px-4 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map(trade => (
                    <React.Fragment key={trade.id}>
                      <tr
                        onClick={() => setExpandedTrade(expandedTrade === trade.id ? null : trade.id)}
                        className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm text-slate-300">
                          {trade.exitTime ? new Date(trade.exitTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-white font-medium">{trade.companyName || trade.scripCode}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            trade.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}>{trade.side}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-slate-300 tabular-nums">{trade.entryPrice?.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-slate-300 tabular-nums">{trade.exitPrice?.toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-mono text-sm font-medium tabular-nums ${(trade.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatCurrency(trade.pnl ?? 0)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${(trade.rMultiple || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(trade.rMultiple ?? 0).toFixed(1)}R
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">{trade.exitReason}</td>
                      </tr>
                      {expandedTrade === trade.id && (
                        <tr key={`${trade.id}-detail`}>
                          <td colSpan={8} className="px-6 py-4 bg-slate-900/50 border-b border-slate-700/50">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                              <div><span className="text-slate-500">Duration:</span> <span className="text-white">{trade.durationMinutes}m</span></div>
                              <div>
                                <span className="text-slate-500">Strategy:</span>{' '}
                                <span className={`font-medium ${
                                  trade.strategy === 'FUDKII' ? 'text-orange-400'
                                  : trade.strategy === 'FUKAA' ? 'text-amber-400'
                                  : trade.strategy === 'PIVOT' ? 'text-blue-400'
                                  : 'text-white'
                                }`}>{trade.strategy}</span>
                              </div>
                              <div><span className="text-slate-500">P&L %:</span> <span className={(trade.pnlPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatPct(trade.pnlPercent ?? 0)}</span></div>
                              <div><span className="text-slate-500">Qty:</span> <span className="text-white">{trade.quantity}</span></div>
                            </div>
                            {trade.tags?.length > 0 && (
                              <div className="flex gap-2 mb-3">
                                {trade.tags.map(tag => (
                                  <span key={tag} className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs">{tag}</span>
                                ))}
                              </div>
                            )}
                            <div className="mt-2">
                              <label className="text-xs text-slate-500 block mb-1">Notes</label>
                              {editingNotes === trade.id ? (
                                <div className="flex gap-2">
                                  <textarea
                                    value={notesText}
                                    onChange={e => setNotesText(e.target.value)}
                                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500 resize-none"
                                    rows={2}
                                  />
                                  <div className="flex flex-col gap-1">
                                    <button onClick={() => handleSaveNotes(trade.id)} className="px-3 py-1 bg-amber-500 text-slate-900 rounded text-xs font-medium">Save</button>
                                    <button onClick={() => setEditingNotes(null)} className="px-3 py-1 bg-slate-700 text-slate-300 rounded text-xs">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <p
                                  onClick={(e) => { e.stopPropagation(); setEditingNotes(trade.id); setNotesText(trade.notes || '') }}
                                  className="text-sm text-slate-400 cursor-pointer hover:text-white transition-colors min-h-[24px]"
                                >
                                  {trade.notes || 'Click to add notes...'}
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-t border-slate-700">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm font-medium bg-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Prev
              </button>
              <span className="text-[10px] sm:text-xs text-slate-500">Page {page + 1}</span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={journal.length < 20}
                className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm font-medium bg-slate-700 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <div className="text-center text-slate-500 py-12 text-sm">No trades recorded yet</div>
        )}
      </div>
    </div>
  )
}
