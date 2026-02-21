import { useEffect, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DashboardPage from './pages/DashboardPage'
import WalletPage from './pages/WalletPage'
import TradesPage from './pages/TradesPage'
import ScoresPage from './pages/ScoresPage'
import SignalsPage from './pages/SignalsPage'
import StockDetailPage from './pages/StockDetailPage'
import QuantScoresPage from './pages/QuantScoresPage'
import PerformancePage from './pages/PerformancePage'
import PatternsPage from './pages/PatternsPage'
import RiskPage from './pages/RiskPage'
import StrategyTransparencyPage from './pages/StrategyTransparencyPage'
import OrderHistoryPage from './pages/OrderHistoryPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import WatchlistPage from './pages/WatchlistPage'
import PnLDashboardPage from './pages/PnLDashboardPage'
import OrderManagementPage from './pages/OrderManagementPage'
import StrategyWalletsPage from './pages/StrategyWalletsPage'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App Error Boundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
          <div className="bg-slate-800 border border-red-500/30 rounded-xl p-8 max-w-lg text-center">
            <h1 className="text-2xl font-bold text-red-400 mb-4">Something went wrong</h1>
            <p className="text-slate-400 mb-6">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/dashboard' }}
              className="px-6 py-3 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <ScrollToTop />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Protected Routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Layout>
                <DashboardPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/positions"
          element={
            <ProtectedRoute>
              <Layout>
                <WalletPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/trades"
          element={
            <ProtectedRoute>
              <Layout>
                <TradesPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/scores"
          element={
            <ProtectedRoute>
              <Layout>
                <ScoresPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quant-scores"
          element={
            <ProtectedRoute>
              <Layout>
                <QuantScoresPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/signals"
          element={
            <ProtectedRoute>
              <Layout>
                <SignalsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/:scripCode"
          element={
            <ProtectedRoute>
              <Layout>
                <StockDetailPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/performance"
          element={
            <ProtectedRoute>
              <Layout>
                <PerformancePage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/patterns"
          element={
            <ProtectedRoute>
              <Layout>
                <PatternsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/risk"
          element={
            <ProtectedRoute>
              <Layout>
                <RiskPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/strategy"
          element={
            <ProtectedRoute>
              <Layout>
                <StrategyTransparencyPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/order-history"
          element={
            <ProtectedRoute>
              <Layout>
                <OrderHistoryPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Layout>
                <ProfilePage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireRole="ADMIN">
              <Layout>
                <AdminPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/watchlist"
          element={
            <ProtectedRoute>
              <Layout>
                <WatchlistPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pnl"
          element={
            <ProtectedRoute>
              <Layout>
                <PnLDashboardPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/wallets"
          element={
            <ProtectedRoute>
              <Layout>
                <StrategyWalletsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <Layout>
                <OrderManagementPage />
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
