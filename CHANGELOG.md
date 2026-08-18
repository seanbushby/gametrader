# v0.35.73 - 2026-08-18
- GT-ARCADE-UI-001 interface/flow pass:
  - Added selectable interface layouts: Classic (unchanged full workspace) and Cockpit (streamlined arcade HUD around the same chart/engine). Preference persisted via Settings gt_set_interfaceLayout, switchable in the settings drawer.
  - Cockpit hides the radio mini-player, indicator dropdown, duplicate Balance/Equity/Session P/L + Max DD/Lowest Eq/buffer cards, and the keyboard legend. Chart, trading state, order engine and controls are shared with Classic. Prop/Challenge runs keep account + buffer cards in Cockpit.
  - Fixed the Multiplier stat (was copying Max DD) to show the live combo multiplier, and added a prominent Combo pill in the header that appears while a streak is active.
  - Home screen reorganized around PLAY (Mystery unknown day, primary), TRAIN (academy), CHALLENGE (another trader). Daily Run, challenge code, Bot Lab, CSV import, mode select and Custom Session moved under a quieter More disclosure.
  - Recent-day cards no longer reveal the market outcome: removed net change, range and Asia high/low; date, bar count, session and high score remain for choosing a day.
  - Navigation: Back (Escape/B) now works predictably from the verdict screen and instrument menu; verdict Enter/R/Start restarts or advances (Daily Run -> next daily, Mystery -> next mystery, custom -> restart, else rematch).
  - Input consistency: keyboard B no longer arms LONG (it conflicted with gamepad B = SHORT); L remains the long key. Key legend speed text corrected to 1-7.
- Chart look, candles, zoom/pan, SL/TP lines and all overlays are untouched; Classic and Cockpit share one chart and one engine.

# v0.35.72 - 2026-08-18
- Moved the Indicators dropdown off the chart canvas: it now sits in the header between the radio (music) row and the info boxes, centred, so it no longer covers chart text.

# v0.35.71 - 2026-08-18
- GT-ARCADE-CORE-001 council pass:
  - Scoring integrity: a valid losing trade no longer breaks the combo. Combo now breaks only on process violations (averaging down, stop widening, revenge entry, overtrading, breach). Averaging-down detection rewritten for the multi-ticket model (aggregate same-side weighted average; the old single-position add block was dead code and never fired). Removed the passive flat-bar PATIENCE +20 bonus. A clean stop-honoured loss earns small positive process credit; a profitable close on a ticket with process violations is penalised (PROFIT WITH FLAW). Every score change is logged with a reason in the score log.
  - Feedback: added STOP HONOURED / STOP WIDENED / REVENGE ENTRY / OVERTRADING / PROFIT WITH FLAW arcade feedback reusing splash, toast, sound, rumble and shake.
  - End-of-run flow: normal arcade/Mystery runs now land on a fast verdict screen (grade, one-line verdict, top strength/mistake with evidence) with REMATCH / FIX THIS HABIT / NEXT MYSTERY / FULL REVIEW / MENU. FULL REVIEW keeps the existing deep score screen.
  - Corrective replay plumbing: startCorrectiveReplay(tag) picks an unknown historical day (not recently seen, not the just-played day) for averaging_down / stop_widening / overtrading / revenge_entry / poor_exit_capture; falls back to a random eligible unknown day when no fresh tagged data exists.
  - Challenge data: day snapshots now carry a process object (processScore, risk compliance, drawdown, trade count, selectivity, P/L) so async process-first comparison is possible; P/L is secondary.
  - Product boundary: Bot Lab and CSV load demoted under a collapsible PRACTICE TOOLS disclosure so the arcade core (Academy, Mystery, Challenge, replay) stays front-and-centre.
  - Daily Arcade Run: deterministic daily selection (date+instrument) with a hidden tape, same settings for every player, process-first scoring; stored in localStorage gt_daily_run. Server/shared infra not wired yet.

# v0.35.70 - 2026-08-18
- Removed the 200x and 500x replay speeds I had added in v0.35.69. Speeds are back to 1/2/5/10/20/50/100x (the 100x added in v0.35.68 stays), dropdown and keyboard shortcut back to 1-7.

# v0.35.69 - 2026-08-18
- Added Custom Session: pick any trading window (e.g. 08:00-11:00 or 14:30-21:00) and how many consecutive days to trade. The replay auto-advances to the next day when the window ends, showing the new day's date and a 5-4-3-2-1-TRADE! countdown in the arcade font. The account carries over across days; the score shows at the end of the run. Added 200x/500x replay speeds for flying through multi-day runs (speed selector, SPD chip and keyboard 1-9).

# v0.35.68 - 2026-08-18
- Added 100× to the replay speed options: the SPD chip cycles 1/2/5/10/20/50/100×, the speed dropdown includes 100×, and keyboard shortcut is now 1-7.

# v0.35.67 - 2026-08-18
- Fixed the Gann fan being invisible/clipped on the chart: the chart's Y-scale now includes the Bokke fan rays and London open (the same auto-scale behaviour the tradeplatform port gets from Lightweight Charts). Previously the scale fit only candles + VWAP bands, so when price traded away from the 08:00 open the fan fell outside the visible range and appeared missing or flat.

# v0.35.66 - 2026-08-18
- Fixed the Bokke Gold Gann fan: the rays are now drawn as true diverging polylines through each bar's fan values (the same technique the tradeplatform port uses), so the 1x2 / 1x1 / 2x1 rays spread out from the 08:00 open instead of appearing as flat horizontal lines.

