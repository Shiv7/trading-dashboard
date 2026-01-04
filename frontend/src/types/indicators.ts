
// IPU Signal types
export interface IPUSignal {
  scripCode: string;
  companyName: string;
  timeframe: string;
  timestamp: string;

  // Overall Score
  ipuFinalScore: number;
  ipuDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';

  // Core Components
  institutionalProxy: number;
  momentum: number;
  exhaustion: number;
  urgency: number;

  // Volume Metrics
  aggressiveBuyVolume: number;
  aggressiveSellVolume: number;
  totalVolume: number;
  volumeExpansionPct: number;
  aggressiveVolumeRatio: number;

  // Directional Conviction
  directionalConviction: number;
  volumeDeltaPct: number;

  // X-Factor
  dibTriggered: boolean;
  vibTriggered: boolean;
  hasXFactor: boolean;

  // Adjustments
  gapStatus: string;
  gapConvictionMultiplier: number;
  liquidityTier: string;
  liquidityPenalty: number;
  
  // OFI
  ofiPressure: number;
  ofiSignal: string;

  // Metrics
  priceEfficiency: number;
  runBarTriggered: boolean;
  momentumState: string;
  usedPassiveVolume: boolean;
}

// VCP Signal types
export interface VolumeCluster {
  price: number;
  type: 'SUPPLY' | 'DEMAND' | 'POC' | 'VA_HIGH' | 'VA_LOW' | 'UNKNOWN';
  volume: number;
  penetrationScore: number;
  distanceFromPrice: number | null;
  isActive: boolean;
  significance: 'STRONG' | 'MEDIUM' | 'WEAK';
}

export interface VCPSignal {
  scripCode: string;
  companyName: string;
  timeframe: string;
  timestamp: string;

  // Overall Score
  vcpCombinedScore: number;
  vcpSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';

  // Clusters
  clusters: VolumeCluster[];
  pocCluster: VolumeCluster | null;
  vahCluster: VolumeCluster | null;
  valCluster: VolumeCluster | null;

  // Scores
  runwayScore: number;
  structuralBias: number;
  penetrationScore: number;
  alignmentScore: number;

  // Context
  currentPrice: number;
  kyleLambda: number;
  pricePosition: 'ABOVE_POC' | 'BELOW_POC' | 'AT_POC';

  // Metrics
  totalClusters: number;
  avgClusterStrength: number;
  hasStrongSupport: boolean;
  hasStrongResistance: boolean;

  // Profile
  totalVolume: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  pointOfControl: number;
}
