# 🤖 Polymarket Arbitrage Bot

> Automates the **dump-and-hedge** strategy on Polymarket's 15-minute Up/Down markets (BTC, ETH, SOL, XRP). Runs safely in **simulation mode by default** — no real money at risk until you're ready.

| | |
|--|--|
| **Repository** | [github.com/Pompeiuss/polymarket-arbitrage-trading-bot](https://github.com/Pompeiuss/polymarket-arbitrage-trading-bot) |
| **Markets** | [polymarket.com](https://polymarket.com) |

[![Node.js](https://img.shields.io/badge/Node.js-16+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Pompeiuss%2Fpolymarket--arbitrage--trading--bot-181717?logo=github)](https://github.com/Pompeiuss/polymarket-arbitrage-trading-bot)
[![Polymarket](https://img.shields.io/badge/Polymarket-polymarket.com-5D3FD3)](https://polymarket.com)

---

## 📸 Bot in Action

<p align="center">
  <img src="https://github.com/Pompeiuss/polymarket-arbitrage-trading-bot/blob/main/image/pom.png" alt="Polymarket Arbitrage Bot Terminal" width="100%" />
</p>

*The screenshot above shows the bot running live in a terminal. Here's what you're looking at:*

- **Top section** — The bot has started up and is scanning active 15-minute Up/Down markets on Polymarket (in this case BTC). It fetches the current market via the Gamma API and locks on to it.
- **Price feed rows** — Each line shows a real-time snapshot of the Up and Down orderbook: the current best ask price for each side, and how many minutes/seconds remain in the 15-minute period. Prices update every second.
- **Dump detection** — When one side's ask drops sharply (by the configured threshold), the bot flags it and prepares to execute Leg 1 (the buy-the-dip trade). You can see the bot logging the detected move and the entry price.
- **Hedge monitoring** — After Leg 1 is filled, the bot watches the combined cost of both sides. When `leg1_price + opposite_ask ≤ 0.95`, it executes Leg 2 (the hedge), locking in profit regardless of which direction the market resolves.
- **P&L tracking** — At the bottom, the bot logs per-period profit/loss and running totals. In simulation mode, no real orders are placed — all numbers are hypothetical so you can safely test the strategy.

> 💡 **New to this?** Don't worry. Everything in this README is explained step by step. You don't need to understand all the code to get it running.

---

## 🧠 What Does This Bot Actually Do? (Plain English)

Polymarket has markets where you bet whether BTC (or ETH, SOL, XRP) will be **Up or Down** in the next 15 minutes. Each outcome token costs between $0 and $1, and the winning side pays out $1.

**The key insight:** If you can buy *both* Up and Down for a combined cost of less than $1.00 (say $0.95), you are **guaranteed to profit** — because no matter what happens, one side wins and pays you $1.

The bot automates this:

1. It watches for a sudden price **dump** on one side (e.g. the "Up" token drops sharply).
2. It buys the dumped side cheap (**Leg 1**).
3. It then waits until the *other* side is also cheap enough that the **combined cost ≤ $0.95**.
4. It buys the other side (**Leg 2** — the hedge).
5. At market close, one side pays $1. Since you spent ≤ $0.95 total, you keep the difference as profit.

If the hedge condition is never met (prices don't get cheap enough), the bot has a **stop-loss** that hedges anyway after a max wait time, capping your downside.

---

## ✅ Before You Start — What You Need

| Requirement | Why you need it | Where to get it |
|---|---|---|
| **Node.js 16+** | Runs the bot | [nodejs.org](https://nodejs.org/) |
| **Git** | Downloads the code | [git-scm.com](https://git-scm.com/) |
| **A terminal / command prompt** | To run commands | Built into your OS |
| **A Polygon wallet** (production only) | Holds USDC for trades | MetaMask, Rabby, etc. |
| **USDC on Polygon** (production only) | The money you trade with | Buy on any exchange |
| **A little POL/MATIC** (production only) | Pays gas fees on Polygon | Buy on any exchange |

> 🟢 **For simulation mode (the default), you don't need a wallet, USDC, or any real money.** You can install and run the bot right now just to watch it work.

---

## 🚀 Quick Start (5 Minutes)

### Step 1 — Download the bot

Open your terminal and run:

```bash
git clone https://github.com/Pompeiuss/polymarket-arbitrage-trading-bot.git
cd polymarket-arbitrage-trading-bot
```

> **What this does:** Downloads all the bot's code to a new folder on your computer and moves you into it.

### Step 2 — Install dependencies

```bash
npm install
```

> **What this does:** Installs all the libraries the bot needs to run. This may take a minute. You'll see a lot of text scroll by — that's normal.

### Step 3 — Build the project

```bash
npm run build
```

> **What this does:** Compiles the TypeScript source code into JavaScript that Node.js can run. You only need to do this once (or again after pulling code updates).

### Step 4 — Set up your configuration file

```bash
cp .env.example .env
```

> **What this does:** Creates a `.env` file (your personal settings file) from the provided example. Open this file in any text editor to change settings.

### Step 5 — Run in simulation mode

```bash
npm start
```

That's it! The bot will start monitoring markets and logging what it *would* do — no real money involved.

You should see output like the screenshot above: live price feeds, dump detections, and simulated trade logs.

---

## ⚙️ Configuration Guide

All settings live in your `.env` file. Open it in a text editor and you'll see:

```env
# ── Wallet (only needed for real trades) ────────────────────────────
PRIVATE_KEY=0x...                    # Your wallet private key
PROXY_WALLET_ADDRESS=0x...           # Your Polymarket proxy address
SIGNATURE_TYPE=2                     # 2 = GnosisSafe (Polymarket default)

# ── Which markets to watch ──────────────────────────────────────────
MARKETS=btc                          # Options: btc, eth, sol, xrp (or comma-separated)

# ── Strategy settings ───────────────────────────────────────────────
DUMP_HEDGE_SHARES=10                 # How many shares to buy per leg
DUMP_HEDGE_SUM_TARGET=0.95           # Only hedge when combined cost ≤ this
DUMP_HEDGE_MOVE_THRESHOLD=0.15       # Dump must be at least 15% drop to trigger
DUMP_HEDGE_WINDOW_MINUTES=2          # Only watch for dumps in the first 2 min of each period
DUMP_HEDGE_STOP_LOSS_MAX_WAIT_MINUTES=5   # After 5 min, hedge anyway (stop-loss)
DUMP_HEDGE_STOP_LOSS_PERCENTAGE=0.2  # Stop-loss cap

# ── Mode ────────────────────────────────────────────────────────────
PRODUCTION=false                     # false = simulation, true = real trades
```

### Settings explained for beginners

| Setting | Simple explanation | Recommended starting value |
|---|---|---|
| `MARKETS` | Which crypto's 15m market to trade | `btc` |
| `DUMP_HEDGE_SHARES` | How many tokens to buy per trade leg | `10` (= $10 risk at $1/share) |
| `DUMP_HEDGE_SUM_TARGET` | Only lock in a trade if you can profit at least 5¢ per share | `0.95` |
| `DUMP_HEDGE_MOVE_THRESHOLD` | How big the price drop needs to be to trigger the bot | `0.15` (15%) |
| `DUMP_HEDGE_WINDOW_MINUTES` | Only look for dumps near the start of each 15m period | `2` |
| `DUMP_HEDGE_STOP_LOSS_MAX_WAIT_MINUTES` | How long to wait for a good hedge before cutting losses | `5` |
| `PRODUCTION` | The safety switch — keep `false` until you're confident | `false` |

---

## 🖥️ Running the Bot

| Command | What it does |
|---|---|
| `npm start` | Run in simulation (safe, no real orders) |
| `npm run sim` | Same as above, explicit |
| `npm run prod` | **Real trades** — only use after testing |
| `npm run dev` | Developer mode (runs TypeScript directly) |
| `npm run build` | Recompile after code changes |

> ⚠️ **Always run simulation first.** Watch several full 15-minute periods play out. Make sure the bot behaves as you expect before switching to `PRODUCTION=true`.

---

## 💰 Going Live (Real Trades)

Once you've tested in simulation and are comfortable with how the bot behaves:

### Step 1 — Get your Polymarket proxy wallet address

1. Go to [polymarket.com](https://polymarket.com) and connect your wallet.
2. Your "proxy wallet" address is shown in your profile. It's different from your main wallet address.
3. Copy it — you'll need it for `PROXY_WALLET_ADDRESS` in `.env`.

### Step 2 — Export your wallet's private key

> 🔴 **Security warning:** Never share your private key with anyone. Never commit your `.env` file to GitHub. Use a dedicated wallet with only the funds you're willing to risk.

Export your private key from MetaMask: Settings → Security & Privacy → Export Private Key.

### Step 3 — Fund your wallet

Deposit **USDC on the Polygon network** to your Polymarket proxy wallet. Also keep a small amount of **POL** (formerly MATIC) for gas fees when redeeming winnings.

### Step 4 — Update `.env`

```env
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
PROXY_WALLET_ADDRESS=0xYOUR_PROXY_ADDRESS_HERE
SIGNATURE_TYPE=2
PRODUCTION=true
```

### Step 5 — Run

```bash
npm run prod
```

---

## 🔍 How It Works — Step by Step

```
┌─────────────────────────────────────────────────────────────┐
│                    Every 15-minute period                    │
│                                                              │
│  1. DISCOVER  → Find the current BTC/ETH/SOL/XRP market     │
│                                                              │
│  2. MONITOR   → Poll Up/Down prices every second            │
│                                                              │
│  3. DETECT    → Did one side drop 15%+ in the first 2 min?  │
│                       │                                      │
│                      YES                                     │
│                       ↓                                      │
│  4. LEG 1     → Buy the dumped side (e.g. "Up" at $0.45)   │
│                                                              │
│  5. WAIT      → Watch: leg1_price + opposite_ask ≤ 0.95?    │
│                       │                                      │
│              YES ─────┴───── NO (timeout after 5 min)       │
│               ↓                        ↓                     │
│  6. LEG 2     → Buy the hedge     STOP-LOSS hedge           │
│              (guaranteed profit)   (cap the loss)           │
│                                                              │
│  7. CLOSE     → Market resolves. Redeem winning tokens.      │
│                 Log P&L. Start next period.                  │
└─────────────────────────────────────────────────────────────┘
```

**Example trade (simulation):**

- Bot detects "Up" token dumps from $0.60 → $0.45 in 90 seconds
- Leg 1: buys 10 "Up" tokens @ $0.45 = **$4.50 spent**
- Waits... "Down" token is now $0.48
- Combined: $0.45 + $0.48 = **$0.93 ≤ $0.95** ✅ Hedge condition met!
- Leg 2: buys 10 "Down" tokens @ $0.48 = **$4.80 spent**
- Total cost: $9.30 for 10 share-pairs
- Market resolves: one side wins → **$10.00 payout**
- **Profit: $0.70** (7% return in under 15 minutes)

---

## 🐛 Troubleshooting

### "Bot doesn't find any markets"
- Make sure `MARKETS` is set to one of: `btc`, `eth`, `sol`, `xrp`
- The bot needs internet access to reach Polymarket's API — check your connection
- Try the default API URLs (don't change `GAMMA_API_URL` or `CLOB_API_URL` unless you know why)

### "No dumps detected for a long time"
- This is normal! The strategy only fires when prices move sharply. Quiet markets = no trades.
- You can try lowering `DUMP_HEDGE_MOVE_THRESHOLD` to `0.10` (10%) to trigger more often, but this increases risk.

### "Orders fail in production"
- Double-check your `PRIVATE_KEY` — it must start with `0x` and be the correct wallet
- Make sure you have enough USDC in your Polymarket proxy wallet
- Confirm `PROXY_WALLET_ADDRESS` is your proxy address (from Polymarket profile), not your main wallet

### "Redemption fails"
- You need a small amount of POL/MATIC for gas fees on Polygon
- Redemption only happens after the market is fully resolved — the bot waits for this automatically

### "I see errors about API keys"
- You don't need to manually set `API_KEY`, `API_SECRET`, or `API_PASSPHRASE`
- Leave them blank — the bot derives credentials automatically from your `PRIVATE_KEY`

---

## 📁 Project Structure

```
polymarket-arbitrage-trading-bot/
├── src/
│   ├── main.ts           ← Entry point: starts the bot, loads config
│   ├── config.ts         ← Reads your .env settings into typed variables
│   ├── api.ts            ← Talks to Polymarket's Gamma + CLOB APIs
│   ├── monitor.ts        ← Polls orderbooks every second
│   ├── dumpHedgeTrader.ts← The strategy brain: detects dumps, places trades
│   ├── models.ts         ← TypeScript type definitions
│   └── logger.ts         ← Writes to terminal and history.toml
├── image/                ← Screenshots for this README
├── .env.example          ← Template for your settings (copy to .env)
├── .env                  ← YOUR settings (never commit this!)
├── history.toml          ← Auto-generated trade log
├── package.json          ← Project metadata and scripts
└── tsconfig.json         ← TypeScript compiler settings
```

---

## 🔐 Security Best Practices

- **Never commit `.env`** — it's already in `.gitignore` but double-check before pushing
- **Use a dedicated wallet** — don't use your main wallet; create one just for this bot
- **Start small** — set `DUMP_HEDGE_SHARES=1` for your first real trades to minimize risk
- **Simulate first** — run for several hours in simulation before going live
- **Rotate keys** — if you ever accidentally expose your private key, move funds immediately and generate a new wallet

---

## 🐳 Docker (Optional)

If you prefer running the bot in a container:

```bash
docker build -t polymarket-arbitrage-bot .
docker run --env-file .env -d --name polymarket-arbitrage-bot polymarket-arbitrage-bot
docker logs -f polymarket-arbitrage-bot
```

---

## 🤝 Contributing

Contributions are welcome!

1. Fork [Pompeiuss/polymarket-arbitrage-trading-bot](https://github.com/Pompeiuss/polymarket-arbitrage-trading-bot)
2. Create a feature branch: `git checkout -b feature/MyFeature`
3. Commit your changes: `git commit -m 'Add MyFeature'`
4. Push: `git push origin feature/MyFeature`
5. Open a Pull Request

---

## 🗺️ Roadmap

- [ ] WebSocket orderbook updates for lower latency
- [ ] Backtesting / replay mode for strategy tuning
- [ ] Telegram/Discord trade notifications
- [ ] Support for longer timeframes (e.g. 1h markets)
- [ ] P&L export and reporting

---

## 📜 License

Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

**This software is provided for educational and research purposes only.**

- **No warranty** — provided as-is, without any guarantees
- **Use at your own risk** — you are solely responsible for any losses
- **Not financial advice** — nothing here is investment or trading advice
- **Check local laws** — prediction market trading may be restricted in your region
- **Always test first** — simulate before trading real money

The authors are not responsible for any financial losses arising from use of this software.

---

**Keywords**: Polymarket bot, Polymarket arbitrage bot, Polymarket trading bot, dump and hedge, 15m Up Down, prediction markets, Polygon, CLOB, trading automation — [polymarket.com](https://polymarket.com)
