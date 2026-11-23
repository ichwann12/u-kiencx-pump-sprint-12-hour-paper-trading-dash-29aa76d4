// Pump Sprint: 12-Hour Paper Trading Dash — small-stake quiet-launch sniper.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts,
// the protocol in the vendored SDK shim (vendor/makefun-bot.ts, a byte-identical
// copy of the kit's sdk/ts/makefun-bot.ts).
//
// Dev evidence on the kit's frozen window (part 0 of 3, 50,000 events): net
// -0.0193 SOL over 45 mints / 90 fills, max drawdown 0.26%, deterministic
// (two runs byte-identical). Full-window estimate about -0.05 SOL. Still
// negative-expectation — see strategy.ts for the honest numbers.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
