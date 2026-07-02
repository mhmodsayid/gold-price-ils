/**
 * Backtest: Gold ILS Buy Strategy — Multi-config comparison
 *
 * Tests the CURRENT strategy vs IMPROVED variants to find
 * the best scoring configuration for trending gold markets.
 */

// ─── Data fetching ───────────────────────────────────────────────────────────

async function fetchYahoo(symbol) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5y&interval=1d`,
  );
  if (!res.ok) throw new Error(`Yahoo failed for ${symbol}: ${res.status}`);
  const data = await res.json();
  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;
  const pairs = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] !== null && closes[i] > 0) {
      pairs.push({ ts: timestamps[i], close: closes[i] });
    }
  }
  return pairs;
}

function alignSeries(goldRaw, ilsRaw) {
  const ilsMap = new Map();
  for (const p of ilsRaw) {
    const day = Math.floor(p.ts / 86400);
    ilsMap.set(day, p.close);
  }
  const aligned = [];
  let lastIls = null;
  for (const g of goldRaw) {
    const day = Math.floor(g.ts / 86400);
    const ils =
      ilsMap.get(day) ??
      ilsMap.get(day - 1) ??
      ilsMap.get(day + 1) ??
      lastIls;
    if (ils !== null && ils !== undefined) {
      aligned.push({ ts: g.ts, gold: g.close, ils, goldILS: g.close * ils });
      lastIls = ils;
    }
  }
  return aligned;
}

// ─── Scoring functions ───────────────────────────────────────────────────────

function percentile(current, values) {
  if (values.length === 0) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < current).length;
  const equal = sorted.filter((v) => v === current).length;
  return ((below + equal * 0.5) / sorted.length) * 100;
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(values, period = 14) {
  if (values.length < period + 1) return null;
  const recent = values.slice(-(period + 1));
  let gains = 0,
    losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcMACD(values) {
  if (values.length < 35) return null;
  const ema = (data, p) => {
    const k = 2 / (p + 1);
    let prev = data.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < data.length; i++) prev = data[i] * k + prev * (1 - k);
    return prev;
  };
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = ema12 - ema26;
  const macdHistory = [];
  const k12 = 2 / 13,
    k26 = 2 / 27;
  let e12 = values.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = values.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  for (let i = 26; i < values.length; i++) {
    e12 = values[i] * k12 + e12 * (1 - k12);
    e26 = values[i] * k26 + e26 * (1 - k26);
    macdHistory.push(e12 - e26);
  }
  const signalLine =
    macdHistory.length >= 9 ? ema(macdHistory, 9) : macdLine;
  return { macd: macdLine, signal: signalLine };
}

function technicalScore(prices) {
  const current = prices[prices.length - 1];
  let score = 0;
  const s20 = sma(prices, 20);
  const s50 = sma(prices, 50);
  const s200 = sma(prices, 200);
  const rsi = calcRSI(prices);
  const macd = calcMACD(prices);

  if (s20) score += current > s20 ? 1 : -1;
  if (s50) score += current > s50 ? 1 : -1;
  if (s200) score += current > s200 ? 1.5 : -1.5;

  if (rsi !== null) {
    if (rsi < 30) score += 1.5;
    else if (rsi < 45) score += 0.5;
    else if (rsi > 70) score -= 1.5;
    else if (rsi > 55) score -= 0.5;
  }

  if (macd) {
    score += macd.macd > macd.signal ? 1 : -1;
  }

  return score;
}

// ─── Strategy configs to compare ─────────────────────────────────────────────

const STRATEGIES = {
  current: {
    name: "CURRENT (production)",
    lookback: 365,
    levelMult: 1.5,
    momThresholds: [-5, -2, -0.5, 2, 5, 10],
    momScores: [3, 2, 1, -1, -2, -3],
    weights: { level: 0.5, momentum: 0.15, tech: 0.35 },
  },

  v2_wider_momentum: {
    name: "V2: Wider momentum thresholds",
    lookback: 365,
    levelMult: 1.5,
    momThresholds: [-15, -5, -1, 5, 15, 30],
    momScores: [3, 2, 1, -1, -2, -3],
    weights: { level: 0.5, momentum: 0.15, tech: 0.35 },
  },

  v3_more_tech: {
    name: "V3: More tech weight, less level",
    lookback: 365,
    levelMult: 1.0,
    momThresholds: [-15, -5, -1, 5, 15, 30],
    momScores: [3, 2, 1, -1, -2, -3],
    weights: { level: 0.3, momentum: 0.2, tech: 0.5 },
  },

  v4_short_lookback: {
    name: "V4: 90-day lookback + wider momentum",
    lookback: 90,
    levelMult: 1.5,
    momThresholds: [-8, -3, -1, 3, 8, 15],
    momScores: [3, 2, 1, -1, -2, -3],
    weights: { level: 0.4, momentum: 0.3, tech: 0.3 },
  },

  v5_balanced: {
    name: "V5: Balanced (90d lookback, equal weights)",
    lookback: 90,
    levelMult: 1.0,
    momThresholds: [-8, -3, -1, 3, 8, 15],
    momScores: [3, 2, 1, -1, -2, -3],
    weights: { level: 0.35, momentum: 0.35, tech: 0.3 },
  },
};

function computeSignal(data, idx, cfg) {
  const start = Math.max(0, idx - cfg.lookback);
  const window = data.slice(start, idx + 1);
  const ilsPrices = window.map((d) => d.goldILS);
  const goldPrices = data.slice(0, idx + 1).map((d) => d.gold);
  const current = data[idx];

  const ilsGoldPct = percentile(current.goldILS, ilsPrices);
  const levelScore = ((50 - ilsGoldPct) / 25) * cfg.levelMult;

  const startPrice = ilsPrices[0];
  const ilsChangePct =
    startPrice > 0
      ? ((current.goldILS - startPrice) / startPrice) * 100
      : 0;

  const t = cfg.momThresholds;
  const s = cfg.momScores;
  let momentumScore = 0;
  if (ilsChangePct < t[0]) momentumScore = s[0];
  else if (ilsChangePct < t[1]) momentumScore = s[1];
  else if (ilsChangePct < t[2]) momentumScore = s[2];
  else if (ilsChangePct > t[5]) momentumScore = s[5];
  else if (ilsChangePct > t[4]) momentumScore = s[4];
  else if (ilsChangePct > t[3]) momentumScore = s[3];

  const techScore = goldPrices.length > 50 ? technicalScore(goldPrices) : 0;

  const w = cfg.weights;
  const combinedScore =
    levelScore * w.level + momentumScore * w.momentum + techScore * w.tech;

  let signal;
  if (combinedScore >= 2) signal = "strong_buy";
  else if (combinedScore >= 0.5) signal = "buy";
  else if (combinedScore >= -0.5) signal = "neutral";
  else if (combinedScore >= -2) signal = "wait";
  else signal = "avoid";

  return { signal, combinedScore, levelScore, momentumScore, techScore };
}

// ─── Backtest runner ─────────────────────────────────────────────────────────

function runBacktest(data, cfg, startIdx, endIdx, horizons) {
  const SIGNALS = ["strong_buy", "buy", "neutral", "wait", "avoid"];
  const buckets = {};
  for (const sig of SIGNALS) {
    buckets[sig] = { count: 0 };
    for (const h of horizons) buckets[sig][`ret${h}`] = [];
  }
  const baseline = {};
  for (const h of horizons) baseline[`ret${h}`] = [];

  for (let i = startIdx; i <= endIdx; i++) {
    const { signal } = computeSignal(data, i, cfg);
    const currentILS = data[i].goldILS;
    buckets[signal].count++;
    for (const h of horizons) {
      const futureILS = data[i + h].goldILS;
      const ret = ((futureILS - currentILS) / currentILS) * 100;
      buckets[signal][`ret${h}`].push(ret);
      baseline[`ret${h}`].push(ret);
    }
  }
  return { buckets, baseline };
}

function avg(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function winRate(arr) {
  return arr.length > 0
    ? (arr.filter((r) => r > 0).length / arr.length) * 100
    : 0;
}

function printResults(name, buckets, baseline, horizons) {
  const SIGNALS = ["strong_buy", "buy", "neutral", "wait", "avoid"];

  console.log(`\n┌─ ${name}`);
  console.log(
    `│ ${"Signal".padEnd(12)} │ ${"Count".padStart(5)} │ ${"30d Ret".padStart(8)} │ ${"90d Ret".padStart(8)} │ ${"30d Win".padStart(8)} │ ${"90d Win".padStart(8)}`,
  );
  console.log(`│ ${"─".repeat(12)}─┼─${"─".repeat(5)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}`);

  for (const sig of SIGNALS) {
    const b = buckets[sig];
    if (b.count === 0) continue;
    console.log(
      `│ ${sig.padEnd(12)} │ ${String(b.count).padStart(5)} │ ${(avg(b.ret30).toFixed(2) + "%").padStart(8)} │ ${(avg(b.ret90).toFixed(2) + "%").padStart(8)} │ ${(winRate(b.ret30).toFixed(1) + "%").padStart(8)} │ ${(winRate(b.ret90).toFixed(1) + "%").padStart(8)}`,
    );
  }

  console.log(`│ ${"─".repeat(12)}─┼─${"─".repeat(5)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}`);
  console.log(
    `│ ${"BASELINE".padEnd(12)} │ ${String(baseline.ret30.length).padStart(5)} │ ${(avg(baseline.ret30).toFixed(2) + "%").padStart(8)} │ ${(avg(baseline.ret90).toFixed(2) + "%").padStart(8)} │ ${(winRate(baseline.ret30).toFixed(1) + "%").padStart(8)} │ ${(winRate(baseline.ret90).toFixed(1) + "%").padStart(8)}`,
  );

  // Key metric: spread between buy-group and wait-group
  const buyRets = (buckets.strong_buy?.ret90 ?? []).concat(
    buckets.buy?.ret90 ?? [],
  );
  const waitRets = (buckets.wait?.ret90 ?? []).concat(
    buckets.avoid?.ret90 ?? [],
  );
  const buyCount = (buckets.strong_buy?.count ?? 0) + (buckets.buy?.count ?? 0);
  const waitCount = (buckets.wait?.count ?? 0) + (buckets.avoid?.count ?? 0);
  const neutralCount = buckets.neutral?.count ?? 0;
  const spread = avg(buyRets) - avg(waitRets);
  const buyVsBase = avg(buyRets) - avg(baseline.ret90);

  console.log(`│`);
  console.log(
    `│ Distribution: ${buyCount} buy/strong_buy, ${neutralCount} neutral, ${waitCount} wait/avoid`,
  );
  console.log(
    `│ Buy avg 90d: ${avg(buyRets).toFixed(2)}%  │  Wait avg 90d: ${avg(waitRets).toFixed(2)}%  │  Spread: ${spread.toFixed(2)}pp  │  vs Baseline: ${buyVsBase >= 0 ? "+" : ""}${buyVsBase.toFixed(2)}pp`,
  );

  const score =
    (spread > 0 ? 1 : 0) +
    (buyVsBase > 0 ? 1 : 0) +
    (buyCount >= 50 ? 1 : 0) +
    (buyCount / (buyCount + waitCount + neutralCount) > 0.1 ? 1 : 0);

  let grade;
  if (score >= 4) grade = "EXCELLENT";
  else if (score >= 3) grade = "GOOD";
  else if (score >= 2) grade = "OK";
  else grade = "POOR";

  console.log(`│ Grade: ${grade} (${score}/4)`);
  console.log(`└${"─".repeat(80)}`);

  return { spread, buyVsBase, buyCount, grade, score };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching 5 years of daily data...\n");
  const [goldRaw, ilsRaw] = await Promise.all([
    fetchYahoo("GC=F"),
    fetchYahoo("USDILS=X"),
  ]);

  const data = alignSeries(goldRaw, ilsRaw);
  console.log(`Aligned data: ${data.length} points`);

  const HORIZONS = [30, 90];
  const maxLookback = 365;
  const startIdx = maxLookback;
  const endIdx = data.length - 180 - 1;

  const dateStr = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
  console.log(
    `Test period: ${dateStr(data[startIdx].ts)} → ${dateStr(data[endIdx].ts)} (${endIdx - startIdx + 1} days)\n`,
  );

  console.log(
    "═".repeat(82),
  );
  console.log(
    "  COMPARING STRATEGY VARIANTS",
  );
  console.log(
    "═".repeat(82),
  );

  const results = {};

  for (const [key, cfg] of Object.entries(STRATEGIES)) {
    const { buckets, baseline } = runBacktest(
      data,
      cfg,
      startIdx,
      endIdx,
      HORIZONS,
    );
    results[key] = printResults(cfg.name, buckets, baseline, HORIZONS);
  }

  // ─── Summary ───────────────────────────────────────────────────────────

  console.log(
    "\n" + "═".repeat(82),
  );
  console.log("  RANKING");
  console.log(
    "═".repeat(82) + "\n",
  );

  const ranked = Object.entries(results)
    .map(([key, r]) => ({ key, ...r, name: STRATEGIES[key].name }))
    .sort((a, b) => b.score - a.score || b.spread - a.spread);

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const marker = i === 0 ? " ★ BEST" : "";
    console.log(
      `  ${i + 1}. [${r.grade}] ${r.name}${marker}`,
    );
    console.log(
      `     Spread: ${r.spread.toFixed(2)}pp  │  vs Baseline: ${r.buyVsBase >= 0 ? "+" : ""}${r.buyVsBase.toFixed(2)}pp  │  Buy signals: ${r.buyCount}`,
    );
  }

  // Print the best strategy config for easy copy
  const best = ranked[0];
  console.log(`\n${"─".repeat(82)}`);
  console.log(`\nBest config (${best.name}):`);
  const cfg = STRATEGIES[best.key];
  console.log(`  lookback:       ${cfg.lookback}`);
  console.log(`  levelMult:      ${cfg.levelMult}`);
  console.log(`  momThresholds:  [${cfg.momThresholds}]`);
  console.log(`  weights:        level=${cfg.weights.level} momentum=${cfg.weights.momentum} tech=${cfg.weights.tech}`);
  console.log();
}

main().catch((e) => {
  console.error("Backtest failed:", e);
  process.exit(1);
});
