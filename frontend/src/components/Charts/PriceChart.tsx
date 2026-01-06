import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Line,
} from 'recharts'
import type { FamilyScore } from '../../types'

interface PriceChartProps {
  data: FamilyScore[]
  height?: number
  showVolume?: boolean
  entryPrice?: number
  stopLoss?: number
  target1?: number
}

interface CandleData {
  time: string
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  bullish: boolean
  bodyTop: number
  bodyBottom: number
  bodyHeight: number
  wickTop: number
  wickBottom: number
}

export default function PriceChart({
  data,
  height = 300,
  showVolume = true,
  entryPrice,
  stopLoss,
  target1,
}: PriceChartProps) {
  const chartData = useMemo<CandleData[]>(() => {
    return data
      .map((score) => {
        const bullish = score.close >= score.open
        return {
          time: new Date(score.timestamp).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          timestamp: new Date(score.timestamp),
          open: score.open,
          high: score.high,
          low: score.low,
          close: score.close,
          volume: score.volume,
          bullish,
          bodyTop: Math.max(score.open, score.close),
          bodyBottom: Math.min(score.open, score.close),
          bodyHeight: Math.abs(score.close - score.open),
          wickTop: score.high,
          wickBottom: score.low,
        }
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(-50) // Last 50 candles
  }, [data])

  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    if (chartData.length === 0) {
      return { minPrice: 0, maxPrice: 100, maxVolume: 0 }
    }
    const prices = chartData.flatMap(d => [d.low, d.high])
    const volumes = chartData.map(d => d.volume)

    // Include reference lines in price range
    const allPrices = [...prices]
    if (entryPrice) allPrices.push(entryPrice)
    if (stopLoss) allPrices.push(stopLoss)
    if (target1) allPrices.push(target1)

    return {
      minPrice: Math.min(...allPrices) * 0.995,
      maxPrice: Math.max(...allPrices) * 1.005,
      maxVolume: Math.max(...volumes),
    }
  }, [chartData, entryPrice, stopLoss, target1])

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-slate-800/50 rounded-lg">
        <span className="text-slate-500">No chart data available</span>
      </div>
    )
  }

  const latestPrice = chartData[chartData.length - 1]?.close || 0
  const firstPrice = chartData[0]?.open || latestPrice
  const priceChange = latestPrice - firstPrice
  const priceChangePercent = firstPrice > 0 ? (priceChange / firstPrice) * 100 : 0

  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-2xl font-bold text-white">{latestPrice.toFixed(2)}</span>
            <span className={`ml-2 text-sm ${priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {entryPrice && (
            <span className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-blue-500" />
              <span className="text-slate-400">Entry: {entryPrice.toFixed(2)}</span>
            </span>
          )}
          {stopLoss && (
            <span className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-red-500" />
              <span className="text-slate-400">SL: {stopLoss.toFixed(2)}</span>
            </span>
          )}
          {target1 && (
            <span className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-emerald-500" />
              <span className="text-slate-400">T1: {target1.toFixed(2)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
          <XAxis
            dataKey="time"
            tick={{ fill: '#64748b', fontSize: 10 }}
            axisLine={{ stroke: '#334155' }}
            tickLine={{ stroke: '#334155' }}
          />
          <YAxis
            yAxisId="price"
            domain={[minPrice, maxPrice]}
            orientation="right"
            tick={{ fill: '#64748b', fontSize: 10 }}
            axisLine={{ stroke: '#334155' }}
            tickLine={{ stroke: '#334155' }}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          {showVolume && (
            <YAxis
              yAxisId="volume"
              domain={[0, maxVolume * 4]}
              orientation="left"
              hide
            />
          )}

          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(value: number, name: string) => {
              if (name === 'volume') return [(value / 1000).toFixed(0) + 'K', 'Volume']
              return [value.toFixed(2), name.charAt(0).toUpperCase() + name.slice(1)]
            }}
          />

          {/* Volume bars */}
          {showVolume && (
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="#334155"
              opacity={0.3}
            />
          )}

          {/* Wick (high-low line) */}
          <Line
            yAxisId="price"
            type="linear"
            dataKey="high"
            stroke="none"
            dot={false}
          />

          {/* Candle bodies as bars */}
          <Bar
            yAxisId="price"
            dataKey="bodyHeight"
            stackId="candle"
            barSize={6}
            fill="#10b981"
            shape={((props: { x: number; y: number; width: number; height: number; payload: CandleData }) => {
              const { x, width, payload } = props
              const isBullish = payload.bullish

              // Calculate Y positions based on price values
              const scaleY = (price: number) => {
                const range = maxPrice - minPrice
                const chartHeight = height - 30 // Approximate chart area
                return 10 + ((maxPrice - price) / range) * chartHeight
              }

              const bodyY = scaleY(payload.bodyTop)
              const bodyH = Math.max(1, scaleY(payload.bodyBottom) - bodyY)
              const wickTopY = scaleY(payload.wickTop)
              const wickBottomY = scaleY(payload.wickBottom)

              return (
                <g>
                  {/* Wick */}
                  <line
                    x1={x + width / 2}
                    y1={wickTopY}
                    x2={x + width / 2}
                    y2={wickBottomY}
                    stroke={isBullish ? '#10b981' : '#ef4444'}
                    strokeWidth={1}
                  />
                  {/* Body */}
                  <rect
                    x={x}
                    y={bodyY}
                    width={width}
                    height={bodyH}
                    fill={isBullish ? '#10b981' : '#ef4444'}
                    rx={1}
                  />
                </g>
              )
            }) as any}
          />

          {/* Reference Lines for trade levels */}
          {entryPrice && (
            <ReferenceLine
              yAxisId="price"
              y={entryPrice}
              stroke="#3b82f6"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
          {stopLoss && (
            <ReferenceLine
              yAxisId="price"
              y={stopLoss}
              stroke="#ef4444"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
          {target1 && (
            <ReferenceLine
              yAxisId="price"
              y={target1}
              stroke="#10b981"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