# v0.35.65 - 2026-08-18
- Removed the legacy Trade Rider Pro shell entirely: the app no longer boots into the Pro dashboard after login (it now goes straight to the arcade menu), the Trade Rider Pro menu button is gone, the Pro shell screen, its theme CSS and pro-shell.js are removed, the TradeRider logo assets are deleted, and all `tradeRider.*` storage keys were renamed to `gt.*`. GameTrader is now a standalone arcade site only.

# v0.35.64 - 2026-08-18
- Added the Bokke Gold PO3 Gann VWAP indicator: a centered Indicators dropdown above the chart with a Settings panel. It plots the London 08:00 open, the Gann fan (1x2 / 1x1 / 2x1 above and below the open, slope per minute), the PO3 ±3/6/9/18/27/45/72/144 levels, reuses the London VWAP bands, and emits Wolfpack LONG/SHORT signals (fan interaction + PO3 distance + EMA crossover confirmation) and Gann Pivot LONG/SHORT signals (fresh fan excursion + confirmed pivot). The settings dialog puts Long/Short signal toggles and feature toggles (Gann fan, PO3, VWAP, Wolfpack signals, Gann pivot, labels) at the top, then per-feature sections below (London session, Gann fan, Wolfpack, Gann pivot).

# v0.35.63 - 2026-07-26
- Made the Pro Prop Challenge page reflect the live run state immediately after start.
- Added visible start feedback so the button no longer feels dead.

# v0.35.62 - 2026-07-26
- Fixed Pro start buttons by binding all matching buttons instead of the first hidden copy.

# v0.35.61 - 2026-07-26
- Made the Pro Prop Challenge start action explicit and surfaced a visible error if the run cannot be created.

# v0.35.60 - 2026-07-26
- Split the Pro challenge flow into a Mystery-day launcher and a separate Prop Challenge start action.
- Restored historical day picks in replay to open the normal replay flow again.

# v0.35.59 - 2026-07-26
- Increased the Pro sidebar logo mark size by 50% for stronger branding.

# v0.35.58 - 2026-07-26
- Removed the tinted Pro sidebar badge fill so the transparent horse logo sits directly on the site background.

# v0.35.57 - 2026-07-26
- Moved the challenge hub into the Trade Rider Pro shell so challenge mode stays inside the site.
- Added a dedicated Pro-styled current challenge view and left-nav entry.

# v0.35.56 - 2026-07-26
- Enlarged the Pro sidebar logo badge and removed its border outline for a cleaner brand mark.

# v0.35.55 - 2026-07-26
- Restored the arcade `GAME TRADER` text logo in the shell and put the transparent Trade Rider mark into the Pro sidebar badge.

# v0.35.54 - 2026-07-26
- Switched the Trade Rider logo to the new transparent `TradeRider-trans` asset and bumped the shell cache-bust trail.

# v0.35.53 - 2026-07-26
- Switched the Trade Rider logo over to the cropped transparent asset so the entry screens no longer show the oversized square canvas.

# v0.35.52 - 2026-07-26
- Fixed the Pro Challenge Hub and Replay Trainer buttons to open the correct arcade screens directly.
- Bumped the shell and asset cache-bust trail to the new build.

# v0.35.51 - 2026-07-26
- Made Trade Rider Pro the default entry shell and kept GameTrader as the arcade subset.
- Fixed Bot Lab `End Test` so it finalizes the active replay instead of silently doing nothing.
- Added Pro-side AI reviews for any completed Bot Lab day or whole week.

# v0.35.49 - 2026-07-26
- Fixed the Pro replay button to open the real Bot Lab replay setup screen instead of dumping back to the main menu.

# v0.35.48 - 2026-07-26
- Fixed the Pro challenge entry so it opens the real challenge hub instead of dumping into replay.
- Added Pro replay historical day/week picking with quick instrument switches, including USTEC access when loaded.

# v0.35.47 - 2026-07-26
- Made the Pro prop and replay actions open the real challenge hub and selectable day-series history instead of the dead replay placeholder.
- Added AI review context to Pro report/replay views and wired clickable Pro settings controls.

# v0.35.46 - 2026-07-26
- Moved the arcade radio track name into its own title row so long song names are readable in the top bar.

# v0.35.44 - 2026-07-26
- Passed the selected Bot Lab instrument through the bot contract so the Bokke USTEC profile is applied reliably to both replay branches.

# v0.35.45 - 2026-07-26
- Moved the arcade radio controls into the middle of the top bar and increased the player height for a less squashed layout.

# v0.35.43 - 2026-07-26
- Added USTEC support to the Bot Lab Bokke DE40 Wolf Cross Engine with its validated trade-management, timing, trend-gate, and live-sizing profile.
- Kept USTEC's standard one-point spread and one-dollar point value while preserving DE40's raw zero-spread backtest execution for both replay branches.

# v0.35.42 - 2026-07-26
- Fixed the arcade radio player by restoring its audio element and keeping the compact inline header layout.

# v0.35.41 - 2026-07-26
- Added a `/music/playlist.json` manifest so the arcade radio can discover and play the existing MP3 files reliably.

# v0.35.40 - 2026-07-26
- Replaced the oversized arcade radio dock with a compact inline header player and tightened track loading feedback for empty or missing `/music` playlists.

# v0.35.39 - 2026-07-26
- Moved the global cog and help buttons out of the Pro shell so they no longer block the Pro top bar.

# v0.35.39 - 2026-07-26
- Added an arcade-only MusicLab radio station with a modern MP3 player in the top header and `/music/` playlist discovery.

# v0.35.38 - 2026-07-26
- Restyled Trade Rider Pro with a professional SaaS dashboard layout.
- Removed arcade typography from Pro theme.
- Added Pro sidebar/topbar navigation.
- Added dashboard KPI cards and recent report table layout.
- Improved account-ready and reports pages.
- Preserved Trade Rider Arcade visual identity.

