import { useDashboardStore } from '../../store/dashboardStore'

interface TradingModeToggleProps {
    className?: string
}

export default function TradingModeToggle({ className = '' }: TradingModeToggleProps) {
    const { tradingMode, setTradingMode } = useDashboardStore()

    return (
        <div className={`flex items-center gap-1 bg-slate-800 rounded-full p-1 ${className}`}>
            <button
                onClick={() => setTradingMode('DEMO')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200
          ${tradingMode === 'DEMO'
                        ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
            >
                DEMO
            </button>
            <button
                onClick={() => setTradingMode('LIVE')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200
          ${tradingMode === 'LIVE'
                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
            >
                LIVE
            </button>
        </div>
    )
}
