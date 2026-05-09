import { test, expect, Page, ConsoleMessage, Request } from '@playwright/test'

/**
 * Smoke test: visits every route defined in src/App.tsx and fails on any console
 * error or network request failure. Purpose: catch regressions like the 2026-04-24
 * /health-check crash (undefined `.icon` on a missing status type) before users do.
 *
 * Auth strategy:
 *   - If env KOTSIN_TEST_USERNAME + KOTSIN_TEST_PASSWORD are set, we login via
 *     POST /api/auth/login and seed localStorage (`kotsin_auth_token` + `kotsin_user`)
 *     in the browser context so protected routes render as the logged-in user.
 *   - Otherwise protected routes will redirect to /login — test still asserts zero
 *     console errors during that redirect flow (which is itself a valid smoke check).
 *
 * Routes list is kept in sync with src/App.tsx manually — CI should warn if App.tsx
 * grows new routes not covered here.
 */

// Routes extracted from src/App.tsx on 2026-04-24 — keep in sync.
// { path, authRequired, adminOnly, dynamicParam? }
type Route = {
  path: string
  label: string
  authRequired: boolean
  adminOnly?: boolean
  dynamic?: boolean // path has :param — we substitute a sample value
}

const ROUTES: Route[] = [
  // Public
  { path: '/',         label: 'LandingPage',        authRequired: false },
  { path: '/login',    label: 'LoginPage',          authRequired: false },
  { path: '/signup',   label: 'SignupPage',         authRequired: false },

  // Protected
  { path: '/no-access',             label: 'NoAccessPage',            authRequired: true },
  { path: '/live',                  label: 'LivePage',                authRequired: true },
  { path: '/dashboard',             label: 'DashboardPage',           authRequired: true },
  { path: '/positions',             label: 'WalletPage',              authRequired: true },
  { path: '/trades',                label: 'TradesPage',              authRequired: true },
  { path: '/insights',              label: 'InsightsPage',            authRequired: true },
  { path: '/command-center',        label: 'InsightsPage (legacy)',   authRequired: true },
  { path: '/market-intelligence',   label: 'InsightsPage (legacy2)',  authRequired: true },
  { path: '/market-pulse',          label: 'MarketPulsePage',         authRequired: true },
  { path: '/hot-stocks',            label: 'HotStocksPage',           authRequired: true },
  { path: '/research/RELIANCE',     label: 'HotStocksDetailPage',     authRequired: true, dynamic: true },
  { path: '/quant-scores',          label: 'QuantScoresPage',         authRequired: true },
  { path: '/signals',               label: 'SignalsPage',             authRequired: true },
  { path: '/stock/500325',          label: 'StockDetailPage',         authRequired: true, dynamic: true },
  { path: '/performance',           label: 'PerformancePage',         authRequired: true },
  { path: '/patterns',              label: 'PatternsPage',            authRequired: true },
  { path: '/risk',                  label: 'RiskPage',                authRequired: true },
  { path: '/strategy',              label: 'StrategyTransparencyPage', authRequired: true },
  { path: '/order-history',         label: 'OrderHistoryPage',        authRequired: true },
  { path: '/profile',               label: 'ProfilePage',             authRequired: true },
  { path: '/admin',                 label: 'AdminPage',               authRequired: true, adminOnly: true },
  { path: '/watchlist',             label: 'WatchlistPage',           authRequired: true },
  { path: '/pnl',                   label: 'PnLDashboardPage',        authRequired: true },
  { path: '/wallets',               label: 'StrategyWalletsPage',     authRequired: true },
  { path: '/signal-audit',          label: 'SignalAuditPage',         authRequired: true },
  { path: '/ws-audit',              label: 'WsAuditPage',             authRequired: true },
  { path: '/orders',                label: 'OrderManagementPage',     authRequired: true },
  { path: '/ml-shadow',             label: 'MLShadowPage',            authRequired: true },
  { path: '/greek-trailing',        label: 'GreekTrailingPage',       authRequired: true },
  { path: '/pivotboss',             label: 'PivotBossPage',           authRequired: true },
  { path: '/pivotboss-analytics',   label: 'PivotBossAnalyticsPage',  authRequired: true },
  { path: '/monday-ship',           label: 'MondayShipPage',          authRequired: true },
  { path: '/health-check',          label: 'HealthCheckPage',         authRequired: true, adminOnly: true },
]