# v0.35.37 - 2026-07-26
- Fixed MusicLab chart rendering so numeric candle timestamps are formatted correctly instead of crashing the analysis view.

# v0.35.36 - 2026-07-26
- Added MusicLab OpenCode AI song-package generation with verified-payload prompting, strict JSON validation, deterministic fallback, and AI debug controls.

# v0.35.35 - 2026-07-26
- Added latest session / good day summary to Pro dashboard.
- Added professional Reports and latest report route.
- Added account-ready report history placeholder.
- Added empty/demo states for guest users.
- Preserved arcade theme and existing trading engine.

# v0.35.33 - 2026-07-26
- Renamed the Bot Lab strategy to Bokke DE40 Wolf Cross Engine across user-facing UI and release references.

# v0.35.35 - 2026-07-26
- Added optional OpenCode AI song-package generation to MusicLab with verified-payload prompting, strict JSON validation, deterministic fallback, and separate AI debug/status controls.

# v0.35.34 - 2026-07-26
- Fixed MusicLab's empty-session handling so dates with no usable morning candles now fail with a clear no-data error instead of running the detector on an empty range.

# v0.35.33 - 2026-07-26
- Added the standalone MusicLab MVP: a browser-only morning price-action analyser with cTrader candle reuse, deterministic event detection, configurable Suno prompt generation, copy/download actions, and focused detector/lyrics tests.

# v0.35.32 - 2026-07-26
- Added an opt-in AI performance review for completed normal replay days, using the existing OpenCode provider, validated shared review schema, verified closed-trade payload, score-screen loading/error states, and local review cache.

# v0.35.31 - 2026-07-26
- Replaced Bot Lab's native browser confirmations with the site-styled confirmation modal and mark incomplete reports as partial with completed versus selected day counts.

# v0.35.30 - 2026-07-26
- Added Bot Lab run options to omit Bot Alone from the displayed report or run blind through all selected days and open only the final result.

# v0.35.29 - 2026-07-26
- Expanded the completed Bot Lab report with a full chronological trade ledger for both branches, including starting balance, entry/exit details, P/L, and balance after every trade.

# v0.35.28 - 2026-07-26
- Set the default Bokke hard stop to 14 points, matching the best-week backtest configuration alongside its existing TP, tight-stop, EMA-band, timing, gate, sizing, and lot-cap defaults.

# v0.35.27 - 2026-07-26
- Fixed unmanaged Bokke comparison parity: both Bot Alone and You Managing now use the backtest's raw $1-per-point fills before a human intervention, so identical no-action branches produce identical results.

# v0.35.26 - 2026-07-26
- Fixed Bot Lab intraday display across missing SQLite candles: the chart now begins at the latest continuous candle sequence instead of fabricating a price move across a data gap.

# v0.35.25 - 2026-07-26
- Added regression coverage confirming that intraday Bot Lab charts retain selected-day pre-open candles while excluding prior-day history.

# v0.35.24 - 2026-07-26
- Fixed Bot Lab intraday chart chronology: chart history now excludes prior-day candles on 1m-10m views, preventing the overnight gap from compressing the current session's candles.

# v0.35.23 - 2026-07-26
- Fixed Bot Lab candle history rendering: SQLite quote-heartbeat rows are now excluded from both chart history and replay candles, preventing false low-price traces and scale distortion.

# v0.35.22 - 2026-07-26
- Corrected Bokke replay's summer-time warmup boundary to start at the canonical backtest's selected-date midnight UTC rather than one hour earlier at the London date boundary.

# v0.35.21 - 2026-07-26
- Matched autonomous Bokke DE40 Wolf Cross Engine replay to the canonical selected-date EMA, deduplicated SQLite candle, incremental trend-gate, no-default-hard-stop, and exact strategy-exit behavior.
- Kept Bokke autonomous fills raw with no spread or commission while preserving realistic managed-branch fills and manual TP/SL controls.

# v0.35.20 - 2026-07-25
- Restored the Bot Lab candle scale after SL/TP actions and show off-screen SL/TP levels as edge markers rather than rescaling candles.

# v0.35.19 - 2026-07-25
- Fixed Bot Lab Edit SL and Edit TP visibility: successful button actions now fit the new risk level into the vertical price scale without changing chart pan, zoom, or timeframe.

# v0.35.18 - 2026-07-25
- Restored Bot Lab's stable candle viewport and VWAP feed after chart-history reference work caused visual regressions; VWAP is again opt-in from the chart control.
- Preserved broker margin, replay execution, position controls, ruler, and account metrics.

# v0.35.17 - 2026-07-25
- Fixed Bot Lab intraday candle chronology: 1m-5m views now show only the selected day and its pre-open context, preventing sparse candles from multiple days being compressed into one apparent session.
- Kept up to one week of history available for 15m, 30m, and 60m chart views.

# v0.35.16 - 2026-07-25
- Cached Bot Lab's filtered chart history after excluding SQLite quote-heartbeat rows, preventing the visual candle fix from adding per-frame replay overhead.

# v0.35.15 - 2026-07-25
- Fixed Bot Lab chart candles by filtering low-volume, flat SQLite quote-heartbeat rows from visual rendering while preserving those source rows for replay strategy execution.

# v0.35.14 - 2026-07-25
- Restored Bot Lab's original single-stream candle aggregation to prevent history and replay bars from being rendered as separate aggregation streams at their boundary.

# v0.35.13 - 2026-07-25
- Fixed Bot Lab VWAP continuity when replay starts after 08:00: the indicator now includes the already-loaded 08:00-to-playback-start session candles instead of resetting at the first replay bar.

