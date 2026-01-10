import React from 'react';

interface InstrumentData {
    scripCode: string;
    type: 'EQUITY' | 'FUTURE' | 'CALL' | 'PUT';
    symbol: string;
    lastPrice: number;
    change: number;
    changePercent: number;
    volume: number;
    oi?: number;
    oiChange?: number;
    strikePrice?: number;
    expiry?: string;
}

interface FamilyInstrumentsPanelProps {
    familyId: string;
    equity?: InstrumentData;
    future?: InstrumentData;
    options: InstrumentData[];
    spotFuturePremium?: number;
    pcr?: number;
}

export const FamilyInstrumentsPanel: React.FC<FamilyInstrumentsPanelProps> = ({
    familyId,
    equity,
    future,
    options,
    spotFuturePremium,
    pcr
}) => {
    const calls = options.filter(o => o.type === 'CALL').slice(0, 4);
    const puts = options.filter(o => o.type === 'PUT').slice(0, 4);

    const formatNumber = (n: number) => {
        if (Math.abs(n) >= 10000000) return (n / 10000000).toFixed(2) + 'Cr';
        if (Math.abs(n) >= 100000) return (n / 100000).toFixed(1) + 'L';
        if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toFixed(0);
    };

    const InstrumentRow: React.FC<{ data: InstrumentData; highlight?: boolean }> = ({ data, highlight }) => (
        <div className={`flex items-center justify-between p-2 rounded-lg ${highlight ? 'bg-slate-700/50' : 'hover:bg-slate-800/50'
            } transition-colors`}>
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${data.type === 'EQUITY' ? 'bg-blue-400' :
                        data.type === 'FUTURE' ? 'bg-purple-400' :
                            data.type === 'CALL' ? 'bg-amber-400' : 'bg-pink-400'
                    }`} />
                <div>
                    <span className="text-sm text-white font-medium">
                        {data.strikePrice ? `₹${data.strikePrice}` : data.symbol}
                    </span>
                    <span className="text-xs text-slate-500 ml-1">{data.type}</span>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <div className="text-right">
                    <div className="text-sm text-white">₹{data.lastPrice.toFixed(2)}</div>
                    <div className={`text-xs ${data.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {data.changePercent >= 0 ? '+' : ''}{data.changePercent.toFixed(2)}%
                    </div>
                </div>
                {data.oi !== undefined && (
                    <div className="text-right w-16">
                        <div className="text-xs text-slate-400">OI</div>
                        <div className={`text-xs ${(data.oiChange ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                            {formatNumber(data.oi)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-sm font-semibold text-white">Family View</h3>
                    <span className="text-xs text-slate-500">{familyId}</span>
                </div>
                <div className="flex items-center gap-3">
                    {spotFuturePremium !== undefined && (
                        <div className="text-xs">
                            <span className="text-slate-500">Premium:</span>
                            <span className={`ml-1 font-medium ${spotFuturePremium > 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}>
                                {spotFuturePremium > 0 ? '+' : ''}{spotFuturePremium.toFixed(2)}%
                            </span>
                        </div>
                    )}
                    {pcr !== undefined && (
                        <div className="text-xs">
                            <span className="text-slate-500">PCR:</span>
                            <span className={`ml-1 font-medium ${pcr < 0.7 ? 'text-emerald-400' : pcr > 1.3 ? 'text-red-400' : 'text-slate-300'
                                }`}>
                                {pcr.toFixed(2)}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Instruments Grid */}
            <div className="grid grid-cols-3 gap-3">
                {/* Equity & Future */}
                <div className="space-y-2">
                    <div className="text-[10px] text-slate-500 uppercase font-medium px-2">Cash & Futures</div>
                    {equity && <InstrumentRow data={equity} highlight />}
                    {future && <InstrumentRow data={future} />}
                </div>

                {/* Calls */}
                <div className="space-y-2">
                    <div className="text-[10px] text-amber-400/70 uppercase font-medium px-2">Calls (CE)</div>
                    {calls.map((call, idx) => (
                        <InstrumentRow key={idx} data={call} />
                    ))}
                </div>

                {/* Puts */}
                <div className="space-y-2">
                    <div className="text-[10px] text-pink-400/70 uppercase font-medium px-2">Puts (PE)</div>
                    {puts.map((put, idx) => (
                        <InstrumentRow key={idx} data={put} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FamilyInstrumentsPanel;
