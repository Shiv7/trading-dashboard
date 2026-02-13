
interface WalletSelectorProps {
  value: 'PAPER' | 'REAL'
  onChange: (walletType: 'PAPER' | 'REAL') => void
  compact?: boolean
}

export default function WalletSelector({ value, onChange, compact = false }: WalletSelectorProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
        <button
          onClick={() => onChange('PAPER')}
          className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
            value === 'PAPER'
              ? 'bg-blue-500 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Paper
        </button>
        <button
          onClick={() => onChange('REAL')}
          className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
            value === 'REAL'
              ? 'bg-amber-500 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Real
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange('PAPER')}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all ${
          value === 'PAPER'
            ? 'bg-blue-500/20 border-2 border-blue-500 text-blue-400'
            : 'bg-slate-800 border-2 border-slate-700 text-slate-400 hover:border-slate-600'
        }`}
      >
        <div className={`w-2.5 h-2.5 rounded-full ${value === 'PAPER' ? 'bg-blue-400' : 'bg-slate-600'}`} />
        Paper Trading
      </button>
      <button
        onClick={() => onChange('REAL')}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all ${
          value === 'REAL'
            ? 'bg-amber-500/20 border-2 border-amber-500 text-amber-400'
            : 'bg-slate-800 border-2 border-slate-700 text-slate-400 hover:border-slate-600'
        }`}
      >
        <div className={`w-2.5 h-2.5 rounded-full ${value === 'REAL' ? 'bg-amber-400' : 'bg-slate-600'}`} />
        Real Trading
      </button>
    </div>
  )
}
