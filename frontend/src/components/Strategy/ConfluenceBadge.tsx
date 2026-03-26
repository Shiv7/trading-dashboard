/**
 * ConfluenceBadge — Displays ConfluentTargetEngine trade quality metadata
 * on signal cards across all strategy tabs.
 *
 * Shows: Grade badge, fortress warning, room ratio, entry quality description
 * with plain English explanations and highlighted keywords.
 */

interface ConfluenceBadgeProps {
  grade?: string
  rejectReason?: string
  fortressScore?: number
  roomRatio?: number
  entryQuality?: string
  slScore?: number
  t1Score?: number
  lotAllocation?: string
  confluenceScore?: number
  hybridRank?: number
  // Confluence-computed equity levels (for comparison with legacy)
  conflSL?: number
  conflT1?: number
  conflT2?: number
  conflT3?: number
  conflT4?: number
  conflRR?: number
  // Option-mapped levels from confluence equity targets
  conflOptSL?: number
  conflOptT1?: number
  conflOptT2?: number
  conflOptT3?: number
  conflOptT4?: number
  conflOptRR?: number
  conflOptSlScore?: number
  conflOptT1Score?: number
  conflOptZoneCount?: number
  zoneCount?: number
  timePhase?: string
}

const GRADE_CONFIG: Record<string, { bg: string; text: string; label: string; meaning: string }> = {
  A: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'A', meaning: 'Excellent setup — strong R:R, no fortress blocking, favorable room' },
  B: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'B', meaning: 'Good setup — acceptable R:R, entry position is clean' },
  C: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'C', meaning: 'Marginal — momentum override allowed entry despite low R:R' },
  F: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'F', meaning: 'Rejected — entry blocked by confluence gates' },
}

