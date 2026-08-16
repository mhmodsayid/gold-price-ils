"use client";

import { useEffect, useState, useCallback } from "react";
import { GoldIlsChart } from "@/components/GoldIlsChart";

type Period = "yearly" | "monthly" | "weekly" | "daily";

interface TechnicalData {
  sma20: string;
  sma50: string;
  sma200: string;
  rsi: string;
  macd: string;
  score: number;
}

interface GoldPriceData {
  goldPriceUSD: number;
  usdToILS: number;
  goldPriceILS: number;
  goldPricePerGramUSD: number;
  goldPricePerGramILS: number;
  goldSignal: "low" | "mid" | "high" | "very_high";
  ilsSignal: "strong" | "mid" | "weak" | "very_weak";
  goldPct: number;
  ilsPct: number;
  ilsGoldPct: number;
  goldRangeLow: number;
  goldRangeHigh: number;
  ilsRangeLow: number;
  ilsRangeHigh: number;
  period: Period;
  ilsPriceChange: number;
  ilsPriceChangePct: number;
  ilsPriceStart: number;
  technical: TechnicalData | null;
  combined: RecLevel;
  combinedScore: number;
  chart: { t: number; v: number }[];
  spotSource?: "gold-api.com" | "swissquote" | "tradingview";
  timestamp: string;
}

type RecLevel = "strong_buy" | "buy" | "neutral" | "wait" | "avoid";

const REC_CONFIG: Record<
  RecLevel,
  {
    title: string;
    desc: string;
    color: string;
    bg: string;
    border: string;
    icon: string;
  }
> = {
  strong_buy: {
    title: "Strong Buy",
    desc: "Gold is affordable and the shekel is strong. Great time to buy!",
    color: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    icon: "▲▲",
  },
  buy: {
    title: "Good to Buy",
    desc: "Conditions are favorable. A good opportunity to consider buying.",
    color: "text-green-300",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    icon: "▲",
  },
  neutral: {
    title: "Neutral",
    desc: "Market conditions are average. Buy if you need, no rush.",
    color: "text-yellow-300",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    icon: "●",
  },
  wait: {
    title: "Consider Waiting",
    desc: "Prices are elevated. Wait for a better entry point if possible.",
    color: "text-orange-300",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    icon: "▼",
  },
  avoid: {
    title: "Not Recommended",
    desc: "Gold is expensive and the shekel is weak. Wait for better conditions.",
    color: "text-red-300",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    icon: "▼▼",
  },
};

const SPOT_SOURCE_LABELS: Record<string, string> = {
  "gold-api.com": "gold-api.com",
  swissquote: "Swissquote XAU/USD",
  tradingview: "TradingView",
};

const GOLD_LABELS: Record<string, { text: string; color: string }> = {
  low: { text: "Low", color: "text-emerald-400" },
  mid: { text: "Moderate", color: "text-yellow-400" },
  high: { text: "High", color: "text-orange-400" },
  very_high: { text: "Very High", color: "text-red-400" },
};

const ILS_LABELS: Record<string, { text: string; color: string }> = {
  strong: { text: "Strong Shekel", color: "text-emerald-400" },
  mid: { text: "Average", color: "text-yellow-400" },
  weak: { text: "Weak Shekel", color: "text-orange-400" },
  very_weak: { text: "Very Weak", color: "text-red-400" },
};

type WeightUnit = "oz" | "gram" | "kg";

const WEIGHT_LABELS: Record<WeightUnit, string> = {
  oz: "Troy Ounce",
  gram: "Gram",
  kg: "Kilogram",
};

type Karat = 24 | 22 | 21 | 18 | 14;

const KARATS: Karat[] = [24, 22, 21, 18, 14];

interface GoldPiece {
  name: string;
  nameAr: string;
  grams: number;
  emoji: string;
  great: number;
  good: number;
  hasCraft?: boolean;
}

function getCraftZone(craft: number): { label: string; color: string } {
  if (craft < 30) return { label: "Great", color: "#10b981" };
  if (craft <= 60) return { label: "Normal", color: "#22c55e" };
  if (craft <= 70) return { label: "High", color: "#eab308" };
  if (craft <= 100) return { label: "Very High", color: "#f97316" };
  return { label: "Extreme", color: "#ef4444" };
}

function getCraftSliderPos(craft: number): number {
  const max = 120;
  return Math.min((craft / max) * 100, 100);
}

