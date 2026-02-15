package com.kotsin.dashboard.service;

import com.kotsin.dashboard.model.entity.PaperTrade;
import com.kotsin.dashboard.model.entity.UserTrade;
import com.kotsin.dashboard.model.entity.UserWallet;
import com.kotsin.dashboard.repository.PaperTradeRepository;
import com.kotsin.dashboard.repository.UserTradeRepository;
import com.kotsin.dashboard.repository.UserWalletRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class UserPnLService {

    private static final Logger log = LoggerFactory.getLogger(UserPnLService.class);
    private static final double INITIAL_CAPITAL = 100000.0;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final UserTradeRepository userTradeRepository;
    private final UserWalletRepository userWalletRepository;
    private final PaperTradeRepository paperTradeRepository;
    private final ScripLookupService scripLookup;

    public UserPnLService(UserTradeRepository userTradeRepository,
                          UserWalletRepository userWalletRepository,
                          PaperTradeRepository paperTradeRepository,
                          ScripLookupService scripLookup) {
        this.userTradeRepository = userTradeRepository;
        this.userWalletRepository = userWalletRepository;
        this.paperTradeRepository = paperTradeRepository;
        this.scripLookup = scripLookup;
    }

    // ==================== SUMMARY ====================

    public Map<String, Object> getSummary(String userId, String walletType) {
        if ("PAPER".equals(walletType)) {
            return getPaperSummary();
        }
        // Fallback to original user_trades logic for REAL wallets
        UserWallet wallet = getOrCreateWallet(userId, walletType);
        return buildWalletSummary(wallet);
    }

    private Map<String, Object> getPaperSummary() {
        List<PaperTrade> allTrades = paperTradeRepository.findAllByOrderByCreatedAtDesc();

        double realizedPnl = allTrades.stream()
                .mapToDouble(PaperTrade::getRealizedPnL).sum();
        double unrealizedPnl = allTrades.stream()
                .filter(t -> "OPEN".equals(t.getStatus()))
                .mapToDouble(PaperTrade::getUnrealizedPnL).sum();
        double totalFees = allTrades.stream()
                .mapToDouble(PaperTrade::getCommission).sum();

        List<PaperTrade> closedTrades = allTrades.stream()
                .filter(t -> "CLOSED".equals(t.getStatus()))
                .collect(Collectors.toList());
        long winCount = closedTrades.stream().filter(t -> t.getRealizedPnL() > 0).count();
        long lossCount = closedTrades.stream().filter(t -> t.getRealizedPnL() < 0).count();
        int totalDecided = (int) (winCount + lossCount);
        double winRate = totalDecided > 0 ? Math.round((winCount * 100.0) / totalDecided * 10.0) / 10.0 : 0;

        // Day P&L: trades created today
        Instant todayStart = LocalDate.now(IST).atStartOfDay(IST).toInstant();
        double dayPnl = allTrades.stream()
                .filter(t -> t.getCreatedAt() != null && t.getCreatedAt().isAfter(todayStart))
                .mapToDouble(t -> t.getRealizedPnL() + t.getUnrealizedPnL())
                .sum();

        // Week P&L
        Instant weekStart = LocalDate.now(IST).minusDays(7).atStartOfDay(IST).toInstant();
        double weekPnl = allTrades.stream()
                .filter(t -> t.getCreatedAt() != null && t.getCreatedAt().isAfter(weekStart))
                .mapToDouble(t -> t.getRealizedPnL() + t.getUnrealizedPnL())
                .sum();

        // Month P&L
        Instant monthStart = LocalDate.now(IST).minusDays(30).atStartOfDay(IST).toInstant();
        double monthPnl = allTrades.stream()
                .filter(t -> t.getCreatedAt() != null && t.getCreatedAt().isAfter(monthStart))
                .mapToDouble(t -> t.getRealizedPnL() + t.getUnrealizedPnL())
                .sum();

        double currentCapital = INITIAL_CAPITAL + realizedPnl + unrealizedPnl - totalFees;

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("walletType", "PAPER");
        summary.put("initialCapital", INITIAL_CAPITAL);
        summary.put("currentCapital", Math.round(currentCapital * 100.0) / 100.0);
        summary.put("realizedPnl", Math.round(realizedPnl * 100.0) / 100.0);
        summary.put("unrealizedPnl", Math.round(unrealizedPnl * 100.0) / 100.0);
        summary.put("totalFees", Math.round(totalFees * 100.0) / 100.0);
        summary.put("totalReturn", INITIAL_CAPITAL > 0
                ? Math.round(((currentCapital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 10000.0) / 100.0 : 0);
        summary.put("dayPnl", Math.round(dayPnl * 100.0) / 100.0);
        summary.put("weekPnl", Math.round(weekPnl * 100.0) / 100.0);
        summary.put("monthPnl", Math.round(monthPnl * 100.0) / 100.0);
        summary.put("totalTradesCount", allTrades.size());
        summary.put("winCount", winCount);
        summary.put("lossCount", lossCount);
        summary.put("winRate", winRate);
        summary.put("openCount", allTrades.size() - closedTrades.size());
        summary.put("lastUpdated", LocalDateTime.now(IST).toString());
        return summary;
    }

    // ==================== DAILY P&L ====================

    public List<Map<String, Object>> getDailyPnl(String userId, String walletType, int days) {
        if ("PAPER".equals(walletType)) {
            return getPaperDailyPnl(days);
        }
        LocalDateTime start = LocalDate.now(IST).minusDays(days).atStartOfDay();
        LocalDateTime end = LocalDateTime.now(IST);
        List<UserTrade> trades = userTradeRepository
                .findByUserIdAndWalletTypeAndExitTimeBetweenOrderByExitTimeDesc(userId, walletType, start, end);

        Map<LocalDate, Double> dailyPnl = new TreeMap<>();
        for (int i = 0; i < days; i++) {
            dailyPnl.put(LocalDate.now(IST).minusDays(i), 0.0);
        }
        for (UserTrade trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().toLocalDate();
                dailyPnl.merge(date, trade.getNetPnl(), Double::sum);
            }
        }
        return dailyPnl.entrySet().stream()
                .map(e -> {
                    Map<String, Object> day = new LinkedHashMap<>();
                    day.put("date", e.getKey().toString());
                    day.put("pnl", e.getValue());
                    return day;
                })
                .collect(Collectors.toList());
    }

    private List<Map<String, Object>> getPaperDailyPnl(int days) {
        Instant start = LocalDate.now(IST).minusDays(days).atStartOfDay(IST).toInstant();
        Instant end = Instant.now();
        List<PaperTrade> trades = paperTradeRepository.findByExitTimeBetweenOrderByExitTimeDesc(start, end);

        Map<LocalDate, Double> dailyPnl = new TreeMap<>();
        for (int i = 0; i < days; i++) {
            dailyPnl.put(LocalDate.now(IST).minusDays(i), 0.0);
        }
        for (PaperTrade trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().atZone(IST).toLocalDate();
                dailyPnl.merge(date, trade.getRealizedPnL() - trade.getCommission(), Double::sum);
            }
        }

        double cumulative = 0;
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<LocalDate, Double> e : dailyPnl.entrySet()) {
            cumulative += e.getValue();
            Map<String, Object> day = new LinkedHashMap<>();
            day.put("date", e.getKey().toString());
            day.put("pnl", Math.round(e.getValue() * 100.0) / 100.0);
            day.put("cumulative", Math.round(cumulative * 100.0) / 100.0);
            long dayTrades = trades.stream()
                    .filter(t -> t.getExitTime() != null && t.getExitTime().atZone(IST).toLocalDate().equals(e.getKey()))
                    .count();
            day.put("trades", dayTrades);
            result.add(day);
        }
        return result;
    }

    // ==================== EQUITY CURVE ====================

    public List<Map<String, Object>> getEquityCurve(String userId, String walletType) {
        if ("PAPER".equals(walletType)) {
            return getPaperEquityCurve();
        }
        UserWallet wallet = getOrCreateWallet(userId, walletType);
        List<UserTrade> trades = userTradeRepository
                .findByUserIdAndWalletTypeOrderByExitTimeDesc(userId, walletType);
        Collections.reverse(trades);

        List<Map<String, Object>> curve = new ArrayList<>();
        double cumulative = wallet.getInitialCapital();
        Map<String, Object> startPoint = new LinkedHashMap<>();
        startPoint.put("date", wallet.getCreatedAt() != null ? wallet.getCreatedAt().toLocalDate().toString() : LocalDate.now(IST).toString());
        startPoint.put("value", cumulative);
        curve.add(startPoint);
        for (UserTrade trade : trades) {
            if (trade.getExitTime() != null) {
                cumulative += trade.getNetPnl();
                Map<String, Object> point = new LinkedHashMap<>();
                point.put("date", trade.getExitTime().toLocalDate().toString());
                point.put("value", Math.round(cumulative * 100.0) / 100.0);
                point.put("tradeId", trade.getTradeId());
                curve.add(point);
            }
        }
        return curve;
    }

    private List<Map<String, Object>> getPaperEquityCurve() {
        List<PaperTrade> closedTrades = paperTradeRepository.findByStatusOrderByCreatedAtDesc("CLOSED");
        // Reverse to chronological order
        Collections.reverse(closedTrades);

        List<Map<String, Object>> curve = new ArrayList<>();
        double cumulative = INITIAL_CAPITAL;

        Map<String, Object> startPoint = new LinkedHashMap<>();
        startPoint.put("date", closedTrades.isEmpty() ? LocalDate.now(IST).toString()
                : closedTrades.get(0).getCreatedAt().atZone(IST).toLocalDate().toString());
        startPoint.put("value", cumulative);
        curve.add(startPoint);

        for (PaperTrade trade : closedTrades) {
            cumulative += trade.getRealizedPnL() - trade.getCommission();
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("date", trade.getExitTime() != null
                    ? trade.getExitTime().atZone(IST).toLocalDate().toString()
                    : trade.getLastUpdated().atZone(IST).toLocalDate().toString());
            point.put("value", Math.round(cumulative * 100.0) / 100.0);
            point.put("tradeId", trade.getTradeId());
            curve.add(point);
        }
        return curve;
    }

    // ==================== CALENDAR HEATMAP ====================

    public List<Map<String, Object>> getCalendarHeatmap(String userId, String walletType, int year) {
        if ("PAPER".equals(walletType)) {
            return getPaperCalendarHeatmap(year);
        }
        LocalDateTime start = LocalDate.of(year, 1, 1).atStartOfDay();
        LocalDateTime end = LocalDate.of(year, 12, 31).atTime(LocalTime.MAX);
        List<UserTrade> trades = userTradeRepository
                .findByUserIdAndWalletTypeAndExitTimeBetweenOrderByExitTimeDesc(userId, walletType, start, end);

        Map<LocalDate, Double> dailyPnl = new TreeMap<>();
        for (UserTrade trade : trades) {
            if (trade.getExitTime() != null) {
                LocalDate date = trade.getExitTime().toLocalDate();
                dailyPnl.merge(date, trade.getNetPnl(), Double::sum);
            }
        }
        return dailyPnl.entrySet().stream()
                .map(e -> {
                    Map<String, Object> day = new LinkedHashMap<>();
                    day.put("date", e.getKey().toString());
                    day.put("pnl", Math.round(e.getValue() * 100.0) / 100.0);
                    day.put("count", trades.stream()
                            .filter(t -> t.getExitTime() != null && t.getExitTime().toLocalDate().equals(e.getKey()))
                            .count());
                    return day;
                })
                .collect(Collectors.toList());
    }

    private List<Map<String, Object>> getPaperCalendarHeatmap(int year) {
        Instant start = LocalDate.of(year, 1, 1).atStartOfDay(IST).toInstant();
        Instant end = LocalDate.of(year, 12, 31).atTime(LocalTime.MAX).atZone(IST).toInstant();
        List<PaperTrade> trades = paperTradeRepository.findByExitTimeBetweenOrderByExitTimeDesc(start, end);

        Map<LocalDate, List<PaperTrade>> byDate = trades.stream()
                .filter(t -> t.getExitTime() != null)
                .collect(Collectors.groupingBy(t -> t.getExitTime().atZone(IST).toLocalDate()));

        return byDate.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> {
                    double pnl = e.getValue().stream().mapToDouble(PaperTrade::getRealizedPnL).sum();
                    Map<String, Object> day = new LinkedHashMap<>();
                    day.put("date", e.getKey().toString());
                    day.put("pnl", Math.round(pnl * 100.0) / 100.0);
                    day.put("count", e.getValue().size());
                    return day;
                })
                .collect(Collectors.toList());
    }

    // ==================== INSTRUMENT BREAKDOWN ====================

    public List<Map<String, Object>> getInstrumentBreakdown(String userId, String walletType) {
        if ("PAPER".equals(walletType)) {
            return getPaperInstrumentBreakdown();
        }
        List<UserTrade> trades = userTradeRepository
                .findByUserIdAndWalletTypeOrderByExitTimeDesc(userId, walletType);
        Map<String, List<UserTrade>> byInstrument = trades.stream()
                .collect(Collectors.groupingBy(t -> t.getSymbol() != null ? t.getSymbol() : t.getScripCode()));
        return byInstrument.entrySet().stream()
                .map(e -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("scripCode", e.getKey());
                    item.put("symbol", e.getKey());
                    item.put("companyName", resolveCompanyName(e.getKey()));
                    double totalPnl = e.getValue().stream().mapToDouble(UserTrade::getNetPnl).sum();
                    long wins = e.getValue().stream().filter(t -> t.getNetPnl() > 0).count();
                    item.put("totalPnl", Math.round(totalPnl * 100.0) / 100.0);
                    item.put("tradeCount", e.getValue().size());
                    item.put("winCount", wins);
                    item.put("winRate", e.getValue().isEmpty() ? 0 : Math.round((wins * 100.0) / e.getValue().size() * 10.0) / 10.0);
                    return item;
                })
                .sorted((a, b) -> Double.compare((double) b.get("totalPnl"), (double) a.get("totalPnl")))
                .collect(Collectors.toList());
    }

    private List<Map<String, Object>> getPaperInstrumentBreakdown() {
        List<PaperTrade> allTrades = paperTradeRepository.findAllByOrderByCreatedAtDesc();
        Map<String, List<PaperTrade>> bySymbol = allTrades.stream()
                .collect(Collectors.groupingBy(PaperTrade::getSymbol));

        return bySymbol.entrySet().stream()
                .map(e -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("scripCode", e.getKey());
                    item.put("symbol", e.getKey());
                    item.put("companyName", resolveCompanyName(e.getKey()));
                    double totalPnl = e.getValue().stream()
                            .mapToDouble(t -> t.getRealizedPnL() + t.getUnrealizedPnL()).sum();
                    long closedCount = e.getValue().stream().filter(t -> "CLOSED".equals(t.getStatus())).count();
                    long wins = e.getValue().stream()
                            .filter(t -> "CLOSED".equals(t.getStatus()) && t.getRealizedPnL() > 0).count();
                    item.put("totalPnl", Math.round(totalPnl * 100.0) / 100.0);
                    item.put("tradeCount", e.getValue().size());
                    item.put("winCount", wins);
                    item.put("winRate", closedCount > 0 ? Math.round((wins * 100.0) / closedCount * 10.0) / 10.0 : 0);
                    return item;
                })
                .sorted((a, b) -> Double.compare((double) b.get("totalPnl"), (double) a.get("totalPnl")))
                .collect(Collectors.toList());
    }

    // ==================== STRATEGY BREAKDOWN ====================

    public List<Map<String, Object>> getStrategyBreakdown(String userId, String walletType) {
        if ("PAPER".equals(walletType)) {
            return getPaperStrategyBreakdown();
        }
        List<UserTrade> trades = userTradeRepository
                .findByUserIdAndWalletTypeOrderByExitTimeDesc(userId, walletType);
        Map<String, List<UserTrade>> byStrategy = trades.stream()
                .collect(Collectors.groupingBy(t -> t.getStrategy() != null ? t.getStrategy() : "UNKNOWN"));
        return byStrategy.entrySet().stream()
                .map(e -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("strategy", e.getKey());
                    double totalPnl = e.getValue().stream().mapToDouble(UserTrade::getNetPnl).sum();
                    long wins = e.getValue().stream().filter(t -> t.getNetPnl() > 0).count();
                    item.put("totalPnl", Math.round(totalPnl * 100.0) / 100.0);
                    item.put("tradeCount", e.getValue().size());
                    item.put("winCount", wins);
                    item.put("winRate", e.getValue().isEmpty() ? 0 : Math.round((wins * 100.0) / e.getValue().size() * 10.0) / 10.0);
                    return item;
                })
                .sorted((a, b) -> Double.compare((double) b.get("totalPnl"), (double) a.get("totalPnl")))
                .collect(Collectors.toList());
    }

    private List<Map<String, Object>> getPaperStrategyBreakdown() {
        List<PaperTrade> allTrades = paperTradeRepository.findAllByOrderByCreatedAtDesc();
        Map<String, List<PaperTrade>> byStrategy = allTrades.stream()
                .collect(Collectors.groupingBy(t -> t.getSignalType() != null ? t.getSignalType() : "UNKNOWN"));

        return byStrategy.entrySet().stream()
                .map(e -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("strategy", e.getKey());
                    double totalPnl = e.getValue().stream()
                            .mapToDouble(t -> t.getRealizedPnL() + t.getUnrealizedPnL()).sum();
                    long closedCount = e.getValue().stream().filter(t -> "CLOSED".equals(t.getStatus())).count();
                    long wins = e.getValue().stream()
                            .filter(t -> "CLOSED".equals(t.getStatus()) && t.getRealizedPnL() > 0).count();
                    item.put("totalPnl", Math.round(totalPnl * 100.0) / 100.0);
                    item.put("tradeCount", e.getValue().size());
                    item.put("winCount", wins);
                    item.put("winRate", closedCount > 0 ? Math.round((wins * 100.0) / closedCount * 10.0) / 10.0 : 0);
                    return item;
                })
                .sorted((a, b) -> Double.compare((double) b.get("totalPnl"), (double) a.get("totalPnl")))
                .collect(Collectors.toList());
    }

    // ==================== ADVANCED METRICS ====================

    public Map<String, Object> getAdvancedMetrics(String userId, String walletType) {
        if ("PAPER".equals(walletType)) {
            return getPaperAdvancedMetrics();
        }
        UserWallet wallet = getOrCreateWallet(userId, walletType);
        List<UserTrade> trades = userTradeRepository
                .findByUserIdAndWalletTypeOrderByExitTimeDesc(userId, walletType);
        return buildAdvancedMetrics(wallet, trades);
    }

    private Map<String, Object> getPaperAdvancedMetrics() {
        List<PaperTrade> closedTrades = paperTradeRepository.findByStatusOrderByCreatedAtDesc("CLOSED");
        List<PaperTrade> allTrades = paperTradeRepository.findAllByOrderByCreatedAtDesc();

        Map<String, Object> metrics = new LinkedHashMap<>();

        long winCount = closedTrades.stream().filter(t -> t.getRealizedPnL() > 0).count();
        long lossCount = closedTrades.stream().filter(t -> t.getRealizedPnL() < 0).count();
        int totalDecided = (int) (winCount + lossCount);
        double winRate = totalDecided > 0 ? Math.round((winCount * 100.0) / totalDecided * 10.0) / 10.0 : 0;

        metrics.put("totalTrades", allTrades.size());
        metrics.put("winRate", winRate);
        metrics.put("winCount", winCount);
        metrics.put("lossCount", lossCount);

        if (closedTrades.isEmpty()) {
            metrics.put("sharpeRatio", 0);
            metrics.put("maxDrawdown", 0);
            metrics.put("maxDrawdownPercent", 0);
            metrics.put("profitFactor", 0);
            metrics.put("expectancy", 0);
            metrics.put("avgRMultiple", 0);
            metrics.put("avgWin", 0);
            metrics.put("avgLoss", 0);
            metrics.put("largestWin", 0);
            metrics.put("largestLoss", 0);
            metrics.put("avgDuration", 0);
            return metrics;
        }

        // Profit factor
        double totalProfit = closedTrades.stream()
                .filter(t -> t.getRealizedPnL() > 0).mapToDouble(PaperTrade::getRealizedPnL).sum();
        double totalLoss = Math.abs(closedTrades.stream()
                .filter(t -> t.getRealizedPnL() < 0).mapToDouble(PaperTrade::getRealizedPnL).sum());
        metrics.put("profitFactor", totalLoss > 0
                ? Math.round((totalProfit / totalLoss) * 100.0) / 100.0
                : totalProfit > 0 ? 999 : 0);

        // Expectancy
        double avgWin = closedTrades.stream()
                .filter(t -> t.getRealizedPnL() > 0).mapToDouble(PaperTrade::getRealizedPnL).average().orElse(0);
        double avgLoss = closedTrades.stream()
                .filter(t -> t.getRealizedPnL() < 0).mapToDouble(PaperTrade::getRealizedPnL).average().orElse(0);
        double winProb = totalDecided > 0 ? (double) winCount / totalDecided : 0;
        double lossProb = 1 - winProb;
        metrics.put("expectancy", Math.round((winProb * avgWin + lossProb * avgLoss) * 100.0) / 100.0);
        metrics.put("avgWin", Math.round(avgWin * 100.0) / 100.0);
        metrics.put("avgLoss", Math.round(avgLoss * 100.0) / 100.0);

        // Largest win/loss
        metrics.put("largestWin", closedTrades.stream().mapToDouble(PaperTrade::getRealizedPnL).filter(p -> p > 0).max().orElse(0));
        metrics.put("largestLoss", closedTrades.stream().mapToDouble(PaperTrade::getRealizedPnL).filter(p -> p < 0).min().orElse(0));

        // Average R-multiple (from riskRewardRatio and realized PnL)
        double avgR = closedTrades.stream()
                .filter(t -> t.getRiskAmount() > 0)
                .mapToDouble(t -> t.getRealizedPnL() / t.getRiskAmount())
                .average().orElse(0);
        metrics.put("avgRMultiple", Math.round(avgR * 100.0) / 100.0);

        // Max drawdown
        List<PaperTrade> chronological = new ArrayList<>(closedTrades);
        Collections.reverse(chronological);
        double peak = INITIAL_CAPITAL;
        double cumulative = INITIAL_CAPITAL;
        double maxDrawdown = 0;
        for (PaperTrade trade : chronological) {
            cumulative += trade.getRealizedPnL() - trade.getCommission();
            if (cumulative > peak) peak = cumulative;
            double drawdown = peak - cumulative;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }
        metrics.put("maxDrawdown", Math.round(maxDrawdown * 100.0) / 100.0);
        metrics.put("maxDrawdownPercent", peak > 0 ? Math.round((maxDrawdown / peak) * 10000.0) / 100.0 : 0);

        // Sharpe ratio (daily returns grouped by date, annualized with sqrt(252), sample std dev)
        Map<LocalDate, Double> dailyPnlMap = chronological.stream()
                .filter(t -> t.getExitTime() != null)
                .collect(Collectors.groupingBy(
                        t -> t.getExitTime().atZone(IST).toLocalDate(),
                        Collectors.summingDouble(t -> t.getRealizedPnL() - t.getCommission())
                ));
        double[] dailyReturns = dailyPnlMap.values().stream()
                .mapToDouble(pnl -> INITIAL_CAPITAL > 0 ? pnl / INITIAL_CAPITAL : 0)
                .toArray();
        int nDays = dailyReturns.length;
        double meanReturn = nDays > 0 ? Arrays.stream(dailyReturns).sum() / nDays : 0;
        double sharpe = 0;
        if (nDays > 1) {
            double sumSqDev = Arrays.stream(dailyReturns).map(r -> Math.pow(r - meanReturn, 2)).sum();
            double stdDev = Math.sqrt(sumSqDev / (nDays - 1));
            sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;
        }
        metrics.put("sharpeRatio", Math.round(sharpe * 100.0) / 100.0);

        // Average duration
        double avgDuration = closedTrades.stream()
                .filter(t -> t.getHoldingPeriodMs() > 0)
                .mapToLong(t -> t.getHoldingPeriodMs() / 60000)
                .average().orElse(0);
        metrics.put("avgDuration", Math.round(avgDuration));

        return metrics;
    }

    // ==================== TRADE JOURNAL ====================

    public Page<UserTrade> getTradeJournal(String userId, String walletType, int page, int size) {
        if ("PAPER".equals(walletType)) {
            return getPaperTradeJournal(page, size);
        }
        return userTradeRepository.findByUserIdAndWalletTypeOrderByExitTimeDesc(
                userId, walletType, PageRequest.of(page, size));
    }

    private Page<UserTrade> getPaperTradeJournal(int page, int size) {
        Page<PaperTrade> paperPage = paperTradeRepository.findAllByOrderByCreatedAtDesc(PageRequest.of(page, size));

        List<UserTrade> converted = paperPage.getContent().stream()
                .map(this::paperTradeToUserTrade)
                .collect(Collectors.toList());

        return new PageImpl<>(converted, paperPage.getPageable(), paperPage.getTotalElements());
    }

    /**
     * Convert a PaperTrade to a UserTrade for the trade journal response.
     */
    private UserTrade paperTradeToUserTrade(PaperTrade pt) {
        double netPnl = "CLOSED".equals(pt.getStatus())
                ? pt.getRealizedPnL() - pt.getCommission()
                : pt.getUnrealizedPnL();

        String status;
        if ("OPEN".equals(pt.getStatus())) {
            status = "OPEN";
        } else if (pt.getRealizedPnL() > 0) {
            status = "CLOSED_WIN";
        } else if (pt.getRealizedPnL() < 0) {
            status = "CLOSED_LOSS";
        } else {
            status = "CLOSED_BREAKEVEN";
        }

        double rMultiple = pt.getRiskAmount() > 0 ? pt.getRealizedPnL() / pt.getRiskAmount() : 0;
        int durationMinutes = pt.getHoldingPeriodMs() > 0 ? (int) (pt.getHoldingPeriodMs() / 60000) : 0;

        String side = "LONG".equals(pt.getDirection()) ? "LONG" : "SHORT";

        return UserTrade.builder()
                .id(pt.getId())
                .tradeId(pt.getTradeId())
                .signalId(pt.getSignalId())
                .scripCode(pt.getSymbol())
                .symbol(pt.getSymbol())
                .companyName(resolveCompanyName(pt.getSymbol()))
                .side(side)
                .walletType("PAPER")
                .entryPrice(pt.getEntryPrice())
                .exitPrice(pt.getExitPrice())
                .quantity(pt.getQuantity())
                .stopLoss(pt.getStopLoss())
                .target1(pt.getTargetPrice())
                .pnl(pt.getRealizedPnL())
                .pnlPercent("CLOSED".equals(pt.getStatus()) ? pt.getRealizedPnLPercent() : pt.getUnrealizedPnLPercent())
                .rMultiple(Math.round(rMultiple * 100.0) / 100.0)
                .fees(pt.getCommission())
                .netPnl(netPnl)
                .entryTime(pt.getEntryTime() != null ? LocalDateTime.ofInstant(pt.getEntryTime(), IST) : null)
                .exitTime(pt.getExitTime() != null ? LocalDateTime.ofInstant(pt.getExitTime(), IST) : null)
                .exitReason(pt.getExitReason())
                .durationMinutes(durationMinutes)
                .strategy(pt.getSignalType())
                .status(status)
                .createdAt(pt.getCreatedAt() != null ? LocalDateTime.ofInstant(pt.getCreatedAt(), IST) : LocalDateTime.now(IST))
                .build();
    }

    private String resolveCompanyName(String scripCode) {
        return scripLookup.resolve(scripCode);
    }

    // ==================== NOTES (unchanged - only works for user_trades) ====================

    public UserTrade updateTradeNotes(String userId, String tradeId, String notes, List<String> tags) {
        UserTrade trade = userTradeRepository.findByIdAndUserId(tradeId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Trade not found"));
        if (notes != null) trade.setNotes(notes);
        if (tags != null) trade.setTags(tags);
        return userTradeRepository.save(trade);
    }

    // ==================== RECORD TRADE (unchanged) ====================

    public void recordTrade(String userId, String walletType, UserTrade trade) {
        trade.setUserId(userId);
        trade.setWalletType(walletType);
        trade.setCreatedAt(LocalDateTime.now(IST));

        if (trade.getEntryTime() != null && trade.getExitTime() != null) {
            trade.setDurationMinutes((int) ChronoUnit.MINUTES.between(trade.getEntryTime(), trade.getExitTime()));
        }

        if (trade.getNetPnl() > 0) {
            trade.setStatus("CLOSED_WIN");
        } else if (trade.getNetPnl() < 0) {
            trade.setStatus("CLOSED_LOSS");
        } else {
            trade.setStatus("CLOSED_BREAKEVEN");
        }

        userTradeRepository.save(trade);
        updateWallet(userId, walletType, trade);
        log.info("Recorded trade {} for user {} ({}) — PnL: {}", trade.getTradeId(), userId, walletType, trade.getNetPnl());
    }

    // ==================== HELPERS ====================

    private Map<String, Object> buildWalletSummary(UserWallet wallet) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("walletType", wallet.getWalletType());
        summary.put("initialCapital", wallet.getInitialCapital());
        summary.put("currentCapital", wallet.getCurrentCapital());
        summary.put("realizedPnl", wallet.getRealizedPnl());
        summary.put("unrealizedPnl", wallet.getUnrealizedPnl());
        summary.put("totalFees", wallet.getTotalFees());
        summary.put("totalReturn", wallet.getInitialCapital() > 0
                ? ((wallet.getCurrentCapital() - wallet.getInitialCapital()) / wallet.getInitialCapital()) * 100 : 0);
        summary.put("dayPnl", wallet.getDayPnl());
        summary.put("weekPnl", wallet.getWeekPnl());
        summary.put("monthPnl", wallet.getMonthPnl());
        summary.put("totalTradesCount", wallet.getTotalTradesCount());
        summary.put("winCount", wallet.getWinCount());
        summary.put("lossCount", wallet.getLossCount());
        summary.put("winRate", wallet.getWinRate());
        summary.put("lastUpdated", wallet.getLastUpdated());
        return summary;
    }

    private Map<String, Object> buildAdvancedMetrics(UserWallet wallet, List<UserTrade> trades) {
        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("totalTrades", wallet.getTotalTradesCount());
        metrics.put("winRate", wallet.getWinRate());
        metrics.put("winCount", wallet.getWinCount());
        metrics.put("lossCount", wallet.getLossCount());
        if (trades.isEmpty()) {
            metrics.put("sharpeRatio", 0);
            metrics.put("maxDrawdown", 0);
            metrics.put("maxDrawdownPercent", 0);
            metrics.put("profitFactor", 0);
            metrics.put("expectancy", 0);
            metrics.put("avgRMultiple", 0);
            metrics.put("avgWin", 0);
            metrics.put("avgLoss", 0);
            metrics.put("largestWin", 0);
            metrics.put("largestLoss", 0);
            metrics.put("avgDuration", 0);
            return metrics;
        }
        double totalProfit = trades.stream().filter(t -> t.getNetPnl() > 0).mapToDouble(UserTrade::getNetPnl).sum();
        double totalLoss = Math.abs(trades.stream().filter(t -> t.getNetPnl() < 0).mapToDouble(UserTrade::getNetPnl).sum());
        metrics.put("profitFactor", totalLoss > 0 ? Math.round((totalProfit / totalLoss) * 100.0) / 100.0 : totalProfit > 0 ? 999 : 0);
        double avgWin = trades.stream().filter(t -> t.getNetPnl() > 0).mapToDouble(UserTrade::getNetPnl).average().orElse(0);
        double avgLoss = trades.stream().filter(t -> t.getNetPnl() < 0).mapToDouble(UserTrade::getNetPnl).average().orElse(0);
        int totalDecided = wallet.getWinCount() + wallet.getLossCount();
        double winProb = totalDecided > 0 ? (double) wallet.getWinCount() / totalDecided : 0;
        metrics.put("expectancy", Math.round((winProb * avgWin + (1 - winProb) * avgLoss) * 100.0) / 100.0);
        metrics.put("avgWin", Math.round(avgWin * 100.0) / 100.0);
        metrics.put("avgLoss", Math.round(avgLoss * 100.0) / 100.0);
        metrics.put("largestWin", trades.stream().mapToDouble(UserTrade::getNetPnl).filter(p -> p > 0).max().orElse(0));
        metrics.put("largestLoss", trades.stream().mapToDouble(UserTrade::getNetPnl).filter(p -> p < 0).min().orElse(0));
        metrics.put("avgRMultiple", Math.round(trades.stream().mapToDouble(UserTrade::getRMultiple).average().orElse(0) * 100.0) / 100.0);
        Collections.reverse(trades);
        double peak = wallet.getInitialCapital();
        double cumulative = wallet.getInitialCapital();
        double maxDrawdown = 0;
        for (UserTrade trade : trades) {
            cumulative += trade.getNetPnl();
            if (cumulative > peak) peak = cumulative;
            double drawdown = peak - cumulative;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }
        metrics.put("maxDrawdown", Math.round(maxDrawdown * 100.0) / 100.0);
        metrics.put("maxDrawdownPercent", peak > 0 ? Math.round((maxDrawdown / peak) * 10000.0) / 100.0 : 0);
        // Sharpe ratio (daily returns grouped by date, annualized with sqrt(252), sample std dev)
        Map<LocalDate, Double> dailyPnlMap = trades.stream()
                .filter(t -> t.getExitTime() != null)
                .collect(Collectors.groupingBy(
                        t -> t.getExitTime().toLocalDate(),
                        Collectors.summingDouble(UserTrade::getNetPnl)
                ));
        double[] dailyReturns = dailyPnlMap.values().stream()
                .mapToDouble(pnl -> wallet.getInitialCapital() > 0 ? pnl / wallet.getInitialCapital() : 0)
                .toArray();
        int nDays = dailyReturns.length;
        double meanReturn = nDays > 0 ? Arrays.stream(dailyReturns).sum() / nDays : 0;
        double sharpeRatio = 0;
        if (nDays > 1) {
            double sumSqDev = Arrays.stream(dailyReturns).map(r -> Math.pow(r - meanReturn, 2)).sum();
            double stdDev = Math.sqrt(sumSqDev / (nDays - 1));
            sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;
        }
        metrics.put("sharpeRatio", Math.round(sharpeRatio * 100.0) / 100.0);
        metrics.put("avgDuration", Math.round(trades.stream().filter(t -> t.getDurationMinutes() > 0).mapToInt(UserTrade::getDurationMinutes).average().orElse(0)));
        return metrics;
    }

    private void updateWallet(String userId, String walletType, UserTrade trade) {
        UserWallet wallet = getOrCreateWallet(userId, walletType);
        wallet.setRealizedPnl(wallet.getRealizedPnl() + trade.getNetPnl());
        wallet.setTotalFees(wallet.getTotalFees() + trade.getFees());
        wallet.setCurrentCapital(wallet.getCurrentCapital() + trade.getNetPnl());
        wallet.setTotalTradesCount(wallet.getTotalTradesCount() + 1);
        if (trade.getNetPnl() > 0) {
            wallet.setWinCount(wallet.getWinCount() + 1);
        } else if (trade.getNetPnl() < 0) {
            wallet.setLossCount(wallet.getLossCount() + 1);
        }
        int totalDecided = wallet.getWinCount() + wallet.getLossCount();
        wallet.setWinRate(totalDecided > 0 ? Math.round((wallet.getWinCount() * 100.0) / totalDecided * 10.0) / 10.0 : 0);
        wallet.setDayPnl(wallet.getDayPnl() + trade.getNetPnl());
        wallet.setWeekPnl(wallet.getWeekPnl() + trade.getNetPnl());
        wallet.setMonthPnl(wallet.getMonthPnl() + trade.getNetPnl());
        wallet.setLastUpdated(LocalDateTime.now(IST));
        userWalletRepository.save(wallet);
    }

    public UserWallet getOrCreateWallet(String userId, String walletType) {
        return userWalletRepository.findByUserIdAndWalletType(userId, walletType)
                .orElseGet(() -> {
                    UserWallet wallet = UserWallet.builder()
                            .userId(userId)
                            .walletType(walletType)
                            .build();
                    return userWalletRepository.save(wallet);
                });
    }

    public List<UserWallet> getUserWallets(String userId) {
        return userWalletRepository.findByUserId(userId);
    }
}