# v0.35.12 - 2026-07-25
- Added broker-style DE40 margin accounting calibrated from the supplied Raw Trading ticket: $141.67 estimated margin per lot at 25,066.60, using 0.5% instrument margin and the ticket’s EUR/USD conversion.
- Added contract notional, used margin, and free-margin tracking; entries now reject insufficient free margin and the replay HUD shows free and used margin.
- Added setup margin guidance and made saved DE40 tests inherit the instrument margin model.
- Changed Bot Lab's default UK playback window to 08:00-11:00, including duplicate tests without a saved end time.

# v0.35.11 - 2026-07-25
- Fixed Bot Lab replay hanging at start by caching the aggregated one-week chart history instead of rebuilding it for every replay bar.
- Reduced Open and Asia reference-level work to the final pre-open history window, preserving the levels without repeated full-history timezone scans.

# v0.35.10 - 2026-07-25
- Fixed Bot Lab replay responsiveness after reference levels were added by caching each day’s Open and Asia calculations and limiting per-bar VWAP work to active replay bars.

# v0.35.9 - 2026-07-25
- Added main-chart reference levels to Bot Lab replay: UK 08:00 Open plus Asia High and Low from the UK 01:00-08:00 range.
- Made Bot Lab VWAP visible by default and reset its calculation at each UK 08:00 session open, rather than accumulating across historical days.
- Added regression coverage for UK Open and Asia reference calculations.

# v0.35.8 - 2026-07-25
- Fixed replay startup failure caused by a browser caching an older managed-runner module after excursion tracking was introduced.
- Versioned interconnected Bot Lab runner/controller modules and made excursion reporting safely optional for mixed cached sessions.

# v0.35.7 - 2026-07-25
- Matched Bot Lab Edit TP and Edit SL actions to the main chart's smart risk placement, using a 5-point step: targets are placed ahead of market and at least into profit, while stops move to protected profit once clear and otherwise sit behind market/entry.
- Kept direct chart-line dragging for manually chosen TP and SL prices.

# v0.35.6 - 2026-07-25
- Added a Bot Lab RULER chart mode for directly measuring price moves in points by dragging across the chart.
- Added automatic managed-position DD and MFE point tracking from executed entry, including intrabar high/low movement, to the replay position desk.

# v0.35.5 - 2026-07-25
- Fixed Bot Lab future-space rendering: horizontal panning now genuinely leaves blank slots on the right, allowing the current candle to move toward the middle of the chart while mouse-wheel zoom remains horizontal.

# v0.35.4 - 2026-07-25
- Fixed blank replay charts when resuming Bot Lab tests created before chart-history persistence was added; these tests now use their saved warmup candles as chart context.

# v0.35.3 - 2026-07-25
- Allowed Bot Lab charts to reserve right-side future space when panned, so the current replay candle can be positioned near the middle instead of remaining fixed to the right edge; LIVE restores the edge-anchored view.

# v0.35.2 - 2026-07-25
- Added up to one week of pre-session candle context to Bot Lab charts for free horizontal navigation and meaningful higher-timeframe views, while keeping strategy execution at its existing 1,200-bar warmup.
- Removed the confirmation prompt from managed-position Close actions; clicking Close now immediately exits at the current replay price.

# v0.35.1 - 2026-07-25
- Fixed Bot Lab date selection so moving `From` after `To`, or `To` before `From`, automatically moves the opposite boundary instead of leaving an invalid backwards range.

# v0.35.0 - 2026-07-25
- Reworked Bot Lab replay to match the main chart's account-first layout, with a managed-account HUD, chart quote tape, and compact positions desk below the chart.
- Added always-visible managed balance, equity, aggregate open P/L, and per-position live P/L using the execution engine's spread- and commission-aware valuation.
- Added instrument OHLC and bid/ask context, main-chart-style 90-bar density, and vertical time-grid lines to replay charts.
- Replaced the one-week CSV date limitation with a same-origin Apache proxy to the read-only SQLite candle service, exposing DE40 coverage from 2025-01-02 through 2026-07-24.
- Made cached CSV fallback sessions retry SQLite metadata when Bot Lab is reopened after a temporary API outage.
- Added versioned Bot Lab asset URLs so chart, setup, and data fixes are not hidden by stale browser caches.

# v0.34.0 - 2026-07-25
- Added a dedicated read-only candle API backed by `/trading/data/candles.db`, running as the restricted `smbuser` account with no trading or write endpoints.
- Added allowlisted DE40, XAUUSD, and USTEC metadata/range queries, Europe/London date boundaries, a 120-day request cap, and 1,200 preceding warmup candles.
- Changed Bot Lab market loading to prefer full SQLite history and automatically fall back to the existing static instrument CSV files when the API is unavailable.
- Updated date selection to expose database coverage, default new tests to the latest 20 calendar days, and fetch older selected ranges on demand instead of loading the entire database in the browser.
- Added the active data source to saved test configuration and setup status.
- Added Python API tests plus live metadata/range verification against the read-only service.

# v0.33.1 - 2026-07-25
- Added explicit zero-trade explanations to day ledgers, distinguishing insufficient balance for the selected Bokke sizing mode from days with no valid entry signal.
- Styled Bot Lab ledger, sidebar, day-summary, and report scrollbars to match the site's thin brass-gradient scrollbar design.
- Added regression coverage for explanatory empty trade ledgers.

