#!/usr/bin/env python3
"""
compute_gametrader_stats.py

Reads candles.db READ-ONLY (bots' database, never written to) and computes
derived pattern statistics into gametrader_stats.db (see gametrader_stats_schema.sql).

Every threshold and window here is a faithful port of the live JS engine in
gametrader.html (PatternEngine / getAsiaPatternStats / getICTSweepStats) — NOT a
reinterpretation. If these ever drift apart, the tutor popup's stated odds would
silently describe a different pattern than the one it just detected live.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

CANDLES_DB_PATH = "/trading/data/candles.db"   # bots' database — READ-ONLY, never write here
STATS_DB_PATH = "/var/www/html/gametrader/gametrader_stats.db"  # GameTrader-owned

LONDON = ZoneInfo("Europe/London")

# ---- Ported 1:1 from CFG in gametrader.html (line ~5352-5362) ----
SESSION_START_MIN = 8 * 60    # 08:00 UK — tradeable/played window start
SESSION_END_MIN = 17 * 60     # 17:00 UK — tradeable/played window end
ASIA_START_MIN = 1 * 60       # 01:00 UK — Asia reference range start
ASIA_END_MIN = 8 * 60         # 08:00 UK — Asia reference range end
MIN_CTX_BARS = 30             # buildLevels(): "ignore fragments" for Asia context
MIN_SESS_BARS = 30            # buildLevels(): "ignore fragments" for session bars
SWEEP_WINDOW_BARS = 15        # round(CFG.sweepWindowSec=900 / 60s bars), min 3
FADE_DIST_PCT = 0.03          # CFG.fadeDistPct — not needed offline (that's a live-proximity
                               # trigger for the popup, irrelevant to historical touch detection,
                               # which uses an actual price cross, not a proximity band)

# Schema is embedded here (not read from a sibling .sql file) so this script has no
# external dependency to lose track of when copying it between machines. The matching
# gametrader_stats_schema.sql file still exists separately purely as human-readable
# reference/documentation for inspecting the DB directly via the sqlite3 CLI — it is
# NOT required for this script to run.
SCHEMA_SQL = """
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
                                            -- pattern_type='realized_outcome' (NULL otherwise) --
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
"""

# Symbol -> candles.db table name. Table name IS the symbol here (candles_<SYMBOL>).
INSTRUMENT_TABLES = {
    "DE40": "candles_DE40",
    "XAUUSD": "candles_XAUUSD",
    "USTEC": "candles_USTEC",
    "STOXX50": "candles_STOXX50",
    "F40": "candles_F40",
    "US500": "candles_US500",
    "US30": "candles_US30",
}

# Correlated pairs for SMT confluence, per the spec (Section 2).
CORRELATED_PAIRS = {
    "DE40": ["STOXX50", "F40"],
    "USTEC": ["US500", "US30"],
    # XAUUSD has no correlated pair wired in yet.
}


def get_bars_readonly(symbol: str) -> list[tuple[int, float, float, float, float, int]]:
    """Reads all bars for one instrument from candles.db, READ-ONLY.

    Uses the SQLite URI 'mode=ro' flag so this is structurally incapable of writing —
    not just a matter of the query never containing INSERT/UPDATE. Connection is opened
    and closed immediately per call; never held open, since candles.db is a live bot
    database that must not be blocked by anything this job does.
    """
    table = INSTRUMENT_TABLES[symbol]
    uri = f"file:{CANDLES_DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        cur = conn.execute(f"SELECT t, o, h, l, c, v FROM {table} ORDER BY t")
        return cur.fetchall()
    finally:
        conn.close()


def uk_minute_of_day(ts: int) -> int:
    dt = datetime.fromtimestamp(ts, timezone.utc).astimezone(LONDON)
    return dt.hour * 60 + dt.minute


def uk_day_key(ts: int) -> str:
    dt = datetime.fromtimestamp(ts, timezone.utc).astimezone(LONDON)
    return dt.date().isoformat()


@dataclass
class Level:
    key: str                       # UK-local calendar date, e.g. '2025-06-12'
    bars: list                     # session bars (08:00-17:00 UK), sorted by t ascending
    asia_hi: Optional[float]
    asia_lo: Optional[float]


def build_levels(rows: list[tuple]) -> list[Level]:
    """Faithful port of buildLevels() in gametrader.html (line ~4447).

    Buckets bars by UK-local calendar day, splits each day into the Asia context
    window (01:00-08:00 UK) and the session/played window (08:00-17:00 UK), computes
    asiaHi/asiaLo from the context bars, and keeps the session bars as the day's
    tradeable `bars` — exactly mirroring the JS version's ctx/sess split and the
    same >=30-bar fragment-filtering thresholds.
    """
    by_day: dict[str, dict[str, list]] = {}
    for b in rows:
        ts = b[0]
        m = uk_minute_of_day(ts)
        in_sess = SESSION_START_MIN <= m < SESSION_END_MIN
        in_asia = ASIA_START_MIN <= m < ASIA_END_MIN
        if not in_sess and not in_asia:
            continue
        k = uk_day_key(ts)
        bucket = by_day.setdefault(k, {"ctx": [], "sess": []})
        if in_sess:
            bucket["sess"].append(b)
        else:
            bucket["ctx"].append(b)

    out: list[Level] = []
    for k in sorted(by_day.keys()):
        ctx = by_day[k]["ctx"]
        sess = by_day[k]["sess"]
        if len(sess) < MIN_SESS_BARS:
            continue
        sess.sort(key=lambda b: b[0])
        asia_hi = None
        asia_lo = None
        if len(ctx) >= MIN_CTX_BARS:
            asia_hi = max(b[2] for b in ctx)
            asia_lo = min(b[3] for b in ctx)
        out.append(Level(key=k, bars=sess, asia_hi=asia_hi, asia_lo=asia_lo))
    return out


def find_fvg(bars: list, from_ix: int, to_ix: int, want_bullish: bool) -> Optional[dict]:
    """Port of findFVG() (gametrader.html line ~4551). 3-candle imbalance:
    bullish (gap up):  bars[i-2].high < bars[i].low  -> zone [bars[i-2].high, bars[i].low]
    bearish (gap down): bars[i-2].low  > bars[i].high -> zone [bars[i].high, bars[i-2].low]
    """
    end = min(to_ix, len(bars) - 1)
    start = max(from_ix + 2, 2)
    for i in range(start, end + 1):
        b0 = bars[i - 2]
        b2 = bars[i]
        if want_bullish:
            if b0[2] < b2[3]:
                return {"ix": i, "lo": b0[2], "hi": b2[3]}
        else:
            if b0[3] > b2[2]:
                return {"ix": i, "lo": b2[2], "hi": b0[3]}
    return None


FVG_SEARCH_BARS = 20   # ICT_CFG.FVG_SEARCH_BARS in the JS reference
FVG_RETEST_BARS = 30   # ICT_CFG.FVG_RETEST_BARS in the JS reference


@dataclass
class DayAnalysis:
    """Everything computed once for one (instrument, day, side) — every pattern_stats
    metric (asia_sweep, ict_fvg, realized_outcome) aggregates from this same record,
    rather than each rescanning bars independently and risking silent drift."""
    day_key: str
    side: int                      # +1 = asiaHi (touched from below), -1 = asiaLo (touched from above)
    level: float
    touched: bool = False
    touch_ix: Optional[int] = None
    extreme: Optional[float] = None       # frozen at moment of reclaim/window-expiry
    reclaimed: bool = False
    reclaim_ix: Optional[int] = None
    fvg: Optional[dict] = None            # {'ix','lo','hi'} if found
    retest_ix: Optional[int] = None       # bar index where price re-entered the FVG zone
    # realized-outcome, keyed by target_type -> 'hit_target' | 'hit_stop' | 'no_hit'
    outcomes: dict = field(default_factory=dict)
    r_achieved: dict = field(default_factory=dict)  # target_type -> R multiple actually reached


def analyze_day(level: Level, side: int) -> DayAnalysis:
    """Ports the live JS state machine's logic (PatternEngine._check / _ictTick) into a
    single offline pass over one day's session bars, for one side (asiaHi or asiaLo)."""
    bars = level.bars
    lvl_price = level.asia_hi if side == 1 else level.asia_lo
    rec = DayAnalysis(day_key=level.key, side=side, level=lvl_price)
    if lvl_price is None:
        return rec

    # --- touch detection ---
    touch_ix = None
    for i, b in enumerate(bars):
        crossed = (b[2] > lvl_price) if side == 1 else (b[3] < lvl_price)
        if crossed:
            touch_ix = i
            break
    if touch_ix is None:
        return rec
    rec.touched = True
    rec.touch_ix = touch_ix

    # --- reclaim within SWEEP_WINDOW_BARS, tracking the frozen extreme ---
    extreme = bars[touch_ix][2] if side == 1 else bars[touch_ix][3]
    reclaim_ix = None
    win_end = min(len(bars) - 1, touch_ix + SWEEP_WINDOW_BARS)
    for j in range(touch_ix, win_end + 1):
        if side == 1:
            extreme = max(extreme, bars[j][2])
            if bars[j][4] < lvl_price:
                reclaim_ix = j
                break
        else:
            extreme = min(extreme, bars[j][3])
            if bars[j][4] > lvl_price:
                reclaim_ix = j
                break
    rec.extreme = extreme
    if reclaim_ix is None:
        return rec  # acceptance day — no reclaim, no FVG/ICT stage applies
    rec.reclaimed = True
    rec.reclaim_ix = reclaim_ix

    # --- FVG search on the reversal leg ---
    fvg = find_fvg(bars, reclaim_ix, reclaim_ix + FVG_SEARCH_BARS, want_bullish=(side == -1))
    if fvg is None:
        return rec
    rec.fvg = fvg

    # --- retest: first bar whose range overlaps the FVG zone ---
    retest_end = min(len(bars) - 1, fvg["ix"] + FVG_RETEST_BARS)
    retest_ix = None
    for k in range(fvg["ix"], retest_end + 1):
        if bars[k][3] <= fvg["hi"] and bars[k][2] >= fvg["lo"]:
            retest_ix = k
            break
    if retest_ix is None:
        return rec
    rec.retest_ix = retest_ix

    # --- realized outcome: entry at retest, stop = frozen extreme, 3 parallel targets ---
    entry = bars[retest_ix][4]
    stop_dist = abs(entry - extreme)
    if stop_dist <= 0:
        return rec  # degenerate, can't compute R
    targets = {
        "1r": entry + (1 * stop_dist if side == -1 else -1 * stop_dist),
        "2r": entry + (2 * stop_dist if side == -1 else -2 * stop_dist),
        "opposite_range": level.asia_hi if side == -1 else level.asia_lo,
    }
    for target_type, target_price in targets.items():
        if target_price is None:
            continue
        outcome = "no_hit"
        r_achieved = 0.0
        for m in range(retest_ix, len(bars)):
            b = bars[m]
            stop_hit = (b[3] <= extreme) if side == -1 else (b[2] >= extreme)
            target_hit = (b[2] >= target_price) if side == -1 else (b[3] <= target_price)
            if stop_hit and target_hit:
                outcome = "hit_stop"        # same-bar ambiguity -> stop wins (conservative)
                r_achieved = -1.0
                break
            if stop_hit:
                outcome = "hit_stop"
                r_achieved = -1.0
                break
            if target_hit:
                outcome = "hit_target"
                r_achieved = (b[2] - entry) / stop_dist if side == -1 else (entry - b[3]) / stop_dist
                break
        rec.outcomes[target_type] = outcome
        rec.r_achieved[target_type] = r_achieved

    return rec


