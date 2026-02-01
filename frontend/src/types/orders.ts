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
