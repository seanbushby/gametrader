'use strict';
// Focused test for the Bokke Gold PO3 Gann VWAP engine inside gametrader.html.
// Extracts the exact bokkeCompute method from the live source and drives it with
// synthetic London 1-minute bars, mirroring the Pine reference behavior.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'gametrader.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function grabConst(name) {
  const i = html.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('missing const ' + name);
  return html.slice(i, html.indexOf('\n', i));
}
function grabFn(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  const open = html.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(i, j + 1);
}

const ctx = {};
ctx.fmtKey = eval('(' + grabConst('fmtKey').replace('const fmtKey = ', '').replace(';', '') + ')');
ctx.fmtHMparts = eval('(' + grabConst('fmtHMparts').replace('const fmtHMparts = ', '').replace(';', '') + ')');
ctx.ukHM = new Function('fmtHMparts', 'return ' + grabFn('ukHM').replace('function ukHM', 'function')).call(null, ctx.fmtHMparts);
ctx.ukHour = new Function('ukHM', 'return ' + grabFn('ukHour').replace('function ukHour', 'function')).call(null, ctx.ukHM);

const Settings = { vals: { bokkeGold:true,bokkeGoldLong:true,bokkeGoldShort:true,bokkeGoldGannFan:true,bokkeGoldPO3:true,bokkeGoldVWAP:true,bokkeGoldSignals:true,bokkeGoldGannPivot:true,bokkeGoldShowLabels:true,bokkeGoldSlope:0.1,bokkeGoldMinPO3:9,bokkeGoldFanSel:'1x2+1x1',bokkeGoldInteraction:'Close Or Wick',bokkeGoldConfirmBars:3,bokkeGoldNoSignal:true,bokkeGoldPivotArm:40,bokkeGoldWpFast:3,bokkeGoldWpSlow:8,bokkeGoldRequireVwap:false,bokkeGoldOnePerDay:false,bokkeGoldIgnoreFirst:5,bokkeGoldPivotU1x2:true,bokkeGoldPivotU1x1:true,bokkeGoldPivotU2x1:true,bokkeGoldPivotL1x2:true,bokkeGoldPivotL1x1:true,bokkeGoldPivotL2x1:true,bokkeGoldPivotLeft:3,bokkeGoldPivotRight:2,bokkeGoldPivotNeedPO3:true } };

const methodStart = html.indexOf('bokkeCompute(bar){');
const methodEnd = html.indexOf('  liveDisplayBar(){', methodStart);
const methodSrc = html.slice(methodStart, methodEnd).trim();
const compute = new Function('fmtKey', 'fmtHMparts', 'ukHM', 'ukHour', 'Settings', 'return ' + methodSrc.replace(/,$/, '').replace(/^bokkeCompute\(bar\)\{/, 'function(bar){')).call(null, ctx.fmtKey, ctx.fmtHMparts, ctx.ukHM, ctx.ukHour, Settings);

function makeGame() {
  return { done: [], bokkePoints: [], bokkeSession: null, bokkeEmaFast: null, bokkeEmaSlow: null, bokkePrevEmaFast: null, bokkePrevEmaSlow: null, bokkeMaxDown: 0, bokkeMaxUp: 0, bokkeLongArm: null, bokkeShortArm: null, bokkeGannShortArm: null, bokkeGannLongArm: null, bokkeLongPrinted: false, bokkeShortPrinted: false, bokkeHighs: [], bokkeLows: [], vwapByTs: new Map(), vwapPoints: [], bokkeCompute: compute };
}

// 08:00 BST London
const ANCHOR = Date.UTC(2026, 7, 7, 7, 0, 0) / 1000;
const bar = (i, o, h, l, c) => [ANCHOR + i * 60, o, h, l, c, 100];

function runWolfpack() {
  const game = makeGame();
  const bars = [];
  for (let i = 0; i <= 9; i++) bars.push(bar(i, 4300, 4300.3, 4299.7, 4299.5));
  bars.push(bar(10, 4299.5, 4299.6, 4288, 4297)); // crossunder fan, maxDown 12
  for (let i = 11; i <= 14; i++) bars.push(bar(i, 4297 + (i - 10) * 5, 4298 + (i - 10) * 5, 4296 + (i - 10) * 5, 4298 + (i - 10) * 5));
  for (const b of bars) { game.done.push(b); game.vwapPoints.push({ v: 4300 }); game.vwapByTs.set(b[0], { v: 4300 }); game.bokkePoints.push(game.bokkeCompute(b)); }
  return game.bokkePoints;
}

function runGannPivot() {
  const game = makeGame();
  const bars = [];
  for (let i = 0; i <= 100; i++) { const p = 4300 + i * 0.03; bars.push(bar(i, p, p + 0.3, p - 0.3, p)); }
  bars.push(bar(101, 4303.03, 4315, 4302.5, 4306));
  bars.push(bar(102, 4306, 4308, 4301, 4302));
  bars.push(bar(103, 4302, 4304, 4298, 4299));
  for (const b of bars) { game.done.push(b); game.vwapPoints.push({ v: 4300 }); game.vwapByTs.set(b[0], { v: 4300 }); game.bokkePoints.push(game.bokkeCompute(b)); }
  return game.bokkePoints;
}

(async function() {
  // Gann fan geometry at minute 60: 1x1 = open + 0.1*60
  const pts = runWolfpack();
  const at10 = pts[10];
  assert.strictEqual(at10.active, true, 'bar 10 inside session');
  assert.ok(Math.abs(at10.fan.oneDown - 4299) < 1e-9, '1x1 fan at 60min below open');
  assert.strictEqual(at10.maxDown, 12, 'max downside excursion 12');
  assert.deepStrictEqual(at10.po3.plus.slice(0, 3), [4303, 4306, 4309], 'PO3 +3/+6/+9');

  // Wolfpack LONG after confirmation bounce
  const longs = pts.map((p, i) => p.signal && p.signal.text === 'LONG' ? i : null).filter(x => x != null);
  assert.deepStrictEqual(longs, [11], 'Wolfpack LONG prints at bar 11');

  // Gann Pivot SHORT after fresh excursion + confirmed pivot
  const gann = runGannPivot();
  const gannShort = gann.map((p, i) => p.gann && p.gann.text === 'GANN S' ? i : null).filter(x => x != null);
  assert.deepStrictEqual(gannShort, [103], 'Gann Pivot SHORT prints at bar 103');

  // Long/Short toggles gate the signals
  Settings.vals.bokkeGoldLong = false;
  const noLong = runWolfpack();
  assert.strictEqual(noLong.some(p => p.signal && p.signal.text === 'LONG'), false, 'Long toggle off suppresses LONG');
  Settings.vals.bokkeGoldLong = true;

  console.log('bokke gold engine tests passed');
})().catch(function(err) {
  console.error(err);
  process.exitCode = 1;
});
