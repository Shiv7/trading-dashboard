import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hotStocksApi } from '../services/api';
import type { StockMetrics } from '../types/hotstocks';

export function HotStocksDetailPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const [data, setData] = useState<StockMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    hotStocksApi.single(symbol).then(setData).catch((e: Error) => setErr(e.message));
  }, [symbol]);

  if (err) {
    return (
      <div className="p-6 text-red-400 text-sm">
        <div className="mb-2">
          <Link to="/hot-stocks" className="text-slate-500 hover:text-slate-300">← Hot Stocks</Link>
        </div>
        Failed to load {symbol}: {err}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <div className="mb-2 text-slate-500 text-sm">
          <Link to="/hot-stocks" className="hover:text-slate-300">← Hot Stocks</Link>
        </div>
        <div className="text-slate-400">Loading {symbol}…</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="text-sm text-slate-500 mb-2">
        <Link to="/hot-stocks" className="hover:text-slate-300">← Hot Stocks</Link>
      </div>
      <h1 className="text-3xl font-semibold text-slate-100">{data.symbol}</h1>
      <div className="text-sm text-slate-400 mb-4">
        {data.sector} · ₹{data.ltpYesterday.toFixed(2)} · {data.trendState} · {data.priceRegime}
      </div>

      <div className="bg-slate-900/60 border border-amber-500/40 rounded-lg p-4 my-4">
        <div className="text-xs text-amber-400 mb-1">SMART TRADER THESIS</div>
        <div className="text-slate-200">{data.thesisText}</div>
      </div>

      <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-4 my-4">
        <div className="text-xs text-amber-400 mb-1">ACTION CUE</div>
        <div className="text-slate-200 font-mono">{data.actionCueText}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
        <StatCard label="1D" value={`${data.change1dPct >= 0 ? '+' : ''}${data.change1dPct.toFixed(2)}%`} />
        <StatCard label="5D" value={`${data.change5dPct >= 0 ? '+' : ''}${data.change5dPct.toFixed(2)}%`} />
        <StatCard label="20D" value={`${data.change20dPct >= 0 ? '+' : ''}${data.change20dPct.toFixed(2)}%`} />
        <StatCard label="vs Sector" value={`${data.vsSectorIndexPct >= 0 ? '+' : ''}${data.vsSectorIndexPct.toFixed(2)}% (${data.vsSectorLabel})`} />
        <StatCard label="vs Nifty" value={`${data.vsNifty50Pct >= 0 ? '+' : ''}${data.vsNifty50Pct.toFixed(2)}% (${data.vsNiftyLabel})`} />
        <StatCard label="52W Pos" value={data.weekly52PositionPct !== null ? `${data.weekly52PositionPct.toFixed(0)}%` : 'DM'} />
        <StatCard label="Delivery" value={`${data.deliveryPctLatest.toFixed(1)}%`} />
        <StatCard label="RSI(14)" value={data.rsi14 !== null ? data.rsi14.toFixed(1) : 'DM'} />
        <StatCard label="Liquidity" value={data.liquidityTier} />
      </div>

      <div className="mt-6 text-xs text-slate-500 italic">
        Full detail page (deal timeline, price chart, delivery trend bar, sector peers, strategies watching panel, raw data audit tables)
        ships in Phase 1b.
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-700/40 rounded px-3 py-2">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-slate-100 font-mono text-sm mt-0.5">{value}</div>
    </div>
  );
}
