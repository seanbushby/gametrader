'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console, Date, Intl, Map, Set, Promise, Math, Number, String, Array, Object, JSON };
sandbox.window = sandbox;
sandbox.BotLab = {};
vm.createContext(sandbox);

function load(relativePath) {
  const file = path.join(__dirname, '..', relativePath);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

[
  'js/bots/bot-contract.js',
  'js/bots/bot-test-engine.js',
  'js/bots/intervention-tracker.js',
  'js/bots/autonomous-runner.js',
  'js/bots/managed-runner.js',
  'js/bots/bot-session-controller.js',
  'js/bots/bot-comparison-metrics.js'
].forEach(load);

function ts(hour, minute) {
  return Date.parse('2026-01-15T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00Z') / 1000;
}

function returnedCommandBot() {
  let closed = 0;
  return {
    onStart() {},
    onBar() {
      return { type: 'OPEN_POSITION', direction: 'long', size: 1, stopLossPoints: 5, takeProfitPoints: 10 };
    },
    onTick() {},
    onPositionClosed() { closed++; },
    onSessionEnd() {},
    closedCount() { return closed; }
  };
}

(async function run() {
  const BotLab = sandbox.BotLab;

  const engine = BotLab.ExecutionEngine.create({ startBalance: 10000, spread: 2, commission: 0, minSize: 1, maxSize: 5 });
  const bot = returnedCommandBot();
  const runner = BotLab.AutonomousRunner.create(bot, engine, {});
  const context = { price: 100, timestamp: ts(8, 0) * 1000, barIndex: 0, warmupBars: [] };
  await runner.start(context);
  await runner.processBar([ts(8, 0), 100, 101, 99, 100, 1], context);
  const position = runner.getPositions()[0];
  assert(position, 'returned command opens a position');
  assert.strictEqual(position.entryPrice, 101, 'long entry pays half spread');
  assert.strictEqual(position.stopLoss, 96, 'point stop is based on actual fill');
  assert.strictEqual(position.takeProfit, 111, 'point target is based on actual fill');

  const closures = engine.checkStops(95, 100, 95, ts(8, 1) * 1000);
  await runner.applyExecutionClosures(closures);
  assert.strictEqual(runner.getPositions().filter(p => !p.closed).length, 0, 'engine stop synchronizes runner state');
  assert.strictEqual(bot.closedCount(), 1, 'engine stop invokes bot close callback');
  assert.strictEqual(runner.getClosedPositions()[0].exitPrice, 95, 'long stop pays exit half spread');

  const rawEngine = BotLab.ExecutionEngine.create({ startBalance: 10000, spread: 2, commission: 0, minSize: 1, maxSize: 5 });
  const rawFill = rawEngine.openPosition({ positionId: 'raw-1', direction: 'long', size: 1, price: 100, rawFill: true, timestamp: ts(8, 0) * 1000 });
  assert.strictEqual(rawFill.price, 100, 'opt-in raw execution bypasses spread for the autonomous baseline');
   assert.strictEqual(rawEngine.closePosition('raw-1', 110, ts(8, 1) * 1000, 'strategy', true).record.exitPrice, 110, 'opt-in raw exit preserves an exact strategy level');

   const ustecEngine = BotLab.ExecutionEngine.create({ startBalance: 10000, ptValue: 1, spread: 1, commission: 0, minSize: 1, maxSize: 50 });
   const ustecFill = ustecEngine.openPosition({ positionId: 'ustec-1', direction: 'long', size: 1, price: 20000, timestamp: ts(8, 0) * 1000 });
   assert.strictEqual(ustecFill.price, 20000.5, 'USTEC uses its one-point spread on entry');
   assert.strictEqual(ustecEngine.closePosition('ustec-1', 20055, ts(8, 1) * 1000, 'strategy').record.exitPrice, 20054.5, 'USTEC uses its one-point spread on exit');

  const strategyTargetBot = {
    onStart() {},
    onBar() { return { type: 'OPEN_POSITION', direction: 'long', size: 1, takeProfitPoints: 10, strategyManagedTakeProfit: true, rawFill: true }; },
    onTick() {}, onSessionEnd() {}
  };
  const strategyEngine = BotLab.ExecutionEngine.create({ startBalance: 10000, spread: 2, commission: 0, minSize: 1, maxSize: 5 });
  const strategyRunner = BotLab.AutonomousRunner.create(strategyTargetBot, strategyEngine, {});
  await strategyRunner.start(context);
  await strategyRunner.processBar([ts(8, 0), 100, 101, 99, 100, 1], context);
  assert.strictEqual(strategyRunner.getPositions()[0].takeProfit, 110, 'strategy-managed target remains available for display');
  assert.strictEqual(strategyEngine.checkTPs(100, 120, 99, ts(8, 1) * 1000).length, 0, 'generic engine TP checks cannot preempt a strategy-managed target');

  const managedRawEngine = BotLab.ExecutionEngine.create({ startBalance: 10000, spread: 2, commission: 0, minSize: 1, maxSize: 5 });
  const managedRawRunner = BotLab.ManagedRunner.create(strategyTargetBot, managedRawEngine, {}, null);
  await managedRawRunner.start(context);
  await managedRawRunner.processBar([ts(8, 0), 100, 101, 99, 100, 1], context);
  assert.strictEqual(managedRawRunner.getPositions()[0].entryPrice, 100, 'managed baseline honors a strategy raw fill before human intervention');

  const marginEngine = BotLab.ExecutionEngine.create({ startBalance: 500, minSize: 1, maxSize: 5, contractSize: 1, quoteToAccountRate: 1.1303, marginRate: 0.005 });
  assert(Math.abs(marginEngine.marginFor(1, 25066.6) - 141.67) < 0.02, 'DE40 one-lot margin matches the broker ticket calibration');
  assert(marginEngine.openPosition({ direction: 'long', size: 3, price: 25066.6, timestamp: ts(8, 0) * 1000 }), 'three lots fit within a $500 account at broker-style margin');
  assert.strictEqual(marginEngine.openPosition({ direction: 'long', size: 1, price: 25066.6, timestamp: ts(8, 1) * 1000 }), null, 'entry is rejected when required margin exceeds free margin');

  const tracker = BotLab.InterventionTracker.create();
  const managedEngine = BotLab.ExecutionEngine.create({ startBalance: 10000, spread: 0, minSize: 1, maxSize: 5 });
  const managed = BotLab.ManagedRunner.create(returnedCommandBot(), managedEngine, {}, tracker);
  await managed.start(context);
  await managed.processBar([ts(8, 0), 100, 101, 99, 100, 1], context);
  const managedPosition = managed.getPositions()[0];
  assert.strictEqual(await managed.humanAddStop(managedPosition.id, 99, 100, ts(8, 1) * 1000, 't', '2026-01-15'), true, 'valid long stop is accepted');
  assert.strictEqual(await managed.humanAddStop(managedPosition.id, 98, 100, ts(8, 2) * 1000, 't', '2026-01-15'), false, 'human stop cannot be widened');
  assert.strictEqual(await managed.humanModifyTP(managedPosition.id, 112, 100, ts(8, 2) * 1000, 't', '2026-01-15'), true, 'managed take profit can be edited');
  assert.strictEqual(managedPosition.takeProfit, 112, 'edited take profit updates the managed order');
  managed.updateExcursions(108, 97);
  assert.strictEqual(managedPosition.maxDrawdownPoints, 3, 'managed position records its worst adverse move in points');
  assert.strictEqual(managedPosition.maxFavorablePoints, 8, 'managed position records its best favorable move in points');
  assert.strictEqual(await managed.humanClosePosition(managedPosition.id, 105, ts(8, 3) * 1000, 't', '2026-01-15'), true, 'manual close uses replay market price');
  assert.strictEqual(managed.getClosedPositions()[0].exitPrice, 105, 'manual close records replay fill');
  assert.strictEqual(tracker.getLog().length, 3, 'stop, target, and close interventions are logged');

  const noCommandBot = { onStart() {}, onBar() {}, onTick() {}, onSessionEnd() {} };
  function branch() {
    const branchEngine = BotLab.ExecutionEngine.create({ startBalance: 10000 });
    return BotLab.AutonomousRunner.create(noCommandBot, branchEngine, {});
  }
  const auto = branch();
  const man = branch();
  const controller = BotLab.SessionController.create({ sessionStartMin: 480, sessionEndMin: 660, cruiseSpeed: 50 }, auto, man, tracker);
  assert.strictEqual(controller.isInSession(ts(8, 0) * 1000), true, 'UK session includes exact start');
  assert.strictEqual(controller.isInSession(ts(11, 0) * 1000), false, 'UK session excludes exact end');

  const slowAutoEngine = BotLab.ExecutionEngine.create({ startBalance: 10000, minSize: 1, maxSize: 5 });
  const slowManagedEngine = BotLab.ExecutionEngine.create({ startBalance: 10000, minSize: 1, maxSize: 5 });
  const slowAuto = BotLab.AutonomousRunner.create(returnedCommandBot(), slowAutoEngine, {});
  const slowManaged = BotLab.ManagedRunner.create(returnedCommandBot(), slowManagedEngine, {}, tracker);
  const slowController = BotLab.SessionController.create({ sessionStartMin: 480, sessionEndMin: 660, cruiseSpeed: 50 }, slowAuto, slowManaged, tracker);
  await slowController.startDay({ bars: [[ts(8, 0), 100, 101, 99, 100, 1]], warmupBars: [], key: '2026-01-15' }, 0);
  await slowController.processBar();
  assert.strictEqual(slowController.getSpeedState().currentSpeed, 1, 'managed trade entry slows replay to 1x');

  const dayOne = {
    autonomousMetrics: BotLab.ComparisonMetrics.computeDailyMetrics({ openingBalance: 10000, balance: 10100, trades: [{ pl: 100 }], equityCurve: [10000, 10100] }),
    managedMetrics: BotLab.ComparisonMetrics.computeDailyMetrics({ openingBalance: 10000, balance: 10050, trades: [{ pl: 50 }], equityCurve: [10000, 10050] })
  };
  const dayTwo = {
    autonomousMetrics: BotLab.ComparisonMetrics.computeDailyMetrics({ openingBalance: 10100, balance: 10120, trades: [{ pl: 20 }], equityCurve: [10100, 10120] }),
    managedMetrics: BotLab.ComparisonMetrics.computeDailyMetrics({ openingBalance: 10050, balance: 10130, trades: [{ pl: 80 }], equityCurve: [10050, 10130] })
  };
  const comparison = BotLab.ComparisonMetrics.computeTestComparison([dayOne, dayTwo], 10000);
  assert.strictEqual(comparison.autonomous.totalTrades, 2, 'multi-day aggregation counts each trade once');
  assert.strictEqual(comparison.autonomous.netPL, 120, 'autonomous multi-day P/L is correct');
  assert.strictEqual(comparison.managed.netPL, 130, 'managed multi-day P/L is correct');
  assert.strictEqual(comparison.managementImpact, 10, 'management impact is correct');

  load('js/bots/bot-report.js');
  const ledger = BotLab.Report.renderTradeLedgerHTML([{
    dayId: '2026-01-15', dir: 1, size: 3, entryTimestamp: ts(8, 30) * 1000,
    entryPrice: 100, exitTimestamp: ts(9, 15) * 1000, exitPrice: 110, pnl: 30, reason: 'target'
  }], 'Managed', '$');
  assert(ledger.includes('3') && ledger.includes('08:30') && ledger.includes('09:15') && ledger.includes('110.00'), 'trade ledger includes lots, UK times, and execution prices');
  assert(BotLab.Report.renderTradeLedgerHTML([{ entryTimestamp: ts(8, 30) * 1000, exitTimestamp: ts(9, 15) * 1000, pnl: 25 }], 'Final', '$', null, 500).includes('$525.00'), 'final trade ledger includes the running balance');
  assert(BotLab.Report.renderTradeLedgerHTML([], 'Bot', '$', 'Balance below minimum').includes('Balance below minimum'), 'empty trade ledger explains why no trades occurred');

  sandbox.window.addEventListener = function() {};
  sandbox.window.removeEventListener = function() {};
  load('js/ui/bot-chart.js');
  assert.strictEqual(BotLab.Chart._test.isScalePrice(null), false, 'missing stop does not inject zero into chart scale');
  assert.strictEqual(BotLab.Chart._test.isScalePrice(0), false, 'zero is rejected from chart scale');
  assert.strictEqual(BotLab.Chart._test.isScalePrice(25000), true, 'valid market price is included in chart scale');
  assert.strictEqual(BotLab.Chart._test.isDisplayBar([0, 25000, 25000, 25000, 25000, 2]), false, 'quote-heartbeat rows are excluded from chart candles');
  assert.strictEqual(BotLab.Chart._test.isDisplayBar([0, 25000, 25004, 24998, 25002, 20]), true, 'market candles remain visible on the chart');
  const intradayHistory = BotLab.Chart._test.visibleHistory([
    [Date.parse('2026-07-23T20:00:00Z') / 1000, 25000, 25004, 24998, 25002, 20],
    [Date.parse('2026-07-24T07:00:00Z') / 1000, 24990, 24994, 24988, 24992, 20]
  ], { currentTimestamp: Date.parse('2026-07-24T08:30:00Z') });
  assert.strictEqual(intradayHistory.length, 1, 'intraday chart history excludes the prior London day');
  assert.strictEqual(intradayHistory[0][0], Date.parse('2026-07-24T07:00:00Z') / 1000, 'intraday chart history retains the selected-day pre-open candle');
  const continuousHistory = BotLab.Chart._test.continuousTail([
    [ts(7, 0), 25000, 25004, 24998, 25002, 20],
    [ts(7, 1), 25002, 25006, 25000, 25004, 20],
    [ts(7, 20), 24930, 24934, 24927, 24929, 20],
    [ts(7, 21), 24929, 24933, 24920, 24922, 20]
  ]);
  assert.strictEqual(continuousHistory.length, 2, 'intraday chart discards history before a missing-candle gap');
  assert.strictEqual(continuousHistory[0][0], ts(7, 20), 'intraday chart begins at the latest continuous candle sequence');
  assert.strictEqual(BotLab.Chart._test.orderCardTop(200, 500, 28), 186, 'order strip centers on the entry-price line');
  assert.strictEqual(BotLab.Chart._test.orderCardTop(5, 500, 28), 2, 'order strip stays inside the top chart edge');
  assert.strictEqual(BotLab.Chart._test.orderCardTop(495, 500, 28), 470, 'order strip stays inside the bottom chart edge');
  const aggregated = BotLab.Chart._test.aggregateBars([
    [0, 100, 103, 99, 102, 5],
    [60, 102, 105, 101, 104, 6],
    [120, 104, 106, 98, 101, 7],
    [180, 101, 102, 97, 99, 8],
    [240, 99, 104, 96, 103, 9]
  ], 5);
  assert.strictEqual(aggregated.length, 1, 'timeframe aggregation combines one five-minute bucket');
  assert.deepStrictEqual(Array.from(aggregated[0]), [0, 100, 106, 96, 103, 35], 'aggregated candle preserves OHLCV semantics');
  const mappedY = BotLab.Chart._test.priceToY(25050, 25000, 25100, 500);
  assert.strictEqual(BotLab.Chart._test.yToPrice(mappedY, 25000, 25100, 500), 25050, 'chart price and Y mapping round-trip');
  const levels = BotLab.Chart._test.referenceLevels([
    [ts(1, 0), 100, 105, 99, 102, 1], [ts(7, 59), 102, 108, 101, 103, 1], [ts(8, 0), 104, 106, 103, 105, 1]
  ], ts(8, 0) * 1000);
  assert.strictEqual(levels.open, 104, 'reference levels use the UK 08:00 session open');
  assert.strictEqual(levels.asiaHigh, 108, 'reference levels include the 01:00-08:00 Asia high');
  assert.strictEqual(levels.asiaLow, 99, 'reference levels include the 01:00-08:00 Asia low');

  console.log('bot lab core tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