# v0.33.0 - 2026-07-25
- Brought Bot Lab chart behavior in line with the mature Game Trader chart interaction model while keeping the autonomous branch hidden.
- Added mouse-wheel horizontal zoom, pointer/touch chart panning, manual vertical price scaling, price-axis zoom/drag, crosshair price/time inspection, LIVE reset, and chart fullscreen.
- Added 1/2/3/5/10/15/30/60-minute chart aggregation without changing one-minute bot execution.
- Added volume-weighted VWAP with one-, two-, and three-deviation bands and matching chart controls.
- Added direct managed SL and TP line dragging with preview, validation, one committed intervention per drag, and persistent replay updates.
- Kept managed position controls anchored to entry prices through zoom, pan, timeframe, and scale changes.
- Added regression coverage for timeframe OHLCV aggregation and chart price-coordinate mapping.

# v0.32.4 - 2026-07-25
- Anchored each managed-position control strip to its entry-price line instead of the chart's bottom-left corner.
- Added responsive edge clamping and overlap spacing so entry-line controls stay visible with multiple positions.
- Added regression coverage for entry-line positioning and chart-boundary clamping.

# v0.32.3 - 2026-07-25
- Fixed Bot Lab candles flattening into a line while a position had no stop; null stops can no longer be coerced to price zero during chart auto-scaling.
- Added defensive rejection of zero/non-positive OHLC prices in Bot Lab market-data preparation and chart rendering.
- Added a chart-level managed-position strip showing side, lots, estimated P/L, and prominent Edit SL, Edit TP, and Close actions.
- Added managed take-profit editing with replay-price validation, human override protection, and intervention logging.
- Added regression coverage for null/zero chart scaling and managed TP changes.

# v0.32.2 - 2026-07-25
- Bumped the Bokke DE40 Wolf Cross Engine replay definition to v1.2.0 for the new dynamic sizing contract.
- Added selectable Bokke dynamic sizing modes based on current branch balance: live uses 0.1 lot per $15 and demo uses 1 whole lot per $150, both rounded down and capped at the configured maximum.
- Added $200, $500, and custom starting-balance controls to Bot Lab, defaulting new tests to $500.
- Expanded Bokke execution limits to support the deployed 250-lot cap and 0.1-lot live sizing while retaining whole-lot demo sizing.
- Added regression tests for $200/$500 live and demo sizes, maximum-lot caps, and historical replay with balance-based position sizing.

# v0.32.1 - 2026-07-25
- Changed managed-trade slowdown from 10x to 1x on every new entry so there is time to assess and intervene.
- Added live position lot size and UK entry time to the replay sidebar.
- Added Bot Alone and You Managing trade ledgers to day summaries and final reports with day, side, lots, UK entry/exit times, entry/exit prices, P/L, and exit reason.
- Made position and signal IDs day-specific so multi-day interventions match the correct trade.
- Fixed the day-complete overlay remaining above the final report after selecting Finish & View Report.

# v0.32.0 - 2026-07-25
- Rebuilt Bot Lab execution so returned bot commands execute exactly once at real replay prices with correct spread, commission, stops, targets, market closes, and synchronized bot/runner state.
- Repaired the replay chart lifecycle: the canvas now remains connected, updates without replacing the screen DOM, shows managed candles and trade markers, resizes correctly, and keeps the autonomous branch hidden.
- Added instrument-specific CSV loading, selectable date ranges, deterministic day selection, configurable UK playback windows, and up to 1,200 pre-session warmup candles per day.
- Corrected the Bokke DE40 Wolf Cross Engine browser port against `/trading/bots/bokke_one_pack.py`: 200-candle minimum, 08:15-11:00 entry window, opening sync, no entry-time hard stop, post-11:00 hard-stop/gate management, 13:00 time stop, correct short TP, and next-bar re-entry blocking.
- Fixed human stop validation and manual closes to use replay market price/time, preserve tightening-only overrides, and log stable day/signal attribution.
- Reworked pause/speed playback, multi-day balances and metrics, final-day completion, interrupted-day resume behavior, compact schema-v2 storage, reports, and intervention matching.
- Added Node and browser regression coverage for core execution, Bokke parity, market-data windows, and historical DE40 replay; the historical smoke test processes five days, 2,250 bars, and 13 Bokke trades.

# v0.31.0 - 2026-07-25
- Added Bokke DE40 Wolf Cross Engine to Bot Lab: faithful JavaScript port of the live DE40 EMA3/8 Wolf Cross strategy with 3-tier stop system (tight SL, hard SL, time stop), trend gate filter, opening sync window, and configurable settings.
- Built real-time candlestick chart for Bot Lab replay screen with trade entry/exit markers, stop-loss and take-profit lines, managed and autonomous position overlays, and price axis.
- Added bot-chart.js module for canvas-based chart rendering during replay.

# v0.30.0 - 2026-07-25
- Added Bot Lab: a new top-level section for Bot-vs-Human management testing with dual-branch parallel replay, autonomous and managed runners, intervention tracking, stop-loss override behaviour, speed control with cruise/slowdown/restore, daily comparison summaries, complete test comparison reports, intervention analysis, and modular file structure across js/bots/, js/ui/, and css/bot-lab.css.
- Reference bot (Simple MA Crossover) included as a deterministic demo for proving the Bot Lab architecture.
- Bot contract interface documented for future real-bot integration.
- Automated test suite added in tests/bot-lab-tests.html.

# v0.29.37 - 2026-07-25
- Tightened the review normaliser and prompt so strengths and improvements must read like coaching advice instead of key lists.

# v0.29.36 - 2026-07-25
- Fixed the file-backed OpenCode prompt loader so the review path can actually fetch the prompt text from the app origin.

# v0.29.35 - 2026-07-25
- Moved the OpenCode coaching prompt into a text file loaded from the app origin so it is easier to edit and reuse for bot integration.

# v0.29.34 - 2026-07-25
- Added synthetic review fallbacks so sparse live OpenCode responses still render useful strengths and improvements.

