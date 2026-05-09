import { useEffect, Component, lazy, Suspense } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout/Layout'
import ProtectedRoute from './components/ProtectedRoute'

// Eagerly imported: public routes hit first (LandingPage / LoginPage) — no code-split
// benefit since they're the first render path anyway.
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'

// All other pages lazy-loaded — shrinks initial bundle from 2.1MB to ~500KB.
// Observed 2026-04-24: LCP 18.2s on mobile → eager 34-page bundle blocked hydration
// for 18s, during which taps appeared to do nothing ("overlay situation").
const SignupPage = lazy(() => import('./pages/SignupPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const WalletPage = lazy(() => import('./pages/WalletPage'))
const TradesPage = lazy(() => import('./pages/TradesPage'))
const MarketPulsePage = lazy(() => import('./pages/MarketPulsePage'))
const InsightsPage = lazy(() => import('./pages/InsightsPage'))
const SignalsPage = lazy(() => import('./pages/SignalsPage'))
const StockDetailPage = lazy(() => import('./pages/StockDetailPage'))
const QuantScoresPage = lazy(() => import('./pages/QuantScoresPage'))
const PerformancePage = lazy(() => import('./pages/PerformancePage'))
const PatternsPage = lazy(() => import('./pages/PatternsPage'))
const RiskPage = lazy(() => import('./pages/RiskPage'))
const StrategyTransparencyPage = lazy(() => import('./pages/StrategyTransparencyPage'))
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'))
const PnLDashboardPage = lazy(() => import('./pages/PnLDashboardPage'))
const SignalAuditPage = lazy(() => import('./pages/SignalAuditPage'))
const WsAuditPage = lazy(() => import('./pages/WsAuditPage'))
const OrderManagementPage = lazy(() => import('./pages/OrderManagementPage'))
const StrategyWalletsPage = lazy(() => import('./pages/StrategyWalletsPage'))
const MLShadowPage = lazy(() => import('./pages/MLShadowPage'))
const LivePage = lazy(() => import('./pages/LivePage'))
const GreekTrailingPage = lazy(() => import('./pages/GreekTrailingPage'))
const HotStocksPage = lazy(() => import('./pages/HotStocksPage').then(m => ({ default: m.HotStocksPage })))
const HotStocksDetailPage = lazy(() => import('./pages/HotStocksDetailPage').then(m => ({ default: m.HotStocksDetailPage })))
const PivotBossPage = lazy(() => import('./pages/PivotBossPage'))
const PivotBossAnalyticsPage = lazy(() => import('./pages/PivotBossAnalyticsPage'))
const MondayShipPage = lazy(() => import('./pages/MondayShipPage'))
const HealthCheckPage = lazy(() => import('./pages/HealthCheckPage'))
const KafkaLagPage = lazy(() => import('./pages/KafkaLagPage'))
const NoAccessPage = lazy(() => import('./pages/NoAccessPage'))

function PageLoader() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
        <div className="text-xs text-slate-500">Loading…</div>
      </div>
    </div>
  )
}

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
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Protected Routes */}
        <Route
          path="/no-access"
          element={
            <ProtectedRoute>
              <Layout>
                <NoAccessPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/live"
          element={
            <ProtectedRoute requiredPage="dashboard">
              <Layout>
                <LivePage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute requiredPage="dashboard">
              <Layout>
                <DashboardPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/positions"
          element={
            <ProtectedRoute requiredPage="positions">
              <Layout>
                <WalletPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/trades"
          element={
            <ProtectedRoute requiredPage="trades">
              <Layout>
                <TradesPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/insights"
          element={
            <ProtectedRoute requiredPage="insights">
              <Layout>
                <InsightsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        {/* Legacy redirects — old routes render the new merged page */}
        <Route
          path="/command-center"
          element={
            <ProtectedRoute requiredPage="insights">
              <Layout>
                <InsightsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/market-intelligence"
          element={
            <ProtectedRoute requiredPage="insights">
              <Layout>
                <InsightsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/market-pulse"
          element={
            <ProtectedRoute requiredPage="market-pulse">
              <Layout>
                <MarketPulsePage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/hot-stocks"
          element={
            <ProtectedRoute requiredPage="hot-stocks">
              <Layout>
                <HotStocksPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/research/:symbol"
          element={
            <ProtectedRoute requiredPage="hot-stocks">
              <Layout>
                <HotStocksDetailPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quant-scores"
          element={
            <ProtectedRoute requiredPage="quant-scores">
              <Layout>
                <QuantScoresPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/signals"
          element={
            <ProtectedRoute requiredPage="signals">
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
            <ProtectedRoute requiredPage="performance">
              <Layout>
                <PerformancePage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/patterns"
          element={
            <ProtectedRoute requiredPage="patterns">
              <Layout>
                <PatternsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/risk"
          element={
            <ProtectedRoute requiredPage="risk">
              <Layout>
                <RiskPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/strategy"
          element={
            <ProtectedRoute requiredPage="strategy">
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
            <ProtectedRoute requiredPage="watchlist">
              <Layout>
                <WatchlistPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pnl"
          element={
            <ProtectedRoute requiredPage="pnl">
              <Layout>
                <PnLDashboardPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/wallets"
          element={
            <ProtectedRoute requiredPage="wallets">
              <Layout>
                <StrategyWalletsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/signal-audit"
          element={
            <ProtectedRoute requiredPage="dashboard">
              <Layout>
                <SignalAuditPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ws-audit"
          element={
            <ProtectedRoute requiredPage="dashboard">
              <Layout>
                <WsAuditPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute requiredPage="orders">
              <Layout>
                <OrderManagementPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ml-shadow"
          element={
            <ProtectedRoute requiredPage="ml-shadow">
              <Layout>
                <MLShadowPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/greek-trailing"
          element={
            <ProtectedRoute requiredPage="greek-trailing">
              <Layout>
                <GreekTrailingPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pivotboss"
          element={
            <ProtectedRoute>
              <Layout>
                <PivotBossPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pivotboss-analytics"
          element={
            <ProtectedRoute>
              <Layout>
                <PivotBossAnalyticsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/monday-ship"
          element={
            <ProtectedRoute>
              <Layout>
                <MondayShipPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/health-check"
          element={
            <ProtectedRoute requireRole="ADMIN">
              <Layout>
                <HealthCheckPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/kafka-lag"
          element={
            <ProtectedRoute requireRole="ADMIN">
              <Layout>
                <KafkaLagPage />
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
      </Suspense>
    </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
