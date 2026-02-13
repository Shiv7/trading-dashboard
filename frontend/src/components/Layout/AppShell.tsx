import Sidebar from './Sidebar'
import TopBar from './TopBar'
import MobileTabBar from './MobileTabBar'

interface AppShellProps {
  children: React.ReactNode
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-950">
      {/* Sidebar - desktop only */}
      <Sidebar />

      {/* Main area with TopBar */}
      <div className="lg:pl-56">
        <TopBar />

        {/* Page content */}
        <main className="px-4 lg:px-6 py-6 pb-24 lg:pb-6 page-enter">
          <div className="max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile tab bar - mobile only */}
      <MobileTabBar />
    </div>
  )
}
