#!/usr/bin/env python3

from __future__ import annotations

import csv
import math
import os
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

import requests
from twisted.internet import defer, reactor
from twisted.internet.error import ReactorNotRunning

from ctrader_open_api import Client, EndPoints, Protobuf, TcpProtocol
from ctrader_open_api.messages.OpenApiMessages_pb2 import (
    ProtoOAAccountAuthReq,
    ProtoOAApplicationAuthReq,
    ProtoOAErrorRes,
    ProtoOAGetAccountListByAccessTokenReq,
    ProtoOAGetTrendbarsReq,
    ProtoOASymbolsListReq,
)
from ctrader_open_api.messages.OpenApiModelMessages_pb2 import ProtoOATrendbarPeriod


BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = Path(os.environ.get("GAMETRADER_ENV_PATH", BASE_DIR / ".env")).resolve()
LONDON = ZoneInfo("Europe/London")
UTC = timezone.utc
TOKEN_URL = "https://openapi.ctrader.com/apps/token"
GAP_THRESHOLD_MINUTES = 3
MAX_HISTORY_WEEKS = 2  # keep only this many most recently completed trading weeks

SYMBOL_TARGETS = {
    "DE40": "gametrader-de40.csv",
    "XAUUSD": "gametrader-xauusd.csv",
    "USTEC": "gametrader-ustec.csv",
    "STOXX50": "gametrader-stoxx50.csv",
    "F40": "gametrader-f40.csv",
    "US500": "gametrader-us500.csv",
    "US30": "gametrader-us30.csv",
}

SYMBOL_ALIASES = {
    "DE40": {"DE40"},
    "XAUUSD": {"XAUUSD"},
    "USTEC": {"USTEC"},
    "STOXX50": {"STOXX50"},
    "F40": {"F40"},
    "US500": {"US500"},
    "US30": {"US30"},
}


class ExportError(Exception):
    pass


@dataclass(frozen=True)
class Candle:
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass(frozen=True)
class SymbolInfo:
    target: str
    symbol_id: int
    symbol_name: str
    digits: int


