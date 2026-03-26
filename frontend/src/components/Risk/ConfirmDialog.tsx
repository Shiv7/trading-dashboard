interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  variant?: 'danger' | 'warning' | 'info'
}

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, variant = 'danger' }: ConfirmDialogProps) {
  const btnColor = variant === 'danger' ? 'bg-red-600 hover:bg-red-700'
    : variant === 'warning' ? 'bg-orange-600 hover:bg-orange-700'
    : 'bg-blue-600 hover:bg-blue-700'

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className={`px-4 py-2 ${btnColor} text-white text-sm rounded-lg font-medium transition-colors`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