# v0.29.33 - 2026-07-25
- Trimmed the OpenCode review payload to a compact summary instead of embedding the full frozen challenge snapshot twice.

# v0.29.32 - 2026-07-25
- Let the basic OpenCode transport test run independently of the full review so the browser can verify a small payload while a review is in flight.

# v0.29.31 - 2026-07-25
- Added a tiny OpenCode transport test so the browser can verify health, session creation, and a short message before sending the full review payload.

# v0.29.30 - 2026-07-25
- Relaxed OpenCode review validation so live responses with text-only fields are accepted instead of being rejected as malformed.

# v0.29.29 - 2026-07-25
- Added in-flight deduping for the OpenCode AI review request so repeated renders or retries do not spawn overlapping browser fetches.

# v0.29.28 - 2026-07-24
- Added an in-browser OpenCode debug log panel for AI review steps and traceable retry/caching behaviour on the completed challenge report.

# v0.29.27 - 2026-07-24
- Auto-refresh invalid cached AI reviews, hide stale fallback text while regenerating, and add clearer retry feedback on the completed challenge report.

# v0.29.24 - 2026-07-24
- Made the in-game challenge storage wipe immediate and one-click, with a visible toast confirmation.

# v0.29.23 - 2026-07-24
- Added an in-game `Clear challenge storage` action to wipe the challenge save, history, and review snapshots without using the browser console.

# v0.29.22 - 2026-07-24
- Normalized HUD metric tiles so the card labels and amounts align consistently across all top-bar boxes.

# v0.29.21 - 2026-07-24
- Fixed challenge day counting so forced closes at finish are counted after tickets are closed, allowing the run to advance.

# v0.29.20 - 2026-07-24
- Reduced snapshot size and saved the challenge state before the review snapshot to avoid quota-related loss of day advancement.

# v0.29.19 - 2026-07-24
- Added persisted challenge-plan normalization and load-time repair so old runs with repeated day keys can advance correctly after finishing a day.

# v0.29.18 - 2026-07-24
- Added a resume-time repair that forces the saved challenge run to advance if it is still pointing at the day that was already completed.

# v0.29.16 - 2026-07-24
- Fixed Prop Challenge day advancement to skip repeated day keys and build runs from distinct historical days only.

# v0.29.15 - 2026-07-24
- Added a challenge day snapshot browser plus explicit Next Day and Review Day actions in the hub and score screens.

# v0.29.14 - 2026-07-24
- Added challenge hub and score screen review actions, plus a dedicated snapshot viewer for the last finished day.

# v0.29.13 - 2026-07-24
- Fixed challenge day finish so the pause overlay is cleared and the challenge hub becomes visible after ending a day.

# v0.29.12 - 2026-07-24
- Repaired broken challenge runs automatically when a saved day key no longer exists, so Start/Resume can recreate a valid run instead of looping on Reset.

# v0.29.11 - 2026-07-24
- Saved a per-day challenge review snapshot with trades, report data, and a small chart thumbnail when finishing a challenge day.

# Changelog

# v0.29.10 - 2026-07-24
- Fixed Prop Challenge day advancement so finishing a day reliably moves to the next saved replay day.

# v0.29.9 - 2026-07-24
- Fixed Prop Challenge Start/Resume so saved challenge days launch directly from the hub without opening the lesson overlay.

# v0.29.8 - 2026-07-24
- Fixed Prop Challenge Start/Resume so saved challenge days launch directly from the hub without opening the lesson overlay.

# v0.29.7 - 2026-07-24
- Fixed Prop Challenge Start/Resume so saved challenge days launch directly from the hub.

# v0.29.6 - 2026-07-24
- Released the Prop Challenge/practice mode separation fix, plus chart ticket overlap handling, TP/SL interactions, and Asia liquidity line styling.

# v0.29.5 - 2026-07-24
- Improved chart ticket overlap handling, TP/SL interactions, and Asia liquidity line styling for clearer chart controls.

# v0.29.4 - 2026-07-24
- Fixed Prop Challenge/menu separation so practice cards remain playable while an active challenge exists.

# v0.29.3 - 2026-07-24
- Added a permanent Finish Trading Day action for Prop Challenges, including position closure, order cancellation, saved day results and immediate progression.

# v0.29.2 - 2026-07-24
- Removed the `overallLossPct` field and made `maxLossPct` the single authoritative phase loss setting, with migration from older saved challenge data.

# v0.29.1 - 2026-07-24
- Fixed the Prop Challenge overall loss floor to use the configured `maxLossPct` instead of a hard-coded 10%.

# v0.29.0 - 2026-07-24
- Prop Challenge now continuously tracks unrealised equity, permanent breach states and intraday drawdown statistics.

# v0.28.65 - 2026-07-23
- Made the per-position chart markers use a clearer pill-style box so they match the active ticket better.

# v0.28.64 - 2026-07-23
- Fixed the remaining loss close toast path so it uses a normal ASCII minus sign.

# v0.28.63 - 2026-07-23
- Fixed the bad loss close toast so it shows a normal minus sign instead of the broken glyph.

# v0.28.62 - 2026-07-23
- Restored a visible side badge on each chart ticket line so the per-position markers read more like the TradingView-style graphic.

# v0.28.61 - 2026-07-23
- Added the missing `B`/`S` arm-mode instructions to the Interface Help tutorial.

# v0.28.59 - 2026-07-23
- Rendered every open ticket as its own chart line again, so additional CFD positions stay visible instead of only the active one.

# v0.28.58 - 2026-07-23
- Removed visible CSV filename references from the instrument cards and loader status text.

