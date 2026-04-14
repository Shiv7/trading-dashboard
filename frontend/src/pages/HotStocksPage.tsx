import { useEffect, useState } from 'react';
import { hotStocksApi } from '../services/api';
import type { HotStocksListResponse } from '../types/hotstocks';
import { HotStocksCard } from '../components/hotstocks/HotStocksCard';

export function HotStocksPage() {
  const [data, setData] = useState<HotStocksListResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showNonFno, setShowNonFno] = useState(false);

  useEffect(() => {
    hotStocksApi.list()
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-slate-100 mb-4">Hot Stocks</h1>
        <div className="text-red-400 text-sm">Failed to load Hot Stocks: {err}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-slate-100 mb-4">Hot Stocks</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[340px] bg-slate-900/50 border border-slate-700/30 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold text-slate-100">Hot Stocks</h1>
        <div className="text-xs text-slate-500">
          Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN')}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.fno.map((m) => (
          <HotStocksCard key={m.scripCode} metrics={m} />
        ))}
      </div>

      {data.nonFno.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowNonFno((v) => !v)}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {showNonFno ? '▾' : '▸'} Non-F&amp;O Picks ({data.nonFno.length})
          </button>
          {showNonFno && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {data.nonFno.map((m) => (
                <HotStocksCard key={m.scripCode} metrics={m} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
