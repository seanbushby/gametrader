'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = {
  console, Date, Intl, Map, Set, Promise, Math, Number, String, Array, Object, JSON,
  INSTRUMENTS: { de40: { key: 'de40', csvFile: 'gametrader-de40.csv' } },
  fetch: async function(file) {
    return { ok: true, text: async function() { return fs.readFileSync(path.join(root, file), 'utf8'); } };
  }
};
sandbox.window = sandbox;
sandbox.BotLab = {};
vm.createContext(sandbox);

function load(file) {
  const source = path.join(root, file);
  vm.runInContext(fs.readFileSync(source, 'utf8'), sandbox, { filename: source });
}

[
  'js/bots/bot-contract.js', 'js/bots/bot-test-engine.js', 'js/bots/intervention-tracker.js',
  'js/bots/autonomous-runner.js', 'js/bots/managed-runner.js', 'js/bots/bot-session-controller.js',
  'js/bots/bokke-one-pack.js', 'js/bots/bot-market-data.js'
].forEach(load);

(async function() {
  const BotLab = sandbox.BotLab;
  await BotLab.MarketData.loadInstrument('de40');
  const dates = BotLab.MarketData.getAvailableDates('de40');
  const days = BotLab.MarketData.buildDays({
    instrument: 'de40', dateFrom: dates[0], dateTo: dates[dates.length - 1],
    sessionStartMin: 480, sessionEndMin: 930, count: 'all', seed: 1
  });
  assert(days.length > 0, 'historical DE40 replay days exist');

  let processedBars = 0;
  let totalTrades = 0;
  for (let index = 0; index < days.length; index++) {
    const autoEngine = BotLab.ExecutionEngine.create({ startBalance: 500, spread: 0.5, ptValue: 1.14225, minSize: 1, maxSize: 250 });
    const managedEngine = BotLab.ExecutionEngine.create({ startBalance: 500, spread: 0.5, ptValue: 1.14225, minSize: 1, maxSize: 250 });
    const definition = BotLab.BokkeOnePack.create();
    const tracker = BotLab.InterventionTracker.create();
    const auto = BotLab.AutonomousRunner.create(definition.createInstance({ size: 1 }), autoEngine, {});
    const managed = BotLab.ManagedRunner.create(definition.createInstance({ size: 1 }), managedEngine, {}, tracker);
    const controller = BotLab.SessionController.create({ instrument: 'de40', sessionStartMin: 480, sessionEndMin: 930, cruiseSpeed: 50 }, auto, managed, tracker);
    await controller.startDay(days[index], index);
    while (!controller.getProgress().dayComplete) {
      const result = await controller.processBar();
      if (result && result.type === 'bar') processedBars++;
      if (!result && !controller.getProgress().dayComplete) throw new Error('replay stalled');
    }
    assert.strictEqual(autoEngine.getAllTrades().length, managedEngine.getAllTrades().length, 'unmanaged branches remain deterministic on ' + days[index].key);
    totalTrades += autoEngine.getAllTrades().length;
  }
  assert(processedBars > 0, 'historical candles reached the bot and execution engine');
  assert(totalTrades > 0, 'dynamic Bokke sizing produces historical trades');
  console.log('bokke historical smoke passed:', days.length, 'days,', processedBars, 'bars,', totalTrades, 'trades');
})().catch(function(error) {
  console.error(error);
  process.exitCode = 1;
});
