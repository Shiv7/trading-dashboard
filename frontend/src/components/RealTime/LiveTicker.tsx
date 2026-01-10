import React from 'react';

interface LiveTickerProps {
    lastRate: number;
    previousClose: number;
    bidQty: number;
    bidRate: number;
    offQty: number;
    offRate: number;
    volume: number;
    high: number;
    low: number;
    companyName?: string;
}

export const LiveTicker: React.FC<LiveTickerProps> = ({
    lastRate,
    previousClose,
    bidQty,
    bidRate,
    offQty,
    offRate,
    volume,
    high,
    low,
    companyName
}) => {
    const change = lastRate - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
    const isPositive = change >= 0;
    const spread = offRate - bidRate;
    const spreadPercent = bidRate > 0 ? (spread / bidRate) * 100 : 0;

    const formatNumber = (n: number, decimals = 2) => {
        if (n >= 10000000) return (n / 10000000).toFixed(2) + 'Cr';
        if (n >= 100000) return (n / 100000).toFixed(2) + 'L';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toFixed(decimals);
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Live Feed</span>
                </div>
                {companyName && (
                    <span className="text-xs text-slate-500">{companyName}</span>
                )}
            </div>

            {/* Main Price */}
            <div className="flex items-baseline gap-3 mb-4">
                <span className="text-3xl font-bold text-white">
                    ₹{lastRate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${isPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                    <span className="text-sm font-semibold">
                        {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                    </span>
                    <span className={`text-lg ${isPositive ? 'rotate-0' : 'rotate-180'}`}>
                        ▲
                    </span>
                </div>
            </div>

            {/* Bid/Ask */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
                    <div className="text-xs text-emerald-400/70 mb-1">Bid</div>
                    <div className="flex items-baseline justify-between">
                        <span className="text-lg font-semibold text-emerald-400">₹{bidRate.toFixed(2)}</span>
                        <span className="text-sm text-emerald-400/70">×{formatNumber(bidQty, 0)}</span>
                    </div>
                </div>
                <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                    <div className="text-xs text-red-400/70 mb-1">Ask</div>
                    <div className="flex items-baseline justify-between">
                        <span className="text-lg font-semibold text-red-400">₹{offRate.toFixed(2)}</span>
                        <span className="text-sm text-red-400/70">×{formatNumber(offQty, 0)}</span>
                    </div>
                </div>
            </div>

            {/* Spread & Stats */}
            <div className="flex items-center justify-between text-xs border-t border-slate-700/50 pt-3">
                <div className="flex items-center gap-4">
                    <div>
                        <span className="text-slate-500">Spread:</span>
                        <span className="text-slate-300 ml-1">₹{spread.toFixed(2)} ({spreadPercent.toFixed(3)}%)</span>
                    </div>
                    <div>
                        <span className="text-slate-500">Vol:</span>
                        <span className="text-slate-300 ml-1">{formatNumber(volume, 0)}</span>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-slate-400">
                    <span>H: ₹{high.toFixed(2)}</span>
                    <span>L: ₹{low.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
};

export default LiveTicker;
