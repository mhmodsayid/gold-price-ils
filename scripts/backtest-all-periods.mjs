/**
 * Backtest all periods: daily (1d), weekly (5d), monthly (30d)
 * Tests multiple strategy configs per period and finds the best.
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
    const ils = ilsMap.get(day) ?? ilsMap.get(day - 1) ?? ilsMap.get(day + 1) ?? lastIls;
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
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
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
  if (macd) score += macd.macd > macd.signal ? 1 : -1;
  return score;
}

// ─── Strategy computation ────────────────────────────────────────────────────

function computeSignal(data, idx, cfg) {
  const start = Math.max(0, idx - cfg.lookback);
  const window = data.slice(start, idx + 1);
  const ilsPrices = window.map((d) => d.goldILS);
  const goldPrices = data.slice(0, idx + 1).map((d) => d.gold);
  const current = data[idx];

  const ilsGoldPct = percentile(current.goldILS, ilsPrices);
  const levelScore = ((50 - ilsGoldPct) / 25) * cfg.levelMult;

  const startPrice = ilsPrices[0];
  const ilsChangePct = startPrice > 0 ? ((current.goldILS - startPrice) / startPrice) * 100 : 0;

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
  const combinedScore = levelScore * w.level + momentumScore * w.momentum + techScore * w.tech;

  let signal;
  if (combinedScore >= 2) signal = "strong_buy";
  else if (combinedScore >= 0.5) signal = "buy";
  else if (combinedScore >= -0.5) signal = "neutral";
  else if (combinedScore >= -2) signal = "wait";
  else signal = "avoid";

  return { signal, combinedScore };
}

// ─── Backtest engine ─────────────────────────────────────────────────────────

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
      if (i + h < data.length) {
        const ret = ((data[i + h].goldILS - currentILS) / currentILS) * 100;
        buckets[signal][`ret${h}`].push(ret);
        baseline[`ret${h}`].push(ret);
      }
    }
  }
  return { buckets, baseline };
}

function avg(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function winRate(arr) {
  return arr.length > 0 ? (arr.filter((r) => r > 0).length / arr.length) * 100 : 0;
}

function evaluate(buckets, baseline) {
  const buyRets = (buckets.strong_buy?.ret7 ?? buckets.strong_buy?.ret5 ?? buckets.strong_buy?.ret30 ?? [])
    .concat(buckets.buy?.ret7 ?? buckets.buy?.ret5 ?? buckets.buy?.ret30 ?? []);
  const waitRets = (buckets.wait?.ret7 ?? buckets.wait?.ret5 ?? buckets.wait?.ret30 ?? [])
    .concat(buckets.avoid?.ret7 ?? buckets.avoid?.ret5 ?? buckets.avoid?.ret30 ?? []);
  const baseRets = baseline.ret7 ?? baseline.ret5 ?? baseline.ret30 ?? [];

  const buyCount = (buckets.strong_buy?.count ?? 0) + (buckets.buy?.count ?? 0);
  const total = Object.values(buckets).reduce((s, b) => s + b.count, 0);

  const spread = avg(buyRets) - avg(waitRets);
  const buyVsBase = avg(buyRets) - avg(baseRets);

  const score =
    (spread > 0 ? 1 : 0) +
    (buyVsBase > 0 ? 1 : 0) +
    (buyCount >= 30 ? 1 : 0) +
    (total > 0 && buyCount / total > 0.08 ? 1 : 0);

  return { spread, buyVsBase, buyCount, total, score };
}

// ─── Period configs ──────────────────────────────────────────────────────────

const PERIOD_TESTS = {
  daily: {
    label: "DAILY (forward horizon: 5 days)",
    horizons: [5, 10],
    startOffset: 30,
    strategies: {
      current: {
        name: "Current: 20% level · 70% momentum · 10% tech",
        lookback: 5, levelMult: 1.5,
        momThresholds: [-5, -2, -0.5, 2, 5, 10],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.2, momentum: 0.7, tech: 0.1 },
      },
      v2: {
        name: "V2: 30% level · 40% momentum · 30% tech",
        lookback: 5, levelMult: 1.5,
        momThresholds: [-3, -1, -0.3, 1, 3, 6],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.3, momentum: 0.4, tech: 0.3 },
      },
      v3: {
        name: "V3: 20/40/40 + 10d lookback",
        lookback: 10, levelMult: 1.5,
        momThresholds: [-4, -1.5, -0.5, 1.5, 4, 8],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.2, momentum: 0.4, tech: 0.4 },
      },
      v4: {
        name: "V4: 35/35/30 + 10d lookback",
        lookback: 10, levelMult: 1.0,
        momThresholds: [-4, -1.5, -0.5, 1.5, 4, 8],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.35, momentum: 0.35, tech: 0.3 },
      },
    },
  },
  weekly: {
    label: "WEEKLY (forward horizon: 7 days)",
    horizons: [7, 14],
    startOffset: 30,
    strategies: {
      current: {
        name: "Current: 30% level · 55% momentum · 15% tech",
        lookback: 5, levelMult: 1.5,
        momThresholds: [-5, -2, -0.5, 2, 5, 10],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.3, momentum: 0.55, tech: 0.15 },
      },
      v2: {
        name: "V2: 35/35/30 + 10d lookback",
        lookback: 10, levelMult: 1.5,
        momThresholds: [-5, -2, -0.5, 2, 5, 10],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.35, momentum: 0.35, tech: 0.3 },
      },
      v3: {
        name: "V3: 30/30/40 + 20d lookback, wider thresholds",
        lookback: 20, levelMult: 1.5,
        momThresholds: [-6, -2.5, -0.5, 2.5, 6, 12],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.3, momentum: 0.3, tech: 0.4 },
      },
      v4: {
        name: "V4: 40/30/30 + 20d lookback",
        lookback: 20, levelMult: 1.0,
        momThresholds: [-6, -2.5, -0.5, 2.5, 6, 12],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.4, momentum: 0.3, tech: 0.3 },
      },
    },
  },
  monthly: {
    label: "MONTHLY (forward horizon: 30 days)",
    horizons: [30, 60],
    startOffset: 60,
    strategies: {
      current: {
        name: "Current: 40% level · 35% momentum · 25% tech",
        lookback: 30, levelMult: 1.5,
        momThresholds: [-5, -2, -0.5, 2, 5, 10],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.4, momentum: 0.35, tech: 0.25 },
      },
      v2: {
        name: "V2: 35/35/30 + 45d lookback",
        lookback: 45, levelMult: 1.5,
        momThresholds: [-6, -3, -1, 3, 6, 12],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.35, momentum: 0.35, tech: 0.3 },
      },
      v3: {
        name: "V3: 30/30/40 + 60d lookback",
        lookback: 60, levelMult: 1.5,
        momThresholds: [-8, -3, -1, 3, 8, 15],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.3, momentum: 0.3, tech: 0.4 },
      },
      v4: {
        name: "V4: 40/30/30 + 60d lookback",
        lookback: 60, levelMult: 1.0,
        momThresholds: [-8, -3, -1, 3, 8, 15],
        momScores: [3, 2, 1, -1, -2, -3],
        weights: { level: 0.4, momentum: 0.3, tech: 0.3 },
      },
    },
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching 5 years of daily data...\n");
  const [goldRaw, ilsRaw] = await Promise.all([
    fetchYahoo("GC=F"),
    fetchYahoo("USDILS=X"),
  ]);
  const data = alignSeries(goldRaw, ilsRaw);
  console.log(`Aligned data: ${data.length} points\n`);

  const bestConfigs = {};

  for (const [periodKey, periodCfg] of Object.entries(PERIOD_TESTS)) {
    const h = periodCfg.horizons;
    const hMain = h[0];
    const startIdx = periodCfg.startOffset;
    const endIdx = data.length - Math.max(...h) - 1;

    console.log("═".repeat(82));
    console.log(`  ${periodCfg.label}`);
    console.log("═".repeat(82));

    const rankings = [];

    for (const [key, cfg] of Object.entries(periodCfg.strategies)) {
      const { buckets, baseline } = runBacktest(data, cfg, startIdx, endIdx, h);

      const SIGNALS = ["strong_buy", "buy", "neutral", "wait", "avoid"];
      console.log(`\n┌─ ${cfg.name}`);
      console.log(
        `│ ${"Signal".padEnd(12)} │ ${"Count".padStart(5)} │ ${(hMain + "d Ret").padStart(8)} │ ${(h[1] + "d Ret").padStart(8)} │ ${(hMain + "d Win").padStart(8)} │ ${(h[1] + "d Win").padStart(8)}`,
      );
      console.log(`│ ${"─".repeat(12)}─┼─${"─".repeat(5)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}`);

      for (const sig of SIGNALS) {
        const b = buckets[sig];
        if (b.count === 0) continue;
        console.log(
          `│ ${sig.padEnd(12)} │ ${String(b.count).padStart(5)} │ ${(avg(b[`ret${hMain}`]).toFixed(2) + "%").padStart(8)} │ ${(avg(b[`ret${h[1]}`]).toFixed(2) + "%").padStart(8)} │ ${(winRate(b[`ret${hMain}`]).toFixed(1) + "%").padStart(8)} │ ${(winRate(b[`ret${h[1]}`]).toFixed(1) + "%").padStart(8)}`,
        );
      }
      console.log(`│ ${"─".repeat(12)}─┼─${"─".repeat(5)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}─┼─${"─".repeat(8)}`);
      console.log(
        `│ ${"BASELINE".padEnd(12)} │ ${String(baseline[`ret${hMain}`].length).padStart(5)} │ ${(avg(baseline[`ret${hMain}`]).toFixed(2) + "%").padStart(8)} │ ${(avg(baseline[`ret${h[1]}`]).toFixed(2) + "%").padStart(8)} │ ${(winRate(baseline[`ret${hMain}`]).toFixed(1) + "%").padStart(8)} │ ${(winRate(baseline[`ret${h[1]}`]).toFixed(1) + "%").padStart(8)}`,
      );

      // evaluate using main horizon
      const buyRets = (buckets.strong_buy[`ret${hMain}`] ?? []).concat(buckets.buy[`ret${hMain}`] ?? []);
      const waitRets = (buckets.wait[`ret${hMain}`] ?? []).concat(buckets.avoid[`ret${hMain}`] ?? []);
      const baseRets = baseline[`ret${hMain}`];
      const buyCount = (buckets.strong_buy?.count ?? 0) + (buckets.buy?.count ?? 0);
      const total = Object.values(buckets).reduce((s, b) => s + b.count, 0);
      const spread = avg(buyRets) - avg(waitRets);
      const buyVsBase = avg(buyRets) - avg(baseRets);

      const evalScore =
        (spread > 0 ? 1 : 0) +
        (buyVsBase > 0 ? 1 : 0) +
        (buyCount >= 30 ? 1 : 0) +
        (total > 0 && buyCount / total > 0.08 ? 1 : 0);

      let grade;
      if (evalScore >= 4) grade = "EXCELLENT";
      else if (evalScore >= 3) grade = "GOOD";
      else if (evalScore >= 2) grade = "OK";
      else grade = "POOR";

      console.log(`│ Buy signals: ${buyCount}  Spread: ${spread.toFixed(2)}pp  vs Base: ${buyVsBase >= 0 ? "+" : ""}${buyVsBase.toFixed(2)}pp  Grade: ${grade} (${evalScore}/4)`);
      console.log(`└${"─".repeat(82)}`);

      rankings.push({ key, name: cfg.name, spread, buyVsBase, buyCount, evalScore, grade, cfg });
    }

    rankings.sort((a, b) => b.evalScore - a.evalScore || b.spread - a.spread);

    console.log(`\n  RANKING for ${periodKey.toUpperCase()}:`);
    for (let i = 0; i < rankings.length; i++) {
      const r = rankings[i];
      const marker = i === 0 ? " ★ BEST" : "";
      console.log(`  ${i + 1}. [${r.grade}] ${r.name}${marker}`);
      console.log(`     Spread: ${r.spread.toFixed(2)}pp  │  vs Base: ${r.buyVsBase >= 0 ? "+" : ""}${r.buyVsBase.toFixed(2)}pp  │  Buy signals: ${r.buyCount}`);
    }

    bestConfigs[periodKey] = rankings[0];
    console.log();
  }

  // ─── Final summary ──────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(82));
  console.log("  FINAL RECOMMENDATIONS");
  console.log("═".repeat(82) + "\n");

  for (const [period, best] of Object.entries(bestConfigs)) {
    const c = best.cfg;
    console.log(`${period.toUpperCase()} → ${best.name} [${best.grade}]`);
    console.log(`  lookback: ${c.lookback}  levelMult: ${c.levelMult}  momThresholds: [${c.momThresholds}]`);
    console.log(`  weights: level=${c.weights.level} momentum=${c.weights.momentum} tech=${c.weights.tech}`);
    console.log();
  }
}

main().catch((e) => {
  console.error("Backtest failed:", e);
  process.exit(1);
});
