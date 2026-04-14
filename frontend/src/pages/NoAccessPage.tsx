export default function NoAccessPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-8 max-w-lg text-center">
        <h1 className="text-2xl font-bold text-amber-400 mb-3">Access Pending</h1>
        <p className="text-slate-400">
          Your account has no pages enabled yet. Please contact your administrator to request access.
        </p>
      </div>
    </div>
  );
}
