// Small-stake quiet-launch sniper for agent-fun/replay/v2 (pump.fun bonding curves).
//
// What the kit's frozen dev window says (1,222 mints, 126,801 trades, 24h of
// pump.fun data, 2-slot fill latency):
//  - Every coin's first trade is a buy and the price jumps off the create price in
//    the first 1-2 slots (about 1.3x by the time any bot can fill), then most coins
//    decay back toward the create price. The big move happens before a bot can buy.
//  - A round trip costs about 4.6% at the minimum 0.01 SOL size: 1.25% curve fees
//    each way plus a flat 105,000-lamport tx fee per order (2.1% of a 0.01 SOL
//    order). Bigger stakes lose more, not less: buying more moves the curve
//    against the bot, so the stake is the guardrail minimum, 0.01 SOL.
//  - Loud launches (big creator buy, many early buyers) spike hardest and crash
//    hardest after a bot fills. The coins that lose least are the quiet ones: a
//    few real buyers, a small creator buy, real SOL already on the curve. So this
//    bot buys only quiet launches, takes a quick +50% when one pops, cuts at -8%,
//    and never holds past 15 slots. On the dev window that is the least-negative
//    of every family tried (momentum -9.38 SOL, reversion -1.64, broad -1.7,
//    pilot sniper defaults -0.14, this bot about -0.05 on the full window).
//  - It is still negative-expectation: 7 of 45 dev coins win, the rest bleed the
//    fee. The prize needs a fresh 6h window to draw unusually well, so the bot
//    is built to lose slowly and meet the guardrails (20+ distinct mints, round
//    trips of at least 0.01 SOL, max drawdown under 50%), not to chase.
//
// Rules (lamports; every comparison in exact bigint math):
//  - One buy per coin, 0.01 SOL, only while the curve holds 2-30 SOL of real
//    reserves, only if the creator bought at most 1 SOL in the create slot, only
//    if at most 3 distinct non-creator buyers have bought, and never after the
//    creator sold or after others have sold more than was bought.
//  - Sell the whole position when its net value (sell proceeds after curve fees,
//    less one tx fee) is >= 150% of its basis (SOL spent plus tx fees paid), or
//    <= 92% of its basis, or 15 slots after the buy filled, or the creator sells
//    after we bought.
//  - Deterministic: a pure function of the batches. No clock, no environment, no
//    randomness, no network, no files. Two runs on the same data produce identical
//    action logs.

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Lamports aimed per coin (also the guardrail's minimum round trip). */
  stakeLamports: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: at most this many lamports. */
  maxDevBuy: number;
  /** Distinct non-creator buyers before entry, at most. */
  maxBuyers: number;
  /** Oldest age (slots since create) at which a first buy may still be decided. */
  maxAge: number;
  /** Exit when the position is worth this much over its cost (bps). */
  tpBps: number;
  /** Exit when it is worth this much under its cost (bps). */
  slBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
}

export const DEFAULT_PARAMS: Params = {
  stakeLamports: 10_000_000,
  minBuyLamports: 10_000_000,
  minRealSol: 2_000_000_000,
  maxRealSol: 30_000_000_000,
  maxDevBuy: 1_000_000_000,
  maxBuyers: 3,
  maxAge: 10,
  tpBps: 5000,
  slBps: 800,
  maxHold: 15,
};

const CURVE_FEE_BPS = 125n; // protocol 95 bps + creator 30 bps, charged on every fill
const MAX_SELL_RATIO_BPS = 10_000n; // skip a coin once others sold more than was bought

