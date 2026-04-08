"use client";

import { DashboardLaneSnapshot } from "@/lib/simulation/domain/snapshots";

type LaneScoresCardProps = {
  lanes: DashboardLaneSnapshot[];
  compact?: boolean;
};

function scoreColor(score: number) {
  if (score < 0.35) {
    return "#58c472";
  }
  if (score < 0.65) {
    return "#f7b84b";
  }
  return "#f0645d";
}

function scoreTone(score: number) {
  if (score < 0.35) {
    return "Stable";
  }
  if (score < 0.65) {
    return "Building";
  }
  return "Critical";
}

export function LaneScoresCard({ lanes, compact = false }: LaneScoresCardProps) {
  const visibleLanes = compact ? [...lanes].sort((a, b) => b.score - a.score) : lanes;

  return (
    <section className="card card-section">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Lane Health</p>
          <h2>Approach Pressure Map</h2>
        </div>
        <p className="section-copy">
          {compact ? "Top pressure points on the main simulation screen." : "Queue, wait, and lane score grouped into cards so you can spot unstable approaches fast."}
        </p>
      </div>
      <div className="lane-card-list">
        {visibleLanes.map((lane) => (
          <div className="lane-card" key={lane.id}>
            <div className="lane-header">
              <div>
                <strong>{lane.label}</strong>
                <p className="lane-meta">{scoreTone(lane.score)}</p>
              </div>
              <span className="lane-score-chip" style={{ color: scoreColor(lane.score) }}>
                {lane.score.toFixed(2)}
              </span>
            </div>
            <div className="score-track">
              <div
                className="score-fill"
                style={{ width: `${Math.min(100, lane.score * 100)}%`, background: scoreColor(lane.score) }}
              />
            </div>
            <div className="lane-stats">
              <div className="lane-stat">
                <span>Queue</span>
                <strong>{lane.queueLength}</strong>
              </div>
              <div className="lane-stat">
                <span>Cars</span>
                <strong>{lane.carCount}</strong>
              </div>
              <div className="lane-stat">
                <span>Wait</span>
                <strong>{lane.waitSeconds.toFixed(0)}s</strong>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
