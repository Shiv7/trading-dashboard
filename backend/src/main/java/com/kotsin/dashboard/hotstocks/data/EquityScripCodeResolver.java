package com.kotsin.dashboard.hotstocks.data;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Optional;

/**
 * Resolves a raw NSE symbol (e.g. "AGIIL", "OLAELEC", "RELIANCE") to its 5paisa cash-equity
 * scripCode from the {@code scripData} Mongo collection.
 *
 * <p>Non-F&amp;O equities have no entry in {@code ScripGroup} (F&amp;O-curated) so the dashboard's
 * usual symbol→scripCode path fails. The full 5paisa master lives in {@code scripData}
 * (~160k rows) and includes the 2,500 NSE cash EQ series rows we need for Tier-2 HotStocks.
 *
 * <p>Query shape: {@code Exch="N", ExchType="C", Series="EQ", SymbolRoot=<symbol>}.
 *
 * <p>Results are cached in-memory for 24h — the 5paisa master only rotates on quarterly
 * rebases, so weekday stability is safe.
 */
@Component
public class EquityScripCodeResolver {

    private static final Logger log = LoggerFactory.getLogger(EquityScripCodeResolver.class);

    private final MongoTemplate mongo;
    private final Cache<String, String> scripCodeCache = Caffeine.newBuilder()
        .maximumSize(5000)
        .expireAfterWrite(Duration.ofHours(24))
        .build();

    public EquityScripCodeResolver(MongoTemplate mongo) {
        this.mongo = mongo;
    }

    /**
     * Resolve {@code symbol} → 5paisa NSE cash scripCode, or empty if the symbol isn't in the
     * master. Case-insensitive; symbol is uppercased before lookup.
     */
    public Optional<String> resolve(String symbol) {
        if (symbol == null || symbol.isBlank()) return Optional.empty();
        String key = symbol.trim().toUpperCase();

        String cached = scripCodeCache.getIfPresent(key);
        if (cached != null) {
            return cached.isEmpty() ? Optional.empty() : Optional.of(cached);
        }

        try {
            Query q = new Query(
                Criteria.where("Exch").is("N")
                    .and("ExchType").is("C")
                    .and("Series").is("EQ")
                    .and("SymbolRoot").is(key)
            );
            q.limit(1);
            Document doc = mongo.findOne(q, Document.class, "scripData");
            if (doc == null) {
                // Cache negative hit to avoid repeated DB pressure for symbols that genuinely don't exist
                scripCodeCache.put(key, "");
                return Optional.empty();
            }
            String scripCode = doc.getString("ScripCode");
            if (scripCode == null || scripCode.isBlank()) {
                scripCodeCache.put(key, "");
                return Optional.empty();
            }
            scripCodeCache.put(key, scripCode);
            return Optional.of(scripCode);
        } catch (Exception e) {
            log.warn("[EQUITY-SCRIP-RESOLVER] lookup failed for symbol={}: {}", key, e.getMessage());
            return Optional.empty();
        }
    }

    /** Test hook — invalidate the cache so a fresh lookup runs next call. */
    public void invalidateAll() {
        scripCodeCache.invalidateAll();
    }
}