/** SOL received for selling `tokens` against virtual reserves (vq, vt), after the 1.25% curve fee. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

interface Tape {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  devBuy: bigint;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  devSold: boolean;
  buysSent: number;
  done: boolean;
  complete: boolean;
}

interface OpenTrade {
  openedSlot: number;
  txPaid: bigint;
  devSoldAtOpen: boolean;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): { onBatch(state: BotState, batch: Batch): OrderInput[] } {
  const P = params;
  const tapes = new Map<Pubkey, Tape>();
  const openTrades = new Map<Pubkey, OpenTrade>();
  const selling = new Set<Pubkey>();

  function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === 'buy') return true;
    }
    return false;
  }

  function hasPendingSell(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === 'sell') return true;
    }
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      // 1. Fold this batch's events into the tapes.
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          tapes.set(e.mint, {
            mint: e.mint,
            createSlot: e.slot,
            creator: e.creator,
            devBuy: 0n,
            buyers: new Set(),
            bought: 0n,
            soldByOthers: 0n,
            devSold: false,
            buysSent: 0,
            done: false,
            complete: false,
          });
        } else if (e.event === 'TradeEvent') {
          const tape = tapes.get(e.mint);
          if (tape === undefined) continue;
          const sol = BigInt(e.sol_amount);
          const isDev = e.user === tape.creator;
          if (e.is_buy) {
            tape.bought += sol;
            if (isDev && e.slot === tape.createSlot) tape.devBuy += sol;
            else if (!isDev) tape.buyers.add(e.user);
          } else if (isDev) {
            tape.devSold = true;
          } else {
            tape.soldByOthers += sol;
          }
        } else {
          const tape = tapes.get(e.mint);
          if (tape !== undefined) {
            tape.complete = true;
            tape.done = true;
          }
        }
      }

      const orders: OrderInput[] = [];
      const maxOrders = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();

      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) {
        marks.set(m.mint, {
          vq: BigInt(m.virtual_quote_reserves),
          vt: BigInt(m.virtual_token_reserves),
        });
      }

      // 2. Fold in the fills that resolved since the last batch.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          openTrades.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        const trade = openTrades.get(f.mint);
        if (f.status !== 'rejected' && trade !== undefined) {
          trade.txPaid += BigInt(f.tx_fee_lamports);
        }
        if (f.side === 'buy' && f.status === 'filled' && trade === undefined) {
          openTrades.set(f.mint, {
            openedSlot: f.slot,
            txPaid: BigInt(f.tx_fee_lamports),
            devSoldAtOpen: tapes.get(f.mint)?.devSold ?? false,
          });
        }
      }
      for (const mint of [...selling]) {
        if (!hasPendingSell(state, mint)) selling.delete(mint);
      }
      for (const mint of [...openTrades.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPendingBuy(state, mint)) {
          openTrades.delete(mint);
        }
      }

      // 3. Exits: take profit, cut losses, age out, or leave when the creator sells.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= maxOrders || selling.has(mint)) continue;
        const tape = tapes.get(mint);
        let trade = openTrades.get(mint);
        if (trade === undefined) {
          trade = { openedSlot: state.slot, txPaid: tx, devSoldAtOpen: tape?.devSold ?? false };
          openTrades.set(mint, trade);
        }
        let mark = marks.get(mint);
        if (mark === undefined) {
          const curve = state.curves.get(mint);
          if (curve === undefined) continue;
          mark = { vq: curve.virtual_quote_reserves, vt: curve.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mark.vq, mark.vt) - tx;
        const basis = pos.cost_lamports + trade.txPaid;
        let exit = false;
        if (basis > 0n) {
          if (value * BPS >= basis * (BPS + BigInt(P.tpBps))) exit = true;
          if (value * BPS <= basis * (BPS - BigInt(P.slBps))) exit = true;
        }
        if (state.slot - trade.openedSlot >= P.maxHold) exit = true;
        if (tape !== undefined && tape.devSold && !trade.devSoldAtOpen) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (tape !== undefined) tape.done = true;
      }

      // 4. Entries: quiet launches only, one minimum-size buy each.
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let open = state.committedPositionCount();
      for (const tape of tapes.values()) {
        if (orders.length >= maxOrders) break;
        if (tape.done || tape.complete) continue;
        const age = state.slot - tape.createSlot;
        if (age > P.maxAge) {
          tape.done = true;
          continue;
        }
        if (tape.buysSent > 0) continue;
        if (open >= state.hello.caps.max_open_positions) continue;
        const curve = state.curves.get(tape.mint);
        if (curve === undefined || curve.complete) continue;
        if (tape.devSold) {
          tape.done = true;
          continue;
        }
        const realSol = curve.real_quote_reserves;
        if (realSol < BigInt(P.minRealSol) || realSol > BigInt(P.maxRealSol)) continue;
        if (tape.devBuy > BigInt(P.maxDevBuy)) {
          tape.done = true;
          continue;
        }
        if (tape.buyers.size > P.maxBuyers) {
          tape.done = true;
          continue;
        }
        if (tape.bought > 0n && tape.soldByOthers * BPS > tape.bought * MAX_SELL_RATIO_BPS) continue;
        const cap = state.maxBuyLamports(tape.mint);
        const stake = BigInt(P.stakeLamports);
        const amount = stake < cap ? stake : cap;
        if (amount < BigInt(P.minBuyLamports)) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint: tape.mint, quote_lamports: amount, max_slippage_bps: 10_000 });
        free -= amount + tx;
        open += 1;
        tape.buysSent = 1;
      }

      return orders;
    },
  };
}
