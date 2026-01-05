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

export interface VirtualPosition {
    scripCode: string
    side: OrderSide
    qty: number
    avgPrice: number
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
    realizedPnl: number
    openedAt: number
    updatedAt: number
}

export interface OrderResponse {
    success: boolean
    order?: VirtualOrder
    position?: VirtualPosition
    error?: string
    message?: string
}
