import { Link } from 'react-router-dom'

export default function LandingPage() {
  const features = [
    {
      icon: '📊',
      title: 'QuantScore Analytics',
      desc: 'Institutional-grade scoring across 8 categories: Greeks, IV Surface, Microstructure, Options Flow, Price Action, Volume Profile, Cross-Instrument, and Confluence.'
    },
    {
      icon: '🎯',
      title: 'Real-Time Signals',
      desc: 'Actionable trading signals with entry/exit prices, stop-loss, targets, and hedging recommendations powered by advanced quant models.'
    },
    {
      icon: '📈',
      title: 'Paper Trading',
      desc: 'Test strategies with virtual capital. Track P&L, manage positions, and optimize your trading approach risk-free.'
    },
    {
      icon: '🔬',
      title: 'Deep Market Analysis',
      desc: 'Wyckoff phases, VPIN analysis, Kyle Lambda, OFI momentum, and 48+ microstructure indicators for professional-grade insights.'
    },
    {
      icon: '⚡',
      title: 'Live Data Streaming',
      desc: 'WebSocket-powered real-time updates. Never miss a market opportunity with instant score and signal notifications.'
    },
    {
      icon: '🛡️',
      title: 'Risk Management',
      desc: 'Portfolio-level risk controls, Greeks-based hedging, position sizing, and drawdown protection built-in.'
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute -bottom-40 right-1/3 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-2000" />
      </div>

      {/* Header */}
      <header className="relative z-10 py-6 px-8">
        <nav className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.jpeg" alt="Kotsin Logo" className="w-12 h-12 rounded-xl shadow-lg shadow-amber-500/20" />
            <span className="text-2xl font-display font-bold text-white">KOTSIN</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="px-5 py-2.5 text-slate-300 hover:text-white transition-colors font-medium"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-bold rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/25"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 pt-20 pb-32 px-8">
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-2 mb-8">
            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-amber-400 text-sm font-medium">Institutional-Grade Trading Intelligence</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-display font-bold text-white mb-6 leading-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600">
              Infinite Edge
            </span>
            <br />
            in Every Trade
          </h1>

          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-12">
            Professional quant scoring, real-time signals, and advanced analytics.
            Make data-driven decisions with the power of institutional algorithms.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/signup"
              className="px-8 py-4 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-bold text-lg rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all shadow-xl shadow-amber-500/30 flex items-center gap-2"
            >
              Start Trading Now
              <span className="text-xl">→</span>
            </Link>
            <Link
              to="/login"
              className="px-8 py-4 bg-slate-800 text-white font-semibold text-lg rounded-xl border border-slate-700 hover:bg-slate-700 hover:border-slate-600 transition-all"
            >
              Sign In
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 max-w-4xl mx-auto">
            {[
              { value: '100+', label: 'QuantScore Factors' },
              { value: '8', label: 'Analysis Categories' },
              { value: '<1s', label: 'Signal Latency' },
              { value: '24/7', label: 'Market Coverage' }
            ].map((stat, i) => (
              <div key={i} className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-2xl p-6">
                <div className="text-3xl font-bold text-amber-400 mb-1">{stat.value}</div>
                <div className="text-sm text-slate-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative z-10 py-24 px-8 bg-slate-800/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-display font-bold text-white mb-4">
              Quantitative Edge at Your Fingertips
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Everything you need to trade like a professional quant fund
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={i}
                className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-2xl p-8 hover:border-amber-500/30 transition-all group"
              >
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-amber-400 transition-colors">
                  {feature.title}
                </h3>
                <p className="text-slate-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QuantScore Preview Section */}
      <section className="relative z-10 py-24 px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl font-display font-bold text-white mb-6">
                8-Category Composite<br />
                <span className="text-amber-400">QuantScore</span> System
              </h2>
              <p className="text-slate-400 text-lg mb-8">
                Our proprietary scoring algorithm synthesizes 100+ factors across 8 categories
                to generate a single actionable score from 0-100.
              </p>
              <div className="space-y-4">
                {[
                  { label: 'Greeks Exposure', max: 15, color: 'bg-blue-500' },
                  { label: 'IV Surface', max: 12, color: 'bg-purple-500' },
                  { label: 'Microstructure', max: 18, color: 'bg-emerald-500' },
                  { label: 'Options Flow', max: 15, color: 'bg-amber-500' },
                  { label: 'Price Action', max: 12, color: 'bg-red-500' },
                  { label: 'Volume Profile', max: 8, color: 'bg-cyan-500' },
                  { label: 'Cross-Instrument', max: 10, color: 'bg-pink-500' },
                  { label: 'Confluence', max: 10, color: 'bg-indigo-500' }
                ].map((cat, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-32 text-sm text-slate-300">{cat.label}</div>
                    <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${cat.color} rounded-full`}
                        style={{ width: `${(cat.max / 18) * 100}%` }}
                      />
                    </div>
                    <div className="w-12 text-right text-sm text-slate-400">0-{cat.max}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-3xl p-8">
              <div className="text-center mb-8">
                <div className="text-8xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-600">
                  78.5
                </div>
                <div className="text-emerald-400 font-bold text-xl mt-2">STRONG BUY</div>
                <div className="text-slate-400 text-sm mt-1">NIFTY 50 • Live Example</div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-slate-700/50 rounded-xl p-4">
                  <div className="text-slate-400">Confidence</div>
                  <div className="text-white font-bold text-lg">87%</div>
                </div>
                <div className="bg-slate-700/50 rounded-xl p-4">
                  <div className="text-slate-400">Direction</div>
                  <div className="text-emerald-400 font-bold text-lg">BULLISH</div>
                </div>
                <div className="bg-slate-700/50 rounded-xl p-4">
                  <div className="text-slate-400">Greeks Risk</div>
                  <div className="text-yellow-400 font-bold text-lg">Low</div>
                </div>
                <div className="bg-slate-700/50 rounded-xl p-4">
                  <div className="text-slate-400">IV Rank</div>
                  <div className="text-white font-bold text-lg">42%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-24 px-8">
        <div className="max-w-4xl mx-auto text-center bg-gradient-to-r from-amber-500/10 to-amber-600/10 border border-amber-500/30 rounded-3xl p-12">
          <h2 className="text-4xl font-display font-bold text-white mb-4">
            Ready to Transform Your Trading?
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Join thousands of traders using institutional-grade analytics
          </p>
          <Link
            to="/signup"
            className="inline-flex px-8 py-4 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-bold text-lg rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all shadow-xl shadow-amber-500/30"
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-8 px-8 border-t border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo.jpeg" alt="Kotsin" className="w-8 h-8 rounded-lg" />
            <span className="text-slate-400">Kotsin Trading Platform</span>
          </div>
          <div className="text-slate-500 text-sm">
            Institutional-Grade Quantitative Analytics
          </div>
        </div>
      </footer>
    </div>
  )
}
