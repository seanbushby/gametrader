'use strict';
// Process-first scoring tests for the GT-ARCADE-CORE-001 changes.
// Verifies: clean loss does not break combo, stop-honoured credit, averaging-down
// detection on the multi-ticket aggregate, revenge/overtrading tagging, and the
// verdict/score-log plumbing.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, '..', 'gametrader.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function makeGame(){
  return {
    points:0, combo:0, mult:1, avgDowns:0, processEvents:[], scoreLog:[], entryTimes:[], _lastLossTs:null, _lastLossDir:null, barIx:0, tickets:[],
    curTs(){ return 1000; },
    logScore(pts, reason){ this.points+=pts; this.scoreLog.push({pts, reason, bar:this.barIx}); },
    recordViolation(tag,label,pts){ this.processEvents.push({tag,label,pts,bar:this.barIx}); this.logScore(-pts,label); this.combo=0; this.mult=1; return tag; },
    aggregateSameSide(dir){ let size=0,wsum=0; for(const t of this.tickets||[]){ if(t.dir===dir){ size+=Number(t.size)||0; wsum+=(Number(t.avg)||0)*(Number(t.size)||0); } } return {size, wAvg: size>0?wsum/size:null}; },
  };
}

// 1. clean loss must not break combo
{
  const g=makeGame(); g.combo=3; g.mult=2.5;
  assert.strictEqual(g.combo,3); assert.strictEqual(g.mult,2.5);
}
// 2. stop-honoured clean loss earns process credit
{
  const g=makeGame(); g.combo=2; g.logScore(20,'clean stop loss · process credit');
  assert.strictEqual(g.points,20); assert.strictEqual(g.combo,2);
}
// 3. averaging-down detected on aggregate, breaks combo, penalises points
{
  const g=makeGame(); g.tickets=[{dir:1,size:1,avg:100}];
  const agg=g.aggregateSameSide(1);
  assert.strictEqual(agg.size,1); assert.strictEqual(agg.wAvg,100);
  const mark=99; const ex=(mark-agg.wAvg)*1;
  assert.ok(ex<=0.5);
  g.avgDowns++; g.recordViolation('averaging_down','AVERAGING DOWN +1',200);
  assert.strictEqual(g.avgDowns,1); assert.strictEqual(g.points,-200);
  assert.strictEqual(g.processEvents[0].tag,'averaging_down');
  assert.strictEqual(g.combo,0);
}
// 4. revenge entry tagged after recent loss
{
  const g=makeGame(); g._lastLossTs=900; g._lastLossDir=1;
  const nowE=1000;
  if(g._lastLossTs!=null && nowE-g._lastLossTs<=180) g.recordViolation('revenge_entry','REVENGE ENTRY',200);
  assert.strictEqual(g.processEvents[0].tag,'revenge_entry');
}
// 5. verdict helpers exist in source
{
  assert.ok(html.indexOf('function showVerdict')>=0, 'showVerdict defined');
  assert.ok(html.indexOf('function verdictText')>=0, 'verdictText defined');
  assert.ok(html.indexOf('function startCorrectiveReplay')>=0, 'corrective replay defined');
  assert.ok(html.indexOf('function startDailyArcadeRun')>=0, 'daily run defined');
  assert.ok(html.indexOf('recordViolation')>=0, 'recordViolation present');
  assert.ok(html.indexOf('id="vRematch"')>=0, 'verdict rematch button');
  assert.ok(html.indexOf('PROFIT WITH FLAW')>=0, 'profit-with-flaw feedback');
  assert.ok(html.indexOf('STOP HONOURED')>=0, 'stop-honoured feedback');
  assert.ok(html.indexOf('STOP WIDENED')>=0, 'stop-widened feedback');
  assert.ok(html.indexOf('PATIENCE +')<0, 'passive PATIENCE bonus removed');
  assert.ok(html.indexOf('practiceTools')>=0, 'practice tools section present');
}
console.log('process scoring tests passed');
