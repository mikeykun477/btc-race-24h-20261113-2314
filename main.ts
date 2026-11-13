// Dip-and-turn BTC scalper for make.fun bounty btc-race-24h-20261113-2314.
//
// Trades Coinbase Wrapped BTC (CBBTC) against USDC, long only, $1,000 paper,
// one position at a time, full size, on 1-minute bars (agent-fun/bars-replay/v1).
//
// Method (tuned and verified on the kit's frozen 24h dev window, 1,440 bars):
//   * BTC's 1-minute noise (sigma ~8 bps) is far below the ~26 bps round-trip
//     cost, so fast momentum / EMA-cross bots whipsaw themselves to death on
//     this window (the kit's EMA-cross baseline loses ~$109, buy-and-hold ~$53
//     on a window that falls -4.9%). The only durable edge is the multi-hour
//     dip-and-recovery: after a steep drop, BTC bounces ~1% within hours.
//   * Entry: the close is >= 2.00% below its rolling 240-minute high AND the
//     5-minute return has turned positive (the dip is over and price is
//     already recovering -- entering mid-plunge loses; the turn filter is what
//     makes the entries work). Buy 100% of cash.
//   * Exit: take profit at +0.80% over the entry close, or a trailing stop
//     2.50% below the peak close since entry (which also caps a straight
//     further fall at -2.50% from entry). No new entries in the last hour of
//     the window; force-exit any position in the last 10 minutes so the
//     window-end flatten never catches us. Daily loss brake: stop entering
//     once realised losses reach $30.
//   * Deterministic, standard library only, no network, no wall clock: every
//     decision is a pure function of the bars seen so far. Uses the kit's
//     TypeScript SDK shim (vendor/makefun-bars.ts, byte-identical to the kit's).
//
// Dev-window result (official local grade, `node cli/makefun.mjs grade-local
// --driver process`): net PnL +$14.89 on 3 round trips, max drawdown -2.2%,
// 6 filled orders. Neighbouring parameters (dip 200-225 bps, TP 60-90 bps,
// trail 250-300 bps) all stay positive (+$6 to +$15), so the result is a
// plateau, not a single tuned point.

import { BPS, runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters (bps unless noted).
const LOOKBACK_BARS = 240; // rolling-high window (minutes)
const DIP_BPS = 200; // entry: close this far below the rolling high
const TURN_BARS = 5; // entry confirmation: 5-minute return positive
const TAKE_PROFIT_BPS = 80; // exit: this far above the entry close
const TRAIL_BPS = 250; // exit: trailing stop below the peak close
const MAX_SLIPPAGE_BPS = 100; // cap on every order (1% past the latest close)
const NO_ENTRY_AFTER_MIN = 1380; // no new entries in the last 60 minutes
const FORCE_EXIT_AFTER_MIN = 1430; // force-exit in the last 10 minutes
const REENTRY_COOLDOWN_BARS = 30; // wait 30 bars after an exit before re-entering:
// the dip that just paid (or stopped) out is usually still falling, and the
// D=175 variant of this bot lost money exactly by re-entering 1 bar after an
// exit into a price that never recovered before the window ended.
const DAILY_LOSS_BRAKE = 30_000_000n; // stop entering after $30 realised loss
const MIN_NOTIONAL = 1_000_000n; // $1, the harness's minimum buy

const closes: number[] = [];
const times: number[] = [];
let entryClose: number | null = null;
let peakClose: number | null = null;
let lastExitSeq = -1000000; // seq of the bar the last exit was decided on
let realised = 0n; // realised PnL in quote units (fills only)
let lastCost = 0n; // notional of the position just exited (for PnL)

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    closes.push(close);
    times.push(batch.t);

    // Track realised PnL from the fills this batch carried.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        lastCost = BigInt(fill.notional_quote_units);
      } else {
        realised += BigInt(fill.notional_quote_units) - BigInt(fill.fee_quote_units) - lastCost;
        lastCost = 0n;
      }
    }

    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;
    const elapsedMin = Math.floor((batch.t - times[0]) / 60000);

    if (qty > 0n) {
      if (entryClose === null) {
        entryClose = close;
        peakClose = close;
      }
      peakClose = Math.max(peakClose as number, close);
      const sell = (side: 'sell'): OrderInput[] => {
        lastExitSeq = batch.seq;
        return [{ side, symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      };
      if (elapsedMin >= FORCE_EXIT_AFTER_MIN) return sell('sell');
      if (close * 10000 <= (peakClose as number) * (10000 - TRAIL_BPS)) return sell('sell');
      if (close * 10000 >= (entryClose as number) * (10000 + TAKE_PROFIT_BPS)) return sell('sell');
      return [];
    }

    // Flat: reset entry tracking and look for a dip-and-turn.
    entryClose = null;
    peakClose = null;
    if (realised <= -DAILY_LOSS_BRAKE) return [];
    if (elapsedMin >= NO_ENTRY_AFTER_MIN) return [];
    if (batch.seq - lastExitSeq < REENTRY_COOLDOWN_BARS) return [];
    if (closes.length <= LOOKBACK_BARS) return [];
    const high = Math.max(...closes.slice(-LOOKBACK_BARS));
    if (close * 10000 > high * (10000 - DIP_BPS)) return [];
    if (closes.length <= TURN_BARS) return [];
    if (close <= closes[closes.length - 1 - TURN_BARS]) return []; // no turn yet
    if (state.cash < MIN_NOTIONAL) return [];
    entryClose = close;
    peakClose = close;
    return [
      {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  },
});
