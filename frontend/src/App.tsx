import { Routes, Route } from 'react-router-dom'
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

function App() {
  return (
    <AuthProvider>
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
          path="/wallet"
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
      </Routes>
    </AuthProvider>
  )
}

export default App
