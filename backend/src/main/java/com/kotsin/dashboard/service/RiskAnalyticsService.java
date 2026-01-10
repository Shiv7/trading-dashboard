package com.kotsin.dashboard.service;

import com.kotsin.dashboard.kafka.SignalConsumer;
import com.kotsin.dashboard.model.dto.SignalDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * RiskAnalyticsService - Portfolio risk metrics and analysis
 *
 * Provides:
 * - Portfolio exposure analysis
 * - Concentration risk
 * - Correlation analysis
 * - VaR estimates
 * - Risk-adjusted metrics
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class RiskAnalyticsService {

    private final SignalConsumer signalConsumer;

    /**
     * Get comprehensive risk metrics
     */
    public RiskMetrics getRiskMetrics() {
        List<SignalDTO> signals = new ArrayList<>(signalConsumer.getAllSignals().values());
        List<SignalDTO> activeSignals = signals.stream()
                .filter(s -> s.isAllGatesPassed() && s.getTradeStatus() == null)
                .collect(Collectors.toList());

        List<SignalDTO> completedTrades = signals.stream()
                .filter(s -> s.getTradeStatus() != null)
                .collect(Collectors.toList());

        return RiskMetrics.builder()
                .portfolioExposure(calculatePortfolioExposure(activeSignals))
                .concentrationRisk(calculateConcentrationRisk(activeSignals))
                .sectorExposure(calculateSectorExposure(activeSignals))
                .directionExposure(calculateDirectionExposure(activeSignals))
                .riskBreakdown(calculateRiskBreakdown(activeSignals))
                .valueAtRisk(calculateVaR(completedTrades))
                .maxLossExposure(calculateMaxLossExposure(activeSignals))
                .correlationMetrics(calculateCorrelationMetrics(activeSignals))
                .riskScore(calculateOverallRiskScore(activeSignals, completedTrades))
                .alerts(generateRiskAlerts(activeSignals, completedTrades))
                .lastUpdated(LocalDateTime.now())
                .build();
    }

    private PortfolioExposure calculatePortfolioExposure(List<SignalDTO> activeSignals) {
        double totalLongExposure = activeSignals.stream()
                .filter(s -> "BULLISH".equals(s.getDirection()))
                .mapToDouble(s -> s.getEntryPrice() * getPositionSize(s))
                .sum();

        double totalShortExposure = activeSignals.stream()
                .filter(s -> "BEARISH".equals(s.getDirection()))
                .mapToDouble(s -> s.getEntryPrice() * getPositionSize(s))
                .sum();

        double netExposure = totalLongExposure - totalShortExposure;
        double grossExposure = totalLongExposure + totalShortExposure;

        return PortfolioExposure.builder()
                .longExposure(totalLongExposure)
                .shortExposure(totalShortExposure)
                .netExposure(netExposure)
                .grossExposure(grossExposure)
                .longCount(activeSignals.stream().filter(s -> "BULLISH".equals(s.getDirection())).count())
                .shortCount(activeSignals.stream().filter(s -> "BEARISH".equals(s.getDirection())).count())
                .netDirection(netExposure > 0 ? "LONG_BIAS" : netExposure < 0 ? "SHORT_BIAS" : "NEUTRAL")
                .build();
    }

    private ConcentrationRisk calculateConcentrationRisk(List<SignalDTO> activeSignals) {
        // Calculate HHI (Herfindahl-Hirschman Index) for concentration
        Map<String, Long> byStock = activeSignals.stream()
                .collect(Collectors.groupingBy(SignalDTO::getScripCode, Collectors.counting()));

        long total = activeSignals.size();
        double hhi = 0;
        if (total > 0) {
            for (Long count : byStock.values()) {
                double share = (double) count / total;
                hhi += share * share;
            }
        }

        // Top holdings
        List<Map.Entry<String, Long>> topHoldings = byStock.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(5)
                .collect(Collectors.toList());

        Map<String, Double> topHoldingsPercent = new LinkedHashMap<>();
        for (Map.Entry<String, Long> entry : topHoldings) {
            topHoldingsPercent.put(entry.getKey(), total > 0 ? (double) entry.getValue() / total * 100 : 0);
        }

        String riskLevel;
        if (hhi < 0.15) {
            riskLevel = "LOW";
        } else if (hhi < 0.25) {
            riskLevel = "MODERATE";
        } else {
            riskLevel = "HIGH";
        }

        return ConcentrationRisk.builder()
                .herfindahlIndex(hhi)
                .riskLevel(riskLevel)
                .uniqueStocks(byStock.size())
                .topHoldings(topHoldingsPercent)
                .singleStockMaxPercent(total > 0 ? (double) byStock.values().stream().max(Long::compare).orElse(0L) / total * 100 : 0)
                .build();
    }

    private Map<String, Double> calculateSectorExposure(List<SignalDTO> activeSignals) {
        // Group by company name prefix as a proxy for sector (in real impl, would use actual sector data)
        Map<String, Long> byCompany = activeSignals.stream()
                .collect(Collectors.groupingBy(
                        s -> s.getCompanyName() != null ? s.getCompanyName().split(" ")[0] : "Unknown",
                        Collectors.counting()
                ));

        long total = activeSignals.size();
        Map<String, Double> exposure = new HashMap<>();
        byCompany.forEach((sector, count) -> {
            exposure.put(sector, total > 0 ? (double) count / total * 100 : 0);
        });
        return exposure;
    }

    private DirectionExposure calculateDirectionExposure(List<SignalDTO> activeSignals) {
        long bullish = activeSignals.stream().filter(s -> "BULLISH".equals(s.getDirection())).count();
        long bearish = activeSignals.stream().filter(s -> "BEARISH".equals(s.getDirection())).count();
        long neutral = activeSignals.size() - bullish - bearish;

        double total = activeSignals.size();
        return DirectionExposure.builder()
                .bullishPercent(total > 0 ? bullish / total * 100 : 0)
                .bearishPercent(total > 0 ? bearish / total * 100 : 0)
                .neutralPercent(total > 0 ? neutral / total * 100 : 0)
                .bullishCount((int) bullish)
                .bearishCount((int) bearish)
                .neutralCount((int) neutral)
                .build();
    }

    private RiskBreakdown calculateRiskBreakdown(List<SignalDTO> activeSignals) {
        double totalRiskAmount = activeSignals.stream()
                .mapToDouble(s -> Math.abs(s.getEntryPrice() - s.getStopLoss()) * getPositionSize(s))
                .sum();

        double avgRiskPerTrade = activeSignals.isEmpty() ? 0 : totalRiskAmount / activeSignals.size();

        double avgRiskReward = activeSignals.stream()
                .filter(s -> s.getRiskRewardRatio() > 0)
                .mapToDouble(SignalDTO::getRiskRewardRatio)
                .average()
                .orElse(0);

        return RiskBreakdown.builder()
                .totalRiskAmount(totalRiskAmount)
                .averageRiskPerTrade(avgRiskPerTrade)
                .averageRiskReward(avgRiskReward)
                .openPositions(activeSignals.size())
                .build();
    }

    private ValueAtRisk calculateVaR(List<SignalDTO> completedTrades) {
        List<Double> returns = completedTrades.stream()
                .filter(s -> s.getRMultiple() != null)
                .map(SignalDTO::getRMultiple)
                .collect(Collectors.toList());

        if (returns.isEmpty()) {
            return ValueAtRisk.builder()
                    .var95(0)
                    .var99(0)
                    .expectedShortfall(0)
                    .sampleSize(0)
                    .build();
        }

        Collections.sort(returns);
        int n = returns.size();

        // 95% VaR (5th percentile)
        int var95Index = (int) Math.floor(n * 0.05);
        double var95 = var95Index < n ? returns.get(var95Index) : 0;

        // 99% VaR (1st percentile)
        int var99Index = (int) Math.floor(n * 0.01);
        double var99 = var99Index < n ? returns.get(var99Index) : returns.get(0);

        // Expected Shortfall (average of returns below VaR)
        double expectedShortfall = returns.stream()
                .filter(r -> r < var95)
                .mapToDouble(Double::doubleValue)
                .average()
                .orElse(var95);

        return ValueAtRisk.builder()
                .var95(Math.abs(var95))
                .var99(Math.abs(var99))
                .expectedShortfall(Math.abs(expectedShortfall))
                .sampleSize(n)
                .build();
    }

    private double calculateMaxLossExposure(List<SignalDTO> activeSignals) {
        return activeSignals.stream()
                .mapToDouble(s -> Math.abs(s.getEntryPrice() - s.getStopLoss()) * getPositionSize(s))
                .sum();
    }

    private CorrelationMetrics calculateCorrelationMetrics(List<SignalDTO> activeSignals) {
        // Simplified correlation - count signals from same source or similar direction
        Map<String, Long> bySource = activeSignals.stream()
                .filter(s -> s.getSignalSource() != null)
                .collect(Collectors.groupingBy(SignalDTO::getSignalSource, Collectors.counting()));

        long maxFromSingleSource = bySource.values().stream().max(Long::compare).orElse(0L);
        double sourceConcentration = activeSignals.isEmpty() ? 0 : (double) maxFromSingleSource / activeSignals.size();

        return CorrelationMetrics.builder()
                .sourceConcentration(sourceConcentration)
                .diversificationScore(1 - sourceConcentration)
                .signalsBySource(bySource)
                .build();
    }

    private RiskScore calculateOverallRiskScore(List<SignalDTO> activeSignals, List<SignalDTO> completedTrades) {
        // Calculate overall risk score (0-100, higher = more risky)
        double concentrationScore = 0;
        double exposureScore = 0;
        double varScore = 0;

        // Concentration component
        ConcentrationRisk concentration = calculateConcentrationRisk(activeSignals);
        concentrationScore = concentration.getHerfindahlIndex() * 100;

        // Exposure component (based on net direction bias)
        DirectionExposure direction = calculateDirectionExposure(activeSignals);
        double directionBias = Math.abs(direction.getBullishPercent() - direction.getBearishPercent());
        exposureScore = directionBias;

        // VaR component
        ValueAtRisk var = calculateVaR(completedTrades);
        varScore = Math.min(var.getVar95() * 20, 100); // Scale VaR to 0-100

        double overallScore = (concentrationScore * 0.3) + (exposureScore * 0.3) + (varScore * 0.4);

        String riskLevel;
        if (overallScore < 30) {
            riskLevel = "LOW";
        } else if (overallScore < 60) {
            riskLevel = "MODERATE";
        } else {
            riskLevel = "HIGH";
        }

        return RiskScore.builder()
                .score(Math.min(overallScore, 100))
                .level(riskLevel)
                .concentrationComponent(concentrationScore)
                .exposureComponent(exposureScore)
                .varComponent(varScore)
                .build();
    }

    private List<RiskAlert> generateRiskAlerts(List<SignalDTO> activeSignals, List<SignalDTO> completedTrades) {
        List<RiskAlert> alerts = new ArrayList<>();

        // Check concentration
        ConcentrationRisk concentration = calculateConcentrationRisk(activeSignals);
        if ("HIGH".equals(concentration.getRiskLevel())) {
            alerts.add(RiskAlert.builder()
                    .type("CONCENTRATION")
                    .severity("HIGH")
                    .message("High concentration risk detected - HHI: " + String.format("%.2f", concentration.getHerfindahlIndex()))
                    .recommendation("Consider diversifying across more stocks")
                    .build());
        }

        // Check direction bias
        DirectionExposure direction = calculateDirectionExposure(activeSignals);
        if (direction.getBullishPercent() > 80) {
            alerts.add(RiskAlert.builder()
                    .type("DIRECTION_BIAS")
                    .severity("MEDIUM")
                    .message("Strong bullish bias - " + String.format("%.0f%%", direction.getBullishPercent()) + " long positions")
                    .recommendation("Consider hedging or adding bearish positions")
                    .build());
        } else if (direction.getBearishPercent() > 80) {
            alerts.add(RiskAlert.builder()
                    .type("DIRECTION_BIAS")
                    .severity("MEDIUM")
                    .message("Strong bearish bias - " + String.format("%.0f%%", direction.getBearishPercent()) + " short positions")
                    .recommendation("Consider hedging or adding bullish positions")
                    .build());
        }

        // Check recent loss streak
        List<SignalDTO> recentTrades = completedTrades.stream()
                .sorted(Comparator.comparing(SignalDTO::getTimestamp).reversed())
                .limit(10)
                .collect(Collectors.toList());

        long recentLosses = recentTrades.stream()
                .filter(s -> s.getTradeStatus() != null && s.getTradeStatus().contains("LOSS"))
                .count();

        if (recentLosses >= 5) {
            alerts.add(RiskAlert.builder()
                    .type("LOSS_STREAK")
                    .severity("HIGH")
                    .message("Loss streak detected - " + recentLosses + " losses in last 10 trades")
                    .recommendation("Consider reducing position sizes or pausing trading")
                    .build());
        }

        // Check if too many open positions
        if (activeSignals.size() > 20) {
            alerts.add(RiskAlert.builder()
                    .type("POSITION_COUNT")
                    .severity("MEDIUM")
                    .message("High number of open positions: " + activeSignals.size())
                    .recommendation("Consider closing some positions to reduce complexity")
                    .build());
        }

        return alerts;
    }

    private int getPositionSize(SignalDTO signal) {
        // Default position size, could be enhanced with actual position data
        double multiplier = signal.getPositionSizeMultiplier();
        return multiplier > 0 ? (int) multiplier : 1;
    }

    // ======================== DTOs ========================

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class RiskMetrics {
        private PortfolioExposure portfolioExposure;
        private ConcentrationRisk concentrationRisk;
        private Map<String, Double> sectorExposure;
        private DirectionExposure directionExposure;
        private RiskBreakdown riskBreakdown;
        private ValueAtRisk valueAtRisk;
        private double maxLossExposure;
        private CorrelationMetrics correlationMetrics;
        private RiskScore riskScore;
        private List<RiskAlert> alerts;
        private LocalDateTime lastUpdated;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class PortfolioExposure {
        private double longExposure;
        private double shortExposure;
        private double netExposure;
        private double grossExposure;
        private long longCount;
        private long shortCount;
        private String netDirection;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class ConcentrationRisk {
        private double herfindahlIndex;
        private String riskLevel;
        private int uniqueStocks;
        private Map<String, Double> topHoldings;
        private double singleStockMaxPercent;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class DirectionExposure {
        private double bullishPercent;
        private double bearishPercent;
        private double neutralPercent;
        private int bullishCount;
        private int bearishCount;
        private int neutralCount;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class RiskBreakdown {
        private double totalRiskAmount;
        private double averageRiskPerTrade;
        private double averageRiskReward;
        private int openPositions;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class ValueAtRisk {
        private double var95;
        private double var99;
        private double expectedShortfall;
        private int sampleSize;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class CorrelationMetrics {
        private double sourceConcentration;
        private double diversificationScore;
        private Map<String, Long> signalsBySource;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class RiskScore {
        private double score;
        private String level;
        private double concentrationComponent;
        private double exposureComponent;
        private double varComponent;
    }

    @lombok.Data
    @lombok.Builder
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class RiskAlert {
        private String type;
        private String severity;
        private String message;
        private String recommendation;
    }
}
