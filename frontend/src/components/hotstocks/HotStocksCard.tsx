import { Link } from 'react-router-dom';
import type { StockMetrics } from '../../types/hotstocks';

interface Props { metrics: StockMetrics }

/**
 * Compact positional-trade card for a single F&O stock.
 * Renders header → smart-trader thesis → 3-column icon grid → action cue.
 */
export function HotStocksCard({ metrics: m }: Props) {
  const priceColor = m.change1dPct >= 0 ? 'text-emerald-400' : 'text-red-400';
  const arrow = m.change1dPct >= 0 ? '↑' : '↓';
  const showUrgency = m.daysToNearestEvent !== null && m.daysToNearestEvent !== undefined && m.daysToNearestEvent <= 5;

  return (
    <Link to={`/research/${encodeURIComponent(m.symbol)}`} className="block">
      <div className="bg-slate-900/80 border border-slate-700/60 rounded-lg p-4 hover:border-amber-500/60 transition-colors">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-slate-100">{m.symbol}</span>
              {m.fnoEligible && (
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">F&amp;O</span>
              )}
              {showUrgency && (
                <span className="text-[10px] text-amber-400">⚡{m.daysToNearestEvent}d</span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              {m.sector} · {m.vsSectorLabel === 'LEADING' ? 'Leader' : m.vsSectorLabel === 'LAGGING' ? 'Laggard' : 'Inline'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-100 font-mono">₹{m.ltpYesterday.toFixed(2)}</div>
            <div className={`text-xs font-mono ${priceColor}`}>
              {arrow}{Math.abs(m.change1dPct).toFixed(1)}% · 5D {m.change5dPct >= 0 ? '+' : ''}{m.change5dPct.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Thesis */}
        <div className="border-l-2 border-amber-500/60 pl-3 my-3 text-xs text-slate-300 leading-relaxed min-h-[3em]">
          {m.thesisText}
        </div>

        {/* Icon grid — 3 columns */}
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-[11px] font-mono text-slate-300 my-2">
          {m.smartBuyCr > 0 && (
            <span>🏛 +{m.smartBuyCr.toFixed(0)}Cr·{m.dealDays}d</span>
          )}
          {m.deliveryPctLatest > 0 && (
            <span>📦 {m.deliveryPctLatest.toFixed(0)}%{m.deliveryTrend === 'RISING' ? '↑' : m.deliveryTrend === 'FALLING' ? '↓' : '·'}</span>
          )}
          {m.vsSectorIndexPct !== 0 && (
            <span>📈 {m.vsSectorIndexPct >= 0 ? '+' : ''}{m.vsSectorIndexPct.toFixed(1)}%</span>
          )}
          {m.volumeRatio5d20d > 0 && (
            <span>🔥 {m.volumeRatio5d20d.toFixed(1)}× Vol</span>
          )}
          <span>🎯 {m.priceRegime.replace('_TREND', '').replace('RANGE_BOUND', 'RANGE')}</span>
          {m.oiInterpretation && (
            <span>⚙ {m.oiInterpretation.replace(/_/g, ' ')}</span>
          )}
          {m.strategiesWatching && m.strategiesWatching.length > 0 && (
            <span>👁 {m.strategiesWatching.slice(0, 2).map((s) => s.strategyName).join('+')}</span>
          )}
          {m.nextCorporateActionLabel && (
            <span>⚡ {m.nextCorporateActionLabel}</span>
          )}
          <span>💧 {m.liquidityTier}</span>
        </div>

        {/* Action cue */}
        <div className="mt-3 pt-2 border-t border-slate-700/50">
          <div className="text-xs font-mono text-amber-200">{m.actionCueText}</div>
        </div>

        <div className="mt-2 text-[10px] text-slate-500 text-right">tap to open →</div>
      </div>
    </Link>
  );
}