# v0.28.57 - 2026-07-23
- Stopped the tutorial tips popup from appearing on the login screen; it now only auto-opens after login.

# v0.28.56 - 2026-07-23
- Capped total open exposure by side to the instrument max size, so multiple tickets can no longer exceed the 50-lot limit.
- Applied the same cap to resting limit orders.

# v0.28.55 - 2026-07-23
- Added vertical chart dragging so the price window can move up and down as well as left and right.
- Fixed the positions pane header text to say `Open positions`.

# v0.28.53 - 2026-07-23
- Changed the close button text to a simple `✕`.

# v0.28.52 - 2026-07-23
- Deduplicated ASIA sweep callouts when closing multiple tickets in one action, so the message shows once instead of repeating for every filled long.

# v0.28.51 - 2026-07-23
- Made `CLOSE ALL` respect the armed side: when `B`/`S` is armed it closes only that side, and when unarmed it closes everything.
- Kept `Space` as the explicit unarm action.

# v0.28.50 - 2026-07-23
- Made the position chips fully opaque black for better readability.

# v0.28.49 - 2026-07-23
- Moved the TP/SL handle chip farther right so it no longer overlaps the entry size/P&L chip.

# v0.28.48 - 2026-07-23
- Restyled the entry position chip to a simple direction-colored quantity and P/L box while keeping TP/SL as separate controls.

# v0.28.47 - 2026-07-23
- Added a simple login screen using the existing visual style.
- Kept the entry TP/SL controls visible and switched them between Add and Edit labels instead of hiding them.

# v0.28.46 - 2026-07-23
- Restored the entry label chip to the original position and layered it above the TP/SL handle chip so `LONG` / `SHORT` is visible again.

# v0.28.45 - 2026-07-23
- Moved the entry position chip left and pushed it rightward only when TP/SL handles are visible, so `LONG`/`SHORT` is no longer clipped.

# v0.28.44 - 2026-07-23
- Kept buy/sell arm mode active after placing one order so `B`/`S` stay armed until `Space` cancels them.

# v0.28.43 - 2026-07-23
- Made chart panning a signed translation instead of a clamped screen-width offset, so dragging can continue past both sides.
- Kept the right-side price panel as an overlay while the chart moves underneath it.

# v0.28.42 - 2026-07-23
- Let the candle plot render under the right-side price scale again so the live bar is no longer visually blocked at the price panel edge.

# v0.28.41 - 2026-07-23
- Fixed horizontal scrolling so the chart uses a raw history window plus right-side empty space, which keeps the current bar movable into the middle.
- Kept higher timeframes working by applying the offset before candle aggregation.

# v0.28.39 - 2026-07-23
- Fixed the horizontal window math so panning shifts the chart by an offset from the live edge instead of collapsing the visible bar count.
- Restored higher-timeframe scrolling by applying the offset in raw-bar units before aggregation.

# v0.28.38 - 2026-07-23
- Restored the `live` render flag after the horizontal drag refactor so the chart and spread quote tape draw again.

# v0.28.37 - 2026-07-23
- Changed horizontal drag to control right-side chart padding instead of hard-clamping the live edge, so the current bar can sit in the middle of the screen.

# v0.28.36 - 2026-07-23
- Reversed chart panning so dragging left moves the bars left and dragging right moves them right.
- Applied the same direction to flick inertia.

# v0.28.35 - 2026-07-23
- Removed the extra right-side chart buffer by anchoring the live view to the plot edge instead of leaving the current bar at ~72% width.
- Restored the plot area to stop before the price scale so the axis behaves like a separate panel.

# v0.28.34 - 2026-07-23
- Densified the price axis ladder with tighter major ticks and halfway gridlines so the chart shows more intermediate prices.

# v0.28.33 - 2026-07-23
- Removed the reserved blank chart strip by rendering the price chart across the full canvas width and treating the right-side price scale as an overlay panel.

# v0.28.32 - 2026-07-23
- Split the right price axis into its own transparent input panel so its wheel and drag handling no longer interfere with chart clicks.
- Fixed axis zoom from being overwritten by the chart auto-fit pass.

# v0.28.31 - 2026-07-23
- Chart wheel zoom now adjusts horizontal scale on the chart and vertical scale on the right price axis.
- Dragging the far-right price axis now resizes the vertical price range.

## v0.28.30 - 2026-07-23
- The round close button now shows `LONGS` or `SHORTS` underneath when buy/sell arm mode is active.

## v0.28.29 - 2026-07-23
- The round `CLOSE` button now closes all open tickets unless buy/sell arm mode is active.
- When arm mode is active, the close button now cancels the arm instead of closing trades.

## v0.28.28 - 2026-07-23
- Fixed `Escape` so it no longer falls through to replay restart.
- Ignored gameplay key handling while the centered edit dialog is open.

## v0.28.27 - 2026-07-23
- Switched the bottom dock back to tabbed full-width mode so the active list uses the full block.
- Slimmed the ticket rows and button sizing for a denser, more modern blotter.

## v0.28.26 - 2026-07-23
- The desktop blotter panes now use a themed scrollbar matching the site.
- Replaced the browser `prompt()`-style edit boxes with a centered in-app dialog.

## v0.28.25 - 2026-07-23
- Added per-ticket open P/L to the positions blotter.
- Kept the compact split-panel layout and ticket-based order entry.

## v0.28.24 - 2026-07-23
- Switched market entries to independent tickets instead of one merged net position.
- Added arm-to-click order entry: `B`/`S` arms buy/sell, clicking the live bar places a market order, clicking elsewhere places a limit order.
- Made `Space` cancel arm mode so normal chart interaction resumes.

