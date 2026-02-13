import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { authApi, type UserProfile } from '../services/api'

interface AuthContextType {
  user: UserProfile | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  signup: (email: string, username: string, password: string, name: string) => Promise<boolean>
  logout: () => void
  error: string | null
  token: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const AUTH_TOKEN_KEY = 'kotsin_auth_token'
const USER_KEY = 'kotsin_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem(AUTH_TOKEN_KEY))
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Validate token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY)
    if (storedToken) {
      // authApi.me() goes through fetchWithAuth which auto-retries with refresh on 401
      authApi.me()
        .then((userData) => {
          setUser(userData)
          setToken(localStorage.getItem(AUTH_TOKEN_KEY) || storedToken)
          localStorage.setItem(USER_KEY, JSON.stringify(userData))
        })
        .catch(() => {
          localStorage.removeItem(AUTH_TOKEN_KEY)
          localStorage.removeItem(USER_KEY)
          setUser(null)
          setToken(null)
        })
        .finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  // Proactive token refresh — refresh every 30 min to keep session alive
  useEffect(() => {
    if (!user || !token) return
    const interval = setInterval(async () => {
      try {
        const response = await authApi.refresh()
        localStorage.setItem(AUTH_TOKEN_KEY, response.token)
        setToken(response.token)
        if (response.user) {
          setUser(response.user)
          localStorage.setItem(USER_KEY, JSON.stringify(response.user))
        }
      } catch {
        // Refresh failed silently — fetchWithAuth will handle 401 on next API call
      }
    }, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user, token])

  const login = async (username: string, password: string): Promise<boolean> => {
    setError(null)
    setIsLoading(true)

    try {
      const response = await authApi.login({ username, password })
      localStorage.setItem(AUTH_TOKEN_KEY, response.token)
      localStorage.setItem(USER_KEY, JSON.stringify(response.user))
      setToken(response.token)
      setUser(response.user)
      setIsLoading(false)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      setError(message)
      setIsLoading(false)
      return false
    }
  }

  const signup = async (email: string, username: string, password: string, name: string): Promise<boolean> => {
    setError(null)
    setIsLoading(true)

    try {
      if (password.length < 6) {
        setError('Password must be at least 6 characters')
        setIsLoading(false)
        return false
      }

      const response = await authApi.register({
        username,
        email,
        password,
        displayName: name,
      })
      localStorage.setItem(AUTH_TOKEN_KEY, response.token)
      localStorage.setItem(USER_KEY, JSON.stringify(response.user))
      setToken(response.token)
      setUser(response.user)
      setIsLoading(false)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signup failed'
      setError(message)
      setIsLoading(false)
      return false
    }
  }

  const logout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setUser(null)
    setToken(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        signup,
        logout,
        error,
        token,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
