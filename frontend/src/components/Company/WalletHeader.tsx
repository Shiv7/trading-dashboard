import { useDashboardStore } from '../../store/dashboardStore'
import type { Wallet } from '../../types'

interface WalletHeaderProps {
    wallet?: Wallet | null
    className?: string
}

export default function WalletHeader({ wallet, className = '' }: WalletHeaderProps) {
    const wsWallet = useDashboardStore((s) => s.wallet)
    const displayWallet = wallet || wsWallet

    const formatCurrency = (amount: number) => {
        if (Math.abs(amount) >= 100000) {
            return `₹${(amount / 100000).toFixed(2)}L`
        } else if (Math.abs(amount) >= 1000) {
            return `₹${(amount / 1000).toFixed(1)}K`
        }
        return `₹${amount.toFixed(0)}`
    }

    return (
        <div className={`flex items-center gap-6 ${className}`}>
            {/* Balance */}
            <div className="text-right">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Balance</div>
                <div className="text-lg font-bold text-white">
                    {displayWallet ? formatCurrency(displayWallet.currentCapital) : '—'}
                </div>
            </div>

            {/* Day P&L */}
            <div className="text-right">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Day P&L</div>
                <div className={`text-lg font-bold ${(displayWallet?.dayPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                    {displayWallet
                        ? `${displayWallet.dayPnl >= 0 ? '+' : ''}${formatCurrency(displayWallet.dayPnl)}`
                        : '—'}
                </div>
            </div>

            {/* Open Positions */}
            <div className="text-right">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Positions</div>
                <div className="text-lg font-bold text-white">
                    {displayWallet?.openPositionsCount ?? 0}
                </div>
            </div>

            {/* Win Rate */}
            {displayWallet && displayWallet.totalTradesCount > 0 && (
                <div className="text-right">
                    <div className="text-xs text-slate-400 uppercase tracking-wide">Win Rate</div>
                    <div className={`text-lg font-bold ${displayWallet.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'
                        }`}>
                        {displayWallet.winRate.toFixed(0)}%
                    </div>
                </div>
            )}
        </div>
    )
}
