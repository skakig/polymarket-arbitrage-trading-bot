import express from "express";
import cors from "cors";
import helmet from "helmet";
import { loadConfig } from "./config";
import { PolymarketApi } from "./api";
import type { Market, Token, TokenPrice } from "./models";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const config = loadConfig();
const api = new PolymarketApi(config.polymarket);

app.use(helmet());
app.use(cors());
app.use(express.json());

let emergencyStopped = false;

type NormalizedMarket = {
  id: string;
  symbol: string;
  question?: string;
  resolveAt: number;
  spotPrice: number | null;
  strikePrice?: number | null;
  yesAsk: number | null;
  yesBid: number | null;
  noAsk: number | null;
  noBid: number | null;
  liquidity?: number | null;
  volume24h?: number | null;
  slug: string;
  conditionId: string;
  window: string;
  upTokenId?: string;
  downTokenId?: string;
};

function parseSymbols(input: unknown): string[] {
  if (typeof input !== "string" || input.trim().length === 0) {
    return config.trading.markets.length
      ? config.trading.markets.map((m) => m.toUpperCase())
      : ["BTC", "ETH"];
  }

  return input
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function parseWindow(input: unknown): "15m" | "1h" | "1d" {
  return input === "1h" || input === "1d" ? input : "15m";
}

function getPeriodSeconds(window: "15m" | "1h" | "1d"): number {
  if (window === "1h") return 60 * 60;
  if (window === "1d") return 24 * 60 * 60;
  return 15 * 60;
}

function getSlug(symbol: string, window: "15m" | "1h" | "1d", timestamp: number): string {
  const lower = symbol.toLowerCase();
  if (window === "15m") return `${lower}-updown-15m-${timestamp}`;
  return `${lower}-up-or-down-${window}-${timestamp}`;
}

function getResolveAtFromMarket(market: Market, fallbackTimestamp: number, window: "15m" | "1h" | "1d"): number {
  const dateValue = market.endDateISO ?? market.endDateIso;
  if (dateValue) {
    const parsed = Date.parse(dateValue);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return (fallbackTimestamp + getPeriodSeconds(window)) * 1000;
}

function parseTokenIds(market: Market): { upToken?: Token; downToken?: Token; upTokenId?: string; downTokenId?: string } {
  if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
    const upToken = market.tokens.find((t) => /up|yes/i.test(t.outcome)) ?? market.tokens[0];
    const downToken = market.tokens.find((t) => /down|no/i.test(t.outcome)) ?? market.tokens[1];
    return { upToken, downToken, upTokenId: upToken?.tokenId, downTokenId: downToken?.tokenId };
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

async function getBestPrices(tokenId?: string): Promise<TokenPrice | null> {
  if (!tokenId) return null;
  try {
    return await api.getBestPrice(tokenId);
  } catch {
    return null;
  }
}

async function discoverMarketForSymbol(symbol: string, window: "15m" | "1h" | "1d"): Promise<{ market: Market; timestamp: number } | null> {
  const supported = new Set(["BTC", "ETH", "SOL", "XRP"]);
  if (!supported.has(symbol)) return null;

  const period = getPeriodSeconds(window);
  const now = Math.floor(Date.now() / 1000);
  const rounded = Math.floor(now / period) * period;

  for (let offset = 0; offset <= 4; offset++) {
    const timestamp = rounded - offset * period;
    const slug = getSlug(symbol, window, timestamp);

    try {
      const market = await api.getMarketBySlug(slug);
      if (market.active && !market.closed) return { market, timestamp };
    } catch {
      // Try previous likely slug.
    }
  }

  return null;
}

async function normalizeMarket(symbol: string, window: "15m" | "1h" | "1d", market: Market, timestamp: number): Promise<NormalizedMarket> {
  const { upTokenId, downTokenId } = parseTokenIds(market);
  const [up, down] = await Promise.all([getBestPrices(upTokenId), getBestPrices(downTokenId)]);

  return {
    id: market.conditionId,
    symbol,
    question: market.question,
    resolveAt: getResolveAtFromMarket(market, timestamp, window),
    spotPrice: null,
    strikePrice: null,
    yesAsk: up?.ask ?? null,
    yesBid: up?.bid ?? null,
    noAsk: down?.ask ?? null,
    noBid: down?.bid ?? null,
    liquidity: null,
    volume24h: null,
    slug: market.slug,
    conditionId: market.conditionId,
    window,
    upTokenId,
    downTokenId,
  };
}

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

app.get("/markets", async (req, res) => {
  try {
    const symbols = parseSymbols(req.query.symbols);
    const window = parseWindow(req.query.window);
    const markets: NormalizedMarket[] = [];

    for (const symbol of symbols) {
      const discovered = await discoverMarketForSymbol(symbol, window);
      if (!discovered) continue;
      markets.push(await normalizeMarket(symbol, window, discovered.market, discovered.timestamp));
    }

    res.json({
      source: "polymarket",
      window,
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