def _pct(n: int, d: int) -> Optional[float]:
    return round(100.0 * n / d, 2) if d > 0 else None


def aggregate_asia_sweep(records: list[DayAnalysis]) -> list[dict]:
    sample = len(records)
    touched = sum(1 for r in records if r.touched)
    reclaimed = sum(1 for r in records if r.reclaimed)
    accepted = sum(1 for r in records if r.touched and not r.reclaimed)
    rows = [
        {"metric": "touched", "count": touched, "denominator": sample, "value": _pct(touched, sample), "unit": "pct"},
        {"metric": "reclaimed", "count": reclaimed, "denominator": touched, "value": _pct(reclaimed, touched), "unit": "pct"},
        {"metric": "accepted", "count": accepted, "denominator": touched, "value": _pct(accepted, touched), "unit": "pct"},
    ]
    return rows


def aggregate_ict_fvg(records: list[DayAnalysis]) -> list[dict]:
    swept = sum(1 for r in records if r.reclaimed)
    fvg = sum(1 for r in records if r.fvg is not None)
    retested = sum(1 for r in records if r.retest_ix is not None)
    confirmed = sum(1 for r in records if r.retest_ix is not None and r.outcomes.get("1r") == "hit_target")
    invalidated = sum(1 for r in records if r.retest_ix is not None and r.outcomes.get("1r") == "hit_stop")
    rows = [
        {"metric": "fvg", "count": fvg, "denominator": swept, "value": _pct(fvg, swept), "unit": "pct"},
        {"metric": "retested", "count": retested, "denominator": fvg, "value": _pct(retested, fvg), "unit": "pct"},
        {"metric": "confirmed", "count": confirmed, "denominator": retested, "value": _pct(confirmed, retested), "unit": "pct"},
        {"metric": "invalidated", "count": invalidated, "denominator": retested, "value": _pct(invalidated, retested), "unit": "pct"},
    ]
    return rows


