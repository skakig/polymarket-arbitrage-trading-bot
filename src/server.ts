import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { loadConfig } from "./config";
import { PolymarketApi } from "./api";
import type { Market, TokenPrice } from "./models";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const config = loadConfig();
const api = new PolymarketApi(config.polymarket);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "1mb" }));

type ApiMarket = {
  asset: string;
  marketName: string;
  conditionId: string;
  slug: string;
  question: string;
  active: boolean;
  closed: boolean;
  endDateISO?: string;
  upTokenId?: string;
  downTokenId?: string;
  up?: TokenPrice | null;
  down?: TokenPrice | null;
  combinedAsk?: number | null;
};

let emergencyStopped = false;
let cachedMarkets: ApiMarket[] = [];
let lastRefreshAt: string | null = null;
let lastRefreshError: string | null = null;

function parseTokenIds(market: Market): { upTokenId?: string; downTokenId?: string } {
  if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
    const up = market.tokens.find((t) => /up|yes/i.test(t.outcome)) ?? market.tokens[0];
    const down = market.tokens.find((t) => /down|no/i.test(t.outcome)) ?? market.tokens[1];
    return { upTokenId: up?.tokenId, downTokenId: down?.tokenId };
  }

  if (market.clobTokenIds) {
    try {
      const parsed = JSON.parse(market.clobTokenIds) as string[];
      return { upTokenId: parsed[0], downTokenId: parsed[1] };
    } catch {
      const parts = market.clobTokenIds.split(",").map((p) => p.trim()).filter(Boolean);
      return { upTokenId: parts[0], downTokenId: parts[1] };
    }
  }

  return {};
}

async function discoverMarketForAsset(asset: string): Promise<Market | null> {
  const assetLower = asset.toLowerCase();
  const supported = new Set(["btc", "eth", "sol", "xrp"]);
  if (!supported.has(assetLower)) return null;

  const periodDurationSecs = 900;
  const now = Math.floor(Date.now() / 1000);
  const roundedTime = Math.floor(now / periodDurationSecs) * periodDurationSecs;

  for (let offset = 0; offset <= 3; offset++) {
    const timestamp = roundedTime - offset * periodDurationSecs;
    const slug = `${assetLower}-updown-15m-${timestamp}`;
    try {
      const market = await api.getMarketBySlug(slug);
      if (market.active && !market.closed) return market;
    } catch {
      // Try the next likely 15m slug.
    }
  }

  return null;
}

async function enrichMarket(asset: string, market: Market): Promise<ApiMarket> {
  const { upTokenId, downTokenId } = parseTokenIds(market);
  const [up, down] = await Promise.all([
    upTokenId ? api.getBestPrice(upTokenId).catch(() => null) : Promise.resolve(null),
    downTokenId ? api.getBestPrice(downTokenId).catch(() => null) : Promise.resolve(null),
  ]);
  const combinedAsk = up?.ask != null && down?.ask != null ? up.ask + down.ask : null;

  return {
    asset,
    marketName: `${asset.toUpperCase()} 15m`,
    conditionId: market.conditionId,
    slug: market.slug,
    question: market.question,
    active: market.active,
    closed: market.closed,
    endDateISO: market.endDateISO ?? market.endDateIso,
    upTokenId,
    downTokenId,
    up,
    down,
    combinedAsk,
  };
}

async function refreshMarkets(): Promise<ApiMarket[]> {
  const assets = config.trading.markets.length > 0 ? config.trading.markets : ["btc", "eth"];
  const discovered: ApiMarket[] = [];

  for (const asset of assets) {
    const market = await discoverMarketForAsset(asset);
    if (!market) continue;
    discovered.push(await enrichMarket(asset, market));
  }

  cachedMarkets = discovered;
  lastRefreshAt = new Date().toISOString();
  lastRefreshError = null;
  return discovered;
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "polymarket-arbitrage-api", mode: config.simulation ? "simulation" : "production" });
});

app.get("/status", (_req, res) => {
  res.json({
    mode: config.simulation ? "simulation" : "production",
    emergencyStopped,
    marketsConfigured: config.trading.markets,
    lastRefreshAt,
    lastRefreshError,
    cachedMarketCount: cachedMarkets.length,
    realOrdersEnabled: !config.simulation && !emergencyStopped,
  });
});

app.get("/markets", asyncHandler(async (_req, res) => {
  const markets = await refreshMarkets();
  res.json({ markets, source: "polymarket", refreshedAt: lastRefreshAt });
}));

app.get("/orderbook/:tokenId", asyncHandler(async (req, res) => {
  const tokenId = req.params.tokenId;
  const orderbook = await api.getOrderbook(tokenId);
  res.json({ tokenId, orderbook });
}));

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
  res.json({ ok: true, emergencyStopped, message: "Emergency stop enabled. Execution endpoints are blocked." });
});

app.post("/open-hedge", (_req, res) => {
  res.status(501).json({
    error: "NOT_IMPLEMENTED",
    message: "Live hedge execution is intentionally not exposed yet. Wire this to DumpHedgeTrader only after risk controls are complete.",
  });
});

app.post("/close-position", (_req, res) => {
  res.status(501).json({
    error: "NOT_IMPLEMENTED",
    message: "Position closing is not implemented yet.",
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  lastRefreshError = message;
  res.status(500).json({ error: "INTERNAL_ERROR", message });
});

app.listen(port, () => {
  console.error(`Polymarket arbitrage API listening on http://localhost:${port}`);
});
