import React from 'react';

interface DepthLevel {
    price: number;
    quantity: number;
    numberOfOrders: number;
}

interface OrderbookLadderProps {
    bids: DepthLevel[];
    asks: DepthLevel[];
    lastPrice: number;
    totalBidQty?: number;
    totalAskQty?: number;
}

export const OrderbookLadder: React.FC<OrderbookLadderProps> = ({
    bids,
    asks,
    lastPrice,
    totalBidQty = 0,
    totalAskQty = 0
}) => {
    // Calculate max quantity for bar scaling
    const maxBidQty = Math.max(...bids.map(b => b.quantity), 1);
    const maxAskQty = Math.max(...asks.map(a => a.quantity), 1);
    const maxQty = Math.max(maxBidQty, maxAskQty);

    // Total imbalance
    const totalImbalance = totalBidQty + totalAskQty > 0
        ? ((totalBidQty - totalAskQty) / (totalBidQty + totalAskQty)) * 100
        : 0;

    const formatQty = (qty: number) => {
        if (qty >= 100000) return (qty / 100000).toFixed(1) + 'L';
        if (qty >= 1000) return (qty / 1000).toFixed(1) + 'K';
        return qty.toString();
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 border border-slate-700/50">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Order Book</h3>
                <div className={`px-2 py-1 rounded text-xs font-medium ${totalImbalance > 10 ? 'bg-emerald-500/20 text-emerald-400' :
                        totalImbalance < -10 ? 'bg-red-500/20 text-red-400' :
                            'bg-slate-700 text-slate-400'
                    }`}>
                    {totalImbalance > 0 ? '+' : ''}{totalImbalance.toFixed(1)}% Imbalance
                </div>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-4 gap-1 text-xs text-slate-500 mb-2 px-1">
                <span>Qty</span>
                <span className="text-right">Price</span>
                <span className="text-right">Price</span>
                <span className="text-right">Qty</span>
            </div>

            {/* Orderbook Levels */}
            <div className="space-y-0.5">
                {/* Asks (top, reversed so lowest ask is at bottom near spread) */}
                {asks.slice(0, 10).reverse().map((ask, i) => (
                    <div key={`ask-${i}`} className="relative grid grid-cols-4 gap-1 text-xs py-1 px-1 hover:bg-slate-700/30 rounded">
                        <div className="col-span-2" />
                        <span className="text-right text-red-400 font-mono">
                            {ask.price.toFixed(2)}
                        </span>
                        <div className="relative flex items-center justify-end">
                            <div
                                className="absolute right-0 h-full bg-red-500/20 rounded-sm"
                                style={{ width: `${(ask.quantity / maxQty) * 100}%` }}
                            />
                            <span className="relative text-red-400 font-mono">
                                {formatQty(ask.quantity)}
                                {ask.numberOfOrders > 1 && (
                                    <span className="text-red-400/50 ml-1">({ask.numberOfOrders})</span>
                                )}
                            </span>
                        </div>
                    </div>
                ))}

                {/* Spread Indicator */}
                <div className="flex items-center justify-center py-2 border-y border-slate-700/50 my-1">
                    <span className="text-lg font-bold text-white">₹{lastPrice.toFixed(2)}</span>
                </div>

                {/* Bids */}
                {bids.slice(0, 10).map((bid, i) => (
                    <div key={`bid-${i}`} className="relative grid grid-cols-4 gap-1 text-xs py-1 px-1 hover:bg-slate-700/30 rounded">
                        <div className="relative flex items-center">
                            <div
                                className="absolute left-0 h-full bg-emerald-500/20 rounded-sm"
                                style={{ width: `${(bid.quantity / maxQty) * 100}%` }}
                            />
                            <span className="relative text-emerald-400 font-mono">
                                {formatQty(bid.quantity)}
                                {bid.numberOfOrders > 1 && (
                                    <span className="text-emerald-400/50 ml-1">({bid.numberOfOrders})</span>
                                )}
                            </span>
                        </div>
                        <span className="text-right text-emerald-400 font-mono">
                            {bid.price.toFixed(2)}
                        </span>
                        <div className="col-span-2" />
                    </div>
                ))}
            </div>

            {/* Footer Totals */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700/50 text-xs">
                <div className="flex items-center gap-2">
                    <span className="text-emerald-400">▲ {formatQty(totalBidQty)}</span>
                    <span className="text-slate-500">Total Bid</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-slate-500">Total Ask</span>
                    <span className="text-red-400">{formatQty(totalAskQty)} ▼</span>
                </div>
            </div>
        </div>
    );
};

export default OrderbookLadder;