export default function ConfluenceBadge({
  grade, rejectReason, fortressScore, roomRatio, entryQuality,
  slScore, t1Score, lotAllocation, zoneCount, timePhase,
  confluenceScore, hybridRank,
  conflSL, conflT1, conflT2, conflT3, conflT4, conflRR,
  conflOptSL, conflOptT1, conflOptT2, conflOptT3, conflOptT4, conflOptRR,
  conflOptSlScore, conflOptT1Score, conflOptZoneCount
}: ConfluenceBadgeProps) {
  if (!grade) return null

  const config = GRADE_CONFIG[grade] || GRADE_CONFIG['C']
  const hasFortress = (fortressScore ?? 0) >= 12
  const roomFavorable = (roomRatio ?? 1) >= 1.5
  const roomUnfavorable = (roomRatio ?? 1) < 0.8

  return (
    <div className="mt-2 space-y-1.5">
      {/* Grade Badge + Scores + One-liner */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded-md text-[11px] font-black ${config.bg} ${config.text}`}>
          {config.label}
        </span>
        {confluenceScore != null && confluenceScore > 0 && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            confluenceScore >= 70 ? 'bg-emerald-500/15 text-emerald-400' :
            confluenceScore >= 45 ? 'bg-blue-500/15 text-blue-400' :
            confluenceScore >= 25 ? 'bg-amber-500/15 text-amber-400' :
            'bg-red-500/15 text-red-400'
          }`}>
            CTS: {confluenceScore.toFixed(0)}/100
          </span>
        )}
        {hybridRank != null && hybridRank > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 text-indigo-400">
            Rank: {hybridRank.toFixed(1)}
          </span>
        )}
        <span className="text-[9px] text-slate-400">{config.meaning}</span>
      </div>

      {/* Rejection Reason (F-grade) */}
      {grade === 'F' && rejectReason && (
        <div className="bg-red-500/10 border border-red-500/20 rounded px-2 py-1 text-[9px] text-red-300">
          <span className="font-bold text-red-400">BLOCKED: </span>
          {highlightKeywords(rejectReason)}
        </div>
      )}

      {/* Fortress Warning */}
      {hasFortress && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1 text-[9px] text-amber-300">
          <span className="font-bold text-amber-400">FORTRESS </span>
          Score <span className="font-bold text-white">{fortressScore?.toFixed(1)}</span> at entry —{' '}
          <span className="font-bold text-amber-400">entering AT strong resistance/support</span>.{' '}
          Multiple timeframes agree this is a wall. High rejection probability.
        </div>
      )}

      {/* Metrics Row */}
      <div className="flex flex-wrap gap-2">
        {/* Room Ratio */}
        {roomRatio != null && roomRatio > 0 && (
          <div className={`text-[9px] px-1.5 py-0.5 rounded ${
            roomFavorable ? 'bg-emerald-500/10 text-emerald-400' :
            roomUnfavorable ? 'bg-red-500/10 text-red-400' :
            'bg-slate-700/50 text-slate-400'
          }`}>
            Room {roomRatio.toFixed(1)}x{' '}
            {roomFavorable ? '— more room to run than to fall' :
             roomUnfavorable ? '— more room to fall than to run' : ''}
          </div>
        )}

        {/* SL Confluence Score */}
        {slScore != null && slScore > 0 && (
          <div className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
            SL zone: <span className={`font-bold ${slScore >= 10 ? 'text-emerald-400' : slScore >= 5 ? 'text-blue-400' : 'text-slate-300'}`}>
              {slScore.toFixed(1)}
            </span>
            {slScore >= 10 ? ' strong' : slScore >= 5 ? ' moderate' : ' weak'}
          </div>
        )}

        {/* T1 Confluence Score */}
        {t1Score != null && t1Score > 0 && (
          <div className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
            T1 zone: <span className={`font-bold ${t1Score >= 10 ? 'text-emerald-400' : t1Score >= 5 ? 'text-blue-400' : 'text-slate-300'}`}>
              {t1Score.toFixed(1)}
            </span>
            {t1Score >= 10 ? ' strong target' : t1Score >= 5 ? ' moderate' : ' weak — may not hold'}
          </div>
        )}

        {/* Zone Count */}
        {zoneCount != null && zoneCount > 0 && (
          <div className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
            {zoneCount} zones detected
          </div>
        )}

        {/* Time Phase */}
        {timePhase && (
          <div className={`text-[9px] px-1.5 py-0.5 rounded ${
            timePhase === 'OPENING_AUCTION' || timePhase === 'OPENING_RANGE' ? 'bg-cyan-500/10 text-cyan-400' :
            timePhase === 'PRE_CLOSE' || timePhase === 'CLOSE' ? 'bg-amber-500/10 text-amber-400' :
            'bg-slate-700/50 text-slate-400'
          }`}>
            {timePhase === 'OPENING_AUCTION' ? 'Opening auction — SL wider for volatility' :
             timePhase === 'OPENING_RANGE' ? 'Opening range — establishing levels' :
             timePhase === 'PRE_CLOSE' ? 'Pre-close — SL tightened, theta accelerating' :
             timePhase === 'CLOSE' ? 'Last 25min — trailing SL active' :
             'Midday — normal parameters'}
          </div>
        )}

        {/* Lot Allocation */}
        {lotAllocation && lotAllocation !== '40,30,20,10' && (
          <div className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400">
            Lots: {lotAllocation.split(',').map((p, i) => `T${i+1}:${p}%`).join(' ')}
            {' — '}weighted by confluence strength
          </div>
        )}
      </div>

      {/* Confluence Levels — Equity + Option dual display */}
      {conflSL != null && conflSL > 0 && (
        <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-2 mt-1">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[9px] text-slate-500 font-semibold">Confluence Targets (active)</div>
            {conflOptZoneCount != null && conflOptZoneCount > 0 && (
              <div className="text-[8px] text-slate-600">{zoneCount} eq zones + {conflOptZoneCount} opt zones</div>
            )}
          </div>
          {/* Header */}
          <div className="grid grid-cols-7 gap-1 text-[8px] text-slate-600 font-semibold uppercase mb-0.5">
            <div></div><div className="text-center">SL</div>
            <div className="text-center">T1</div><div className="text-center">T2</div>
            <div className="text-center">T3</div><div className="text-center">T4</div>
            <div className="text-center">R:R</div>
          </div>
          {/* Equity row */}
          <div className="grid grid-cols-7 gap-1 text-[10px] font-mono">
            <div className="text-[8px] text-blue-400 font-semibold self-center">EQ</div>
            <div className="text-center">
              <div className="text-red-400 font-bold">{conflSL.toFixed(0)}</div>
              <div className="text-[7px] text-slate-600">({slScore?.toFixed(0) ?? '—'})</div>
            </div>
            {[
              { eq: conflT1, score: t1Score },
              { eq: conflT2 },
              { eq: conflT3 },
              { eq: conflT4 },
            ].map((t, i) => (
              <div key={i} className="text-center">
                <div className="text-emerald-400 font-bold">{t.eq != null && t.eq > 0 ? t.eq.toFixed(0) : '—'}</div>
              </div>
            ))}
            <div className="text-center">
              <div className={`font-bold ${(conflRR ?? 0) >= 1.5 ? 'text-emerald-400' : (conflRR ?? 0) >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
                {conflRR != null && conflRR > 0 ? conflRR.toFixed(1) : '—'}
              </div>
            </div>
          </div>
          {/* Option row */}
          {conflOptSL != null && conflOptSL > 0 && (
            <div className="grid grid-cols-7 gap-1 text-[10px] font-mono mt-0.5 border-t border-slate-700/30 pt-0.5">
              <div className="text-[8px] text-purple-400 font-semibold self-center">OPT</div>
              <div className="text-center">
                <div className="text-red-400/80 font-bold">₹{conflOptSL.toFixed(1)}</div>
                {conflOptSlScore != null && <div className="text-[7px] text-slate-600">({conflOptSlScore.toFixed(0)})</div>}
              </div>
              {[conflOptT1, conflOptT2, conflOptT3, conflOptT4].map((opt, i) => (
                <div key={i} className="text-center">
                  <div className="text-emerald-400/80 font-bold">{opt != null && opt > 0 ? '₹' + opt.toFixed(1) : '—'}</div>
                </div>
              ))}
              <div className="text-center">
                <div className={`font-bold ${(conflOptRR ?? 0) >= 1.5 ? 'text-emerald-400' : (conflOptRR ?? 0) >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
                  {conflOptRR != null && conflOptRR > 0 ? conflOptRR.toFixed(1) : '—'}
                </div>
              </div>
            </div>
          )}
          {/* Lot allocation */}
          {lotAllocation && lotAllocation !== '40,30,20,10' && (
            <div className="mt-1 pt-1 border-t border-slate-700/30 text-[9px] text-indigo-400">
              Lots: {lotAllocation.split(',').map((p, i) => `T${i+1}:${p}%`).join('  ')} — weighted by option confluence
            </div>
          )}
        </div>
      )}

      {/* Entry Quality Description (human-readable) */}
      {entryQuality && entryQuality.length > 0 && (
        <div className="text-[9px] text-slate-500 italic">
          {highlightKeywords(entryQuality)}
        </div>
      )}
    </div>
  )
}

/** Highlight important keywords in descriptions */
function highlightKeywords(text: string): JSX.Element {
  const keywords: Record<string, string> = {
    'FORTRESS': 'text-amber-400 font-bold',
    'RESISTANCE': 'text-red-400 font-bold',
    'SUPPORT': 'text-emerald-400 font-bold',
    'FAVORABLE': 'text-emerald-400 font-bold',
    'UNFAVORABLE': 'text-red-400 font-bold',
    'BULLISH': 'text-emerald-400 font-bold',
    'BEARISH': 'text-red-400 font-bold',
    'R:R': 'text-blue-400 font-bold',
    'fortress': 'text-amber-400 font-bold',
    'blocking': 'text-red-400 font-bold',
    'momentum': 'text-cyan-400 font-bold',
  }

  const parts = text.split(/(\b(?:FORTRESS|RESISTANCE|SUPPORT|FAVORABLE|UNFAVORABLE|BULLISH|BEARISH|R:R|fortress|blocking|momentum)\b)/g)
  return (
    <>
      {parts.map((part, i) => {
        const cls = keywords[part]
        return cls ? <span key={i} className={cls}>{part}</span> : <span key={i}>{part}</span>
      })}
    </>
  )
}
