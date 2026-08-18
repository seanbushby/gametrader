-- gametrader_stats.db
-- Owned by GameTrader. Holds ONLY derived numbers computed from candles.db
-- (read-only, never copied). No raw candle data lives here.

CREATE TABLE IF NOT EXISTS pattern_stats (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument            TEXT NOT NULL,   -- e.g. 'DE40'
    correlated_instrument TEXT,            -- e.g. 'STOXX50'; NULL for non-SMT stats
    pattern_type          TEXT NOT NULL,   -- 'asia_sweep' | 'ict_fvg' | 'smt_confluence' |
                                            -- 'realized_outcome' | future types
    level_key             TEXT NOT NULL,   -- 'asiaHi' | 'asiaLo'
    target_type           TEXT,            -- '1r' | '2r' | 'opposite_range'; only used for
                                            -- pattern_type='realized_outcome' (NULL otherwise) —
                                            -- disambiguates the 3 parallel target definitions
                                            -- computed from the same entry/stop
    metric                TEXT NOT NULL,   -- 'touched' | 'reclaimed' | 'accepted' | 'fvg' |
                                            -- 'retested' | 'confirmed' | 'invalidated' |
                                            -- 'smt_confirmed' | 'smt_diverged' |
                                            -- 'hit_target' | 'hit_stop' | 'no_hit' |
                                            -- 'avg_r_achieved' | 'median_r_achieved' | future metrics
    count                 INTEGER NOT NULL,
    denominator           INTEGER NOT NULL,  -- what `count`/`value` is relative to at this stage
    value                 REAL,              -- percentage OR magnitude, depending on `unit`
    unit                  TEXT NOT NULL DEFAULT 'pct',  -- 'pct' | 'r_multiple' | 'points'
    bucket                TEXT,              -- reserved for future breakdowns (e.g. hour-of-day,
                                              -- day-of-week); unused/NULL for now, no migration
                                              -- needed later when that's added
    window_start          TEXT NOT NULL,     -- ISO date, inclusive
    window_end            TEXT NOT NULL,     -- ISO date, inclusive
    computed_at           TEXT NOT NULL      -- ISO datetime this row was computed
);

CREATE INDEX IF NOT EXISTS idx_pattern_stats_lookup
    ON pattern_stats (instrument, pattern_type, level_key, target_type, computed_at);

-- Typical read the frontend export step will do: latest row set for one instrument/pattern.
-- SELECT * FROM pattern_stats
-- WHERE instrument = ? AND pattern_type = ?
--   AND computed_at = (SELECT MAX(computed_at) FROM pattern_stats WHERE instrument = ? AND pattern_type = ?);

-- ============================================================
-- REALIZED-OUTCOME COMPUTATION RULES (locked in, not yet coded)
-- ============================================================
-- Entry:      at the FVG retest (the live engine's `in_fvg` phase) — the same moment the
--             tutor popup already frames as "this is the zone."
-- Stop:       the original sweep extreme (already tracked in the live engine as `extreme`).
-- Targets (computed independently, 3 rows per setup, one per target_type):
--   '1r'             — 1x the entry-to-stop distance, projected in the trade direction
--   '2r'             — 2x the same distance
--   'opposite_range' — the opposite side of the Asia range (swept the low -> target = Asia high)
-- Same-bar tie-break: if a single bar's range contains both the stop level and a target
--   level, count it as a STOP hit, never a target hit. This is the conservative convention —
--   OHLC data alone can't tell you which was actually touched first within the bar, and
--   assuming the target wins would systematically inflate the win rate.
-- No-hit handling: if neither stop nor target is reached before the day's session data ends,
--   record it as its own 'no_hit' count — NOT silently excluded from the denominator. All
--   three metrics ('hit_target', 'hit_stop', 'no_hit') must sum to `denominator` for a given
--   instrument/level/target_type, so nobody can compute a flattering win rate by quietly
--   dropping the ambiguous cases.
-- Labeling requirement downstream: any UI showing these numbers must state the window_start/
--   window_end dates plainly (e.g. "historical, Jul 2024-Jul 2026") — never phrased as a
--   forward-looking guarantee, and never combined into a single expectancy/EV figure
--   (win rate x R-multiple) without also showing the two inputs separately.
