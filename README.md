# Pump Sprint: 12-Hour Paper Trading Dash — small-stake quiet-launch sniper

[![make.fun · u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)
[![make.fun · rank](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/ichwann12/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/rank.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)
[![make.fun · reward](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/ichwann12/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/reward.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)

A deterministic trading bot for make.fun's "Pump Sprint: 12-Hour Paper Trading Dash" bounty ($10 in USDC). It trades 10 SOL of paper money on a replay of pump.fun bonding-curve events.

## Strategy

A small-stake quiet-launch sniper: one 0.01 SOL buy per coin, only on quiet launches (2–30 SOL of real reserves on the curve, creator bought at most 1 SOL in the create slot, at most 3 distinct non-creator buyers, creator hasn't sold). Sells the whole position at +50%, cuts at −8%, never holds past 15 slots, and leaves at once if the creator sells. Pure function of the replay batches — no clock, no randomness, no network.

## Dev evidence (honest)

On the kit's frozen dev window, part 0 of 3 (50,000 events): net **−0.0193 SOL** over 45 mints / 90 fills, max drawdown 0.26%, 7 of 45 coins won. Full-window estimate about −0.05 SOL. Every family tried on this data loses (momentum −9.38, reversion −1.64, broad −1.7, pilot sniper defaults −0.14 on the same subset); this is the least-negative, because a round trip costs ~4.6% at minimum size and the price has already jumped ~1.3x by the time any bot can fill. The prize needs the fresh 6h final window to draw unusually well.

## Run

The grader runs `node main.ts`. `strategy.ts` holds the bot; `vendor/makefun-bot.ts` is a byte-identical copy of the kit's `sdk/ts/makefun-bot.ts`.
