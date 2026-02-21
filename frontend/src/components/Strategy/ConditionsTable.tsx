import React from 'react';
import { CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react';
import { StrategyCondition, getCategoryColor } from '../../types/strategy';

interface ConditionsTableProps {
  conditions: StrategyCondition[];
  compact?: boolean;
}

export const ConditionsTable: React.FC<ConditionsTableProps> = ({
  conditions,
  compact = false
}) => {
  if (!conditions || conditions.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No condition details available
      </div>
    );
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'REQUIRED':
        return <AlertCircle className="w-3 h-3 text-red-400" />;
      case 'OPTIMAL':
        return <CheckCircle className="w-3 h-3 text-yellow-400" />;
      case 'BONUS':
        return <Info className="w-3 h-3 text-blue-400" />;
      default:
        return <Info className="w-3 h-3 text-gray-400" />;
    }
  };

  const getProgressBar = (progress: number, passed: boolean) => {
    const color = passed ? 'bg-green-500' : progress >= 75 ? 'bg-yellow-500' : 'bg-gray-500';
    return (
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div
          className={`${color} h-1.5 rounded-full transition-all duration-300`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    );
  };

  if (compact) {
    return (
      <div className="space-y-1">
        {conditions.map((c, i) => (
          <div
            key={i}
            className={`flex items-center justify-between p-1.5 rounded text-xs ${
              c.passed ? 'bg-green-500/10' : 'bg-gray-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {c.passed ? (
                <CheckCircle className="w-3 h-3 text-green-400" />
              ) : (
                <XCircle className="w-3 h-3 text-gray-500" />
              )}
              <span className={c.passed ? 'text-gray-200' : 'text-gray-400'}>
                {c.name}
              </span>
            </div>
            <span className={`font-mono ${c.passed ? 'text-green-400' : 'text-gray-500'}`}>
              {c.progressPercent}%
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Mobile: compact card layout */}
      <div className="md:hidden space-y-1.5">
        {conditions.map((c, i) => (
          <div
            key={i}
            className={`flex items-center justify-between p-2 rounded text-xs ${
              c.passed ? 'bg-green-500/10' : 'bg-gray-800'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {c.passed ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              )}
              <div className="min-w-0">
                <span className={`block truncate ${c.passed ? 'text-gray-200' : 'text-gray-400'}`}>
                  {c.name}
                </span>
                {c.explanation && (
                  <span className="text-gray-600 text-[10px] block truncate">{c.explanation}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <div className="w-12">
                {getProgressBar(c.progressPercent, c.passed)}
              </div>
              <span className={`font-mono text-[10px] w-7 text-right ${c.passed ? 'text-green-400' : 'text-gray-500'}`}>
                {c.progressPercent}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: full table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs border-b border-gray-700">
              <th className="text-left py-2 px-2">Condition</th>
              <th className="text-left py-2 px-2">Category</th>
              <th className="text-left py-2 px-2">Current</th>
              <th className="text-left py-2 px-2">Required</th>
              <th className="text-center py-2 px-2">Status</th>
              <th className="text-right py-2 px-2 w-24">Progress</th>
            </tr>
          </thead>
          <tbody>
            {conditions.map((c, i) => (
              <tr
                key={i}
                className={`border-b border-gray-800 ${
                  c.passed ? 'bg-green-500/5' : ''
                } hover:bg-gray-800/50 transition-colors`}
              >
                <td className="py-2 px-2">
                  <div className="flex flex-col">
                    <span className="text-gray-200 font-medium">{c.name}</span>
                    {c.explanation && (
                      <span className="text-gray-500 text-xs mt-0.5">
                        {c.explanation}
                      </span>
                    )}
                    {c.timeframe && (
                      <span className="text-gray-600 text-xs">
                        [{c.source || ''} {c.timeframe}]
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-2">
                  <div className="flex items-center gap-1">
                    {getCategoryIcon(c.category)}
                    <span className={`text-xs ${getCategoryColor(c.category)}`}>
                      {c.category}
                    </span>
                  </div>
                </td>
                <td className="py-2 px-2">
                  <span className={`font-mono text-xs ${
                    c.passed ? 'text-green-400' : 'text-gray-300'
                  }`}>
                    {c.currentValue}
                  </span>
                </td>
                <td className="py-2 px-2">
                  <span className="font-mono text-xs text-gray-400">
                    {c.requiredValue}
                  </span>
                </td>
                <td className="py-2 px-2 text-center">
                  {c.passed ? (
                    <CheckCircle className="w-5 h-5 text-green-400 mx-auto" />
                  ) : (
                    <XCircle className="w-5 h-5 text-gray-500 mx-auto" />
                  )}
                </td>
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      {getProgressBar(c.progressPercent, c.passed)}
                    </div>
                    <span className={`font-mono text-xs w-8 text-right ${
                      c.passed ? 'text-green-400' : 'text-gray-400'
                    }`}>
                      {c.progressPercent}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default ConditionsTable;