const GOLD_PIECES: GoldPiece[] = [
  {
    name: "Ounce Gold Bar",
    nameAr: "سبيكة اونصة",
    grams: 31.1035,
    emoji: "🏅",
    great: 1200,
    good: 1500,
  },
  {
    name: "English Lira",
    nameAr: "ليرة انجليزي",
    grams: 8,
    emoji: "👑",
    great: 450,
    good: 500,
  },
  {
    name: "Bracelet (10g)",
    nameAr: "اسوارة",
    grams: 10,
    emoji: "📿",
    great: 0,
    good: 0,
    hasCraft: true,
  },
];

function getPricePosition(profit: number, great: number, good: number): number {
  const maxBar = good * 1.5;
  if (profit <= 0) return 0;
  if (profit >= maxBar) return 100;
  return (profit / maxBar) * 100;
}

function getSliderColor(profit: number, great: number, good: number): string {
  if (profit < great) return "#10b981";
  if (profit <= good) return "#22c55e";
  if (profit <= good * 1.2) return "#eab308";
  if (profit <= good * 1.5) return "#f97316";
  return "#ef4444";
}

function getZoneLabel(profit: number, great: number, good: number): string {
  if (profit < great) return "Great";
  if (profit <= good) return "Good";
  if (profit <= good * 1.2) return "Normal";
  if (profit <= good * 1.5) return "High";
  return "Too High";
}