## v0.28.23 - 2026-07-23
- Reworked the desktop blotter into a table-like layout with column headers and row actions.
- Added `pointerdown` + `click` handling for the desk buttons so close, SL/TP, edit, and cancel stay responsive.

## v0.28.22 - 2026-07-23
- Rendered pending CFD orders as separate blotter rows instead of a single merged block.
- Kept the position row merged as intended for CFD-style exposure while preserving edit/close actions.
- Tightened the dock interaction wiring so row buttons keep working after edits and cancels.

## v0.28.21 - 2026-07-23
- Converted the desktop position/orders dock into compact single-line rows.
- Added inline edit, close, and cancel actions that call the real trade/order handlers.

## v0.28.20 - 2026-07-23
- Reworked the desktop bottom dock into side-by-side `Position` and `Pending Orders` panes that match the chart width.
- Removed the dead tab-switch behavior so the orders area is visible and clickable again.

## v0.28.19 - 2026-07-23
- Moved the desktop `Position` and `Pending Orders` panel below the chart into a bottom dock.
- Removed the desktop sidebar scrollbar source by taking the tabbed desk panel out of the left control column.

## v0.28.18 - 2026-07-23
- Broadened tablet/mobile TP/SL drag targets by enlarging the grip area and allowing the TP/SL chips themselves to start a drag.
- Added pointer-event drag cleanup so touch/pencil drags release more reliably.

## v0.28.17 - 2026-07-23
- Added desktop sidebar tabs for `Position` and `Pending Orders`.
- Wired the desktop panel to show live position details and a quick cancel-all path for pending orders.

## v0.28.16 - 2026-07-23
- Added a fullscreen button for phone/tablet browsers that support the Fullscreen API.
- Added a visible `CXL` pending-orders chip to cancel limit orders quickly.
- Improved touch dragging for SL/TP/limit lines by enabling direct touch hit-testing on the chart and increasing the drag snap zone.

## v0.28.15 - 2026-07-23
- Adjusted device detection so portrait tablets use the mobile layout instead of the desktop sidebar layout.

## v0.28.14 - 2026-07-23
- Moved off-screen top level badges like `ASIA H` to the top-right stack so they no longer clash with the quote block.

## v0.28.13 - 2026-07-23
- Pushed the top-left off-screen level tags lower so `ASIA H` and similar badges no longer sit behind the quote title/tape.

## v0.28.12 - 2026-07-23
- Fixed the settings drawer gameplay mode layout so the longer mode labels and descriptions no longer overlap.
- Switched gameplay mode buttons to a stacked full-width format for readability in the narrow side drawer.

## v0.28.11 - 2026-07-23
- Added three gameplay mode presets: `Pure Arcade`, `Sim Arcade`, and `Prop Challenge`.
- Centralized mode rules for spread, commission, score generosity, and daily-loss breach behavior.
- Pure Arcade now disables spread/commission, uses a 10% loss buffer, applies a score penalty on breach, and continues the replay in `DANGER ZONE`.
- Sim Arcade remains the default realistic mode with spread enabled and hard 5% breach.
- Prop Challenge keeps strict realistic execution and uses stronger breach warning language.
- Mode selection is now persisted, shown in the menu/HUD, and leaderboards are separated by mode.

## v0.28.10 - 2026-07-23
- Moved the live OHLC readout into the quote title bar to the right of the instrument name.
- Removed the overlapping canvas-top OHLC text from underneath the quote overlay.

## v0.28.9 - 2026-07-23
- Shrunk the fixed chart quote tape and added a title line above it in a TradingView-style layout.
- Moved top-left off-screen price tags lower so levels like Asia High no longer sit underneath the quote block.

## v0.28.8 - 2026-07-23
- Replaced the scrunched right-axis bid/ask pills with a fixed TradingView-style quote tape in the top-left of the chart.
- Kept bid/ask lines on the chart while making the visible spread display stable during scrolling and zooming.

## v0.28.7 - 2026-07-23
- Added visible live bid/ask quote lines to the chart for instruments with spread enabled.
- Added `Spread` to the HUD and side stats so the execution spread is visible in-game.
- Added realistic right-axis bid/ask quote pills plus a chart spread badge.

## v0.28.6 - 2026-07-23
- Added spread presets for `USTEC` and `GOLD` from the provided live quote examples.
- `USTEC` now uses a `1.0` spread and `GOLD` now uses a `0.08` spread.

## v0.28.5 - 2026-07-23
- Added realistic spread handling to DE40 execution using a `0.5` morning London spread.
- Kept the chart on mid price while market entries, exits, stops, targets, limits, and open P/L use bid/ask execution prices.
- Preserved drag/freeze mechanics for SL, TP, and limit lines while making fills and mark-to-market more realistic.

## v0.28.4 - 2026-07-23
- Replaced the weak generic beeps with a centralized procedural WebAudio arcade sound manager.
- Added named sound events for long/short opens, closes, wins, losses, stops, targets, limits, combos, warnings, and breach.
- Added a saved master sound volume slider with default `45%`.
- Upgraded breach warning audio to play once below `50%`, stronger below `25%`, and repeat only while danger persists.

## v0.28.3 - 2026-07-23
- Added a real DE40 Academy chop lesson using the London session from `2025-05-13`.
- Kept the synthetic chop tutorial while adding a guided real historical no-trade example.
- Standardized the in-app version labels to `v0.28.3`.

## v0.28.2 - 2026-07-23
- Shifted the live candle further right to reduce wasted forward space on desktop and mobile charts.
- Added a siren-style breach warning that starts before the account reaches the daily loss breach.
- Standardized the in-app version labels to `v0.28.2`.

## Notes
- Maintain this file for every version change.
- Increment the visible app version whenever user-facing behavior changes.
