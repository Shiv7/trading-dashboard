import React from 'react';
import {
  ArrowRight,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Activity
} from 'lucide-react';
import {
  MtfAnalysis,
  getBiasColor,
  getZoneColor,
  getFlowStatusColor,
  getQualityTierColor
} from '../../types/strategy';

interface MtfAnalysisPanelProps {
  analysis: MtfAnalysis;
}

export const MtfAnalysisPanel: React.FC<MtfAnalysisPanelProps> = ({ analysis }) => {
  if (!analysis) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No MTF analysis available
      </div>
    );
  }

  // Calculate position in swing range
  const position = analysis.rangePositionPercent;

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          MTF Analysis
        </h4>
        <span className={`text-xs px-2 py-0.5 rounded ${getQualityTierColor(analysis.qualityTierDisplay)}`}>
          {analysis.qualityTierDisplay} Tier
        </span>
      </div>

      {/* Hierarchical Bias */}
      <div className="bg-gray-900/50 rounded p-3">
        <div className="text-xs text-gray-500 mb-2">Hierarchical Bias</div>
        <div className="flex items-center justify-center gap-4">
          <div className="text-center">
            <div className="text-xs text-gray-500">HTF ({analysis.htfTimeframe})</div>
            <div className={`text-lg font-bold ${getBiasColor(analysis.htfBias)}`}>
              {analysis.htfBias === 'BULLISH' ? (
                <TrendingUp className="w-6 h-6 mx-auto" />
              ) : analysis.htfBias === 'BEARISH' ? (
                <TrendingDown className="w-6 h-6 mx-auto" />
              ) : (
                <span className="text-gray-500">?</span>
              )}
            </div>
            <div className={`text-sm ${getBiasColor(analysis.htfBias)}`}>
              {analysis.htfBias}
            </div>
          </div>

          <ArrowRight className="w-5 h-5 text-gray-600" />

          <div className="text-center">
            <div className="text-xs text-gray-500">LTF ({analysis.ltfTimeframe})</div>
            <div className={`text-lg font-bold ${getBiasColor(analysis.ltfBias)}`}>
              {analysis.ltfBias === 'BULLISH' ? (
                <TrendingUp className="w-6 h-6 mx-auto" />
              ) : analysis.ltfBias === 'BEARISH' ? (
                <TrendingDown className="w-6 h-6 mx-auto" />
              ) : (
                <span className="text-gray-500">?</span>
              )}
            </div>
            <div className={`text-sm ${getBiasColor(analysis.ltfBias)}`}>
              {analysis.ltfBias}
            </div>
          </div>

          <div className="flex items-center gap-1 ml-4">
            {analysis.biasAligned ? (
              <>
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-green-400 text-sm">ALIGNED</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-400 text-sm">DIVERGENT</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Swing Range Visual */}
      <div className="bg-gray-900/50 rounded p-3">
        <div className="text-xs text-gray-500 mb-2">Swing Range</div>
        <div className="relative h-8 bg-gradient-to-r from-green-900/30 via-yellow-900/30 to-red-900/30 rounded">
          {/* Equilibrium line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-yellow-500/50"
            style={{ left: '50%' }}
          />
          {/* Current position */}
          <div
            className="absolute top-1 bottom-1 w-2 bg-blue-400 rounded"
            style={{ left: `calc(${Math.min(100, Math.max(0, position))}% - 4px)` }}
          />
          {/* Labels */}
          <div className="absolute left-1 top-1 text-xs text-green-400 font-mono">
            {analysis.swingLow.toFixed(2)}
          </div>
          <div className="absolute right-1 top-1 text-xs text-red-400 font-mono">
            {analysis.swingHigh.toFixed(2)}
          </div>
        </div>
        <div className="flex justify-between mt-1 text-xs">
          <span className="text-green-400">DISCOUNT</span>
          <span className="text-yellow-400">EQ: {analysis.equilibrium.toFixed(2)}</span>
          <span className="text-red-400">PREMIUM</span>
        </div>
        <div className="mt-2 text-center">
          <span className={`text-sm ${getZoneColor(analysis.zonePosition)}`}>
            {analysis.zonePosition}
          </span>
          <span className="text-gray-400 text-sm ml-2">
            ({position.toFixed(0)}%)
          </span>
        </div>
      </div>

      {/* Flow Status */}
      <div className="bg-gray-900/50 rounded p-3">
        <div className="flex justify-between items-center">
          <div className="text-xs text-gray-500">F&O Flow</div>
          <span className={`text-sm font-medium ${getFlowStatusColor(analysis.flowStatus)}`}>
            {analysis.flowStatus}
          </span>
        </div>
        {analysis.flowInterpretation && (
          <div className="text-sm text-gray-300 mt-1">
            {analysis.flowInterpretation}
          </div>
        )}
        {analysis.flowReason && (
          <div className="text-xs text-gray-500 mt-1">
            {analysis.flowReason}
          </div>
        )}
      </div>

      {/* Entry Sequence */}
      <div className="bg-gray-900/50 rounded p-3">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs text-gray-500">Entry Sequence</div>
          <span className="text-sm font-mono">
            <span className={analysis.coreRequirementsMet ? 'text-green-400' : 'text-gray-400'}>
              {analysis.completedSteps}
            </span>
            <span className="text-gray-600">/{analysis.totalSteps}</span>
          </span>
        </div>
        {/* Progress blocks */}
        <div className="flex gap-1 mb-2">
          {Array.from({ length: analysis.totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-2 rounded ${
                i < analysis.completedSteps ? 'bg-green-500' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>
        {/* Missing steps */}
        {analysis.missingStepNames && analysis.missingStepNames.length > 0 && (
          <div className="text-xs text-gray-500">
            Missing: <span className="text-orange-400">
              {analysis.missingStepNames.join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* SMC Details */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className={`p-2 rounded ${analysis.ltfSweepDetected ? 'bg-green-500/10' : 'bg-gray-900/50'}`}>
          <span className="text-gray-500">Sweep:</span>
          <span className={`ml-1 ${analysis.ltfSweepDetected ? 'text-green-400' : 'text-gray-500'}`}>
            {analysis.ltfSweepDetected ? analysis.ltfSweepSide : 'None'}
          </span>
        </div>
        <div className={`p-2 rounded ${analysis.ltfChochDetected || analysis.ltfBosDetected ? 'bg-green-500/10' : 'bg-gray-900/50'}`}>
          <span className="text-gray-500">Break:</span>
          <span className={`ml-1 ${analysis.ltfChochDetected || analysis.ltfBosDetected ? 'text-green-400' : 'text-gray-500'}`}>
            {analysis.ltfChochDetected
              ? `CHoCH ${analysis.ltfChochDirection}`
              : analysis.ltfBosDetected
                ? `BOS ${analysis.ltfBosDirection}`
                : 'None'}
          </span>
        </div>
        <div className={`p-2 rounded ${analysis.atHtfDemand ? 'bg-green-500/10' : 'bg-gray-900/50'}`}>
          <span className="text-gray-500">HTF Demand:</span>
          <span className={`ml-1 ${analysis.atHtfDemand ? 'text-green-400' : 'text-gray-500'}`}>
            {analysis.atHtfDemand ? 'At Zone' : 'No'}
          </span>
        </div>
        <div className={`p-2 rounded ${analysis.atHtfSupply ? 'bg-red-500/10' : 'bg-gray-900/50'}`}>
          <span className="text-gray-500">HTF Supply:</span>
          <span className={`ml-1 ${analysis.atHtfSupply ? 'text-red-400' : 'text-gray-500'}`}>
            {analysis.atHtfSupply ? 'At Zone' : 'No'}
          </span>
        </div>
      </div>

      {/* Quality Summary */}
      {analysis.qualitySummary && (
        <div className="text-xs text-gray-400 border-t border-gray-700 pt-2">
          {analysis.qualitySummary}
        </div>
      )}
    </div>
  );
};

export default MtfAnalysisPanel;