def aggregate_realized_outcome(records: list[DayAnalysis]) -> dict[str, list[dict]]:
    """Returns {target_type: [rows]}. Enforces hit_target+hit_stop+no_hit == denominator
    by construction: denominator for each target_type is the count of records that
    actually have a computed outcome for it (excludes degenerate stop_dist<=0 days,
    where analyze_day correctly can't compute an R-multiple at all, rather than
    silently miscounting them as retested)."""
    out: dict[str, list[dict]] = {}
    for target_type in ("1r", "2r", "opposite_range"):
        eligible = [r for r in records if r.retest_ix is not None and target_type in r.outcomes]
        denom = len(eligible)
        hit_target = sum(1 for r in eligible if r.outcomes[target_type] == "hit_target")
        hit_stop = sum(1 for r in eligible if r.outcomes[target_type] == "hit_stop")
        no_hit = sum(1 for r in eligible if r.outcomes[target_type] == "no_hit")
        r_values = [r.r_achieved[target_type] for r in eligible]
        avg_r = round(sum(r_values) / len(r_values), 3) if r_values else None
        out[target_type] = [
            {"metric": "hit_target", "count": hit_target, "denominator": denom, "value": _pct(hit_target, denom), "unit": "pct"},
            {"metric": "hit_stop", "count": hit_stop, "denominator": denom, "value": _pct(hit_stop, denom), "unit": "pct"},
            {"metric": "no_hit", "count": no_hit, "denominator": denom, "value": _pct(no_hit, denom), "unit": "pct"},
            {"metric": "avg_r_achieved", "count": len(r_values), "denominator": denom, "value": avg_r, "unit": "r_multiple"},
        ]
        assert hit_target + hit_stop + no_hit == denom, "outcome counts must sum to denominator"
    return out


