import React from 'react';

interface OIData {
    scripType: 'CE' | 'PE' | 'FUT';
    strikePrice?: number;
    openInterest: number;
    oiChange: number;
    oiChangePercent: number;
    lastRate: number;
}

interface OITrackerProps {
    futureOI?: OIData;
    callOI: OIData[];
    putOI: OIData[];
    spotPrice: number;
    pcr?: number;
    maxPain?: number;
}

export const OITracker: React.FC<OITrackerProps> = ({
    futureOI,
    callOI,
    putOI,
    spotPrice,
    pcr,
    maxPain
}) => {
    // Calculate totals
    const totalCallOI = callOI.reduce((sum, c) => sum + c.openInterest, 0);
    const totalPutOI = putOI.reduce((sum, p) => sum + p.openInterest, 0);
    const totalCallChange = callOI.reduce((sum, c) => sum + c.oiChange, 0);
    const totalPutChange = putOI.reduce((sum, p) => sum + p.oiChange, 0);

    const formatOI = (oi: number) => {
        if (oi >= 10000000) return (oi / 10000000).toFixed(2) + 'Cr';
        if (oi >= 100000) return (oi / 100000).toFixed(1) + 'L';
        if (oi >= 1000) return (oi / 1000).toFixed(0) + 'K';
        return oi.toString();
    };

    const getOIInterpretation = (data: OIData, type: 'CE' | 'PE' | 'FUT') => {
        const priceUp = data.lastRate > 0;
        const oiUp = data.oiChange > 0;

        if (type === 'FUT') {
            if (priceUp && oiUp) return { label: 'LONG BUILD', color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
            if (priceUp && !oiUp) return { label: 'SHORT COVER', color: 'text-emerald-400/70', bg: 'bg-emerald-500/10' };
            if (!priceUp && oiUp) return { label: 'SHORT BUILD', color: 'text-red-400', bg: 'bg-red-500/20' };
            return { label: 'LONG UNWIND', color: 'text-red-400/70', bg: 'bg-red-500/10' };
        }

        if (type === 'CE') {
            if (oiUp) return { label: 'ACCUMULATE', color: 'text-amber-400', bg: 'bg-amber-500/20' };
            return { label: 'UNWINDING', color: 'text-slate-400', bg: 'bg-slate-500/20' };
        }

        // PE
        if (oiUp) return { label: 'ACCUMULATE', color: 'text-purple-400', bg: 'bg-purple-500/20' };
        return { label: 'UNWINDING', color: 'text-slate-400', bg: 'bg-slate-500/20' };
    };

    const pcrSignal = pcr !== undefined ? (
        pcr < 0.7 ? { label: 'Bullish', color: 'text-emerald-400' } :
            pcr > 1.3 ? { label: 'Bearish', color: 'text-red-400' } :
                { label: 'Neutral', color: 'text-slate-400' }
    ) : null;

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Open Interest</h3>
                {pcr !== undefined && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">PCR:</span>
                        <span className={`text-sm font-semibold ${pcrSignal?.color}`}>
                            {pcr.toFixed(2)} ({pcrSignal?.label})
                        </span>
                    </div>
                )}
            </div>

            {/* Grid: Future | Calls | Puts */}
            <div className="grid grid-cols-3 gap-3 mb-4">
                {/* Future */}
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
                    <div className="text-xs text-slate-500 mb-2">FUTURE</div>
                    {futureOI ? (
                        <>
                            <div className="text-lg font-bold text-white mb-1">
                                {formatOI(futureOI.openInterest)}
                            </div>
                            <div className={`text-sm font-medium ${futureOI.oiChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {futureOI.oiChange >= 0 ? '+' : ''}{futureOI.oiChangePercent.toFixed(1)}%
                            </div>
                            <div className={`mt-2 px-2 py-1 rounded text-xs font-medium ${getOIInterpretation(futureOI, 'FUT').bg} ${getOIInterpretation(futureOI, 'FUT').color}`}>
                                {getOIInterpretation(futureOI, 'FUT').label}
                            </div>
                        </>
                    ) : (
                        <div className="text-slate-500 text-sm">N/A</div>
                    )}
                </div>

                {/* Calls */}
                <div className="bg-amber-500/5 rounded-lg p-3 border border-amber-500/20">
                    <div className="text-xs text-amber-400/70 mb-2">CALLS (CE)</div>
                    <div className="text-lg font-bold text-amber-400 mb-1">
                        {formatOI(totalCallOI)}
                    </div>
                    <div className={`text-sm font-medium ${totalCallChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {totalCallChange >= 0 ? '+' : ''}{formatOI(totalCallChange)}
                    </div>
                </div>

                {/* Puts */}
                <div className="bg-purple-500/5 rounded-lg p-3 border border-purple-500/20">
                    <div className="text-xs text-purple-400/70 mb-2">PUTS (PE)</div>
                    <div className="text-lg font-bold text-purple-400 mb-1">
                        {formatOI(totalPutOI)}
                    </div>
                    <div className={`text-sm font-medium ${totalPutChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {totalPutChange >= 0 ? '+' : ''}{formatOI(totalPutChange)}
                    </div>
                </div>
            </div>

            {/* Max Pain */}
            {maxPain && (
                <div className="flex items-center justify-between py-2 px-3 bg-slate-800/50 rounded-lg border border-slate-700/30">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Max Pain:</span>
                        <span className="text-sm font-semibold text-white">₹{maxPain.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                        {((maxPain - spotPrice) / spotPrice * 100).toFixed(1)}% from spot
                    </div>
                </div>
            )}
        </div>
    );
};

export default OITracker;
