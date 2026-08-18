#!/usr/bin/env python3
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone

from api.candle_api import RequestError, candle_range, dispatch, metadata


class CandleApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.NamedTemporaryFile(suffix=".db")
        connection = sqlite3.connect(self.temp.name)
        connection.execute("CREATE TABLE candles_DE40 (t INTEGER PRIMARY KEY,o REAL,h REAL,l REAL,c REAL,v INTEGER)")
        start = int(datetime(2026, 1, 14, 7, 58, tzinfo=timezone.utc).timestamp())
        rows = [(start + index * 60, 100 + index, 102 + index, 99 + index, 101 + index, index + 1) for index in range(10)]
        connection.executemany("INSERT INTO candles_DE40 VALUES (?,?,?,?,?,?)", rows)
        connection.commit()
        connection.close()

    def tearDown(self):
        self.temp.close()

    def test_metadata(self):
        result = metadata("DE40", self.temp.name)
        self.assertEqual(result["count"], 10)
        self.assertEqual(result["source"], "sqlite")

    def test_range_and_warmup(self):
        result = candle_range("DE40", "2026-01-14", "2026-01-14", self.temp.name)
        self.assertEqual(result["rangeCount"], 10)
        self.assertEqual(len(result["bars"]), 10)

    def test_allowlist_and_range_limit(self):
        with self.assertRaises(RequestError):
            dispatch({"action": ["meta"], "symbol": ["../../secret"]}, self.temp.name)
        with self.assertRaises(RequestError):
            candle_range("DE40", "2025-01-01", "2026-01-01", self.temp.name)


if __name__ == "__main__":
    unittest.main()
