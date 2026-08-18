'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = {
  console,
  Date,
  Intl,
  Map,
  Number,
  Array,
  Object,
  Math,
  INSTRUMENTS: { de40: { key: 'de40', csvFile: 'gametrader-de40.csv' } },
  fetch: async function(file) {
    return { ok: true, text: async function() { return fs.readFileSync(path.join(root, file), 'utf8'); } };
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/bots/bot-market-data.js'), 'utf8'), sandbox);

(async function() {
  const marketData = sandbox.BotLab.MarketData;
  await marketData.loadInstrument('de40');
  const dates = marketData.getAvailableDates('de40');
  assert(dates.length > 0, 'DE40 dates load from its own CSV');
  const days = marketData.buildDays({
    instrument: 'de40',
    dateFrom: dates[0],
    dateTo: dates[dates.length - 1],
    sessionStartMin: 8 * 60,
    sessionEndMin: 15 * 60 + 30,
    count: 1,
    seed: 42
  });
  assert.strictEqual(days.length, 1, 'date range can select one deterministic day');
  assert(days[0].bars.length > 0, 'selected day has playback bars');
  assert(days[0].warmupBars.length + days[0].bars.length >= 120, 'selected day has the canonical absolute-index guard coverage');
  assert(days[0].chartHistory.length >= days[0].warmupBars.length, 'selected day retains chart context separately from strategy warmup');
  assert(days[0].bars.every(function(bar) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(bar[0] * 1000));
    const hour = Number(parts.find(function(part) { return part.type === 'hour'; }).value);
    const minute = Number(parts.find(function(part) { return part.type === 'minute'; }).value);
    const value = hour * 60 + minute;
    return value >= 480 && value < 930;
  }), 'all playback bars are inside the selected UK time window');

  const apiCalls = [];
  const apiStart = Date.parse('2026-07-23T23:00:00Z') / 1000;
  const apiSandbox = {
    console, Date, Intl, Map, Number, Array, Object, Math,
    location: { hostname: '192.168.0.164' },
    INSTRUMENTS: sandbox.INSTRUMENTS,
    fetch: async function(url) {
      apiCalls.push(url);
      if (url.includes('action=meta')) {
        return { ok: true, json: async function() { return { firstDate: '2025-01-02', lastDate: '2026-07-24' }; } };
      }
       const bars = [];
       for (let index = 0; index < 600; index++) bars.push([apiStart + index * 60, 100, 101, 99, 100.5, 1]);
       bars.push([apiStart + 480 * 60, 101, 102, 100, 101.5, 1]);
      return { ok: true, json: async function() { return { bars: bars, warmupCount: 120, rangeCount: 480 }; } };
    }
  };
  apiSandbox.window = apiSandbox;
  vm.createContext(apiSandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/bots/bot-market-data.js'), 'utf8'), apiSandbox);
  await apiSandbox.BotLab.MarketData.loadInstrument('de40');
  assert.strictEqual(apiSandbox.BotLab.MarketData.getSource('de40'), 'sqlite', 'SQLite is preferred when same-origin API metadata is available');
  assert.strictEqual(apiSandbox.BotLab.MarketData.getAvailableDates('de40').at(-1), '2026-07-24', 'date picker uses complete SQLite coverage');
   await apiSandbox.BotLab.MarketData.loadRange('de40', '2026-07-24', '2026-07-24');
   assert(apiCalls.every(function(url) { return url.startsWith('/gametrader-api/v1/candles'); }), 'browser requests use the same-origin candle API proxy');
   const sqliteDay = apiSandbox.BotLab.MarketData.buildDays({ instrument: 'de40', dateFrom: '2026-07-24', dateTo: '2026-07-24', sessionStartMin: 8 * 60, sessionEndMin: 9 * 60, count: 'all' })[0];
    assert.strictEqual(sqliteDay.warmupBars[0][0], apiStart + 60 * 60, 'strategy warmup begins at selected-date midnight UTC, not the London date boundary');
   assert.strictEqual(sqliteDay.bars.find(function(item) { return item[0] === apiStart + 480 * 60; })[4], 101.5, 'duplicate SQLite timestamps retain the last row');
  console.log('bot market data tests passed');
})().catch(function(error) {
  console.error(error);
  process.exitCode = 1;
});