def aggregate_smt(primary_records: list[DayAnalysis], correlated_records_by_day: dict[str, DayAnalysis]) -> list[dict]:
    """Compares each primary sweep day against the correlated instrument's OWN record
    for the same UK-local calendar day. Only counts days where the correlated instrument
    actually has a touch/no-touch verdict available for that day (guards against a
    market-closed/no-data day being misreported as divergence)."""
    eligible = [r for r in primary_records if r.reclaimed]
    confirmed = 0
    diverged = 0
    counted = 0
    for r in eligible:
        corr = correlated_records_by_day.get(r.day_key)
        if corr is None:
            continue  # no data for this day on the correlated instrument -> skip, don't guess
        counted += 1
        if corr.touched:
            confirmed += 1
        else:
            diverged += 1
    return [
        {"metric": "smt_confirmed", "count": confirmed, "denominator": counted, "value": _pct(confirmed, counted), "unit": "pct"},
        {"metric": "smt_diverged", "count": diverged, "denominator": counted, "value": _pct(diverged, counted), "unit": "pct"},
    ]


def write_stats(conn: sqlite3.Connection, rows_to_insert: list[tuple]) -> None:
    conn.executemany(
        """INSERT INTO pattern_stats
           (instrument, correlated_instrument, pattern_type, level_key, target_type,
            metric, count, denominator, value, unit, window_start, window_end, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        rows_to_insert,
    )
    conn.commit()


def run(stats_db_path: str = STATS_DB_PATH) -> None:
    computed_at = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(stats_db_path)
    try:
        conn.executescript(SCHEMA_SQL)

        all_records: dict[str, dict[str, list[DayAnalysis]]] = {}  # instrument -> level_key -> records
        all_levels: dict[str, list[Level]] = {}

        for symbol in INSTRUMENT_TABLES:
            rows = get_bars_readonly(symbol)
            levels = build_levels(rows)
            all_levels[symbol] = levels
            all_records[symbol] = {
                "asiaHi": [analyze_day(lv, 1) for lv in levels],
                "asiaLo": [analyze_day(lv, -1) for lv in levels],
            }

        insert_rows: list[tuple] = []
        for symbol, by_level in all_records.items():
            levels = all_levels[symbol]
            window_start = levels[0].key if levels else ""
            window_end = levels[-1].key if levels else ""

            for level_key, records in by_level.items():
                for row in aggregate_asia_sweep(records):
                    insert_rows.append((symbol, None, "asia_sweep", level_key, None,
                                         row["metric"], row["count"], row["denominator"], row["value"], row["unit"],
                                         window_start, window_end, computed_at))
                for row in aggregate_ict_fvg(records):
                    insert_rows.append((symbol, None, "ict_fvg", level_key, None,
                                         row["metric"], row["count"], row["denominator"], row["value"], row["unit"],
                                         window_start, window_end, computed_at))
                for target_type, rows in aggregate_realized_outcome(records).items():
                    for row in rows:
                        insert_rows.append((symbol, None, "realized_outcome", level_key, target_type,
                                             row["metric"], row["count"], row["denominator"], row["value"], row["unit"],
                                             window_start, window_end, computed_at))

            for corr_symbol in CORRELATED_PAIRS.get(symbol, []):
                corr_records_by_level = all_records.get(corr_symbol)
                if corr_records_by_level is None:
                    continue
                for level_key, records in by_level.items():
                    corr_by_day = {r.day_key: r for r in corr_records_by_level[level_key]}
                    for row in aggregate_smt(records, corr_by_day):
                        insert_rows.append((symbol, corr_symbol, "smt_confluence", level_key, None,
                                             row["metric"], row["count"], row["denominator"], row["value"], row["unit"],
                                             window_start, window_end, computed_at))

        write_stats(conn, insert_rows)
        print(f"Wrote {len(insert_rows)} rows to {stats_db_path} (computed_at={computed_at})")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
