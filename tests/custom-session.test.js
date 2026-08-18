'use strict';
// Custom session (time range + N days) tests for gametrader.html.
// Verifies level slicing, range enforcement, day-count capping, and the
// day-transition bookkeeping (countdown + account carry-over + finish).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'gametrader.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function grabFn(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  const open = html.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(i, j + 1);
}
function grabConstLine(name) {
  const i = html.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('missing const ' + name);
  return html.slice(i, html.indexOf('\n', i));
}

const ctx = {};
ctx.fmtKey = eval('(' + grabConstLine('fmtKey').replace('const fmtKey = ', '').replace(/;$/, '') + ')');
ctx.fmtDay = eval('(' + grabConstLine('fmtDay').replace('const fmtDay = ', '').replace(/;$/, '') + ')');
ctx.fmtDate = eval('(' + grabConstLine('fmtDate').replace('const fmtDate = ', '').replace(/;$/, '') + ')');
ctx.ukHM = new Function('fmtHMparts', 'return ' + grabFn('ukHM').replace('function ukHM', 'function')).call(null, eval('(' + grabConstLine('fmtHMparts').replace('const fmtHMparts = ', '').replace(/;$/, '') + ')'));
ctx.ukHour = new Function('ukHM', 'return ' + grabFn('ukHour').replace('function ukHour', 'function')).call(null, ctx.ukHM);
ctx.ukMinOfDay = new Function('ukHM', 'return ' + grabFn('ukMinOfDay').replace('function ukMinOfDay', 'function')).call(null, ctx.ukHM);
const buildCustomLevelsFn = new Function('POOL','fmtKey','fmtDay','fmtDate','ukMinOfDay','CFG','hmLabel','return (' + grabFn('buildCustomLevels') + ');');
ctx.buildCustomLevels = function(fromMin, toMin, days, pool){ return buildCustomLevelsFn(pool, ctx.fmtKey, ctx.fmtDay, ctx.fmtDate, ctx.ukMinOfDay, {decimals:2}, ctx.hmLabel)(fromMin, toMin, days); };
ctx.hmLabel = new Function('return (' + grabFn('hmLabel') + ');')();

// Synthetic pool: 3 consecutive UK days, 08:00-21:00 each, 1m bars
const DAY0 = Date.UTC(2026, 6, 6, 7, 0, 0) / 1000; // 08:00 BST
const POOL = [];
for(let d = 0; d < 3; d++){
  const start = DAY0 + d * 86400;
  for(let m = 0; m < 13 * 60; m++){
    const ts = start + m * 60;
    const o = 25800 + d * 10 + Math.sin(m / 7) * 5;
    POOL.push([ts, o, o + 3, o - 3, o + 1, 100]);
  }
}

// Test 1: 08:00-11:00, 5 days -> capped at 3 available
const levels = ctx.buildCustomLevels(8*60, 11*60, 5, POOL, ctx.fmtKey, ctx.fmtDay, ctx.fmtDate, ctx.ukMinOfDay, {decimals:2});
assert.ok(Array.isArray(levels) && levels.length === 3, '3 days available, capped to 5 -> 3, got ' + levels.length);
for(const lv of levels){
  assert.ok(lv.bars.length === 180, '3h window = 180 bars, got ' + lv.bars.length);
  for(const b of lv.bars){
    const m = ctx.ukMinOfDay(b[0]);
    assert.ok(m >= 8*60 && m < 11*60, 'bar minute ' + m + ' outside 08:00-11:00');
  }
}

// Test 2: 14:30-21:00, 2 days
const ny = ctx.buildCustomLevels(14*60+30, 21*60, 2, POOL, ctx.fmtKey, ctx.fmtDay, ctx.fmtDate, ctx.ukMinOfDay, {decimals:2});
assert.ok(ny.length === 2, '2 days requested -> 2, got ' + ny.length);
for(const lv of ny){
  assert.ok(lv.bars.length === 390, '6.5h window = 390 bars, got ' + lv.bars.length);
}

// Test 3: full-day 00:00-23:59, 1 day
const full = ctx.buildCustomLevels(0, 24*60, 1, POOL, ctx.fmtKey, ctx.fmtDay, ctx.fmtDate, ctx.ukMinOfDay, {decimals:2});
assert.ok(full.length === 1, '1 day requested');
assert.ok(full[0].bars.length === 13*60, '13h of data = 780 bars');

// Test 4: hmLabel
assert.strictEqual(ctx.hmLabel(8*60), '08:00');
assert.strictEqual(ctx.hmLabel(14*60+30), '14:30');

// Test 5: day-transition bookkeeping (mirrors Game.nextCustomDay/showDayCountdown)
const game = { customRun:{levels, ix:0}, lvIndex:-1, _started:0, _countdowns:0 };
game.startCustom = function(levels){ this.customRun={levels, ix:0}; this.lvIndex=-1; this.beginDay(levels[0], false); };
game.beginDay = function(lv, keepAccount){ this.lv=lv; this._started++; this._keep = keepAccount; };
game.nextCustomDay = function(){
  const run=this.customRun; if(!run) return;
  run.ix++;
  if(run.ix>=run.levels.length){ this.customRun=null; this._finished=true; return; }
  const lv=run.levels[run.ix];
  this._countdowns++;
  this.showDayCountdown(lv, ()=>{ this.beginDay(lv, true); });
};
game.showDayCountdown = function(lv, cb){ this._cb=cb; };
game.startCustom(levels);
assert.strictEqual(game._started, 1);
assert.strictEqual(game._keep, false, 'day 1 fresh account');
for(let i=0;i<3;i++){
  game.nextCustomDay();
  if(game.customRun){
    assert.ok(game._countdowns === i+1, 'countdown shown on transition ' + (i+1));
    game._cb();
    assert.strictEqual(game._keep, true, 'account kept on day change');
  }
}
assert.strictEqual(game.customRun, null, 'run finished after last day');
assert.strictEqual(game._finished, true);

console.log('custom session tests passed');
