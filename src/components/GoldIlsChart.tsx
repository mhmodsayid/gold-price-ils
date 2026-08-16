"use client";

import { useId, useMemo, useState } from "react";

export type ChartPeriod = "yearly" | "monthly" | "weekly" | "daily";
export type ChartKarat = 24 | 22 | 21 | 18 | 14;

export interface GoldIlsChartPoint {
  t: number;
  v: number;
}

const PERIODS: { id: ChartPeriod; label: string }[] = [
  { id: "daily", label: "24h" },
  { id: "weekly", label: "7d" },
  { id: "monthly", label: "30d" },
  { id: "yearly", label: "1Y" },
];

const KARATS: ChartKarat[] = [24, 22, 21, 18, 14];
const TROY_OZ_GRAMS = 31.1035;

const W = 640;
const H = 220;
const PAD = { l: 12, r: 64, t: 18, b: 32 };

function formatIls(n: number, digits = 0) {
  return (
    "₪" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}

function formatAxisTime(t: number, period: ChartPeriod) {
  const d = new Date(t);
  if (period === "daily") {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }
  if (period === "yearly") {
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTooltipTime(t: number, period: ChartPeriod) {
  const d = new Date(t);
  if (period === "daily") {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: period === "yearly" ? "numeric" : undefined,
  });
}

export function GoldIlsChart({
  points,
  period,
  onPeriodChange,
  karat,
  onKaratChange,
}: {
  points: GoldIlsChartPoint[];
  period: ChartPeriod;
  onPeriodChange: (p: ChartPeriod) => void;
  karat: ChartKarat;
  onKaratChange: (k: ChartKarat) => void;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const purity = karat / 24;

  const scaled = useMemo(
    () =>
      points.map((p) => ({
        t: p.t,
        v: (p.v / TROY_OZ_GRAMS) * purity,
        oz: p.v * purity,
      })),
    [points, purity],
  );

  const stats = useMemo(() => {
    if (scaled.length === 0) return null;
    const values = scaled.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const last = scaled[scaled.length - 1].v;
    const span = max - min || Math.abs(last) * 0.02 || 1;
    const yMin = min - span * 0.08;
    const yMax = max + span * 0.08;
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const xAt = (i: number) =>
      PAD.l + (scaled.length === 1 ? innerW / 2 : (i / (scaled.length - 1)) * innerW);
    const yAt = (v: number) =>
      PAD.t + ((yMax - v) / (yMax - yMin)) * innerH;
    const coords = scaled.map((p, i) => ({ x: xAt(i), y: yAt(p.v), ...p }));
    const line = coords
      .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
      .join(" ");
    const area = `${line} L ${coords[coords.length - 1].x.toFixed(2)} ${PAD.t + innerH} L ${coords[0].x.toFixed(2)} ${PAD.t + innerH} Z`;
    const ticks = [yMax, (yMin + yMax) / 2, yMin];
    const xLabels =
      coords.length < 3
        ? coords
        : [coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]];
    return { min, max, last, coords, line, area, ticks, xLabels, yMin, yMax };
  }, [scaled]);

  const active =
    hover !== null && stats ? stats.coords[hover] : stats?.coords[stats.coords.length - 1];
  const displayChange = stats && active ? active.v - stats.coords[0].v : 0;
  const displayChangePct =
    stats && stats.coords[0].v !== 0
      ? (displayChange / stats.coords[0].v) * 100
      : 0;
  const up = displayChangePct >= 0;

  const onPointer = (clientX: number, target: SVGSVGElement) => {
    if (!stats) return;
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < stats.coords.length; i++) {
      const d = Math.abs(stats.coords[i].x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  };

  return (
    <div className="relative overflow-hidden bg-gray-800/30 border border-gray-700/40 rounded-3xl p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-gray-200">
            Gold Price Chart
          </h2>
          <p className="text-xs text-gray-500">
            ₪ per gram · {karat}K · {(purity * 100).toFixed(1)}% pure
          </p>
        </div>
        <div className="flex gap-1 bg-gray-900/60 border border-gray-700/50 rounded-xl p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => onPeriodChange(p.id)}
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                period === p.id
                  ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                  : "text-gray-400 hover:text-gray-200 border border-transparent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 sm:gap-2">
        {KARATS.map((k) => (
          <button
            key={k}
            onClick={() => onKaratChange(k)}
            className={`flex-1 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-xl transition-all ${
              karat === k
                ? "bg-gradient-to-b from-yellow-500/30 to-amber-600/20 text-yellow-300 border border-yellow-500/40"
                : "bg-gray-900/50 text-gray-400 border border-gray-700/40 hover:text-gray-200 hover:border-gray-600"
            }`}
          >
            {k}K
          </button>
        ))}
      </div>

      {stats && (
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-2xl sm:text-3xl font-bold text-yellow-400">
            {formatIls(active?.v ?? stats.last, 2)}
            <span className="text-sm sm:text-base font-semibold text-yellow-400/70 ml-1">
              /g
            </span>
          </p>
          <p
            className={`text-sm font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}
          >
            {displayChange > 0 ? "+" : displayChange < 0 ? "−" : ""}
            {formatIls(Math.abs(displayChange), 2)}{" "}
            ({displayChangePct > 0 ? "+" : ""}
            {displayChangePct.toFixed(2)}%)
          </p>
          {active && (
            <p className="text-xs text-gray-500">
              {formatIls(active.oz, 2)}/oz
            </p>
          )}
        </div>
      )}

      {!stats ? (
        <div className="h-40 flex items-center justify-center text-sm text-gray-500">
          Chart data unavailable for this period.
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto touch-none cursor-crosshair"
            role="img"
            aria-label={`Gold price in shekels per gram at ${karat} karat, currently ${formatIls(stats.last, 2)}`}
            onMouseMove={(e) => onPointer(e.clientX, e.currentTarget)}
            onMouseLeave={() => setHover(null)}
            onTouchStart={(e) => onPointer(e.touches[0].clientX, e.currentTarget)}
            onTouchMove={(e) => onPointer(e.touches[0].clientX, e.currentTarget)}
          >
            <defs>
              <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#eab308" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#eab308" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${gid}-stroke`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#facc15" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>

            {stats.ticks.map((tick, i) => {
              const y =
                PAD.t +
                ((stats.yMax - tick) / (stats.yMax - stats.yMin)) * (H - PAD.t - PAD.b);
              return (
                <g key={i}>
                  <line
                    x1={PAD.l}
                    x2={W - PAD.r}
                    y1={y}
                    y2={y}
                    stroke="#374151"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={W - PAD.r + 8}
                    y={y + 4}
                    fill="#9ca3af"
                    fontSize="11"
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                  >
                    {formatIls(tick, 1)}
                  </text>
                </g>
              );
            })}

            <path d={stats.area} fill={`url(#${gid}-fill)`} />
            <path
              d={stats.line}
              fill="none"
              stroke={`url(#${gid}-stroke)`}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {active && (
              <>
                <line
                  x1={active.x}
                  x2={active.x}
                  y1={PAD.t}
                  y2={H - PAD.b}
                  stroke="#eab308"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                />
                <circle
                  cx={active.x}
                  cy={active.y}
                  r="5"
                  fill="#111827"
                  stroke="#facc15"
                  strokeWidth="2.5"
                />
              </>
            )}

            {stats.xLabels.map((c, i) => (
              <text
                key={i}
                x={c.x}
                y={H - 8}
                fill="#6b7280"
                fontSize="11"
                textAnchor={i === 0 ? "start" : i === stats.xLabels.length - 1 ? "end" : "middle"}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {formatAxisTime(c.t, period)}
              </text>
            ))}
          </svg>

          {hover !== null && active && (
            <div
              className="pointer-events-none absolute top-2 rounded-xl bg-gray-950/95 border border-yellow-500/30 px-3 py-2 shadow-xl text-xs"
              style={{
                left: `${Math.min(Math.max((active.x / W) * 100, 18), 82)}%`,
                transform: "translateX(-50%)",
              }}
            >
              <p className="text-gray-400">{formatTooltipTime(active.t, period)}</p>
              <p className="text-yellow-300 font-semibold">
                {formatIls(active.v, 2)}/g
              </p>
              <p className="text-gray-500">
                {formatIls(active.oz, 2)}/oz · {karat}K
              </p>
            </div>
          )}
        </div>
      )}

      {stats && (
        <div className="flex justify-between text-[11px] text-gray-500">
          <span>Low {formatIls(stats.min, 2)}/g</span>
          <span>High {formatIls(stats.max, 2)}/g</span>
        </div>
      )}
    </div>
  );
}
