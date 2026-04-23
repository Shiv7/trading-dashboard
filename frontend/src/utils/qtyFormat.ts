// Instrument-aware qty formatting. Derivatives (OPTION/FUTURES) display
// as "10 LOTS (750 qty)"; equity keeps "179 QTY".

export type InstrumentKind = string | undefined | null

export function isDerivative(instrumentType: InstrumentKind): boolean {
  if (!instrumentType) return false
  const t = instrumentType.toUpperCase()
  return t === 'OPTION' || t === 'OPTIONS' || t === 'FUTURES' || t === 'FUT'
}

/**
 * Format a position's total size.
 * For derivatives: "10 LOTS (750 qty)" when lots available, else "750 qty".
 * For equity: "179 QTY".
 */
export function formatPositionQty(params: {
  instrumentType?: InstrumentKind
  quantity: number
  lots?: number | null
  lotSize?: number | null
}): string {
  const q = Math.abs(params.quantity || 0)
  if (isDerivative(params.instrumentType)) {
    const lots = derivLots(params.lots, params.lotSize, q)
    if (lots != null && lots > 0) {
      return `${lots.toLocaleString('en-IN')} LOTS (${q.toLocaleString('en-IN')} qty)`
    }
    return `${q.toLocaleString('en-IN')} qty`
  }
  return `${q.toLocaleString('en-IN')} QTY`
}

/**
 * Format a single exit-history event. ExitEvent carries both lots + qty.
 */
export function formatExitQty(params: {
  instrumentType?: InstrumentKind
  lots?: number
  qty?: number
}): string {
  const qty = params.qty ?? 0
  const lots = params.lots ?? 0
  if (isDerivative(params.instrumentType)) {
    if (lots > 0) {
      return `${lots.toLocaleString('en-IN')} LOTS (${qty.toLocaleString('en-IN')} qty)`
    }
    return `${qty.toLocaleString('en-IN')} qty`
  }
  return `${qty.toLocaleString('en-IN')} QTY`
}

function derivLots(lots: number | null | undefined, lotSize: number | null | undefined, qty: number): number | null {
  if (lots != null && lots > 0) return lots
  if (lotSize != null && lotSize > 0 && qty > 0) return Math.round(qty / lotSize)
  return null
}
