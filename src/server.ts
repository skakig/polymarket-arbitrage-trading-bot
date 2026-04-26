app.get("/markets", async (req, res) => {
  try {
    const symbols = ["BTC", "ETH"];

    // 🔥 Pull real market list (no guessing)
    const response = await fetch("https://gamma-api.polymarket.com/markets?active=true");
    const data = await response.json();

    const markets = [];

    for (const m of data) {
      const question = (m.question || "").toLowerCase();

      // Filter only BTC/ETH Up/Down markets
      if (!symbols.some(s => question.includes(s.toLowerCase()))) continue;
      if (!question.includes("up") && !question.includes("down")) continue;

      if (!m.tokens || m.tokens.length < 2) continue;

      const yesToken = m.tokens.find((t: any) => /yes|up/i.test(t.outcome));
      const noToken = m.tokens.find((t: any) => /no|down/i.test(t.outcome));

      if (!yesToken || !noToken) continue;

      // Fetch best bid/ask
      const [yesPrice, noPrice] = await Promise.all([
        api.getBestPrice(yesToken.tokenId).catch(() => null),
        api.getBestPrice(noToken.tokenId).catch(() => null),
      ]);

      markets.push({
        id: m.conditionId,
        symbol: symbols.find(s => question.includes(s.toLowerCase())),
        question: m.question,
        resolveAt: Date.parse(m.endDateIso || m.endDateISO),
        spotPrice: null,
        strikePrice: null,
        yesAsk: yesPrice?.ask ?? null,
        yesBid: yesPrice?.bid ?? null,
        noAsk: noPrice?.ask ?? null,
        noBid: noPrice?.bid ?? null,
        liquidity: m.liquidity ?? null,
        volume24h: m.volume ?? null,
        slug: m.slug,
        conditionId: m.conditionId,
        window: "live",
        upTokenId: yesToken.tokenId,
        downTokenId: noToken.tokenId,
      });
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
