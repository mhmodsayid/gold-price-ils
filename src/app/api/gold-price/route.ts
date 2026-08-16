import { NextResponse } from "next/server";

interface YahooChartResult {
  meta: { regularMarketPrice: number };
  timestamp?: number[];
  indicators: { quote: [{ close: (number | null)[] }] };
}

export interface GoldIlsChartPoint {
  t: number;
  v: number;
}

type YahooRange = "1d" | "5d" | "1mo" | "1y";
type YahooInterval = "15m" | "1d";

async function fetchYahooChart(
  symbol: string,
  range: YahooRange,
  interval: YahooInterval,
  fresh = false,
): Promise<{ current: number; points: GoldIlsChartPoint[] }> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`,
    fresh
      ? { cache: "no-store" }
      : { next: { revalidate: range === "1d" ? 300 : 3600 } },
  );
  if (!res.ok) throw new Error(`Yahoo Finance failed for ${symbol}: ${res.status}`);
  const data = await res.json();
  const result: YahooChartResult = data.chart.result[0];
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators.quote[0].close;
  const points: GoldIlsChartPoint[] = [];
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i];
    if (v !== null && v > 0) {
      points.push({ t: (timestamps[i] ?? 0) * 1000, v });
    }
  }
  return { current: result.meta.regularMarketPrice, points };
}

type SpotSource = "gold-api.com" | "swissquote" | "tradingview";

interface SpotQuote {
  price: number;
  source: SpotSource;
}

function isSaneGoldUsd(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 1000 && n < 20000;
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

/** Live XAU/USD from gold-api.com (no key). */
async function fetchSpotFromGoldApi(): Promise<SpotQuote> {
  const data = (await fetchJson("https://api.gold-api.com/price/XAU")) as {
    price?: number;
  };
  if (!isSaneGoldUsd(data.price)) throw new Error("gold-api.com returned invalid gold price");
  return { price: data.price, source: "gold-api.com" };
}

/** Live XAU/USD mid from Swissquote public FX quotes. */
async function fetchSpotFromSwissquote(): Promise<SpotQuote> {
  const data = (await fetchJson(
    "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD",
  )) as Array<{ spreadProfilePrices?: Array<{ bid: number; ask: number }> }>;
  for (const row of data) {
    const p = row.spreadProfilePrices?.[0];
    if (p && isSaneGoldUsd(p.bid) && isSaneGoldUsd(p.ask)) {
      return { price: (p.bid + p.ask) / 2, source: "swissquote" };
    }
  }
  throw new Error("Swissquote returned no XAU/USD quote");
}

/** Last-resort spot via TradingView TVC:GOLD. */
async function fetchSpotFromTradingView(): Promise<SpotQuote> {
  const data = (await fetchJson(
    "https://scanner.tradingview.com/symbol?symbol=TVC:GOLD&fields=close,description,type",
  )) as { close?: number };
  if (!isSaneGoldUsd(data.close)) {
    throw new Error("TradingView returned invalid gold price");
  }
  return { price: data.close, source: "tradingview" };
}

/** Live spot gold (USD/oz). Yahoo GC=F is a futures contract, not spot. */
async function fetchSpotGoldUSD(): Promise<SpotQuote> {
  const sources = [fetchSpotFromGoldApi, fetchSpotFromSwissquote, fetchSpotFromTradingView];
  const errors: string[] = [];
  for (const fetchSpot of sources) {
    try {
      return await fetchSpot();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`All spot gold sources failed: ${errors.join("; ")}`);
}

function percentile(current: number, values: number[]): number {
  if (values.length === 0) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < current).length;
  const equal = sorted.filter((v) => v === current).length;
  return ((below + equal * 0.5) / sorted.length) * 100;
}

function toSignal(pct: number): "low" | "mid" | "high" | "very_high" {
  if (pct < 25) return "low";
  if (pct < 50) return "mid";
  if (pct < 75) return "high";
  return "very_high";
}

function toIlsSignal(pct: number): "strong" | "mid" | "weak" | "very_weak" {
  if (pct < 25) return "strong";
  if (pct < 50) return "mid";
  if (pct < 75) return "weak";
  return "very_weak";
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  const recent = values.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcMACD(values: number[]): { macd: number; signal: number } | null {
  if (values.length < 35) return null;
  const ema = (data: number[], p: number) => {
    const k = 2 / (p + 1);
    let prev = data.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < data.length; i++) prev = data[i] * k + prev * (1 - k);
    return prev;
  };
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = ema12 - ema26;
  const macdHistory: number[] = [];
  const k12 = 2 / 13, k26 = 2 / 27;
  let e12 = values.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = values.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  for (let i = 26; i < values.length; i++) {
    e12 = values[i] * k12 + e12 * (1 - k12);
    e26 = values[i] * k26 + e26 * (1 - k26);
    macdHistory.push(e12 - e26);
  }
  const signalLine = macdHistory.length >= 9 ? ema(macdHistory, 9) : macdLine;
  return { macd: macdLine, signal: signalLine };
}

function technicalScore(prices: number[]): { score: number; sma20: string; sma50: string; sma200: string; rsi: string; macd: string } {
  const current = prices[prices.length - 1];
  let score = 0;
  const s20 = sma(prices, 20);
  const s50 = sma(prices, 50);
  const s200 = sma(prices, 200);
  const rsi = calcRSI(prices);
  const macd = calcMACD(prices);

  const sma20Signal = s20 ? (current > s20 ? "buy" : "sell") : "neutral";
  const sma50Signal = s50 ? (current > s50 ? "buy" : "sell") : "neutral";
  const sma200Signal = s200 ? (current > s200 ? "buy" : "sell") : "neutral";

  if (sma20Signal === "buy") score += 1; else if (sma20Signal === "sell") score -= 1;
  if (sma50Signal === "buy") score += 1; else if (sma50Signal === "sell") score -= 1;
  if (sma200Signal === "buy") score += 1.5; else if (sma200Signal === "sell") score -= 1.5;

  let rsiSignal = "neutral";
  if (rsi !== null) {
    if (rsi < 30) { rsiSignal = "buy"; score += 1.5; }
    else if (rsi < 45) { rsiSignal = "buy"; score += 0.5; }
    else if (rsi > 70) { rsiSignal = "sell"; score -= 1.5; }
    else if (rsi > 55) { rsiSignal = "sell"; score -= 0.5; }
  }

  let macdSignal = "neutral";
  if (macd) {
    if (macd.macd > macd.signal) { macdSignal = "buy"; score += 1; }
    else { macdSignal = "sell"; score -= 1; }
  }

  return { score, sma20: sma20Signal, sma50: sma50Signal, sma200: sma200Signal, rsi: rsiSignal, macd: macdSignal };
}

const PERIOD_CONFIG: Record<string, { goldRange: YahooRange; goldInterval: YahooInterval; ilsRange: YahooRange; ilsInterval: YahooInterval }> = {
  daily:   { goldRange: "1d",  goldInterval: "15m", ilsRange: "5d",  ilsInterval: "1d" },
  weekly:  { goldRange: "5d",  goldInterval: "1d",  ilsRange: "5d",  ilsInterval: "1d" },
  monthly: { goldRange: "1mo", goldInterval: "1d",  ilsRange: "1mo", ilsInterval: "1d" },
  yearly:  { goldRange: "1y",  goldInterval: "1d",  ilsRange: "1y",  ilsInterval: "1d" },
};

function pinLiveChartPoint(
  points: GoldIlsChartPoint[],
  livePrice: number,
): GoldIlsChartPoint[] {
  const live: GoldIlsChartPoint = {
    t: Date.now(),
    v: Math.round(livePrice * 100) / 100,
  };
  if (points.length === 0) return [live];
  const last = points[points.length - 1];
  if (live.t - last.t < 20 * 60 * 1000) {
    return [...points.slice(0, -1), live];
  }
  return [...points, live];
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const p = searchParams.get("period");
    const period = p === "daily" ? "daily" : p === "weekly" ? "weekly" : p === "monthly" ? "monthly" : "yearly";
    const fresh = searchParams.get("fresh") === "1";
    const cfg = PERIOD_CONFIG[period];

    // Spot from gold-api.com (Swissquote / TradingView fallback). Yahoo GC=F is history only.
    const [gold, goldYearly, ils, spot] = await Promise.all([
      fetchYahooChart("GC=F", cfg.goldRange, cfg.goldInterval, fresh),
      period !== "yearly" ? fetchYahooChart("GC=F", "1y", "1d", fresh) : null,
      fetchYahooChart("USDILS=X", cfg.ilsRange, cfg.ilsInterval, fresh),
      fetchSpotGoldUSD(),
    ]);

    const goldPriceUSD = spot.price;
    const usdToILS = ils.current;
    const goldPriceILS = goldPriceUSD * usdToILS;

    // Align futures history to spot level (basis is usually ~1%).
    const basis =
      gold.current > 0 ? goldPriceUSD / gold.current : 1;
    const goldHistory = gold.points.map((p) => p.v * basis);
    const goldFullHistory = (goldYearly?.points ?? gold.points).map(
      (p) => p.v * basis,
    );
    const ilsHistory = ils.points.map((p) => p.v);

    let goldSignal: "low" | "mid" | "high" | "very_high" = "mid";
    let ilsSignal: "strong" | "mid" | "weak" | "very_weak" = "mid";
    let goldPct = 50;
    let ilsPct = 50;
    let goldRangeLow = 0;
    let goldRangeHigh = 0;
    let ilsRangeLow = 0;
    let ilsRangeHigh = 0;

    if (goldHistory.length > 0) {
      goldPct = Math.round(percentile(goldPriceUSD, goldHistory));
      goldSignal = toSignal(goldPct);
      goldRangeLow = Math.round(Math.min(...goldHistory));
      goldRangeHigh = Math.round(Math.max(...goldHistory));
    }

    if (ilsHistory.length > 0) {
      ilsPct = Math.round(percentile(usdToILS, ilsHistory));
      ilsSignal = toIlsSignal(ilsPct);
      ilsRangeLow = Math.round(Math.min(...ilsHistory) * 10000) / 10000;
      ilsRangeHigh = Math.round(Math.max(...ilsHistory) * 10000) / 10000;
    }

    const tech = goldFullHistory.length > 50 ? technicalScore(goldFullHistory) : null;

    // Backtested scoring configs per period
    const SCORING_CFG = {
      daily:   { lookback: 10,  levelMult: 1.5, mom: [-4, -1.5, -0.5, 0.5, 1.5, 4, 8], w: [0.2, 0.4, 0.4] },
      weekly:  { lookback: 20,  levelMult: 1.0, mom: [-6, -2.5, -0.5, 0.5, 2.5, 6, 12], w: [0.4, 0.3, 0.3] },
      monthly: { lookback: 60,  levelMult: 1.5, mom: [-8, -3, -1, 1, 3, 8, 15], w: [0.3, 0.3, 0.4] },
      yearly:  { lookback: 90,  levelMult: 1.5, mom: [-8, -3, -1, 1, 3, 8, 15], w: [0.4, 0.3, 0.3] },
    } as const;
    const sCfg = SCORING_CFG[period];

    // Build gold-in-ILS history: multiply gold × ILS at each point
    let goldIlsHistory: number[] = [];
    let goldIlsChart: GoldIlsChartPoint[] = [];
    if (period === "daily") {
      goldIlsHistory = goldHistory.map(g => g * usdToILS);
      goldIlsChart = gold.points.map((p) => ({
        t: p.t,
        v: Math.round(p.v * basis * usdToILS * 100) / 100,
      }));
    } else {
      const len = Math.min(gold.points.length, ils.points.length);
      if (len > 0) {
        const gSlice = gold.points.slice(-len);
        const iSlice = ils.points.slice(-len);
        goldIlsChart = gSlice.map((g, idx) => ({
          t: g.t,
          v: Math.round(g.v * basis * iSlice[idx].v * 100) / 100,
        }));
        goldIlsHistory = goldIlsChart.map((p) => p.v);
      }
    }

    // Scoring uses a shorter lookback window (keeps full history for display)
    const scoringHistory = goldIlsHistory.length > sCfg.lookback
      ? goldIlsHistory.slice(-sCfg.lookback)
      : goldIlsHistory;

    // Level score: percentile of current ₪ price in scoring window
    let scoringPct = 50;
    if (scoringHistory.length > 0) {
      scoringPct = percentile(goldPriceILS, scoringHistory);
    }
    const levelScore = (50 - scoringPct) / 25 * sCfg.levelMult;

    // Display: percentile against the full selected period
    let ilsGoldPct = 50;
    if (goldIlsHistory.length > 0) {
      ilsGoldPct = percentile(goldPriceILS, goldIlsHistory);
    }

    // Momentum for scoring: ₪ change over the scoring lookback window
    let scoringChangePct = 0;
    if (scoringHistory.length >= 2) {
      const startPrice = scoringHistory[0];
      scoringChangePct = ((goldPriceILS - startPrice) / startPrice) * 100;
    }

    // Display: ₪ change over the full selected period
    let ilsPriceChange = 0;
    let ilsPriceChangePct = 0;
    if (goldIlsHistory.length >= 2) {
      const startPrice = goldIlsHistory[0];
      ilsPriceChange = goldPriceILS - startPrice;
      ilsPriceChangePct = (ilsPriceChange / startPrice) * 100;
    }

    const m = sCfg.mom;
    let momentumScore = 0;
    if (scoringChangePct < m[0]) momentumScore = 3;
    else if (scoringChangePct < m[1]) momentumScore = 2;
    else if (scoringChangePct < m[2]) momentumScore = 1;
    else if (scoringChangePct > m[6]) momentumScore = -3;
    else if (scoringChangePct > m[5]) momentumScore = -2;
    else if (scoringChangePct > m[4]) momentumScore = -1;

    const techScore = tech ? tech.score : 0;
    const [wLevel, wMom, wTech] = sCfg.w;
    const combinedScore = levelScore * wLevel + momentumScore * wMom + techScore * wTech;

    let combined: "strong_buy" | "buy" | "neutral" | "wait" | "avoid";
    if (combinedScore >= 2) combined = "strong_buy";
    else if (combinedScore >= 0.5) combined = "buy";
    else if (combinedScore >= -0.5) combined = "neutral";
    else if (combinedScore >= -2) combined = "wait";
    else combined = "avoid";

    return NextResponse.json({
      goldPriceUSD: Math.round(goldPriceUSD * 100) / 100,
      usdToILS: Math.round(usdToILS * 10000) / 10000,
      goldPriceILS: Math.round(goldPriceILS * 100) / 100,
      goldPricePerGramUSD: Math.round((goldPriceUSD / 31.1035) * 100) / 100,
      goldPricePerGramILS: Math.round((goldPriceILS / 31.1035) * 100) / 100,
      goldSignal,
      ilsSignal,
      goldPct,
      ilsPct,
      ilsGoldPct: Math.round(ilsGoldPct),
      goldRangeLow,
      goldRangeHigh,
      ilsRangeLow,
      ilsRangeHigh,
      period,
      technical: tech ? {
        sma20: tech.sma20,
        sma50: tech.sma50,
        sma200: tech.sma200,
        rsi: tech.rsi,
        macd: tech.macd,
        score: Math.round(tech.score * 10) / 10,
      } : null,
      ilsPriceChange: Math.round(ilsPriceChange * 100) / 100,
      ilsPriceChangePct: Math.round(ilsPriceChangePct * 100) / 100,
      ilsPriceStart: goldIlsHistory.length > 0 ? Math.round(goldIlsHistory[0] * 100) / 100 : 0,
      combined,
      combinedScore: Math.round(combinedScore * 10) / 10,
      chart: pinLiveChartPoint(goldIlsChart, goldPriceILS),
      spotSource: spot.source,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch gold price data" },
      { status: 500 },
    );
  }
}
