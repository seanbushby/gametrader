'use strict';
// GT-ARCADE-UI-001 regression tests: layout preference, cockpit visibility,
// home destinations, day-card outcome cleanup, combo/multiplier display fix.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'gametrader.html'), 'utf8');

// 1. Layout preference persisted via Settings + applied to body
assert.ok(html.indexOf("interfaceLayout:'classic'")>=0, 'classic default');
assert.ok(html.indexOf("data-layout=\"classic\"")>=0, 'classic button');
assert.ok(html.indexOf("data-layout=\"cockpit\"")>=0, 'cockpit button');
assert.ok(html.indexOf('function applyLayout')>=0, 'applyLayout defined');
assert.ok(html.indexOf("classList.toggle('cockpit'")>=0, 'body cockpit class toggle');

// 2. Cockpit CSS hides duplicate/professional clutter but keeps the chart
const cockpitCss = html.slice(html.indexOf('COCKPIT LAYOUT'), html.indexOf('MENU ----------'));
assert.ok(cockpitCss.indexOf('body.cockpit #radioMini{display:none')>=0, 'cockpit hides radio');
assert.ok(cockpitCss.indexOf('body.cockpit #indicatorMenuBar{display:none')>=0, 'cockpit hides indicator bar');
assert.ok(cockpitCss.indexOf('body.cockpit .mcards{display:none')>=0, 'cockpit hides duplicate cards');
assert.ok(cockpitCss.indexOf('body.cockpit #keyRef{display:none')>=0, 'cockpit hides keyboard legend');
assert.ok(cockpitCss.indexOf('body.cockpit.propMode .mcards{display:flex')>=0, 'challenge keeps account info');
// chart itself untouched by cockpit
assert.ok(html.indexOf('body.cockpit #cvWrap{')<0, 'no cockpit chart-specific override (chart shared)');

// 3. Home destinations
assert.ok(html.indexOf('id="playBtn"')>=0, 'PLAY destination');
assert.ok(html.indexOf('id="trainBtn"')>=0, 'TRAIN destination');
assert.ok(html.indexOf('id="challengeHubBtn"')>=0, 'CHALLENGE destination');
assert.ok(html.indexOf('<summary>More</summary>')>=0, 'More disclosure');
assert.ok(html.indexOf('id="dailyRunBtn"')>=0, 'Daily Run still present (under More)');
assert.ok(html.indexOf('id="gameModeSel"')>=0, 'mode select still present');

// 4. Day cards no longer leak market outcome
assert.ok(html.indexOf('Range <b>${lv.range} pts</b>')<0, 'range removed from day cards');
assert.ok(html.indexOf('Asia <b>${lv.asiaLo')<0, 'asia levels removed from day cards');
assert.ok(html.indexOf('Net <b class="chg')<0, 'net change removed from day cards');

// 5. Combo/multiplier display fixed (no longer copies Max DD into Multiplier)
assert.ok(html.indexOf("m('mult2').textContent=multTxt;")>=0, 'mult2 shows live multiplier');
assert.ok(html.indexOf('id="mCombo"')>=0, 'header combo pill present');

// 6. Input consistency: keyboard B no longer arms LONG (gamepad B = SHORT)
const kb = html.slice(html.indexOf('switch(k){'));
assert.ok(kb.indexOf("case 'l': if(!heldKeys")>=0, "keyboard L arms long");
assert.ok(kb.indexOf("case 'l': case 'b':")<0, "keyboard B long-arm alias removed");

// 7. Navigation: verdict + instrumentMenu back handling
assert.ok(html.indexOf('if(inVerdict){')>=0, 'keyboard verdict handling');
assert.ok(html.indexOf('if(inInstMenu){')>=0, 'keyboard instrumentMenu handling');

console.log('cockpit ui tests passed');
