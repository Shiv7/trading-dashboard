import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface User {
  id: string
  username: string
  email: string
  role: 'admin' | 'user'
  name: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  signup: (email: string, username: string, password: string, name: string) => Promise<boolean>
  logout: () => void
  error: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Master admin credentials
const MASTER_ADMIN: User = {
  id: 'admin-001',
  username: 'devina',
  email: 'devina@kotsin.com',
  role: 'admin',
  name: 'Devina (Admin)'
}

const MASTER_PASSWORD = 'devina'

// Local storage keys
const AUTH_TOKEN_KEY = 'kotsin_auth_token'
const USER_KEY = 'kotsin_user'
const USERS_DB_KEY = 'kotsin_users_db'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initialize auth state from localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem(USER_KEY)
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY)

    if (storedUser && storedToken) {
      try {
        setUser(JSON.parse(storedUser))
      } catch {
        localStorage.removeItem(USER_KEY)
        localStorage.removeItem(AUTH_TOKEN_KEY)
      }
    }
    setIsLoading(false)
  }, [])

  // Get users database from localStorage
  const getUsersDB = (): Record<string, { user: User; password: string }> => {
    try {
      const db = localStorage.getItem(USERS_DB_KEY)
      return db ? JSON.parse(db) : {}
    } catch {
      return {}
    }
  }

  // Save users database to localStorage
  const saveUsersDB = (db: Record<string, { user: User; password: string }>) => {
    localStorage.setItem(USERS_DB_KEY, JSON.stringify(db))
  }

  const login = async (username: string, password: string): Promise<boolean> => {
    setError(null)
    setIsLoading(true)

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500))

    try {
      // Check master admin
      if (username.toLowerCase() === MASTER_ADMIN.username && password === MASTER_PASSWORD) {
        const token = btoa(`${username}:${Date.now()}`)
        localStorage.setItem(AUTH_TOKEN_KEY, token)
        localStorage.setItem(USER_KEY, JSON.stringify(MASTER_ADMIN))
        setUser(MASTER_ADMIN)
        setIsLoading(false)
        return true
      }

      // Check registered users
      const usersDB = getUsersDB()
      const userRecord = usersDB[username.toLowerCase()]

      if (userRecord && userRecord.password === password) {
        const token = btoa(`${username}:${Date.now()}`)
        localStorage.setItem(AUTH_TOKEN_KEY, token)
        localStorage.setItem(USER_KEY, JSON.stringify(userRecord.user))
        setUser(userRecord.user)
        setIsLoading(false)
        return true
      }

      setError('Invalid username or password')
      setIsLoading(false)
      return false
    } catch (err) {
      setError('Login failed. Please try again.')
      setIsLoading(false)
      return false
    }
  }

  const signup = async (email: string, username: string, password: string, name: string): Promise<boolean> => {
    setError(null)
    setIsLoading(true)

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500))

    try {
      // Validate inputs
      if (!email || !username || !password || !name) {
        setError('All fields are required')
        setIsLoading(false)
        return false
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters')
        setIsLoading(false)
        return false
      }

      // Check if username is reserved
      if (username.toLowerCase() === MASTER_ADMIN.username) {
        setError('This username is reserved')
        setIsLoading(false)
        return false
      }

      // Check if user exists
      const usersDB = getUsersDB()
      if (usersDB[username.toLowerCase()]) {
        setError('Username already exists')
        setIsLoading(false)
        return false
      }

      // Create new user
      const newUser: User = {
        id: `user-${Date.now()}`,
        username: username.toLowerCase(),
        email,
        role: 'user',
        name
      }

      // Save to database
      usersDB[username.toLowerCase()] = { user: newUser, password }
      saveUsersDB(usersDB)

      // Auto-login
      const token = btoa(`${username}:${Date.now()}`)
      localStorage.setItem(AUTH_TOKEN_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(newUser))
      setUser(newUser)
      setIsLoading(false)
      return true
    } catch (err) {
      setError('Signup failed. Please try again.')
      setIsLoading(false)
      return false
    }
  }

  const logout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setUser(null)
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
        error
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