const AUTH_TOKEN_KEY = 'kotsin_auth_token'
const USER_KEY = 'kotsin_user'

const USERNAME = process.env.KOTSIN_TEST_USERNAME
const PASSWORD = process.env.KOTSIN_TEST_PASSWORD

/**
 * Login via API and return the token + user JSON. Used to seed localStorage before
 * navigating to protected routes.
 */
async function fetchAuthSession(baseURL: string): Promise<{ token: string; user: unknown } | null> {
  if (!USERNAME || !PASSWORD) return null
  const res = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })
  if (!res.ok) {
    console.warn(`[smoke] auth login failed: HTTP ${res.status}`)
    return null
  }
  const body = await res.json() as { token: string; user: unknown }
  return { token: body.token, user: body.user }
}

/**
 * Console messages we intentionally ignore because they're not actionable signals of
 * broken pages. Examples: third-party analytics warnings, expected 401s on logged-out
 * /api/auth/me probes, dev HMR noise.
 */
const IGNORE_CONSOLE_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /\[vite\]/i,
  /WebSocket connection to .* failed/i, // STOMP reconnects are noisy but not crashes
  /net::ERR_INTERNET_DISCONNECTED/i,
]

const IGNORE_NETWORK_PATTERNS: RegExp[] = [
  /\/api\/auth\/me/,       // 401 expected when unauthenticated
  /\/api\/auth\/refresh/,  // 401 expected
  /\.hot-update\./,
  /google-analytics|googletagmanager|doubleclick/i,
  /sockjs-node|\/ws\b/,    // websocket failures aren't page crashes
]

type Failure = { kind: 'console' | 'network'; text: string }

function attachListeners(page: Page): Failure[] {
  const failures: Failure[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORE_CONSOLE_PATTERNS.some(r => r.test(text))) return
    failures.push({ kind: 'console', text })
  })
  page.on('pageerror', (err: Error) => {
    // Uncaught exceptions — always a real crash.
    failures.push({ kind: 'console', text: `PAGE ERROR: ${err.message}` })
  })
  page.on('requestfailed', (req: Request) => {
    const url = req.url()
    if (IGNORE_NETWORK_PATTERNS.some(r => r.test(url))) return
    const err = req.failure()?.errorText ?? 'unknown'
    failures.push({ kind: 'network', text: `${req.method()} ${url} -> ${err}` })
  })
  return failures
}

let authSession: { token: string; user: unknown } | null = null

test.beforeAll(async ({ }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL as string
  authSession = await fetchAuthSession(baseURL)
  if (!authSession) {
    console.warn('[smoke] no auth session — protected routes will be tested as /login redirects')
    console.warn('[smoke] set KOTSIN_TEST_USERNAME + KOTSIN_TEST_PASSWORD to test logged-in flows')
  } else {
    console.log('[smoke] auth session acquired for', (authSession.user as { username?: string })?.username)
  }
})

for (const route of ROUTES) {
  test(`page ${route.path} (${route.label})`, async ({ page, baseURL }) => {
    const failures = attachListeners(page)

    // Seed auth into localStorage before first navigation so ProtectedRoute sees a
    // user on mount (avoids /login redirect flash).
    if (authSession && route.authRequired) {
      await page.addInitScript(
        ({ token, user, tokenKey, userKey }) => {
          localStorage.setItem(tokenKey, token)
          localStorage.setItem(userKey, JSON.stringify(user))
        },
        {
          token: authSession.token,
          user: authSession.user,
          tokenKey: AUTH_TOKEN_KEY,
          userKey: USER_KEY,
        },
      )
    }

    const url = `${baseURL}${route.path}`
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(response, `No response for ${url}`).toBeTruthy()
    expect(response!.status(), `HTTP status for ${url}`).toBeLessThan(500)

    // Wait for either networkidle OR a 5s settle — some pages have long-poll WS which
    // never goes idle. 5s is enough for lazy-loaded chunks to finish rendering.
    try {
      await page.waitForLoadState('networkidle', { timeout: 8_000 })
    } catch {
      // networkidle timeout is fine — WS keepalive is expected on some pages
    }
    // small settle for React Suspense fallbacks to resolve
    await page.waitForTimeout(1_500)

    if (failures.length > 0) {
      const summary = failures.map(f => `  [${f.kind}] ${f.text}`).join('\n')
      throw new Error(`${failures.length} failure(s) on ${route.path}:\n${summary}`)
    }
  })
}
