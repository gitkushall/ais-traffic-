"use client";

import { MetricSample } from "@/lib/simulation/domain/models";

type SparklineProps = {
  samples: number[];
  color: string;
  height?: number;
};

function Sparkline({ samples, color, height = 40 }: SparklineProps) {
  if (samples.length < 2) {
    return <svg width="100%" height={height} />;
  }
  const max = Math.max(...samples, 1);
  const w = 200;
  const h = height;
  const pts = samples.map((v, i) => {
    const x = (i / (samples.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const areaBottom = `${w},${h} 0,${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`${pts.join(" ")} ${areaBottom}`} fill={`url(#grad-${color.replace("#", "")})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

type MetricsChartProps = {
  history: MetricSample[];
  vehiclesServedCount: number;
};

export function MetricsChart({ history, vehiclesServedCount }: MetricsChartProps) {
  const throughput = history.map((s) => s.vehiclesServed);
  const waitTimes  = history.map((s) => s.avgWaitSeconds);
  const queues     = history.map((s) => s.totalQueue);

  const latestThroughput = throughput.at(-1) ?? 0;
  const latestWait       = waitTimes.at(-1) ?? 0;
  const latestQueue      = queues.at(-1) ?? 0;

  return (
    <section className="card card-section metrics-chart-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Performance</p>
          <h2>Live Metrics</h2>
        </div>
        <span className="hero-badge">{vehiclesServedCount} served</span>
      </div>

      <div className="metrics-grid">
        <div className="metric-chart-block">
          <div className="metric-chart-header">
            <span>Throughput</span>
            <strong>{latestThroughput} <small>veh/5s</small></strong>
          </div>
          <Sparkline samples={throughput} color="#22c55e" height={44} />
        </div>

        <div className="metric-chart-block">
          <div className="metric-chart-header">
            <span>Avg Wait</span>
            <strong>{latestWait.toFixed(1)} <small>s</small></strong>
          </div>
          <Sparkline samples={waitTimes} color="#f59e0b" height={44} />
        </div>

        <div className="metric-chart-block">
          <div className="metric-chart-header">
            <span>Queue Depth</span>
            <strong>{latestQueue} <small>veh</small></strong>
          </div>
          <Sparkline samples={queues} color="#6366f1" height={44} />
        </div>
      </div>
    </section>
  );
}
