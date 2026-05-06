"use client";

import { ComparisonStats } from "@/lib/simulation/domain/models";
import { SimulationCommand } from "@/lib/simulation/domain/models";

type ComparisonPanelProps = {
  isFixedCycle: boolean;
  comparison: ComparisonStats;
  dispatch: (command: SimulationCommand) => void;
};

function DeltaBadge({ adaptive, fixed, lowerIsBetter = false }: { adaptive: number; fixed: number; lowerIsBetter?: boolean }) {
  if (adaptive === 0 && fixed === 0) return <span className="delta-badge is-neutral">—</span>;
  const diff = adaptive - fixed;
  const pct = fixed !== 0 ? Math.abs(diff / fixed) * 100 : 0;
  const adaptiveWins = lowerIsBetter ? diff < 0 : diff > 0;
  const label = adaptiveWins
    ? `AI ${pct.toFixed(0)}% better`
    : diff === 0
      ? "Equal"
      : `Fixed ${pct.toFixed(0)}% better`;
  return (
    <span className={`delta-badge ${adaptiveWins ? "is-win" : diff === 0 ? "is-neutral" : "is-loss"}`}>
      {label}
    </span>
  );
}

export function ComparisonPanel({ isFixedCycle, comparison, dispatch }: ComparisonPanelProps) {
  const hasData = comparison.adaptiveThroughput > 0 || comparison.fixedThroughput > 0;

  return (
    <section className="card card-section comparison-panel">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Research Tool</p>
          <h2>AI vs Fixed Cycle</h2>
        </div>
        <button
          className={`mode-toggle-btn ${isFixedCycle ? "is-fixed" : "is-adaptive"}`}
          onClick={() => dispatch({ type: "toggleControllerMode" })}
        >
          {isFixedCycle ? "⟳ Fixed 30s" : "⚡ AI Adaptive"}
        </button>
      </div>

      <div className={`mode-indicator ${isFixedCycle ? "is-fixed" : "is-adaptive"}`}>
        <div className="mode-dot" />
        <div>
          <strong>{isFixedCycle ? "Fixed-Cycle Controller" : "AI Adaptive Controller"}</strong>
          <p>
            {isFixedCycle
              ? "Phases rotate on a dumb 30-second timer — no traffic awareness"
              : "AI scores every lane every 600ms and switches to highest-pressure phase"}
          </p>
        </div>
      </div>

      {hasData ? (
        <div className="comparison-table">
          <div className="comparison-header-row">
            <span>Metric</span>
            <span>AI Adaptive</span>
            <span>Fixed 30s</span>
            <span>Result</span>
          </div>
          <div className="comparison-row">
            <span>Throughput</span>
            <strong className="is-adaptive-val">{comparison.adaptiveThroughput}</strong>
            <strong className="is-fixed-val">{comparison.fixedThroughput}</strong>
            <DeltaBadge adaptive={comparison.adaptiveThroughput} fixed={comparison.fixedThroughput} />
          </div>
          <div className="comparison-row">
            <span>Avg Wait (s)</span>
            <strong className="is-adaptive-val">{comparison.adaptiveAvgWait.toFixed(1)}</strong>
            <strong className="is-fixed-val">{comparison.fixedAvgWait.toFixed(1)}</strong>
            <DeltaBadge adaptive={comparison.adaptiveAvgWait} fixed={comparison.fixedAvgWait} lowerIsBetter />
          </div>
          <div className="comparison-row">
            <span>Avg Queue</span>
            <strong className="is-adaptive-val">{comparison.adaptiveQueue.toFixed(1)}</strong>
            <strong className="is-fixed-val">{comparison.fixedQueue.toFixed(1)}</strong>
            <DeltaBadge adaptive={comparison.adaptiveQueue} fixed={comparison.fixedQueue} lowerIsBetter />
          </div>
        </div>
      ) : (
        <p className="comparison-hint">
          Switch between modes during the same scenario to build comparison data. Stats accumulate per mode.
        </p>
      )}
    </section>
  );
}
