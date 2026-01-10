import React from 'react';

interface DayPnLData {
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    largestWin: number;
    largestLoss: number;
    tradesToday: number;
}

interface DayPnLPanelProps {
    data: DayPnLData;
    initialCapital: number;
}

export const DayPnLPanel: React.FC<DayPnLPanelProps> = ({ data, initialCapital }) => {
    const pnlPercent = initialCapital > 0 ? (data.totalPnl / initialCapital) * 100 : 0;
    const isProfit = data.totalPnl >= 0;

    const formatCurrency = (amount: number) => {
        const absAmount = Math.abs(amount);
        if (absAmount >= 10000000) return (amount / 10000000).toFixed(2) + 'Cr';
        if (absAmount >= 100000) return (amount / 100000).toFixed(2) + 'L';
        if (absAmount >= 1000) return (amount / 1000).toFixed(1) + 'K';
        return '₹' + amount.toFixed(0);
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Today's P&L</h3>
                <span className="text-xs text-slate-500">{data.tradesToday} trades</span>
            </div>

            {/* Main P&L Display */}
            <div className={`p-4 rounded-xl mb-4 ${isProfit ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'
                }`}>
                <div className={`text-3xl font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isProfit ? '+' : ''}{formatCurrency(data.totalPnl)}
                </div>
                <div className={`text-lg font-medium ${isProfit ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                    {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
                </div>
            </div>

            {/* P&L Breakdown */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-2 bg-slate-800/50 rounded-lg">
                    <div className="text-[10px] text-slate-500">Realized</div>
                    <div className={`text-sm font-semibold ${data.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {data.realizedPnl >= 0 ? '+' : ''}{formatCurrency(data.realizedPnl)}
                    </div>
                </div>
                <div className="p-2 bg-slate-800/50 rounded-lg">
                    <div className="text-[10px] text-slate-500">Unrealized</div>
                    <div className={`text-sm font-semibold ${data.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {data.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(data.unrealizedPnl)}
                    </div>
                </div>
            </div>

            {/* Win/Loss Stats */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="text-center p-2 bg-slate-800/50 rounded-lg">
                    <div className="text-[10px] text-slate-500">Win Rate</div>
                    <div className={`text-lg font-bold ${data.winRate >= 60 ? 'text-emerald-400' : data.winRate >= 40 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                        {data.winRate.toFixed(0)}%
                    </div>
                </div>
                <div className="text-center p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <div className="text-[10px] text-emerald-400/70">Wins</div>
                    <div className="text-lg font-bold text-emerald-400">{data.winCount}</div>
                </div>
                <div className="text-center p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                    <div className="text-[10px] text-red-400/70">Losses</div>
                    <div className="text-lg font-bold text-red-400">{data.lossCount}</div>
                </div>
            </div>

            {/* Win/Loss Bar */}
            <div className="h-3 bg-slate-700 rounded-full overflow-hidden flex mb-4">
                <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${data.winRate}%` }}
                />
                <div
                    className="h-full bg-red-500"
                    style={{ width: `${100 - data.winRate}%` }}
                />
            </div>

            {/* Avg Win/Loss */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between p-2 bg-slate-800/50 rounded">
                    <span className="text-slate-500">Avg Win:</span>
                    <span className="text-emerald-400">{formatCurrency(data.avgWin)}</span>
                </div>
                <div className="flex justify-between p-2 bg-slate-800/50 rounded">
                    <span className="text-slate-500">Avg Loss:</span>
                    <span className="text-red-400">{formatCurrency(data.avgLoss)}</span>
                </div>
                <div className="flex justify-between p-2 bg-slate-800/50 rounded">
                    <span className="text-slate-500">Best:</span>
                    <span className="text-emerald-400">{formatCurrency(data.largestWin)}</span>
                </div>
                <div className="flex justify-between p-2 bg-slate-800/50 rounded">
                    <span className="text-slate-500">Worst:</span>
                    <span className="text-red-400">{formatCurrency(data.largestLoss)}</span>
                </div>
            </div>
        </div>
    );
};

export default DayPnLPanel;
