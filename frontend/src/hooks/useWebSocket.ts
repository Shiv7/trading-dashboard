import { useEffect, useRef, useCallback, useState } from 'react'
import { Client, IMessage } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useDashboardStore } from '../store/dashboardStore'
import { walletApi, scoresApi, quantScoresApi } from '../services/api'

const WS_URL = 'http://3.111.242.49:8085/ws'

// FIX BUG #10: Data validation helper
function isValidObject(data: unknown): data is Record<string, unknown> {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
}

// FIX BUG #10: Validate wallet data before updating store
function isValidWallet(data: unknown): boolean {
  if (!isValidObject(data)) return false
  // Must have at least walletId or currentCapital to be valid
  return 'walletId' in data || 'currentCapital' in data || 'positions' in data
}

// FIX BUG #10: Validate score data before updating store
function isValidScore(data: unknown): boolean {
  if (!isValidObject(data)) return false
  // Must have scripCode to be valid
  return 'scripCode' in data && typeof data.scripCode === 'string' && data.scripCode.length > 0
}

export function useWebSocket() {
  const clientRef = useRef<Client | null>(null)
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 10
  // FIX BUG #12: Track if disconnect handler already fired
  const disconnectHandled = useRef(false)

  const {
    updateWallet,
    updateScore,
    addSignal,
    updateTrade,
    updateRegime,
    addNotification,
    updateMasterArch,
    updateACL,
    updateFUDKII,
    updateQuantScore,
    bulkUpdateQuantScores,
    updateNarrative,
    updateIntelligence,
    updateActiveSetups,
    updateForecast
  } = useDashboardStore()

  // FIX BUG #11: Refresh data on reconnect to avoid stale data
  const refreshDataOnReconnect = useCallback(async () => {
    console.log('WebSocket reconnected - refreshing data...')
    try {
      // Fetch fresh wallet data
      const walletData = await walletApi.getWallet().catch(() => null)
      if (walletData && isValidWallet(walletData)) {
        updateWallet(walletData)
      }

      // Fetch fresh scores
      const scoresData = await scoresApi.getTopScores(100).catch(() => [])
      scoresData.forEach(score => {
        if (isValidScore(score)) {
          updateScore(score)
        }
      })

      // Fetch fresh quant scores
      const quantScoresData = await quantScoresApi.getAllScores(100).catch(() => [])
      if (quantScoresData.length > 0) {
        bulkUpdateQuantScores(quantScoresData)
      }

      console.log('Data refresh complete after reconnect')
    } catch (err) {
      console.error('Error refreshing data on reconnect:', err)
    }
  }, [updateWallet, updateScore, bulkUpdateQuantScores])

  const connect = useCallback(() => {
    if (clientRef.current?.connected) return

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,

      onConnect: () => {
        console.log('WebSocket connected')
        setConnected(true)
        setReconnecting(false)
        setError(null)
        setParseErrors([])
        // FIX BUG #12: Reset disconnect flag
        disconnectHandled.current = false

        // FIX BUG #11: If this is a reconnection (not first connect), refresh data
        if (reconnectAttempts.current > 0) {
          refreshDataOnReconnect()
        }
        reconnectAttempts.current = 0

        // Helper to handle parse errors with error boundary
        const handleParseError = (topic: string, e: unknown) => {
          const errorMsg = `Failed to parse ${topic}: ${e instanceof Error ? e.message : 'Unknown error'}`
          console.error(errorMsg)
          setParseErrors(prev => [...prev.slice(-9), errorMsg]) // Keep last 10 errors
        }

        // FIX BUG #10: Subscribe to wallet updates with validation
        client.subscribe('/topic/wallet', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            // Validate data before updating store
            if (isValidWallet(data)) {
              updateWallet(data)
            } else {
              console.warn('Received invalid wallet data, skipping update:', data)
            }
          } catch (e) {
            handleParseError('wallet', e)
          }
        })

        // FIX BUG #10: Subscribe to all scores with validation
        client.subscribe('/topic/scores', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            // Validate data before updating store
            if (isValidScore(data)) {
              updateScore(data)
            } else {
              console.warn('Received invalid score data, skipping update:', data)
            }
          } catch (e) {
            handleParseError('scores', e)
          }
        })

        // Subscribe to signals
        client.subscribe('/topic/signals', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            addSignal(data)
          } catch (e) {
            handleParseError('signals', e)
          }
        })

        // Subscribe to trades
        client.subscribe('/topic/trades', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateTrade(data)
          } catch (e) {
            handleParseError('trades', e)
          }
        })

        // Subscribe to regime
        client.subscribe('/topic/regime', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateRegime(data)
          } catch (e) {
            handleParseError('regime', e)
          }
        })

        // Subscribe to notifications
        client.subscribe('/topic/notifications', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            addNotification(data)
          } catch (e) {
            handleParseError('notifications', e)
          }
        })

        // Subscribe to Master Architecture (FF1) decisions
        client.subscribe('/topic/master-arch', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateMasterArch(data)
          } catch (e) {
            handleParseError('master-arch', e)
          }
        })

        // Subscribe to ACL (Anti-Cycle Limiter) updates
        client.subscribe('/topic/acl', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateACL(data)
          } catch (e) {
            handleParseError('acl', e)
          }
        })

        // Subscribe to FUDKII ignition signals
        client.subscribe('/topic/fudkii', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateFUDKII(data)
          } catch (e) {
            handleParseError('fudkii', e)
          }
        })

        // FIX BUG #10: Subscribe to QuantScore updates with validation
        client.subscribe('/topic/quant-scores', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            // Validate quant score - must have familyId or scripCode and quantScore
            if (isValidObject(data) && ('familyId' in data || 'scripCode' in data)) {
              updateQuantScore(data)
            } else {
              console.warn('Received invalid quant score data, skipping update')
            }
          } catch (e) {
            handleParseError('quant-scores', e)
          }
        })

        // ======================== MARKET INTELLIGENCE SUBSCRIPTIONS ========================

        // Subscribe to market narratives
        client.subscribe('/topic/narrative', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateNarrative(data)
          } catch (e) {
            handleParseError('narrative', e)
          }
        })

        // Subscribe to market intelligence
        client.subscribe('/topic/intelligence', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateIntelligence(data)
          } catch (e) {
            handleParseError('intelligence', e)
          }
        })

        // FIX BUG #32: Subscribe to active setups with proper familyId extraction
        client.subscribe('/topic/setups', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            // Setups come as an array, extract familyId from first element
            if (Array.isArray(data) && data.length > 0) {
              // FIX: Use explicit checks for falsy values like "0", "", null, undefined
              let familyId = data[0].familyId
              if (!familyId || familyId === '0' || familyId === 'null' || familyId === 'undefined') {
                familyId = data[0].scripCode
              }
              // Additional fallback: try to find any valid familyId in the array
              if (!familyId || familyId === '0' || familyId === 'null' || familyId === 'undefined') {
                for (const setup of data) {
                  if (setup.familyId && setup.familyId !== '0' && setup.familyId !== 'null') {
                    familyId = setup.familyId
                    break
                  }
                  if (setup.scripCode && setup.scripCode !== '0' && setup.scripCode !== 'null') {
                    familyId = setup.scripCode
                    break
                  }
                }
              }
              // Only update if we have a valid familyId
              if (familyId && familyId !== '0' && familyId !== 'null' && familyId !== 'undefined') {
                updateActiveSetups(familyId, data)
              } else {
                console.warn('Received setups with no valid familyId, skipping:', data)
              }
            }
          } catch (e) {
            handleParseError('setups', e)
          }
        })

        // Subscribe to opportunity forecasts
        client.subscribe('/topic/forecast', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateForecast(data)
          } catch (e) {
            handleParseError('forecast', e)
          }
        })
      },

      onStompError: (frame) => {
        console.error('STOMP error:', frame.headers['message'])
        setError(frame.headers['message'] || 'Connection error')
        setConnected(false)
        // FIX BUG #12: Only handle once
        if (!disconnectHandled.current) {
          disconnectHandled.current = true
          setReconnecting(true)
          reconnectAttempts.current++
        }
      },

      // FIX BUG #12: Prevent double increment by using flag
      onWebSocketClose: () => {
        console.log('WebSocket closed')
        setConnected(false)
        // Only handle if not already handled
        if (!disconnectHandled.current) {
          disconnectHandled.current = true
          if (reconnectAttempts.current < maxReconnectAttempts) {
            setReconnecting(true)
            reconnectAttempts.current++
            console.log(`Reconnecting... attempt ${reconnectAttempts.current}/${maxReconnectAttempts}`)
          } else {
            setReconnecting(false)
            setError('Connection lost. Maximum reconnection attempts reached.')
          }
        }
      },

      onDisconnect: () => {
        console.log('STOMP disconnected')
        setConnected(false)
        // FIX BUG #12: Don't increment here - let onWebSocketClose handle it
        // This prevents double increment when both handlers fire
        if (!disconnectHandled.current) {
          setReconnecting(true)
        }
      },
    })

    clientRef.current = client
    client.activate()
  }, [updateWallet, updateScore, addSignal, updateTrade, updateRegime, addNotification, updateMasterArch, updateACL, updateFUDKII, updateQuantScore, updateNarrative, updateIntelligence, updateActiveSetups, updateForecast, refreshDataOnReconnect, bulkUpdateQuantScores])

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.deactivate()
      clientRef.current = null
      setConnected(false)
    }
  }, [])

  const subscribeToStock = useCallback((scripCode: string) => {
    if (clientRef.current?.connected) {
      clientRef.current.subscribe(`/topic/scores/${scripCode}`, (message: IMessage) => {
        try {
          const data = JSON.parse(message.body)
          updateScore(data)
        } catch (e) {
          console.error('Error parsing stock score:', e)
        }
      })
    }
  }, [updateScore])

  const subscribeToIPU = useCallback((scripCode: string, callback: (data: unknown) => void) => {
    if (clientRef.current?.connected) {
      return clientRef.current.subscribe(`/topic/ipu/${scripCode}`, (message: IMessage) => {
        try {
          callback(JSON.parse(message.body))
        } catch (e) {
          console.error('Error parsing IPU message:', e)
        }
      })
    }
    return null
  }, [])

  const subscribeToVCP = useCallback((scripCode: string, callback: (data: unknown) => void) => {
    if (clientRef.current?.connected) {
      return clientRef.current.subscribe(`/topic/vcp/${scripCode}`, (message: IMessage) => {
        try {
          callback(JSON.parse(message.body))
        } catch (e) {
          console.error('Error parsing VCP message:', e)
        }
      })
    }
    return null
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  // Helper to clear parse errors
  const clearParseErrors = useCallback(() => {
    setParseErrors([])
  }, [])

  // Helper to manually reset reconnection state
  const resetReconnection = useCallback(() => {
    reconnectAttempts.current = 0
    setReconnecting(false)
    setError(null)
  }, [])

  return {
    connected,
    reconnecting,
    error,
    parseErrors,
    subscribeToStock,
    subscribeToIPU,
    subscribeToVCP,
    reconnect: connect,
    clearParseErrors,
    resetReconnection
  }
}
