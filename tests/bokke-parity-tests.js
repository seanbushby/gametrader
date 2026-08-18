'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'js', 'bots', 'bokke-one-pack.js');
const sandbox = { console, Date, Intl, Number, Array, Object, Math, String };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: sourcePath });

const Bokke = sandbox.BotLab.BokkeOnePack;
const helpers = Bokke._test;

function timestamp(hour, minute) {
  return Date.parse('2026-07-24T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00Z') / 1000;
}

function bar(hour, minute, close, high, low) {
  return [timestamp(hour, minute), close, high == null ? close : high, low == null ? close : low, close, 1];
}

function midnightWarmup() {
  const bars = [];
  for (let minute = 0; minute < 8 * 60; minute++) bars.push(bar(Math.floor(minute / 60), minute % 60, 25000));
  return bars;
}

(function testCanonicalDefaultsAndWarmupGuard() {
  const definition = Bokke.create();
  assert.strictEqual(definition.version, '1.4.0', 'Bokke replay definition identifies the canonical port');
  assert.strictEqual(definition.settingsSchema.hard_sl_pts.default, 14, 'Bokke defaults to the best-week backtest hard stop');
  const instance = definition.createInstance({ gate_on: false });
  instance.onStart({ warmupBars: midnightWarmup() });
  instance.onPositionOpened({ id: 'long-1', direction: 'long', entryPrice: 25000 }, {});
  assert.strictEqual(instance.onBar(bar(11, 0, 24980, 25001, 24970), {}), null, 'the default no-hard-stop setting cannot close at 11:00');
})();

(function testUstecProfileAndExecution() {
  const definition = Bokke.create();
  const ustec = Bokke.settingsForInstrument({}, 'ustec');
  assert(definition.instruments.includes('ustec'), 'Bokke supports USTEC');
  assert.deepStrictEqual(Object.assign({}, ustec), {
    tp_pts: 55, tight_sl_trig: 25, band_pts: 10, hard_sl_pts: 5,
    hard_sl_time: '12:00', entry_start: '08:15', entry_cutoff: '11:00',
    stop_time: '13:00', gate_on: false, sizing_mode: 'live', max_lot_cap: 50,
    rawFill: false
  }, 'USTEC uses its validated strategy and live-sizing defaults');
  assert.strictEqual(Bokke.executionForInstrument('ustec').rawFill, false, 'USTEC commands retain normal spread-aware fills');
  assert.deepStrictEqual(Object.assign({}, Bokke.executionForInstrument('ustec').engine), {}, 'USTEC retains instrument execution settings');
  assert.deepStrictEqual(Object.assign({}, Bokke.executionForInstrument('de40').engine), { ptValue: 1, spread: 0, commission: 0 }, 'DE40 retains raw backtest execution');
})();

(function testCanonicalExitLevelsAndOrder() {
  const instance = Bokke.create().createInstance({ gate_on: false });
  instance.onStart({ warmupBars: midnightWarmup() });
  instance.onPositionOpened({ id: 'short-1', direction: 'short', entryPrice: 24894.6 }, {});
  assert.strictEqual(instance.onBar(bar(8, 52, 24879.6, 24880, 24879), {}), null, 'profit first places the tight stop');
  const tight = instance.onBar(bar(8, 53, 24895, 24895.7, 24894.9), {});
  assert.strictEqual(tight.reason, 'tight_sl', 'tight stop wins its canonical position-management slot');
  assert.strictEqual(tight.closePrice, 24895.6, 'tight stop closes at its exact one-point level');

  const target = Bokke.create().createInstance({ gate_on: false });
  target.onStart({ warmupBars: midnightWarmup() });
  target.onPositionOpened({ id: 'long-1', direction: 'long', entryPrice: 24897.9 }, {});
  const tp = target.onBar(bar(9, 31, 24950, 24953, 24949), {});
  assert.strictEqual(tp.reason, 'tp_hit', 'TP is managed by the strategy, not an engine target');
  assert.strictEqual(tp.closePrice, 24952.9, 'TP closes at its exact canonical level');
})();

(function testIncrementalGate() {
  const gate = { closesCount: 0, ema3: null, ema8: null, previousSpread: 0, previousBucket: null, bucketBars: [], crossedUp: false, crossedDown: false };
  helpers.stepGate(bar(8, 0, 100), gate);
  helpers.stepGate(bar(8, 10, 99), gate);
  helpers.stepGate(bar(8, 20, 102), gate);
  helpers.stepGate(bar(8, 30, 102), gate);
  assert.strictEqual(gate.closesCount, 3, 'gate consumes each completed ten-minute bucket once');
  assert.strictEqual(gate.crossedUp, true, 'gate records the incremental crossover on the current bar');
})();

(function testDynamicSizing() {
  assert.strictEqual(helpers.computePositionSize(200, 'demo', 250), 1, '$200 demo balance uses 1 whole lot');
  assert.strictEqual(helpers.computePositionSize(500, 'live', 250), 3.3, '$500 live balance uses 3.3 lots');
})();

console.log('bokke parity tests passed');
