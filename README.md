# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ariefmp/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ariefmp/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in a sealed DefiLlama snapshot by the implied value of its future token launch, and shows a concrete farm plan for each one.

## Get it on Agensi

**Pre-Token Launch Radar** is now live on [Agensi](https://www.agensi.io/skills/pre-token-launch-radar) — **$5 one-time**. The packaged skill for AI agents: rank pre-token DeFi protocols by implied launch value and get a 7-step farm plan for any protocol you pick.

## Model radar-4

```
implied value = TVL × 0.30 × growth × maturity × breadth × category × dominance × data quality
```

- **Base:** TVL × 0.30, the launch multiple applied to the value already locked in.
- **Growth:** 7-day TVL change clamped to −80%…+200%, raised to the power 0.8 — gentle near zero, sharp at the extremes.
- **Maturity:** 0.4 + 0.6 × √(min(age, 1460 days) / 1460) — the first year with no token is the strongest signal; later years add less.
- **Breadth:** 1 + 0.04 per extra chain, up to 6 extra.
- **Category:** ×1.12 for token-native models (lending, exchanges, derivatives, yield, RWA and the like), ×0.88 for models that rarely carry a token (chains, stablecoin issuers, token lockers, BTC wrappers), ×1.00 for the rest.
- **Dominance:** ×1.10 for the largest pre-token protocol in its category by TVL (in a category of three or more ranked protocols), ×1.05 for 2nd and 3rd, ×1.00 otherwise; the leader of a two-protocol category takes ×1.05 and a lone protocol ×1.00 — leadership means beating peers, and with no peers there is no signal.
- **Data quality:** ×0.95 when the 7-day change is missing, ×0.95 when the listing date is missing — a protocol the snapshot cannot measure is worth less than one it can, because its growth and maturity are guesses.
- **Stale:** a further ×0.90 when a protocol is over two years old and still shrinking more than 10% in 7 days.
- **Farm plans:** every step's gas is priced for the protocol's own first chain — a transaction on Ethereum costs far more than one on a cheap L2 or on Solana — instead of one flat figure for every chain.

No protocol name is ever special-cased. A protocol is said to *record no token*, never that it has none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=qh9fnnyy&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
