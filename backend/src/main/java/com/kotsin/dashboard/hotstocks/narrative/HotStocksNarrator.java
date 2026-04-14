package com.kotsin.dashboard.hotstocks.narrative;

import com.kotsin.dashboard.hotstocks.model.StockMetrics;
import org.springframework.stereotype.Component;

@Component
public class HotStocksNarrator {

    private final ThesisGenerator thesisGenerator;
    private final ActionCueGenerator cueGenerator;

    public HotStocksNarrator(ThesisGenerator thesisGenerator, ActionCueGenerator cueGenerator) {
        this.thesisGenerator = thesisGenerator;
        this.cueGenerator = cueGenerator;
    }

    /** Mutates metrics in place — sets thesisText, actionCueType, actionCueText. */
    public void enrich(StockMetrics metrics) {
        metrics.setThesisText(thesisGenerator.generate(metrics));
        ActionCueGenerator.CueResult cue = cueGenerator.generate(metrics);
        metrics.setActionCueType(cue.type);
        metrics.setActionCueText(cue.text);
    }
}
