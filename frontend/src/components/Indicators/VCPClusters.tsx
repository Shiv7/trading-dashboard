import { VCPSignal } from '../../types/indicators'

interface VCPClustersProps {
    data: VCPSignal;
}

export function VCPClusters({ data }: VCPClustersProps) {

    // Find key clusters
    const poc = data.pocCluster
    const clusters = data.clusters || []

    // Calculate relative widths for visualization
    const maxVol = Math.max(...clusters.map(c => c.volume))

    return (
        <div className="card">
            <div className="card-header flex justify-between items-center">
                <span>📊 VCP Clusters</span>
                <div className={`text-xl font-bold ${data.vcpCombinedScore >= 60 ? 'text-emerald-400' : data.vcpCombinedScore <= 40 ? 'text-red-400' : 'text-amber-400'}`}>
                    {data.vcpCombinedScore.toFixed(0)}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4 text-center text-xs">
                <div className="bg-slate-700/30 p-2 rounded">
                    <div className="text-slate-400">Runway</div>
                    <div className="font-bold text-white">{(data.runwayScore * 100).toFixed(0)}%</div>
                </div>
                <div className="bg-slate-700/30 p-2 rounded">
                    <div className="text-slate-400">Bias</div>
                    <div className="font-bold text-white">{data.structuralBias.toFixed(2)}</div>
                </div>
                <div className="bg-slate-700/30 p-2 rounded">
                    <div className="text-slate-400">Clusters</div>
                    <div className="font-bold text-white">{data.totalClusters}</div>
                </div>
            </div>

            {/* Cluster Visualization List */}
            <div className="space-y-1 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                {clusters.sort((a, b) => b.price - a.price).map((cluster, idx) => {
                    const isPOC = poc && Math.abs(cluster.price - poc.price) < 0.01
                    const isCurrent = Math.abs(cluster.price - data.currentPrice) / data.currentPrice < 0.001 // Within 0.1%

                    return (
                        <div key={idx} className={`relative flex items-center text-xs p-1 ${isCurrent ? 'bg-blue-500/20 ring-1 ring-blue-500' : ''}`}>
                            <div className="w-16 text-right font-mono text-slate-300 mr-2">
                                {cluster.price.toFixed(2)}
                            </div>

                            {/* Volume Bar */}
                            <div className="flex-1 h-4 bg-slate-800 rounded-sm relative overflow-hidden">
                                <div
                                    className={`absolute left-0 top-0 bottom-0 ${cluster.type === 'SUPPLY' ? 'bg-red-500/40' : cluster.type === 'DEMAND' ? 'bg-emerald-500/40' : 'bg-slate-500/40'}`}
                                    style={{ width: `${(cluster.volume / maxVol) * 100}%` }}
                                />
                                {isPOC && (
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-400 shadow-[0_0_5px_rgba(250,204,21,0.5)]"></div>
                                )}
                            </div>

                            <div className="w-8 text-right text-slate-500 ml-2">
                                {cluster.type === 'POC' ? 'POC' : cluster.type.substring(0, 3)}
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="mt-3 text-xs text-center text-slate-500">
                Current Price: <span className="text-white font-mono">{data.currentPrice.toFixed(2)}</span> •
                Position: <span className={data.pricePosition === 'ABOVE_POC' ? 'text-emerald-400' : data.pricePosition === 'BELOW_POC' ? 'text-red-400' : 'text-slate-400'}>{data.pricePosition.replace('_', ' ')}</span>
            </div>
        </div>
    )
}
