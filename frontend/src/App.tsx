import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import DashboardPage from './pages/DashboardPage'
import WalletPage from './pages/WalletPage'
import TradesPage from './pages/TradesPage'
import ScoresPage from './pages/ScoresPage'
import SignalsPage from './pages/SignalsPage'
import StockDetailPage from './pages/StockDetailPage'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/scores" element={<ScoresPage />} />
        <Route path="/signals" element={<SignalsPage />} />
        <Route path="/stock/:scripCode" element={<StockDetailPage />} />
      </Routes>
    </Layout>
  )
}

export default App

