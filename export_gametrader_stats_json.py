#!/usr/bin/env python3
"""
export_gametrader_stats_json.py

__version__ = "1.0.0"

CHANGELOG:
  1.0.0 - Initial version. Reads the latest computed_at row set per instrument from
          gametrader_stats.db and writes one small JSON file per instrument, in a
          shape mirroring the existing JS getAsiaPatternStats()/getICTSweepStats()
          objects so the frontend can fetch precomputed stats instead of recomputing
          them client-side from the thin 2-week CSVs.

Deliberately produces a SMALL, "latest snapshot only" JSON per instrument -- NOT a
dump of the whole growing pattern_stats table. gametrader_stats.db is designed to keep
every computed_at run forever (so odds-drift-over-time can be inspected later), but
the browser only ever needs the most recent snapshot. This script is the boundary that
keeps that historical growth from ever reaching the client.

Run this AFTER compute_gametrader_stats.py on each refresh cycle.
"""

from __future__ import annotations

__version__ = "1.0.0"

import json
import sqlite3
from pathlib import Path

STATS_DB_PATH = "/var/www/html/gametrader/gametrader_stats.db"
OUTPUT_DIR = "/var/www/html/gametrader"  # same place the instrument CSVs are already served from

# Matches compute_gametrader_stats.py's INSTRUMENT_TABLES keys and CORRELATED_PAIRS.
INSTRUMENTS = ["DE40", "XAUUSD", "USTEC", "STOXX50", "F40", "US500", "US30"]
CORRELATED_PAIRS = {
    "DE40": ["STOXX50", "F40"],
    "USTEC": ["US500", "US30"],
}


def latest_computed_at(conn: sqlite3.Connection, instrument: str) -> str | None:
    row = conn.execute(
        "SELECT MAX(computed_at) FROM pattern_stats WHERE instrument = ?", (instrument,)
    ).fetchone()
    return row[0] if row else None


def rows_for(conn: sqlite3.Connection, instrument: str, computed_at: str) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """SELECT correlated_instrument, pattern_type, level_key, target_type, metric,
                  count, denominator, value, unit, window_start, window_end
           FROM pattern_stats
           WHERE instrument = ? AND computed_at = ?""",
        (instrument, computed_at),
    ).fetchall()


def build_instrument_json(conn: sqlite3.Connection, instrument: str) -> dict | None:
    computed_at = latest_computed_at(conn, instrument)
    if computed_at is None:
        return None  # no stats computed yet for this instrument -- skip, don't write a stale/empty file

    rows = rows_for(conn, instrument, computed_at)

    out = {
        "instrument": instrument,
        "computed_at": computed_at,
        "window_start": rows[0]["window_start"] if rows else None,
        "window_end": rows[0]["window_end"] if rows else None,
        "asia_sweep": {"asiaHi": {}, "asiaLo": {}},
        "ict_fvg": {"asiaHi": {}, "asiaLo": {}},
        "realized_outcome": {"asiaHi": {}, "asiaLo": {}},
        "smt_confluence": {},
    }

    for r in rows:
        pt = r["pattern_type"]
        lk = r["level_key"]
        metric = r["metric"]
        entry = {"count": r["count"], "denominator": r["denominator"], "value": r["value"], "unit": r["unit"]}

        if pt == "asia_sweep":
            out["asia_sweep"][lk][metric] = entry
        elif pt == "ict_fvg":
            out["ict_fvg"][lk][metric] = entry
        elif pt == "realized_outcome":
            tt = r["target_type"]
            out["realized_outcome"][lk].setdefault(tt, {})[metric] = entry
        elif pt == "smt_confluence":
            corr = r["correlated_instrument"]
            out["smt_confluence"].setdefault(corr, {"asiaHi": {}, "asiaLo": {}})
            out["smt_confluence"][corr][lk][metric] = entry

    return out


def run(stats_db_path: str = STATS_DB_PATH, output_dir: str = OUTPUT_DIR) -> None:
    print(f"export_gametrader_stats_json.py v{__version__}")
    conn = sqlite3.connect(f"file:{stats_db_path}?mode=ro", uri=True)
    try:
        out_path = Path(output_dir)
        written = 0
        for instrument in INSTRUMENTS:
            data = build_instrument_json(conn, instrument)
            if data is None:
                print(f"  {instrument}: no stats found, skipped")
                continue
            filename = f"gametrader-stats-{instrument.lower()}.json"
            (out_path / filename).write_text(json.dumps(data, indent=2))
            print(f"  {instrument}: wrote {filename} (computed_at={data['computed_at']})")
            written += 1
        print(f"Done. Wrote {written}/{len(INSTRUMENTS)} instrument JSON files to {output_dir}")
    finally:
        conn.close()


if __name__ == "__main__":
    run()

