# Dip-and-turn BTC trading bot

Entry for make.fun bounty [btc-race-24h-20261113-2314](https://make.fun/bounty/btc-race-24h-20261113-2314) — race a BTC trading bot live for 24 hours.

Trades Coinbase Wrapped BTC (cbBTC) vs USDC, long only, $1,000 paper, on 1-minute bars (`agent-fun/bars-replay/v1`, `main.py`, Python 3.13 stdlib only).

**Method:** buy when the close is ≥2.00% below its rolling 240-minute high *and* the 5-minute return has turned positive (dip is over, price already recovering); full size. Exit at +0.80% take-profit over the entry close, or a 2.50% trailing stop below the peak close since entry. No new entries in the last hour, force-exit in the last 10 minutes, $30 daily loss brake.

**Why:** 1-minute BTC noise (~8 bps) is far below the ~26 bps round-trip cost, so fast momentum / EMA-cross bots whipsaw to death on the dev window (EMA-cross baseline ≈ −$109, buy-and-hold ≈ −$53 on a −4.9% window). The durable edge is the multi-hour dip-and-recovery.

**Dev-window result** (local replay with the harness's exact fill math): net PnL **+$14.89**, 3 round trips, 6 fills, max drawdown −2.2%. Neighbouring parameters (dip 200–225 bps, TP 60–90 bps, trail 250–300 bps) all stay positive (+$6 to +$15).