def load_env(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text().splitlines()
    values: dict[str, str] = {}
    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return lines, values


def update_env_tokens(path: Path, access_token: str, refresh_token: str) -> None:
    lines = path.read_text().splitlines()
    updated: list[str] = []
    seen = set()
    for line in lines:
        if line.startswith("CTRADER_ACCESS_TOKEN="):
            updated.append(f"CTRADER_ACCESS_TOKEN={access_token}")
            seen.add("CTRADER_ACCESS_TOKEN")
            continue
        if line.startswith("ACCESS_TOKEN="):
            updated.append(f"ACCESS_TOKEN={access_token}")
            seen.add("ACCESS_TOKEN")
            continue
        if line.startswith("CTRADER_REFRESH_TOKEN="):
            updated.append(f"CTRADER_REFRESH_TOKEN={refresh_token}")
            seen.add("CTRADER_REFRESH_TOKEN")
            continue
        if line.startswith("REFRESH_TOKEN="):
            updated.append(f"REFRESH_TOKEN={refresh_token}")
            seen.add("REFRESH_TOKEN")
            continue
        updated.append(line)
    if "CTRADER_ACCESS_TOKEN" not in seen:
        if "ACCESS_TOKEN" not in seen:
            updated.append(f"CTRADER_ACCESS_TOKEN={access_token}")
    if "CTRADER_REFRESH_TOKEN" not in seen:
        if "REFRESH_TOKEN" not in seen:
            updated.append(f"CTRADER_REFRESH_TOKEN={refresh_token}")
    path.write_text("\n".join(updated) + "\n")


def require_env(values: dict[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise ExportError(f"Missing required env value: {key}")
    return value


def env_first(values: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = values.get(key, "").strip()
        if value:
            return value
    raise ExportError(f"Missing required env value. Tried: {', '.join(keys)}")


def normalize_symbol_name(value: str) -> str:
    return "".join(ch for ch in value.upper() if ch.isalnum())


def previous_trading_week_window(now: Optional[datetime] = None) -> tuple[datetime, datetime]:
    london_now = (now or datetime.now(UTC)).astimezone(LONDON)
    days_since_friday = (london_now.weekday() - 4) % 7
    end_date = london_now.date() - timedelta(days=days_since_friday)
    end_dt = datetime.combine(end_date, time(21, 0), tzinfo=LONDON)
    if london_now <= end_dt:
        end_dt -= timedelta(days=7)
    start_date = end_dt.date() - timedelta(days=5)
    start_dt = datetime.combine(start_date, time(23, 0), tzinfo=LONDON)
    return start_dt, end_dt


def format_uk(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).astimezone(LONDON).strftime("%Y-%m-%d %H:%M:%S %Z")


def trading_week_key(ts: int) -> str:
    """Groups a candle timestamp by the trading week it belongs to (Sun 23:00 London ->
    Fri 21:00 London), keyed by that week's Friday-close date. Mirrors the same week
    boundary logic as previous_trading_week_window(), so weeks line up consistently."""
    dt = datetime.fromtimestamp(ts, UTC).astimezone(LONDON)
    days_since_friday = (dt.weekday() - 4) % 7
    end_date = dt.date() - timedelta(days=days_since_friday)
    end_dt = datetime.combine(end_date, time(21, 0), tzinfo=LONDON)
    if dt > end_dt:
        end_dt += timedelta(days=7)  # weekend candle belongs to the following trading week
    return end_dt.date().isoformat()


def price_from_relative(relative: int, digits: int) -> float:
    return round(relative / 100000.0, digits)


def decode_trendbars(trendbars: Iterable, digits: int, start_ts: int, end_ts: int) -> list[Candle]:
    rows: dict[int, Candle] = {}
    for trendbar in trendbars:
        timestamp = int(trendbar.utcTimestampInMinutes) * 60
        if timestamp < start_ts or timestamp >= end_ts:
            continue
        low_rel = int(trendbar.low)
        low = price_from_relative(low_rel, digits)
        open_ = price_from_relative(low_rel + int(trendbar.deltaOpen), digits)
        high = price_from_relative(low_rel + int(trendbar.deltaHigh), digits)
        close = price_from_relative(low_rel + int(trendbar.deltaClose), digits)
        rows[timestamp] = Candle(
            timestamp=timestamp,
            open=open_,
            high=high,
            low=low,
            close=close,
            volume=int(trendbar.volume),
        )
    return [rows[key] for key in sorted(rows)]


def weekday_gaps(candles: list[Candle]) -> list[tuple[str, str, int]]:
    gaps: list[tuple[str, str, int]] = []
    for prev, curr in zip(candles, candles[1:]):
        gap_minutes = (curr.timestamp - prev.timestamp) // 60
        if gap_minutes <= GAP_THRESHOLD_MINUTES:
            continue
        prev_dt = datetime.fromtimestamp(prev.timestamp, UTC).astimezone(LONDON)
        curr_dt = datetime.fromtimestamp(curr.timestamp, UTC).astimezone(LONDON)
        if prev_dt.weekday() >= 5 or curr_dt.weekday() >= 5:
            continue
        gaps.append((format_uk(prev.timestamp), format_uk(curr.timestamp), int(gap_minutes)))
    return gaps


def write_csv(path: Path, candles: list[Candle]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["time", "open", "high", "low", "close", "Volume"])
        for candle in candles:
            writer.writerow([
                candle.timestamp,
                f"{candle.open:.10f}".rstrip("0").rstrip("."),
                f"{candle.high:.10f}".rstrip("0").rstrip("."),
                f"{candle.low:.10f}".rstrip("0").rstrip("."),
                f"{candle.close:.10f}".rstrip("0").rstrip("."),
                candle.volume,
            ])


def read_existing_csv(path: Path) -> list[Candle]:
    if not path.exists():
        return []
    rows: list[Candle] = []
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                rows.append(Candle(
                    timestamp=int(row["time"]),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=int(float(row.get("Volume") or row.get("volume") or 0)),
                ))
            except (KeyError, ValueError, TypeError):
                continue  # skip malformed rows rather than failing the whole export
    return rows


def merge_and_prune(existing: list[Candle], new: list[Candle], max_weeks: int) -> list[Candle]:
    by_ts = {c.timestamp: c for c in existing}
    for c in new:
        by_ts[c.timestamp] = c  # freshly fetched candle wins on any overlap
    weeks: dict[str, list[Candle]] = {}
    for c in by_ts.values():
        weeks.setdefault(trading_week_key(c.timestamp), []).append(c)
    keep_keys = sorted(weeks.keys())[-max_weeks:]  # ISO date keys sort chronologically
    merged: list[Candle] = []
    for key in keep_keys:
        merged.extend(weeks[key])
    merged.sort(key=lambda c: c.timestamp)
    return merged


def print_summary(filename: str, candles: list[Candle]) -> None:
    if not candles:
        raise ExportError(f"No candles returned for {filename}")
    first_ts = candles[0].timestamp
    last_ts = candles[-1].timestamp
    print(f"{filename}: rows={len(candles)} first={format_uk(first_ts)} last={format_uk(last_ts)}")
    gaps = weekday_gaps(candles)
    if gaps:
        print("  weekday gaps>", GAP_THRESHOLD_MINUTES, "minutes:", sep="")
        for start, end, minutes in gaps:
            print(f"  - {minutes} minutes: {start} -> {end}")
    else:
        print(f"  weekday gaps>{GAP_THRESHOLD_MINUTES} minutes: none")


def discover_sqlite_source(base_dir: Path) -> Optional[Path]:
    candidates = sorted(base_dir.glob("*.db"))
    for candidate in candidates:
        if candidate.name == "candles.db":
            return candidate
    return None


def export_from_sqlite(db_path: Path, start_ts: int, end_ts: int) -> Optional[dict[str, list[Candle]]]:
    try:
        conn = sqlite3.connect(db_path)
    except sqlite3.Error:
        return None
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if not tables:
            return None
    finally:
        conn.close()
    return None


def refresh_access_token(env: dict[str, str]) -> tuple[str, str]:
    response = requests.get(
        TOKEN_URL,
        params={
            "grant_type": "refresh_token",
            "refresh_token": env_first(env, "CTRADER_REFRESH_TOKEN", "REFRESH_TOKEN"),
            "client_id": env_first(env, "CTRADER_CLIENT_ID", "CLIENT_ID"),
            "client_secret": env_first(env, "CTRADER_CLIENT_SECRET", "CLIENT_SECRET"),
        },
        headers={"Accept": "application/json"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errorCode"):
        raise ExportError(
            f"cTrader token refresh failed: {payload['errorCode']} {payload.get('description', '').strip()}".strip()
        )
    access_token = payload.get("accessToken")
    refresh_token = payload.get("refreshToken")
    if not access_token or not refresh_token:
        raise ExportError("cTrader token refresh did not return both accessToken and refreshToken")
    update_env_tokens(ENV_PATH, access_token, refresh_token)
    return access_token, refresh_token


class CTraderExporter:
    def __init__(self, env: dict[str, str], start_dt: datetime, end_dt: datetime):
        self.env = env
        self.start_dt = start_dt
        self.end_dt = end_dt
        self.access_token = env_first(env, "CTRADER_ACCESS_TOKEN", "ACCESS_TOKEN")
        self.client: Optional[Client] = None
        self.account_id: Optional[int] = None
        self.symbol_cache: dict[str, SymbolInfo] = {}
        self.host = self._resolve_host()

    def _resolve_host(self) -> str:
        host = self.env.get("ACCOUNT_HOST", "").strip()
        if host:
            return host
        return EndPoints.PROTOBUF_LIVE_HOST

    def _start_client(self) -> None:
        self.client = Client(self.host, EndPoints.PROTOBUF_PORT, TcpProtocol)
        self.client.startService()

    def _stop_client(self) -> defer.Deferred:
        if self.client is None:
            return defer.succeed(None)
        self.client.stopService()
        self.client = None
        waiter: defer.Deferred = defer.Deferred()
        reactor.callLater(0.2, waiter.callback, None)
        return waiter

    @defer.inlineCallbacks
    def restart_client(self):
        yield self._stop_client()
        self._start_client()

    def _send(self, message, timeout: int = 30):
        if self.client is None:
            raise ExportError("cTrader client is not connected")
        return self.client.send(message, responseTimeoutInSeconds=timeout)

    @defer.inlineCallbacks
    def _send_checked(self, message, timeout: int = 30, auth_retry: bool = True):
        raw = yield self._send(message, timeout=timeout)
        parsed = Protobuf.extract(raw)
        if isinstance(parsed, ProtoOAErrorRes):
            error_code = parsed.errorCode
            description = parsed.description or ""
            if auth_retry and error_code in {"CH_ACCESS_TOKEN_INVALID", "CH_ACCESS_DENIED"}:
                self.access_token, _ = refresh_access_token(self.env)
                self.env["CTRADER_ACCESS_TOKEN"] = self.access_token
                yield self.restart_client()
                yield self.authorize()
                raw = yield self._send(message, timeout=timeout)
                parsed = Protobuf.extract(raw)
                if isinstance(parsed, ProtoOAErrorRes):
                    raise ExportError(f"cTrader API error after token refresh: {parsed.errorCode} {parsed.description}")
                defer.returnValue(parsed)
                return
            raise ExportError(f"cTrader API error: {error_code} {description}".strip())
        defer.returnValue(parsed)

    @defer.inlineCallbacks
    def authorize(self):
        app = ProtoOAApplicationAuthReq()
        app.clientId = env_first(self.env, "CTRADER_CLIENT_ID", "CLIENT_ID")
        app.clientSecret = env_first(self.env, "CTRADER_CLIENT_SECRET", "CLIENT_SECRET")
        yield self._send_checked(app, timeout=15, auth_retry=False)

        acct_list_req = ProtoOAGetAccountListByAccessTokenReq()
        acct_list_req.accessToken = self.access_token
        acct_list = yield self._send_checked(acct_list_req, timeout=15)
        if not acct_list.ctidTraderAccount:
            raise ExportError("No trading accounts were returned for the current cTrader access token")

        direct_account_id = self.env.get("ACCOUNT_ID", "").strip()
        preferred_ids = [
            direct_account_id,
            self.env.get("DEV_CTID", ""),
            self.env.get("JB_CTID", ""),
            self.env.get("JJ_CTID", ""),
        ]
        accounts = list(acct_list.ctidTraderAccount)
        chosen = None
        for preferred in preferred_ids:
            if preferred:
                chosen = next((acct for acct in accounts if str(acct.ctidTraderAccountId) == preferred), None)
                if chosen is not None:
                    break
        if chosen is None:
            chosen = next((acct for acct in accounts if acct.isLive), accounts[0])
        self.account_id = int(chosen.ctidTraderAccountId)

        acct_auth = ProtoOAAccountAuthReq()
        acct_auth.ctidTraderAccountId = self.account_id
        acct_auth.accessToken = self.access_token
        yield self._send_checked(acct_auth, timeout=15)

    @defer.inlineCallbacks
    def symbols(self):
        if self.account_id is None:
            raise ExportError("Account is not authorized")
        req = ProtoOASymbolsListReq()
        req.ctidTraderAccountId = self.account_id
        response = yield self._send_checked(req, timeout=30)
        defer.returnValue(list(response.symbol))

    @defer.inlineCallbacks
    def resolve_symbols(self) -> dict[str, SymbolInfo]:
        if self.symbol_cache:
            defer.returnValue(self.symbol_cache)
            return
        direct_symbol_ids = {
            target: self.env.get(f"SYMBOL_{target}", "").strip()
            for target in SYMBOL_TARGETS
        }
        if all(direct_symbol_ids.values()):
            digits_by_id = yield self.fetch_symbol_digits({int(value) for value in direct_symbol_ids.values()})
            self.symbol_cache = {
                target: SymbolInfo(
                    target=target,
                    symbol_id=int(symbol_id),
                    symbol_name=target,
                    digits=digits_by_id[int(symbol_id)],
                )
                for target, symbol_id in direct_symbol_ids.items()
            }
            defer.returnValue(self.symbol_cache)
            return
        symbols = yield self.symbols()
        normalized_targets = {k: {normalize_symbol_name(v) for v in aliases} for k, aliases in SYMBOL_ALIASES.items()}
        resolved: dict[str, SymbolInfo] = {}
        for target in SYMBOL_TARGETS:
            candidates = []
            for symbol in symbols:
                raw_name = symbol.symbolName or ""
                raw_desc = symbol.description or ""
                normalized_name = normalize_symbol_name(raw_name)
                normalized_desc = normalize_symbol_name(raw_desc)
                score = None
                if normalized_name == normalize_symbol_name(target):
                    score = 100
                elif normalized_name in normalized_targets[target]:
                    score = 95
                elif any(alias in normalized_name for alias in normalized_targets[target]):
                    score = 80
                elif any(alias in normalized_desc for alias in normalized_targets[target]):
                    score = 60
                if score is None:
                    continue
                candidates.append((score, len(raw_name), symbol))
            if not candidates:
                raise ExportError(f"Could not find a broker symbol for {target}")
            candidates.sort(key=lambda item: (-item[0], item[1], item[2].symbolId))
            best = candidates[0][2]
            resolved[target] = SymbolInfo(
                target=target,
                symbol_id=int(best.symbolId),
                symbol_name=best.symbolName or target,
                digits=2 if target == "DE40" and not hasattr(best, "digits") else 5,
            )
        digits_by_id = yield self.fetch_symbol_digits({info.symbol_id for info in resolved.values()})
        self.symbol_cache = {
            target: SymbolInfo(
                target=info.target,
                symbol_id=info.symbol_id,
                symbol_name=info.symbol_name,
                digits=digits_by_id.get(info.symbol_id, info.digits),
            )
            for target, info in resolved.items()
        }
        defer.returnValue(self.symbol_cache)

    @defer.inlineCallbacks
    def fetch_symbol_digits(self, symbol_ids: set[int]) -> dict[int, int]:
        from ctrader_open_api.messages.OpenApiMessages_pb2 import ProtoOASymbolByIdReq

        digits: dict[int, int] = {}
        for symbol_id in symbol_ids:
            req = ProtoOASymbolByIdReq()
            req.ctidTraderAccountId = self.account_id
            req.symbolId.append(symbol_id)
            response = yield self._send_checked(req, timeout=15)
            for symbol in response.symbol:
                digits[int(symbol.symbolId)] = int(symbol.digits)
        defer.returnValue(digits)

    @defer.inlineCallbacks
    def fetch_candles(self, info: SymbolInfo) -> list[Candle]:
        if self.account_id is None:
            raise ExportError("Account is not authorized")
        req = ProtoOAGetTrendbarsReq()
        req.ctidTraderAccountId = self.account_id
        req.symbolId = info.symbol_id
        req.period = ProtoOATrendbarPeriod.Value("M1")
        req.fromTimestamp = int(self.start_dt.astimezone(UTC).timestamp() * 1000)
        req.toTimestamp = int(self.end_dt.astimezone(UTC).timestamp() * 1000) - 1
        response = yield self._send_checked(req, timeout=60)
        candles = decode_trendbars(
            response.trendbar,
            digits=info.digits,
            start_ts=int(self.start_dt.astimezone(UTC).timestamp()),
            end_ts=int(self.end_dt.astimezone(UTC).timestamp()),
        )
        defer.returnValue(candles)


@defer.inlineCallbacks
def run():
    env_lines, env = load_env(ENV_PATH)
    _ = env_lines
    start_dt, end_dt = previous_trading_week_window()
    print(f"Export window: {start_dt.strftime('%Y-%m-%d %H:%M:%S %Z')} -> {end_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}")

    start_ts = int(start_dt.astimezone(UTC).timestamp())
    end_ts = int(end_dt.astimezone(UTC).timestamp())

    sqlite_source = discover_sqlite_source(BASE_DIR)
    if sqlite_source is not None:
        sqlite_data = export_from_sqlite(sqlite_source, start_ts, end_ts)
        if sqlite_data:
            for target, filename in SYMBOL_TARGETS.items():
                candles = sqlite_data.get(target, [])
                output_path = BASE_DIR / filename
                existing = read_existing_csv(output_path)
                merged = merge_and_prune(existing, candles, MAX_HISTORY_WEEKS)
                write_csv(output_path, merged)
                print_summary(filename, merged)
            reactor.stop()
            return

    exporter = CTraderExporter(env, start_dt, end_dt)
    try:
        exporter._start_client()
        yield exporter.authorize()
        symbols = yield exporter.resolve_symbols()
        for target, filename in SYMBOL_TARGETS.items():
            info = symbols[target]
            candles = yield exporter.fetch_candles(info)
            output_path = BASE_DIR / filename
            existing = read_existing_csv(output_path)
            merged = merge_and_prune(existing, candles, MAX_HISTORY_WEEKS)
            write_csv(output_path, merged)
            print_summary(filename, merged)
    finally:
        yield exporter._stop_client()
        reactor.stop()


def main() -> int:
    exit_code = {"value": 0}

    def on_failure(failure):
        exit_code["value"] = 1
        message = failure.getErrorMessage() or str(failure.value)
        print(f"ERROR: {message}", file=sys.stderr)
        try:
            reactor.stop()
        except ReactorNotRunning:
            pass
        return None

    def start():
        deferred = defer.ensureDeferred(run())
        deferred.addErrback(on_failure)

    reactor.callWhenRunning(start)
    reactor.run()
    return exit_code["value"]


if __name__ == "__main__":
    raise SystemExit(main())
