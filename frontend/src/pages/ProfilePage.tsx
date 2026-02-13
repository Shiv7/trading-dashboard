import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { profileApi, authApi, type UserProfile } from '../services/api'

type Tab = 'personal' | 'preferences' | 'notifications' | 'security'

export default function ProfilePage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('personal')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Personal info form
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')

  // Preferences form
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [defaultLotSize, setDefaultLotSize] = useState(1)
  const [riskTolerance, setRiskTolerance] = useState('MODERATE')

  // Notification form
  const [inApp, setInApp] = useState(true)
  const [telegramEnabled, setTelegramEnabled] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(false)

  // Password form
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    profileApi.getProfile().then((p) => {
      setProfile(p)
      setDisplayName(p.displayName || '')
      setEmail(p.email || '')
      if (p.preferences) {
        setTimezone(p.preferences.timezone || 'Asia/Kolkata')
        setDefaultLotSize(p.preferences.defaultLotSize || 1)
        setRiskTolerance(p.preferences.riskTolerance || 'MODERATE')
        if (p.preferences.notificationSettings) {
          setInApp(p.preferences.notificationSettings.inApp)
          setTelegramEnabled(p.preferences.notificationSettings.telegram)
          setEmailEnabled(p.preferences.notificationSettings.email)
        }
      }
    }).catch(() => setMessage({ type: 'error', text: 'Failed to load profile' }))
  }, [])

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleSavePersonal = async () => {
    setSaving(true)
    try {
      const updated = await profileApi.updateProfile({ displayName, email } as Partial<UserProfile>)
      setProfile(updated)
      showMessage('success', 'Profile updated')
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to update')
    }
    setSaving(false)
  }

  const handleSavePreferences = async () => {
    setSaving(true)
    try {
      const updated = await profileApi.updatePreferences({
        timezone,
        defaultLotSize,
        riskTolerance,
        preferredInstruments: profile?.preferences?.preferredInstruments || [],
        notificationSettings: profile?.preferences?.notificationSettings || { telegram: false, email: false, inApp: true },
      })
      setProfile(updated)
      showMessage('success', 'Preferences updated')
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to update')
    }
    setSaving(false)
  }

  const handleSaveNotifications = async () => {
    setSaving(true)
    try {
      const updated = await profileApi.updateNotifications({
        telegram: telegramEnabled,
        email: emailEnabled,
        inApp,
      } as unknown as UserProfile['preferences'])
      setProfile(updated)
      showMessage('success', 'Notifications updated')
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to update')
    }
    setSaving(false)
  }

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      showMessage('error', 'Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      showMessage('error', 'Password must be at least 6 characters')
      return
    }
    setSaving(true)
    try {
      await authApi.changePassword({ oldPassword, newPassword })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showMessage('success', 'Password changed successfully')
    } catch (err) {
      showMessage('error', err instanceof Error ? err.message : 'Failed to change password')
    }
    setSaving(false)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'personal', label: 'Personal Info' },
    { key: 'preferences', label: 'Trading Preferences' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'security', label: 'Security' },
  ]

  const inputClass = "w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
  const labelClass = "block text-sm font-medium text-slate-300 mb-2"

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-display font-bold text-white mb-6">Profile Settings</h1>

      {/* Message */}
      {message && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${
          message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' :
          'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-800/50 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-amber-500 text-slate-900'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-2xl p-8">
        {/* Personal Info Tab */}
        {activeTab === 'personal' && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-2xl font-bold text-slate-900">
                {user?.displayName?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <p className="text-lg font-semibold text-white">{user?.displayName || user?.username}</p>
                <p className="text-sm text-slate-400">{user?.role} account</p>
              </div>
            </div>
            <div>
              <label className={labelClass}>Display Name</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Username</label>
              <input type="text" value={user?.username || ''} disabled className={`${inputClass} opacity-50 cursor-not-allowed`} />
              <p className="text-xs text-slate-500 mt-1">Username cannot be changed</p>
            </div>
            <button onClick={handleSavePersonal} disabled={saving}
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-bold rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Preferences Tab */}
        {activeTab === 'preferences' && (
          <div className="space-y-6">
            <div>
              <label className={labelClass}>Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className={inputClass}>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Default Lot Size</label>
              <input type="number" min={1} value={defaultLotSize} onChange={e => setDefaultLotSize(parseInt(e.target.value) || 1)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Risk Tolerance</label>
              <div className="flex gap-3">
                {['LOW', 'MODERATE', 'HIGH'].map(level => (
                  <button key={level} onClick={() => setRiskTolerance(level)}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all border ${
                      riskTolerance === level
                        ? level === 'LOW' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                          : level === 'MODERATE' ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                          : 'bg-red-500/20 border-red-500/50 text-red-400'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}>
                    {level}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={handleSavePreferences} disabled={saving}
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-bold rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            {[
              { label: 'In-App Notifications', desc: 'Toast and bell notifications in the dashboard', checked: inApp, onChange: setInApp },
              { label: 'Telegram Alerts', desc: 'Get trade signals and P&L updates via Telegram', checked: telegramEnabled, onChange: setTelegramEnabled },
              { label: 'Email Notifications', desc: 'Receive daily summaries and important alerts via email', checked: emailEnabled, onChange: setEmailEnabled },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between p-4 bg-slate-900/30 rounded-xl">
                <div>
                  <p className="text-white font-medium">{item.label}</p>
                  <p className="text-sm text-slate-400">{item.desc}</p>
                </div>
                <button onClick={() => item.onChange(!item.checked)}
                  className={`w-12 h-6 rounded-full transition-all relative ${item.checked ? 'bg-amber-500' : 'bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${item.checked ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
            <button onClick={handleSaveNotifications} disabled={saving}
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-bold rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Notifications'}
            </button>
          </div>
        )}

        {/* Security Tab */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-white">Change Password</h3>
            <div>
              <label className={labelClass}>Current Password</label>
              <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} className={inputClass} placeholder="Enter current password" />
            </div>
            <div>
              <label className={labelClass}>New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputClass} placeholder="Min 6 characters" />
            </div>
            <div>
              <label className={labelClass}>Confirm New Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputClass} placeholder="Confirm new password" />
            </div>
            <button onClick={handleChangePassword} disabled={saving || !oldPassword || !newPassword}
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-bold rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50">
              {saving ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