export default function Home() {
  const [data, setData] = useState<GoldPriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<WeightUnit>("oz");
  const [customWeight, setCustomWeight] = useState<string>("1");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [pieceQty, setPieceQty] = useState<Record<string, number>>({});
  const [karat, setKarat] = useState<Karat>(24);
  const [sellerPrices, setSellerPrices] = useState<Record<string, string>>({});
  const [customSellerPrice, setCustomSellerPrice] = useState<string>("");
  const [period, setPeriod] = useState<Period>("yearly");
  const [openTip, setOpenTip] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/gold-price?period=${period}&fresh=1&_=${Date.now()}`,
        {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const json: GoldPriceData = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch {
      setError("Unable to fetch gold prices. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const purity = karat / 24;

  const getPriceForUnit = (pricePerOzILS: number): number => {
    const w = parseFloat(customWeight) || 0;
    switch (unit) {
      case "oz":
        return pricePerOzILS * w * purity;
      case "gram":
        return (pricePerOzILS / 31.1035) * w * purity;
      case "kg":
        return (pricePerOzILS / 31.1035) * 1000 * w * purity;
    }
  };

  const getPriceForUnitUSD = (pricePerOzUSD: number): number => {
    const w = parseFloat(customWeight) || 0;
    switch (unit) {
      case "oz":
        return pricePerOzUSD * w * purity;
      case "gram":
        return (pricePerOzUSD / 31.1035) * w * purity;
      case "kg":
        return (pricePerOzUSD / 31.1035) * 1000 * w * purity;
    }
  };

  const getQty = (name: string) => pieceQty[name] || 1;

  const setQty = (name: string, val: number) =>
    setPieceQty((prev) => ({ ...prev, [name]: Math.max(1, val) }));

  const piecePrice = (grams: number, qty: number) =>
    data ? (data.goldPriceILS / 31.1035) * grams * qty * purity : 0;

  const piecePriceUSD = (grams: number, qty: number) =>
    data ? (data.goldPriceUSD / 31.1035) * grams * qty * purity : 0;

  const setSellerPrice = (name: string, val: string) =>
    setSellerPrices((prev) => ({ ...prev, [name]: val }));

  const formatNumber = (n: number) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-3 sm:px-4 py-8 sm:py-12">
      <div className="w-full max-w-2xl space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="text-6xl mb-4">🪙</div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
            Gold Price Calculator
          </h1>
          <p className="text-gray-400 text-base sm:text-lg">
            Real-time gold price in Israeli Shekel (₪)
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-center">
            <p className="text-red-400">{error}</p>
            <button
              onClick={fetchData}
              className="mt-2 text-sm text-red-300 underline hover:text-red-200"
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && !data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-48 bg-gray-800/50 rounded-2xl" />
            <div className="h-32 bg-gray-800/50 rounded-2xl" />
          </div>
        )}

        {data && (
          <>
            {/* Main Price Card */}
            <div className="relative overflow-hidden bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-transparent border border-yellow-500/20 rounded-3xl p-5 sm:p-8">
              <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="relative space-y-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-yellow-400/80 uppercase tracking-wider">
                    Gold per Troy Ounce
                  </span>
                  <button
                    onClick={fetchData}
                    disabled={loading}
                    className="text-xs text-gray-500 hover:text-yellow-400 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    <svg
                      className={`w-3 h-3 ${loading ? "animate-spin" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Refresh
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <p className="text-sm text-gray-400 mb-1">USD</p>
                    <p className="text-2xl sm:text-3xl font-bold text-white">
                      ${formatNumber(data.goldPriceUSD)}
                    </p>
                    {data.spotSource && (
                      <p className="text-[10px] text-gray-600 mt-1">
                        Spot · {SPOT_SOURCE_LABELS[data.spotSource] ?? data.spotSource}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 mb-1">ILS (₪)</p>
                    <p className="text-2xl sm:text-3xl font-bold text-yellow-400">
                      ₪{formatNumber(data.goldPriceILS)}
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-700/50 grid grid-cols-2 gap-4 sm:gap-6 text-sm">
                  <div>
                    <p className="text-gray-500">Per Gram (USD)</p>
                    <p className="text-gray-300 font-medium">
                      ${formatNumber(data.goldPricePerGramUSD)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Per Gram (₪)</p>
                    <p className="text-yellow-300/80 font-medium">
                      ₪{formatNumber(data.goldPricePerGramILS)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Exchange Rate Badge */}
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 bg-gray-800/50 border border-gray-700/50 rounded-full px-4 sm:px-5 py-2 text-xs sm:text-sm">
                <span className="text-gray-400">Exchange Rate:</span>
                <span className="font-semibold text-white">
                  1 USD = {data.usdToILS} ₪
                </span>
              </div>
            </div>

            <GoldIlsChart
              points={data.chart ?? []}
              period={period}
              onPeriodChange={setPeriod}
            />

            {/* Combined Recommendation */}
            {(() => {
              const cfg = REC_CONFIG[data.combined];
              const gLabel = GOLD_LABELS[data.goldSignal];
              const iLabel = ILS_LABELS[data.ilsSignal];
              const rangeLabel =
                period === "daily"
                  ? "24 hours"
                  : period === "weekly"
                    ? "7 days"
                    : period === "monthly"
                      ? "30 days"
                      : "1 year";
              const colorFromClass = (cls: string) =>
                cls === "text-emerald-400"
                  ? "#10b981"
                  : cls === "text-yellow-400"
                    ? "#eab308"
                    : cls === "text-orange-400"
                      ? "#f97316"
                      : "#ef4444";
              const techSigColor = (s: string) =>
                s === "buy"
                  ? "text-emerald-400"
                  : s === "sell"
                    ? "text-red-400"
                    : "text-gray-500";
              const techSigLabel = (s: string) =>
                s === "buy" ? "Buy" : s === "sell" ? "Sell" : "—";
              return (
                <div
                  className={`${cfg.bg} border ${cfg.border} rounded-3xl p-4 sm:p-6 space-y-4`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-200">
                      Should You Buy?
                    </h2>
                    <select
                      value={period}
                      onChange={(e) => setPeriod(e.target.value as Period)}
                      className="bg-gray-800/80 border border-gray-600/50 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-yellow-500/50 cursor-pointer"
                    >
                      <option value="yearly">Yearly (12 mo)</option>
                      <option value="monthly">Monthly (30 d)</option>
                      <option value="weekly">Weekly (7 d)</option>
                      <option value="daily">Daily (24 h)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <span
                      className={`text-xl sm:text-2xl font-bold ${cfg.color}`}
                    >
                      {cfg.icon}
                    </span>
                    <span
                      className={`text-lg sm:text-xl font-bold ${cfg.color}`}
                    >
                      {cfg.title}
                    </span>
                    <span
                      className={`ml-auto relative cursor-help inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} border ${cfg.border}`}
                      onClick={() =>
                        setOpenTip(openTip === "score" ? null : "score")
                      }
                    >
                      <span className={`text-[11px] text-gray-400`}>Score</span>
                      <span className={`${cfg.color} font-bold`}>
                        {data.combinedScore}
                      </span>
                      <span className="text-gray-500 text-[10px]">ⓘ</span>
                      {openTip === "score" && (
                        <div className="absolute bottom-full right-0 mb-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-[10px] text-gray-300 w-56 z-10 shadow-lg leading-relaxed">
                          <p className="font-semibold text-gray-200 mb-1">
                            How is this calculated?
                          </p>
                          <p>
                            <span className="text-yellow-400">
                              Price Level:
                            </span>{" "}
                            gold ₪ price percentile vs last{" "}
                            {period === "yearly" ? "90 days" : rangeLabel}
                          </p>
                          <p>
                            <span className="text-yellow-400">Momentum:</span> ₪
                            price change (start → now)
                          </p>
                          <p>
                            <span className="text-yellow-400">Technical:</span>{" "}
                            SMA 20/50/200, RSI, MACD on 1Y gold data
                          </p>
                          <p className="mt-1 text-gray-500">
                            Weight:{" "}
                            {period === "daily"
                              ? "20% level · 40% momentum · 40% tech"
                              : period === "weekly"
                                ? "40% level · 30% momentum · 30% tech"
                                : period === "monthly"
                                  ? "30% level · 30% momentum · 40% tech"
                                  : "40% level · 30% momentum · 30% tech"}
                          </p>
                          <p className="mt-1 text-gray-500">
                            ≥2 Strong Buy · ≥0.5 Buy · ≥-0.5 Neutral · ≥-2 Wait
                            · &lt;-2 Avoid
                          </p>
                        </div>
                      )}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">{cfg.desc}</p>

                  {/* Gold ₪ price percentile — drives the level score */}
                  {(() => {
                    const pct = data.ilsGoldPct;
                    const pctColor =
                      pct <= 25
                        ? "#10b981"
                        : pct <= 50
                          ? "#22c55e"
                          : pct <= 75
                            ? "#eab308"
                            : "#ef4444";
                    const pctLabel =
                      pct <= 25
                        ? "Low"
                        : pct <= 50
                          ? "Average"
                          : pct <= 75
                            ? "Above Avg"
                            : "High";
                    return (
                      <div className="pt-3 border-t border-gray-700/30 space-y-2">
                        <p className="text-xs text-gray-500">
                          Gold Price in ₪ ({rangeLabel} range)
                        </p>
                        <div className="flex items-center gap-2">
                          <p
                            className="text-sm font-semibold"
                            style={{ color: pctColor }}
                          >
                            {pctLabel} ({pct}th pctl)
                          </p>
                          <span className="text-[10px] text-gray-600">
                            ₪{formatNumber(data.goldPriceILS)}/oz
                          </span>
                        </div>
                        <div className="relative h-2 rounded-full bg-gray-800 overflow-hidden">
                          <div
                            className="absolute inset-0 opacity-20"
                            style={{
                              background:
                                "linear-gradient(to right, #10b981, #eab308, #ef4444)",
                            }}
                          />
                          <div
                            className="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              background: pctColor,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Context: gold USD & exchange rate breakdown */}
                  <div className="grid grid-cols-2 gap-3 pt-2 text-[10px] text-gray-600">
                    <div
                      className="relative cursor-help"
                      onClick={() =>
                        setOpenTip(openTip === "goldCtx" ? null : "goldCtx")
                      }
                    >
                      <span className={gLabel.color}>{gLabel.text}</span> gold (
                      {data.goldPct}th pctl){" "}
                      <span className="text-gray-700">ⓘ</span>
                      <p className="truncate">
                        $
                        {data.goldRangeLow > 0
                          ? formatNumber(data.goldRangeLow)
                          : "..."}{" "}
                        – $
                        {data.goldRangeHigh > 0
                          ? formatNumber(data.goldRangeHigh)
                          : "..."}
                      </p>
                      {openTip === "goldCtx" && (
                        <div className="absolute bottom-full left-0 mb-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-[10px] text-gray-300 w-52 z-10 shadow-lg leading-relaxed">
                          <p className="font-semibold text-gray-200 mb-1">
                            Gold USD Price
                          </p>
                          <p>
                            Current gold is at the{" "}
                            <span className="text-yellow-400">
                              {data.goldPct}th percentile
                            </span>{" "}
                            of its {rangeLabel} USD range.
                          </p>
                          <p className="mt-1">
                            {data.goldPct <= 25
                              ? "Low — gold is cheap in USD terms."
                              : data.goldPct <= 50
                                ? "Moderate — gold is near its mid-range."
                                : data.goldPct <= 75
                                  ? "High — gold is above average."
                                  : "Very high — gold is near its peak."}
                          </p>
                        </div>
                      )}
                    </div>
                    <div
                      className="relative cursor-help"
                      onClick={() =>
                        setOpenTip(openTip === "ilsCtx" ? null : "ilsCtx")
                      }
                    >
                      <span className={iLabel.color}>{iLabel.text}</span> shekel
                      ({data.ilsPct}th pctl){" "}
                      <span className="text-gray-700">ⓘ</span>
                      <p className="truncate">
                        {data.ilsRangeLow > 0 ? data.ilsRangeLow : "..."} –{" "}
                        {data.ilsRangeHigh > 0 ? data.ilsRangeHigh : "..."}
                      </p>
                      {openTip === "ilsCtx" && (
                        <div className="absolute bottom-full right-0 mb-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-[10px] text-gray-300 w-52 z-10 shadow-lg leading-relaxed">
                          <p className="font-semibold text-gray-200 mb-1">
                            USD/ILS Exchange Rate
                          </p>
                          <p>
                            The shekel is at the{" "}
                            <span className="text-yellow-400">
                              {data.ilsPct}th percentile
                            </span>{" "}
                            of its {rangeLabel} range.
                          </p>
                          <p className="mt-1">
                            {data.ilsPct <= 25
                              ? "Strong shekel — you get more gold per ₪. Good for buying."
                              : data.ilsPct <= 50
                                ? "Average — exchange rate is near its mid-range."
                                : data.ilsPct <= 75
                                  ? "Weak shekel — you get less gold per ₪."
                                  : "Very weak shekel — unfavorable rate for buying gold."}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-700/30 space-y-2">
                    <p className="text-xs text-gray-500">
                      Price Change in ₪ ({rangeLabel})
                    </p>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p
                        className={`text-sm font-semibold ${data.ilsPriceChangePct < -0.5 ? "text-emerald-400" : data.ilsPriceChangePct > 2 ? "text-red-400" : "text-yellow-400"}`}
                      >
                        {data.ilsPriceChange > 0 ? "+" : ""}₪
                        {formatNumber(Math.abs(data.ilsPriceChange))}
                        <span className="ml-1 text-xs">
                          ({data.ilsPriceChangePct > 0 ? "+" : ""}
                          {data.ilsPriceChangePct}%)
                        </span>
                      </p>
                      <span className="text-[10px] text-gray-600">
                        {data.ilsPriceChangePct < -2
                          ? "Significant dip — good entry"
                          : data.ilsPriceChangePct < -0.5
                            ? "Price dipping"
                            : data.ilsPriceChangePct > 5
                              ? "Sharp rise — consider waiting"
                              : data.ilsPriceChangePct > 2
                                ? "Price rising"
                                : "Stable"}
                      </span>
                    </div>
                    {data.ilsPriceStart > 0 && (
                      <p className="text-[10px] text-gray-600">
                        ₪{formatNumber(data.ilsPriceStart)} → ₪
                        {formatNumber(data.goldPriceILS)} per oz
                      </p>
                    )}
                  </div>

                  {data.technical && (
                    <div className="pt-3 border-t border-gray-700/30 space-y-2">
                      <p className="text-xs text-gray-500">
                        Technical Indicators (1 year daily)
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
                        {[
                          {
                            label: "SMA 20",
                            val: data.technical.sma20,
                            tip: "20-day average — short-term trend",
                          },
                          {
                            label: "SMA 50",
                            val: data.technical.sma50,
                            tip: "50-day average — mid-term trend",
                          },
                          {
                            label: "SMA 200",
                            val: data.technical.sma200,
                            tip: "200-day average — long-term trend",
                          },
                          {
                            label: "RSI",
                            val: data.technical.rsi,
                            tip: "Relative Strength Index — overbought or oversold",
                          },
                          {
                            label: "MACD",
                            val: data.technical.macd,
                            tip: "Moving Average Convergence — momentum direction",
                          },
                        ].map((ind) => (
                          <div
                            key={ind.label}
                            className="bg-gray-900/50 rounded-lg py-2 px-1 relative cursor-help"
                            onClick={() =>
                              setOpenTip(
                                openTip === ind.label ? null : ind.label,
                              )
                            }
                          >
                            <p className="text-[10px] text-gray-500">
                              {ind.label}
                            </p>
                            <p
                              className={`text-xs font-bold ${techSigColor(ind.val)}`}
                            >
                              {techSigLabel(ind.val)}
                            </p>
                            {openTip === ind.label && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-[10px] text-gray-300 whitespace-nowrap z-10 shadow-lg">
                                {ind.tip}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Karat Selector */}
            <div className="bg-gray-800/30 border border-gray-700/40 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-300">
                  Gold Purity
                </h2>
                <span className="text-xs text-gray-500">
                  {(purity * 100).toFixed(1)}% pure
                </span>
              </div>
              <div className="flex gap-1.5 sm:gap-2">
                {KARATS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setKarat(k)}
                    className={`flex-1 py-2 sm:py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all ${
                      karat === k
                        ? "bg-gradient-to-b from-yellow-500/30 to-amber-600/20 text-yellow-300 border border-yellow-500/40 shadow-lg shadow-yellow-500/10"
                        : "bg-gray-900/50 text-gray-400 border border-gray-700/40 hover:text-gray-200 hover:border-gray-600"
                    }`}
                  >
                    {k}K
                  </button>
                ))}
              </div>
            </div>

            {/* Ready Pieces */}
            <div className="bg-gray-800/30 border border-gray-700/40 rounded-3xl p-4 sm:p-8 space-y-4 sm:space-y-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base sm:text-lg font-semibold text-gray-200">
                  Ready Gold Pieces
                </h2>
                <span className="text-xs text-yellow-400/70 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2.5 py-0.5 font-medium shrink-0">
                  {karat}K · {(purity * 100).toFixed(0)}%
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {GOLD_PIECES.map((piece) => {
                  const qty = getQty(piece.name);
                  const market = piecePrice(piece.grams, qty);
                  const sellerVal = parseFloat(sellerPrices[piece.name] || "");
                  const hasSellerPrice = !isNaN(sellerVal) && sellerVal > 0;
                  const profit = hasSellerPrice ? sellerVal - market : 0;
                  const greatThreshold = piece.great * qty;
                  const goodThreshold = piece.good * qty;
                  const sliderPos = hasSellerPrice
                    ? getPricePosition(profit, greatThreshold, goodThreshold)
                    : 0;
                  const sliderColor = hasSellerPrice
                    ? getSliderColor(profit, greatThreshold, goodThreshold)
                    : "#10b981";
                  const zone = hasSellerPrice
                    ? getZoneLabel(profit, greatThreshold, goodThreshold)
                    : null;
                  const maxBar = goodThreshold * 1.5;
                  const greatPct = (greatThreshold / maxBar) * 100;
                  const goodPct = (goodThreshold / maxBar) * 100;
                  const normalPct = ((goodThreshold * 1.2) / maxBar) * 100;
                  const barGradient = `linear-gradient(to right, #10b981 0%, #10b981 ${greatPct}%, #22c55e ${greatPct}%, #22c55e ${goodPct}%, #eab308 ${goodPct}%, #eab308 ${normalPct}%, #f97316 ${normalPct}%, #f97316 100%)`;

                  return (
                    <div
                      key={piece.name}
                      className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-3 sm:p-5 space-y-3 sm:space-y-4 transition-colors"
                    >
                      <div className="flex items-start sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <span className="text-xl sm:text-2xl shrink-0">
                            {piece.emoji}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-200">
                              {piece.name}
                            </p>
                            <p className="text-[11px] sm:text-xs text-gray-500 truncate">
                              {piece.nameAr} · {piece.grams}g
                            </p>
                            {!piece.hasCraft && (
                              <p className="text-[10px] text-gray-600 truncate">
                                great &lt;₪{piece.great} · good ≤₪{piece.good}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setQty(piece.name, qty - 1)}
                            className="w-7 h-7 rounded-lg bg-gray-800 border border-gray-600/50 text-gray-400 hover:text-white hover:border-gray-500 flex items-center justify-center text-sm transition-colors"
                          >
                            −
                          </button>
                          <span className="w-8 text-center text-sm font-medium text-white">
                            {qty}
                          </span>
                          <button
                            onClick={() => setQty(piece.name, qty + 1)}
                            className="w-7 h-7 rounded-lg bg-gray-800 border border-gray-600/50 text-gray-400 hover:text-white hover:border-gray-500 flex items-center justify-center text-sm transition-colors"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs text-gray-500">Market Price</p>
                          <p className="text-base sm:text-lg font-bold text-yellow-400">
                            ₪{formatNumber(market)}
                          </p>
                          <p className="text-[11px] sm:text-xs text-gray-600">
                            ${formatNumber(piecePriceUSD(piece.grams, qty))}
                          </p>
                          {piece.hasCraft && (
                            <p className="text-[10px] text-gray-500">
                              ₪{formatNumber(market / (piece.grams * qty))}/g gold
                            </p>
                          )}
                        </div>
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs text-gray-500">
                            Seller Price (₪)
                          </p>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="Enter price..."
                            value={sellerPrices[piece.name] || ""}
                            onChange={(e) =>
                              setSellerPrice(piece.name, e.target.value)
                            }
                            className="w-full bg-gray-800/60 border border-gray-600/40 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/20 transition-all"
                          />
                        </div>
                      </div>

                      {!piece.hasCraft && hasSellerPrice && zone && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-1 text-xs flex-wrap">
                            <span
                              style={{ color: sliderColor }}
                              className="font-bold"
                            >
                              {zone}
                            </span>
                            <span
                              className={`${profit > 0 ? "text-gray-400" : "text-emerald-400"} text-[11px] sm:text-xs`}
                            >
                              {profit > 0
                                ? `+₪${formatNumber(profit)}`
                                : `-₪${formatNumber(Math.abs(profit))}`}
                            </span>
                          </div>
                          <div
                            className="relative h-3 rounded-full overflow-hidden"
                            style={{ background: barGradient }}
                          >
                            <div
                              className="absolute top-[-2px] w-5 h-[calc(100%+4px)] rounded-full border-2 border-white shadow-lg transition-all duration-300"
                              style={{
                                left: `calc(${Math.min(sliderPos, 98)}% - 10px)`,
                                backgroundColor: sliderColor,
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-600">
                            <span>Great</span>
                            <span>Good</span>
                            <span>Normal</span>
                            <span>High</span>
                            <span>Too High</span>
                          </div>
                        </div>
                      )}

                      {piece.hasCraft && hasSellerPrice && (() => {
                        const craftTotal = Math.max(0, sellerVal - market);
                        const craftPerGram = craftTotal / (piece.grams * qty);
                        const craftZone = getCraftZone(craftPerGram);
                        const craftPos = getCraftSliderPos(craftPerGram);
                        const craftBar = "linear-gradient(to right, #10b981 0%, #10b981 25%, #22c55e 25%, #22c55e 50%, #eab308 50%, #eab308 58%, #f97316 58%, #f97316 83%, #ef4444 83%, #ef4444 100%)";
                        return (
                          <div className="space-y-1.5 bg-gray-800/40 rounded-lg px-3 py-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-gray-500">Craft Fee /gram</span>
                              <span className="text-xs font-bold" style={{ color: craftZone.color }}>
                                ₪{formatNumber(craftPerGram)}/g · {craftZone.label}
                              </span>
                            </div>
                            <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: craftBar }}>
                              <div
                                className="absolute top-[-2px] w-4 h-[calc(100%+4px)] rounded-full border-2 border-white shadow-lg transition-all duration-300"
                                style={{ left: `calc(${Math.min(craftPos, 97)}% - 8px)`, backgroundColor: craftZone.color }}
                              />
                            </div>
                            <div className="flex justify-between text-[9px] text-gray-600">
                              <span>Great</span>
                              <span>₪30</span>
                              <span>₪60</span>
                              <span>₪70</span>
                              <span>₪100</span>
                            </div>
                            <div className="flex items-center justify-between pt-1.5 border-t border-gray-700/30 mt-1.5">
                              <span className="text-[11px] text-gray-500">Seller price /gram</span>
                              <span className="text-xs font-semibold text-gray-300">
                                ₪{formatNumber(sellerVal / (piece.grams * qty))}/g
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-gray-500">Seller profit</span>
                              <span className={`text-xs font-semibold ${craftTotal > 0 ? "text-gray-400" : "text-emerald-400"}`}>
                                {craftTotal > 0 ? "+" : ""}₪{formatNumber(craftTotal)}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Calculator Card */}
            <div className="bg-gray-800/30 border border-gray-700/40 rounded-3xl p-4 sm:p-8 space-y-4 sm:space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-semibold text-gray-200">
                  Custom Calculator
                </h2>
                <span className="text-xs text-yellow-400/70 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2.5 py-0.5 font-medium">
                  {karat}K · {(purity * 100).toFixed(0)}%
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Weight Input */}
                <div>
                  <label className="text-sm text-gray-400 block mb-2">
                    Weight
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={customWeight}
                    onChange={(e) => setCustomWeight(e.target.value)}
                    className="w-full bg-gray-900/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white text-lg focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/30 transition-all"
                  />
                </div>

                {/* Unit Selector */}
                <div>
                  <label className="text-sm text-gray-400 block mb-2">
                    Unit
                  </label>
                  <div className="flex gap-1 bg-gray-900/60 border border-gray-600/50 rounded-xl p-1">
                    {(Object.keys(WEIGHT_LABELS) as WeightUnit[]).map((u) => (
                      <button
                        key={u}
                        onClick={() => setUnit(u)}
                        className={`flex-1 py-2.5 text-xs sm:text-sm font-medium rounded-lg transition-all ${
                          unit === u
                            ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                            : "text-gray-400 hover:text-gray-200 border border-transparent"
                        }`}
                      >
                        {WEIGHT_LABELS[u]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Seller Asking Price */}
              <div>
                <label className="text-sm text-gray-400 block mb-2">
                  Seller Asking Price (₪)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Enter seller price..."
                  value={customSellerPrice}
                  onChange={(e) => setCustomSellerPrice(e.target.value)}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white text-lg focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/30 transition-all"
                />
              </div>

              {/* Result */}
              <div className="bg-gradient-to-r from-yellow-500/10 to-amber-500/5 border border-yellow-500/20 rounded-2xl p-4 sm:p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm text-gray-400 mb-1">
                      Value in USD
                    </p>
                    <p className="text-xl sm:text-2xl font-bold text-white">
                      ${formatNumber(getPriceForUnitUSD(data.goldPriceUSD))}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm text-gray-400 mb-1">
                      Value in ₪
                    </p>
                    <p className="text-xl sm:text-2xl font-bold text-yellow-400">
                      ₪{formatNumber(getPriceForUnit(data.goldPriceILS))}
                    </p>
                    {(() => {
                      const w = parseFloat(customWeight) || 0;
                      const totalGrams = unit === "oz" ? w * 31.1035 : unit === "kg" ? w * 1000 : w;
                      if (totalGrams <= 0) return null;
                      return (
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          ₪{formatNumber(getPriceForUnit(data.goldPriceILS) / totalGrams)}/g gold
                        </p>
                      );
                    })()}
                  </div>
                </div>

                {(() => {
                  const sellerVal = parseFloat(customSellerPrice);
                  const marketILS = getPriceForUnit(data.goldPriceILS);
                  if (isNaN(sellerVal) || sellerVal <= 0 || marketILS <= 0)
                    return null;
                  const w = parseFloat(customWeight) || 0;
                  const totalGrams = unit === "oz" ? w * 31.1035 : unit === "kg" ? w * 1000 : w;
                  const craftTotal = Math.max(0, sellerVal - marketILS);
                  const craftPerGram = totalGrams > 0 ? craftTotal / totalGrams : 0;
                  const craftZone = getCraftZone(craftPerGram);
                  const craftPos = getCraftSliderPos(craftPerGram);
                  const craftBar = "linear-gradient(to right, #10b981 0%, #10b981 25%, #22c55e 25%, #22c55e 50%, #eab308 50%, #eab308 58%, #f97316 58%, #f97316 83%, #ef4444 83%, #ef4444 100%)";
                  return (
                    <div className="pt-4 border-t border-yellow-500/10 space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Craft Fee /gram</span>
                          <span className="text-xs font-bold" style={{ color: craftZone.color }}>
                            ₪{formatNumber(craftPerGram)}/g · {craftZone.label}
                          </span>
                        </div>
                        <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: craftBar }}>
                          <div
                            className="absolute top-[-2px] w-4 h-[calc(100%+4px)] rounded-full border-2 border-white shadow-lg transition-all duration-300"
                            style={{ left: `calc(${Math.min(craftPos, 97)}% - 8px)`, backgroundColor: craftZone.color }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-gray-600">
                          <span>Great</span>
                          <span>₪30</span>
                          <span>₪60</span>
                          <span>₪70</span>
                          <span>₪100</span>
                        </div>
                      </div>
                      <div className="space-y-1.5 pt-1 border-t border-yellow-500/10">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Gold price /gram</span>
                          <span className="text-xs text-gray-400">
                            ₪{formatNumber(totalGrams > 0 ? marketILS / totalGrams : 0)}/g
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Seller price /gram</span>
                          <span className="text-xs font-semibold text-gray-300">
                            ₪{formatNumber(totalGrams > 0 ? sellerVal / totalGrams : 0)}/g
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Seller profit</span>
                          <span className={`text-xs font-semibold ${craftTotal > 0 ? "text-gray-400" : "text-emerald-400"}`}>
                            {craftTotal > 0 ? "+" : ""}₪{formatNumber(craftTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer */}
            <div className="text-center text-xs text-gray-600 space-y-1">
              {lastRefresh && <p>Last updated: {formatTime(lastRefresh)}</p>}
              <p>Auto-refreshes every minute · Prices are indicative</p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
