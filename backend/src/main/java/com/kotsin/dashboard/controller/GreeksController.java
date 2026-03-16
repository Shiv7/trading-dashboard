package com.kotsin.dashboard.controller;

import com.kotsin.dashboard.options.BlackScholesCalculator;
import com.kotsin.dashboard.options.OptionGreeks;
import com.kotsin.dashboard.options.OptionGreeks.OptionType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * REST endpoint for computing option Greeks on demand.
 * Used by frontend CTA buttons to show revised SL/targets when user clicks
 * beyond the 30m signal boundary.
 */
@RestController
@RequestMapping("/api/greeks")
@RequiredArgsConstructor
@Slf4j
public class GreeksController {

    private final BlackScholesCalculator calculator;

    @Value("${option.greek.sl.iv.multiplier:1.5}")
    private double slIvMultiplier;

    @Value("${option.greek.sl.min.floor:0.08}")
    private double slMinFloor;

    @Value("${option.greek.gamma.boost.multiplier:15.0}")
    private double gammaBoostMultiplier;

    @Value("${option.greek.gamma.boost.cap:0.5}")
    private double gammaBoostCap;

    @Value("${option.greek.theta.impairment.threshold:0.05}")
    private double thetaImpairmentThreshold;

    /**
     * Compute Greeks + revised SL/targets for a given option at current LTP.
     *
     * @param spot        Current underlying equity price
     * @param strike      Option strike price
     * @param optionLtp   Current option LTP
     * @param optionType  "CE" or "PE"
     * @param expiry      Expiry date (yyyy-MM-dd)
     * @param equityEntry Original equity entry price (for SL/target computation)
     * @param equitySl    Original equity SL
     * @param equityT1    Original equity T1
     * @param equityT2    Original equity T2 (optional)
     * @param equityT3    Original equity T3 (optional)
     * @param equityT4    Original equity T4 (optional)
     */
    @GetMapping("/compute")
    public ResponseEntity<Map<String, Object>> computeGreeks(
            @RequestParam double spot,
            @RequestParam double strike,
            @RequestParam double optionLtp,
            @RequestParam String optionType,
            @RequestParam String expiry,
            @RequestParam double equityEntry,
            @RequestParam double equitySl,
            @RequestParam double equityT1,
            @RequestParam(defaultValue = "0") double equityT2,
            @RequestParam(defaultValue = "0") double equityT3,
            @RequestParam(defaultValue = "0") double equityT4) {

        try {
            LocalDate expiryDate;
            try {
                expiryDate = LocalDate.parse(expiry, DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (Exception e) {
                expiryDate = LocalDate.parse(expiry, DateTimeFormatter.ofPattern("yyyy-MM-dd"));
            }

            OptionType bsType = "CE".equals(optionType) ? OptionType.CALL : OptionType.PUT;
            OptionGreeks greeks = calculator.calculateGreeks(spot, strike, expiryDate, bsType, optionLtp);

            double delta = greeks.getDelta();
            double absDelta = Math.abs(delta);
            double gamma = greeks.getGamma();
            double theta = greeks.getTheta();
            double iv = greeks.getImpliedVolatility();
            int dte = greeks.getDaysToExpiry();

            boolean thetaImpaired = optionLtp > 0 && (Math.abs(theta) / optionLtp) > thetaImpairmentThreshold;

            // Compute Greek-aware SL
            double equityRiskDistance = Math.abs(equityEntry - equitySl);
            double deltaSL = optionLtp - equityRiskDistance * absDelta;
            double ivDecimal = iv / 100.0;
            double tYears = Math.max(dte / 365.0, 0.001);
            double ivFloor = optionLtp * ivDecimal * Math.sqrt(tYears) * slIvMultiplier;
            double absoluteFloor = optionLtp * slMinFloor;
            double minSLdistance = Math.max(ivFloor, absoluteFloor);

            double optionSL;
            String slMethod;
            if ((optionLtp - deltaSL) < minSLdistance) {
                optionSL = optionLtp - minSLdistance;
                slMethod = "IV_FLOOR";
            } else {
                optionSL = deltaSL;
                slMethod = "DELTA";
            }
            optionSL = Math.max(optionSL, 0.05);

            double gammaBoost = Math.min(gamma * gammaBoostMultiplier, gammaBoostCap);

            double optT1 = equityT1 > 0 ? optionLtp + Math.abs(equityT1 - equityEntry) * absDelta : 0;
            double optT2 = equityT2 > 0 ? optionLtp + Math.abs(equityT2 - equityEntry) * absDelta * (1 + gammaBoost) : 0;
            double optT3 = equityT3 > 0 ? optionLtp + Math.abs(equityT3 - equityEntry) * absDelta * (1 + gammaBoost) : 0;
            double optT4 = equityT4 > 0 ? optionLtp + Math.abs(equityT4 - equityEntry) * absDelta * (1 + gammaBoost) : 0;

            double optionRisk = optionLtp - optionSL;
            double optionReward = optT1 - optionLtp;
            double optionRR = optionRisk > 0 ? optionReward / optionRisk : 0;
            String lotAllocation = thetaImpaired ? "100,0,0,0" : "40,30,20,10";

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("delta", round(delta, 4));
            result.put("gamma", round(gamma, 6));
            result.put("theta", round(theta, 4));
            result.put("vega", round(greeks.getVega(), 4));
            result.put("iv", round(iv, 2));
            result.put("dte", dte);
            result.put("moneynessType", greeks.getMoneynessType() != null ? greeks.getMoneynessType().name() : "UNKNOWN");
            result.put("thetaImpaired", thetaImpaired);
            result.put("optionSL", round(optionSL, 2));
            result.put("optionT1", round(optT1, 2));
            result.put("optionT2", round(optT2, 2));
            result.put("optionT3", round(optT3, 2));
            result.put("optionT4", round(optT4, 2));
            result.put("optionRR", round(optionRR, 2));
            result.put("slMethod", slMethod);
            result.put("gammaBoost", round(gammaBoost, 4));
            result.put("lotAllocation", lotAllocation);
            result.put("optionLtp", optionLtp);
            result.put("spot", spot);

            log.info("GREEKS_COMPUTE strike={} type={} ltp={} delta={} IV={}% SL={} T1={} RR={}",
                strike, optionType, round(optionLtp, 2), round(delta, 3), round(iv, 1),
                round(optionSL, 2), round(optT1, 2), round(optionRR, 2));

            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("GREEKS_COMPUTE_ERROR: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    private double round(double value, int places) {
        double factor = Math.pow(10, places);
        return Math.round(value * factor) / factor;
    }
}
