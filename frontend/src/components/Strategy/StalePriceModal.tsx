import { AlertTriangle, TrendingUp, X } from 'lucide-react';

interface StalePriceModalProps {
  type: 'below-sl' | 'targets-shifted';
  currentLtp: number;
  originalEntry: number;
  originalSl: number;
  originalTargets: { t1: number | null; t2: number | null; t3: number | null; t4: number | null };
  adjustedSl: number;
  adjustedTargets: { t1: number | null; t2: number | null; t3: number | null; t4: number | null };
  levelsShifted: number;
  instrumentName: string;
  onCancel: () => void;
  onProceed: () => void;
}

function fmt(value: number | null): string {
  if (value == null) return '--';
  return `\u20B9${value.toFixed(2)}`;
}

export default function StalePriceModal({
  type,
  currentLtp,
  originalEntry,
  originalSl,
  originalTargets,
  adjustedSl,
  adjustedTargets,
  levelsShifted,
  instrumentName,
  onCancel,
  onProceed,
}: StalePriceModalProps) {
  const isBelowSl = type === 'below-sl';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {isBelowSl ? (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            ) : (
              <TrendingUp className="w-5 h-5 text-blue-400" />
            )}
            <h3 className="text-lg font-semibold text-white">
              {isBelowSl ? 'Price Breached Stop Loss' : 'Price Moved \u2014 Targets Adjusted'}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instrument name */}
        <p className="text-sm text-slate-400 mb-3">{instrumentName}</p>

        {/* Description */}
        {isBelowSl ? (
          <div className="mb-4">
            <p className="text-sm text-amber-300">
              Current LTP {fmt(currentLtp)} has breached the SL {fmt(originalSl)}.
              This trade is already in loss territory.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="bg-slate-700/50 rounded-lg p-3">
                <p className="text-[10px] uppercase text-slate-400 mb-1">Original Entry</p>
                <p className="text-sm font-medium text-white">{fmt(originalEntry)}</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-3">
                <p className="text-[10px] uppercase text-slate-400 mb-1">Current LTP</p>
                <p className="text-sm font-medium text-amber-400">{fmt(currentLtp)}</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-3 col-span-2">
                <p className="text-[10px] uppercase text-slate-400 mb-1">Stop Loss</p>
                <p className="text-sm font-medium text-red-400">{fmt(originalSl)}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-4">
            <p className="text-sm text-blue-300">
              Current LTP {fmt(currentLtp)} has crossed {levelsShifted} target{levelsShifted > 1 ? 's' : ''}.
              Targets have been shifted up.
            </p>

            {/* Before / After comparison */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              {/* Original */}
              <div className="bg-slate-700/50 rounded-lg p-3">
                <p className="text-[10px] uppercase text-slate-400 mb-2 font-semibold">Original</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">SL</span>
                    <span className="text-red-400">{fmt(originalSl)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T1</span>
                    <span className="text-slate-300">{fmt(originalTargets.t1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T2</span>
                    <span className="text-slate-300">{fmt(originalTargets.t2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T3</span>
                    <span className="text-slate-300">{fmt(originalTargets.t3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T4</span>
                    <span className="text-slate-300">{fmt(originalTargets.t4)}</span>
                  </div>
                </div>
              </div>

              {/* Adjusted */}
              <div className="bg-slate-700/50 rounded-lg p-3 border border-blue-500/30">
                <p className="text-[10px] uppercase text-blue-400 mb-2 font-semibold">Adjusted</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">SL</span>
                    <span className="text-red-400">{fmt(adjustedSl)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T1</span>
                    <span className="text-green-400">{fmt(adjustedTargets.t1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T2</span>
                    <span className="text-green-400">{fmt(adjustedTargets.t2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T3</span>
                    <span className="text-green-400">{fmt(adjustedTargets.t3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">T4</span>
                    <span className="text-green-400">{fmt(adjustedTargets.t4)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onProceed}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isBelowSl
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-green-600 hover:bg-green-500 text-white'
            }`}
          >
            {isBelowSl ? 'Proceed Anyway' : 'Execute with Adjusted Targets'}
          </button>
        </div>
      </div>
    </div>
  );
}
