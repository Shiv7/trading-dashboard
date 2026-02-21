// Order types for trading functionality

export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT'
export type TrailingType = 'NONE' | 'FIXED' | 'PCT'

export interface CreateOrderRequest {
    scripCode: string
    side: OrderSide
    type: OrderType
    qty: number
    limitPrice?: number
    currentPrice?: number  // FIX: For MARKET orders, use this as entry price
    sl?: number
    tp1?: number
    tp2?: number
    tp1ClosePercent?: number
    trailingType?: TrailingType
    trailingValue?: number
    trailingStep?: number
    signalSource?: string  // Strategy source: FUDKII, FUKAA, PIVOT, etc.
}

export interface ModifyPositionRequest {
    sl?: number
    tp1?: number
    tp2?: number
    tp1ClosePercent?: number
    trailingType?: TrailingType
    trailingValue?: number
    trailingStep?: number
    trailingActive?: boolean
}

export interface VirtualOrder {
    id: string
    scripCode: string
    side: OrderSide
    type: OrderType
    qty: number
    limitPrice?: number
    sl?: number
    tp1?: number
    tp2?: number
    status: string
    createdAt: number
    filledAt?: number
    filledPrice?: number
}

// FIX BUG #8: Position side should be LONG/SHORT not BUY/SELL
export type PositionSide = 'LONG' | 'SHORT'

export interface VirtualPosition {
    scripCode: string
    side: PositionSide // FIX: Changed from OrderSide to PositionSide
    qty: number
    qtyOpen?: number // FIX: Add alternate field name used by backend
    avgPrice: number
    avgEntry?: number // FIX: Add alternate field name used by backend
    currentPrice: number
    sl?: number
    tp1?: number
    tp2?: number
    tp1Hit?: boolean
    tp1ClosePercent?: number
    trailingType?: string
    trailingValue?: number
    trailingStep?: number
    trailingActive?: boolean
    trailingStop?: number
    unrealizedPnl: number
    unrealizedPnlPct: number
    unrealizedPnlPercent?: number // FIX: Add alternate field name
    realizedPnl: number
    openedAt: number
    updatedAt: number
    signalId?: string // FIX: Add missing field
}

export interface OrderResponse {
    success: boolean
    order?: VirtualOrder
    position?: VirtualPosition
    error?: string
    message?: string
}

// Strategy trade request for option/futures execution
export interface StrategyTradeRequest {
    scripCode: string
    instrumentSymbol: string
    instrumentType: 'OPTION' | 'FUTURES'
    underlyingScripCode: string
    underlyingSymbol: string
    side: 'BUY'
    quantity: number
    lots: number
    lotSize: number
    multiplier: number
    entryPrice: number
    sl: number
    t1: number
    t2: number
    t3: number
    t4: number
    equitySpot: number
    equitySl: number
    equityT1: number
    equityT2: number
    equityT3: number
    equityT4: number
    delta: number
    optionType?: 'CE' | 'PE'
    strike: number
    strategy: string
    exchange: string
    direction: 'BULLISH' | 'BEARISH'
    confidence: number
}

export interface StrategyTradeResponse {
    success: boolean
    tradeId?: string
    scripCode?: string
    instrumentSymbol?: string
    entryPrice?: number
    quantity?: number
    lots?: number
    sl?: number
    t1?: number
    t2?: number
    t3?: number
    t4?: number
    strategy?: string
    error?: string
}
