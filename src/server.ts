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

type WindowParam = "15m" | "1h" | "1d";

type GammaMarket = Market & {
  conditionId?: string;
  condition_id?: string;
  endDateISO?: string;
  endDateIso?: string;
  end_date_iso?: string;
  clobTokenIds?: string;
  clob_token_ids?: string;
  volume?: string | number | null;
  volume24hr?: string | number | null;
  liquidity?: string | number | null;
};

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
  window: WindowParam;
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

function parseWindow(input: unknown): WindowParam {
  return input === "1h" || input === "1d" ? input : "15m";
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getConditionId(market: GammaMarket): string {
  return String(market.conditionId ?? market.condition_id ?? "");
}

function getResolveAt(market: GammaMarket): number {
  const dateValue = market.endDateISO ?? market.endDateIso ?? market.end_date_iso;
  if (!dateValue) return Date.now();
  const parsed = Date.parse(dateValue);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function inferSymbol(market: GammaMarket, symbols: string[]): string | null {
  const haystack = `${market.question ?? ""} ${market.slug ?? ""}`.toLowerCase();
  return symbols.find((symbol) => haystack.includes(symbol.toLowerCase())) ?? null;
}

function isLikelyWindow(market: GammaMarket, window: WindowParam): boolean {
  const haystack = `${market.question ?? ""} ${market.slug ?? ""}`.toLowerCase();
  if (window === "15m") return haystack.includes("15m") || haystack.includes("15-min") || haystack.includes("15 minute");
  if (window === "1h") return haystack.includes("1h") || haystack.includes("hour");
  return haystack.includes("1d") || haystack.includes("daily") || haystack.includes("day");
}

function isUpDownMarket(market: GammaMarket): boolean {
  const haystack = `${market.question ?? ""} ${market.slug ?? ""}`.toLowerCase();
  return haystack.includes("up") && haystack.includes("down");
}

function parseTokenIds(market: GammaMarket): { upToken?: Token; downToken?: Token; upTokenId?: string; downTokenId?: string } {
  if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
    const upToken = market.tokens.find((t) => /up|yes/i.test(t.outcome)) ?? market.tokens[0];
    const downToken = market.tokens.find((t) => /down|no/i.test(t.outcome)) ?? market.tokens[1];
    return { upToken, downToken, upTokenId: upToken?.tokenId, downTokenId: downToken?.tokenId };
  }

  const clobTokenIds = market.clobTokenIds ?? market.clob_token_ids;
  if (clobTokenIds) {
    try {
      const parsed = JSON.parse(clobTokenIds) as string[];
      return { upTokenId: parsed[0], downTokenId: parsed[1] };
    } catch {
      const parts = String(clobTokenIds).split(",").map((p) => p.trim()).filter(Boolean);
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

async function fetchGammaMarkets(): Promise<GammaMarket[]> {
  const url = `${config.polymarket.gammaApiUrl}/markets?active=true&closed=false&limit=500`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gamma markets request failed: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? (data as GammaMarket[]) : [];
}

async function normalizeMarket(market: GammaMarket, symbol: string, window: WindowParam): Promise<NormalizedMarket | null> {
  const conditionId = getConditionId(market);
  if (!conditionId) return null;

  const { upTokenId, downTokenId } = parseTokenIds(market);
  const [up, down] = await Promise.all([getBestPrices(upTokenId), getBestPrices(downTokenId)]);

  return {
    id: conditionId,
    symbol,
    question: market.question,
    resolveAt: getResolveAt(market),
    spotPrice: null,
    strikePrice: null,
    yesAsk: up?.ask ?? null,
    yesBid: up?.bid ?? null,
    noAsk: down?.ask ?? null,
    noBid: down?.bid ?? null,
    liquidity: toNumber(market.liquidity),
    volume24h: toNumber(market.volume24hr ?? market.volume),
    slug: market.slug,
    conditionId,
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
    const gammaMarkets = await fetchGammaMarkets();
    const markets: NormalizedMarket[] = [];

    for (const rawMarket of gammaMarkets) {
      if (!rawMarket.active || rawMarket.closed) continue;
      if (!isUpDownMarket(rawMarket)) continue;
      if (!isLikelyWindow(rawMarket, window)) continue;

      const symbol = inferSymbol(rawMarket, symbols);
      if (!symbol) continue;

      const normalized = await normalizeMarket(rawMarket, symbol, window);
      if (normalized) markets.push(normalized);
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
