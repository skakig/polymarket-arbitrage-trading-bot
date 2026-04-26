import express from "express";
import cors from "cors";
import helmet from "helmet";
import { loadConfig } from "./config";
import { PolymarketApi } from "./api";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const config = loadConfig();
const api = new PolymarketApi(config.polymarket);

app.use(helmet());
app.use(cors());
app.use(express.json());

let emergencyStopped = false;

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "polymarket-arbitrage-api",
    mode: config.simulation ? "simulation" : "production",
  });
});

app.get("/status", (_req, res) => {
  res.json({
    mode: config.simulation ? "simulation" : "production",
    emergencyStopped,
    marketsConfigured: config.trading.markets,
    realOrdersEnabled: !config.simulation && !emergencyStopped,
  });
});

app.get("/markets", async (_req, res) => {
  try {
    const assets = config.trading.markets.length
      ? config.trading.markets
      : ["btc", "eth"];

    const period = 900;
    const now = Math.floor(Date.now() / 1000);
    const rounded = Math.floor(now / period) * period;

    const markets = [];

    for (const asset of assets) {
      for (let offset = 0; offset <= 3; offset++) {
        const timestamp = rounded - offset * period;
        const slug = `${asset.toLowerCase()}-updown-15m-${timestamp}`;

        try {
          const market = await api.getMarketBySlug(slug);
          if (market.active && !market.closed) {
            markets.push({
              asset,
              slug,
              conditionId: market.conditionId,
              question: market.question,
              active: market.active,
              closed: market.closed,
              endDateISO: market.endDateISO ?? market.endDateIso,
              tokens: market.tokens,
              clobTokenIds: market.clobTokenIds,
              outcomes: market.outcomes,
            });
            break;
          }
        } catch {
          // Try previous 15-minute slug.
        }
      }
    }

    res.json({
      source: "polymarket",
      refreshedAt: new Date().toISOString(),
      markets,
    });
  } catch (error) {
    res.status(500).json({
      error: "MARKETS_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/orderbook/:tokenId", async (req, res) => {
  try {
    const orderbook = await api.getOrderbook(req.params.tokenId);
    res.json({
      tokenId: req.params.tokenId,
      orderbook,
    });
  } catch (error) {
    res.status(500).json({
      error: "ORDERBOOK_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/balances", (_req, res) => {
  res.status(501).json({
    error: "NOT_IMPLEMENTED",
    message: "Balance lookup is not implemented yet. Keep wallet reads server-side only.",
  });
});

app.post("/start", (_req, res) => {
  emergencyStopped = false;
  res.json({ ok: true, emergencyStopped });
});

app.post("/stop", (_req, res) => {
  emergencyStopped = true;
  res.json({ ok: true, emergencyStopped });
});

app.post("/emergency-stop", (_req, res) => {
  emergencyStopped = true;
  res.json({
    ok: true,
    emergencyStopped,
    message: "Emergency stop enabled.",
  });
});

app.post("/open-hedge", (_req, res) => {
  res.status(501).json({
    error: "NOT_IMPLEMENTED",
    message: "Live hedge execution is intentionally not exposed yet.",
  });
});

app.post("/close-position", (_req, res) => {
  res.status(501).json({
    error: "NOT_IMPLEMENTED",
    message: "Position closing is not implemented yet.",
  });
});

app.listen(port, () => {
  console.log(`Polymarket arbitrage API listening on http://localhost:${port}`);
});
