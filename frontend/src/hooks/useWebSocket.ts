import { useEffect, useRef, useCallback, useState } from 'react'
import { Client, IMessage } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { useDashboardStore } from '../store/dashboardStore'

const WS_URL = 'http://13.203.60.173:8085/ws'

export function useWebSocket() {
  const clientRef = useRef<Client | null>(null)
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 10

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
    updateQuantScore
  } = useDashboardStore()

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
        reconnectAttempts.current = 0

        // Helper to handle parse errors with error boundary
        const handleParseError = (topic: string, e: unknown) => {
          const errorMsg = `Failed to parse ${topic}: ${e instanceof Error ? e.message : 'Unknown error'}`
          console.error(errorMsg)
          setParseErrors(prev => [...prev.slice(-9), errorMsg]) // Keep last 10 errors
        }

        // Subscribe to wallet updates
        client.subscribe('/topic/wallet', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateWallet(data)
          } catch (e) {
            handleParseError('wallet', e)
          }
        })

        // Subscribe to all scores
        client.subscribe('/topic/scores', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateScore(data)
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

        // Subscribe to QuantScore updates
        client.subscribe('/topic/quant-scores', (message: IMessage) => {
          try {
            const data = JSON.parse(message.body)
            updateQuantScore(data)
          } catch (e) {
            handleParseError('quant-scores', e)
          }
        })
      },

      onStompError: (frame) => {
        console.error('STOMP error:', frame.headers['message'])
        setError(frame.headers['message'] || 'Connection error')
        setConnected(false)
        setReconnecting(true)
        reconnectAttempts.current++
      },

      onWebSocketClose: () => {
        console.log('WebSocket closed')
        setConnected(false)
        if (reconnectAttempts.current < maxReconnectAttempts) {
          setReconnecting(true)
          reconnectAttempts.current++
          console.log(`Reconnecting... attempt ${reconnectAttempts.current}/${maxReconnectAttempts}`)
        } else {
          setReconnecting(false)
          setError('Connection lost. Maximum reconnection attempts reached.')
        }
      },

      onDisconnect: () => {
        console.log('STOMP disconnected')
        setConnected(false)
        setReconnecting(true)
      },
    })

    clientRef.current = client
    client.activate()
  }, [updateWallet, updateScore, addSignal, updateTrade, updateRegime, addNotification, updateMasterArch, updateACL, updateFUDKII, updateQuantScore])

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
