/**
 * Estimate round-trip slippage based on premium level and quantity.
 * Premium-based tick model: cheap options have wider spreads.
 */
export function estimateSlippage(entryPrice: number, qty: number, exchange?: string): number {
  if (!entryPrice || !qty) return 0
  const tickSize = exchange === 'M' ? 1.0 : 0.05
  const entryTicks = entryPrice < 5 ? 3 : entryPrice < 20 ? 2 : 1
  const exitTicks = entryPrice < 5 ? 3 : entryPrice < 20 ? 2 : 1
  return (entryTicks + exitTicks) * tickSize * Math.abs(qty)
}

export function estimateSlippagePct(entryPrice: number, qty: number, exchange?: string): number {
  if (!entryPrice || !qty) return 0
  const slip = estimateSlippage(entryPrice, qty, exchange)
  const cost = Math.abs(entryPrice * qty)
  return cost > 0 ? (slip / cost) * 100 : 0
}

export function formatSlippage(amount: number): string {
  if (amount >= 100000) return `\u20B9${(amount / 100000).toFixed(2)}L`
  if (amount >= 1000) return `\u20B9${(amount / 1000).toFixed(1)}K`
  return `\u20B9${Math.round(amount)}`
}
