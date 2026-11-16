// Token Radar model (radar-3): one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank: the whole
// watchlist (the floor, never the ceiling) plus every other pre-token protocol
// below the floor that is not an exchange and not a versioned pool. Live-token
// protocols are kept apart and shown with the market's own values, never mixed
// into the ranked board.
//
// Implied value is this entry's own claim, derived only from the snapshot's
// own figures for each protocol:
//
//   base      = tvl_usd x 0.30                      (FDV/TVL multiple)
//   growth    = clamp(change_7d, -80, 200) per cent
//   growth x  = (1 + growth / 100) ^ 0.8            (power curve: gentle near
//               zero, sharp at the extremes — a protocol compounding hard is
//               worth much more, one collapsing is worth much less)
//   age       = days from listed_at to as_of (unknown: 365)
//   maturity x= 0.4 + 0.6 x sqrt(min(age, 1460) / 1460)
//               (concave: the first year with no token is the strongest
//               signal; later years add less)
//   breadth x = 1 + 0.04 x min(chains - 1, 6)
//   category x= 1.12 for token-native business models (lending, exchanges,
//               derivatives, yield, RWA, prediction markets and the like),
//               0.88 for models that rarely carry a token (chains, stablecoin
//               issuers, token lockers, BTC wrappers and the like), 1.00 else
//   stale x   = 0.90 when the protocol is over two years old AND still
//               shrinking more than 10% in 7 days — an old protocol bleeding
//               TVL has likely missed its launch window; 1.00 otherwise
//   implied   = max(1, round(base x growth x maturity x breadth x category
//               x stale))
//
// No protocol name is ever special-cased: the same function scores every row.
// A protocol is said to record no token, never that it has none: DefiLlama's
// record is not proof, and a protocol on the list may still carry a token its
// record does not name.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_floor: number;
  growth_cap: number;
  growth_exponent: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  category_native: number;
  category_unlikely: number;
  stale_age_days: number;
  stale_growth_pct: number;
  stale_multiplier: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_floor: -80,
  growth_cap: 200,
  growth_exponent: 0.8,
  maturity_floor: 0.4,
  maturity_range: 0.6,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_chains: 6,
  category_native: 1.12,
  category_unlikely: 0.88,
  stale_age_days: 730,
  stale_growth_pct: -10,
  stale_multiplier: 0.9,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    category_multiplier: number;
    category_group: 'native' | 'neutral' | 'unlikely';
    stale_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard reads it: the board row, whole. */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocols_total: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Categories whose business model is token-native: the protocol's own token is
 * the product's natural funding and governance vehicle, so a launch is more
 * likely and worth more.
 */
const CATEGORY_NATIVE = new Set([
  'AI Agents',
  'Basis Trading',
  'CDP',
  'CDP Manager',
  'Collateral Management',
  'Collateral Markets',
  'Decentralized AI',
  'Derivatives',
  'Dexs',
  'Farm',
  'Interest Rate Derivatives',
  'Launchpad',
  'Lending',
  'Leveraged Farming',
  'Liquidity Manager',
  'Onchain Capital Allocator',
  'Options',
  'Options Vault',
  'Prediction Market',
  'Restaking',
  'Risk Curators',
  'RWA',
  'Staking Pool',
  'Synthetics',
  'Uncollateralized Lending',
  'Yield',
  'Yield Aggregator',
]);

/**
 * Categories whose business model rarely carries a token: the product is the
 * chain, the stablecoin or the wrapper itself, so a launch is less likely and
 * worth less when it comes.
 */
const CATEGORY_UNLIKELY = new Set([
  'Algo-Stables',
  'Anchor BTC',
  'Chain',
  'DOR',
  'Decentralized BTC',
  'Dual-Token Stablecoin',
  'Governance Incentives',
  'NFT Marketplace',
  'Payments',
  'Privacy',
  'Reserve Currency',
  'Stablecoin Issuer',
  'Stablecoin Wrapper',
  'Token Locker',
]);

/** Which of the three category groups a protocol's category falls in. */
export function categoryGroup(category: string | null): 'native' | 'neutral' | 'unlikely' {
  if (category !== null && CATEGORY_NATIVE.has(category)) return 'native';
  if (category !== null && CATEGORY_UNLIKELY.has(category)) return 'unlikely';
  return 'neutral';
}

/** The category multiplier for a group, from the model's constants. */
function categoryMultiplier(group: 'native' | 'neutral' | 'unlikely', model: ModelConstants): number {
  if (group === 'native') return model.category_native;
  if (group === 'unlikely') return model.category_unlikely;
  return 1;
}

/** The six multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  categoryMult: number;
  categoryGroup: 'native' | 'neutral' | 'unlikely';
  staleMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.pow(1 + growthPct / 100, model.growth_exponent);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) *
      model.maturity_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max_chains));
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const group = categoryGroup(protocol.category);
  const categoryMult = categoryMultiplier(group, model);
  const stale =
    age !== null && age > model.stale_age_days && growthPct < model.stale_growth_pct;
  const staleMult = stale ? model.stale_multiplier : 1;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(
    1,
    Math.round(base * growthMult * maturityMult * breadthMult * categoryMult * staleMult),
  );
  return { implied, base: Math.round(base), growthPct, growthMult, maturityMult, breadthMult, categoryMult, categoryGroup: group, staleMult, age };
}

/** A name ending in a release marker is a pool of another protocol, not its own launch. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist's rule leaves out: a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades. This mirrors the
 * watchlist's own rule on every signal the snapshot carries (category and
 * name); the snapshot carries no parentProtocol field, so a protocol the
 * watchlist leaves out for its parent alone is the one screen this cannot run.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort(
    (a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_usd: s.v.base,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      category_multiplier: round4(s.v.categoryMult),
      category_group: s.v.categoryGroup,
      stale_multiplier: round4(s.v.staleMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One step as a single string: action, cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 300;
  if (p.tvl_usd >= 500_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Lend $${capital} of USDC on ${name} (${chain}) and leave the loan open.`;
  if (c.includes('dex'))
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} with ${name}, then put the bridged funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and hold the receipt token.`;
  if (c.includes('derivative') || c.includes('perpetual'))
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('yield'))
    return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and leave it earning.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('prediction'))
    return `Fund $${capital} and take one position in an open market on ${name}.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of stablecoins through ${name} on ${chain}.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline where nobody else can read it.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 200 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week, a deposit, a borrow, a swap or a vote, so the wallet shows steady use instead of one burst.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, check the protocol's own points or rewards page from the link it publishes, and claim only there, never pay a fee to claim.`,
      cost: 'free to check, never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it in stages.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocols_total: snapshot.protocols.length,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (
    board.length >= 2 &&
    board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd
  ) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
