#!/usr/bin/env python3
"""Read-only candle access for Game Trader Bot Lab."""

import json
import os
import sqlite3
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

DB_PATH = "/trading/data/candles.db"
SYMBOLS = {"DE40", "XAUUSD", "USTEC"}
LONDON = ZoneInfo("Europe/London")
MAX_RANGE_DAYS = 120
# Strategy execution uses its own 1,200-bar warmup. This larger read-only
# context is for replay-chart navigation and higher timeframes only.
CHART_HISTORY_BARS = 10080


class RequestError(ValueError):
    pass


def _symbol(value):
    symbol = str(value or "").upper()
    if symbol not in SYMBOLS:
        raise RequestError("Unsupported symbol")
    return symbol


def _date(value, field):
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise RequestError(f"Invalid {field} date")


def _connect(db_path=DB_PATH):
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def metadata(symbol, db_path=DB_PATH):
    symbol = _symbol(symbol)
    with _connect(db_path) as connection:
        first_ts, last_ts, count = connection.execute(
            f'SELECT MIN(t), MAX(t), COUNT(*) FROM "candles_{symbol}"'
        ).fetchone()
    if first_ts is None or last_ts is None:
        raise RequestError("No candles available")
    return {
        "symbol": symbol,
        "firstDate": datetime.fromtimestamp(first_ts, timezone.utc).astimezone(LONDON).date().isoformat(),
        "lastDate": datetime.fromtimestamp(last_ts, timezone.utc).astimezone(LONDON).date().isoformat(),
        "firstTimestamp": first_ts,
        "lastTimestamp": last_ts,
        "count": count,
        "source": "sqlite",
    }


def candle_range(symbol, from_date, to_date, db_path=DB_PATH):
    symbol = _symbol(symbol)
    start_day = _date(from_date, "from")
    end_day = _date(to_date, "to")
    if end_day < start_day:
        raise RequestError("The to date must not precede the from date")
    if (end_day - start_day).days + 1 > MAX_RANGE_DAYS:
        raise RequestError(f"Date range is limited to {MAX_RANGE_DAYS} days")

    start_ts = int(datetime.combine(start_day, time.min, LONDON).timestamp())
    end_ts = int(datetime.combine(end_day + timedelta(days=1), time.min, LONDON).timestamp())
    table = f'candles_{symbol}'
    with _connect(db_path) as connection:
        warmup = connection.execute(
            f'SELECT t,o,h,l,c,v FROM "{table}" WHERE t < ? ORDER BY t DESC LIMIT ?',
            (start_ts, CHART_HISTORY_BARS),
        ).fetchall()
        rows = connection.execute(
            f'SELECT t,o,h,l,c,v FROM "{table}" WHERE t >= ? AND t < ? ORDER BY t',
            (start_ts, end_ts),
        ).fetchall()
    warmup.reverse()
    bars = [list(row) for row in warmup + rows]
    return {
        "symbol": symbol,
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "warmupCount": len(warmup),
        "rangeCount": len(rows),
        "bars": bars,
        "source": "sqlite",
    }


def dispatch(params, db_path=DB_PATH):
    action = (params.get("action") or ["meta"])[0]
    symbol = (params.get("symbol") or [""])[0]
    if action == "meta":
        return metadata(symbol, db_path)
    if action == "candles":
        return candle_range(
            symbol,
            (params.get("from") or [""])[0],
            (params.get("to") or [""])[0],
            db_path,
        )
    raise RequestError("Unsupported action")


def cgi_main():
    try:
        payload = dispatch(parse_qs(os.environ.get("QUERY_STRING", "")))
        status = "200 OK"
    except RequestError as error:
        payload = {"error": str(error)}
        status = "400 Bad Request"
    except Exception:
        payload = {"error": "Candle data is temporarily unavailable"}
        status = "500 Internal Server Error"
    print(f"Status: {status}")
    print("Content-Type: application/json; charset=utf-8")
    print("Cache-Control: no-store")
    print("X-Content-Type-Options: nosniff")
    print()
    print(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    cgi_main()
