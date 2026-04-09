"use client";

import { LaneId, MovementLane, TurnIntent } from "@/lib/simulation/domain/enums";
import { SceneSnapshot } from "@/lib/simulation/domain/snapshots";
import { DashboardPhaseSnapshot } from "@/lib/simulation/domain/snapshots";

type ActivePhaseCardProps = {
  phase: DashboardPhaseSnapshot;
  weatherLabel?: string;
  analytics?: {
    tick: number;
    stage: string;
    phaseScores: Array<{ key: string; score: number }>;
    emergencyServedCount: number;
    pedestrianServedCount: number;
  };
  compact?: boolean;
  scene?: SceneSnapshot;
};

type LeadBlocker = {
  laneId: LaneId;
  label: string;
  waitReason: string;
  movementLane: MovementLane;
  intent: TurnIntent;
  state: string;
  progress: number;
  leadVehicleId: string | null;
  gapToLeader: number;
};

function currentPhaseApproaches(currentLabel: string) {
  if (currentLabel.startsWith("N/S")) {
    return new Set(["north", "south"]);
  }
  if (currentLabel.startsWith("E/W")) {
    return new Set(["east", "west"]);
  }
  return new Set<string>();
}

function readableWaitReason(waitReason: string) {
  return waitReason.replaceAll("_", " ");
}

export function ActivePhaseCard({ phase, weatherLabel, analytics, compact = false, scene }: ActivePhaseCardProps) {
  const emergencySummary = phase.emergency.detected
    ? `${phase.emergency.type?.replaceAll("_", " ")} on ${phase.emergency.laneId} ${phase.emergency.movementLane}`
    : "No active emergency vehicle";
  const activeApproaches = currentPhaseApproaches(phase.currentLabel);
  const leadBlockers =
    scene && phase.stageLabel.toLowerCase() === "green"
      ? scene.lanes
          .filter((lane) => activeApproaches.has(lane.id))
          .flatMap((lane) => {
            const leadVehicle = [...lane.vehicles].sort((a, b) => b.progress - a.progress)[0];
            if (!leadVehicle) {
              return [];
            }
            return [{
              laneId: lane.id,
              label: lane.label,
              waitReason: leadVehicle.waitReason,
              movementLane: leadVehicle.movementLane,
              intent: leadVehicle.intent,
              state: leadVehicle.state,
              progress: leadVehicle.progress,
              leadVehicleId: leadVehicle.leadVehicleId,
              gapToLeader: leadVehicle.gapToLeader,
            }];
          })
      : [];

  return (
    <section className="card card-section phase-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Signal State</p>
          <h2>Current Decision</h2>
        </div>
        <span className={`stage-badge is-${phase.stageLabel.toLowerCase().replaceAll(" ", "-")}`}>{phase.stageLabel}</span>
      </div>

      <div className="phase-hero">
        <div>
          <p className="phase-label">Current phase</p>
          <h3>{phase.currentLabel}</h3>
          <p className="phase-subtitle">Next up: {phase.nextLabel}</p>
        </div>
        <div className="phase-timer">
          <span>Green remaining</span>
          <strong>{phase.greenRemaining.toFixed(1)}s</strong>
        </div>
      </div>

      <div className="phase-meta-grid">
        <div className="metric-tile">
          <span>Controller mode</span>
          <strong>{phase.controllerMode.replaceAll("_", " ")}</strong>
        </div>
        <div className="metric-tile">
          <span>Walk crossings</span>
          <strong>{analytics?.pedestrianServedCount ?? 0}</strong>
        </div>
        <div className="metric-tile">
          <span>Weather</span>
          <strong>{weatherLabel ?? "Clear"}</strong>
        </div>
        <div className="metric-tile">
          <span>Tick</span>
          <strong>{analytics?.tick ?? 0}</strong>
        </div>
      </div>

      <div className={`alert-strip ${phase.preemptionActive ? "is-alert" : ""}`}>
        <strong>{phase.preemptionActive ? "Priority override" : "Adaptive reasoning"}</strong>
        <span>{phase.reason}</span>
      </div>

      <div className="phase-inline-grid">
        <div className="detail-block">
          <span className="detail-label">Emergency</span>
          <strong>{emergencySummary}</strong>
          <small>
            {phase.emergency.detected && phase.emergency.distanceToStop !== null
              ? `${phase.emergency.distanceToStop.toFixed(0)}px to stop line`
              : "No preemption trigger in queue"}
          </small>
        </div>
        <div className="detail-block">
          <span className="detail-label">Pedestrian release</span>
          <strong>{phase.walkCrossings.length > 0 ? phase.walkCrossings.join(", ") : "Hold"}</strong>
          <small>{phase.preemptionActive ? "Crossings constrained by priority service" : "Crossings follow conflict-safe release"}</small>
        </div>
      </div>

      {leadBlockers.length > 0 ? (
        <div className="phase-score-list">
          {leadBlockers.map((blocker) => (
            <div className="phase-score-row" key={blocker.laneId}>
              <span>{blocker.label}</span>
              <div>
                <strong>{readableWaitReason(blocker.waitReason)}</strong>
                <small>
                  {blocker.movementLane} {blocker.intent} | {blocker.state}
                </small>
              </div>
              <strong>{Number.isFinite(blocker.gapToLeader) ? blocker.gapToLeader.toFixed(0) : "free"}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {!compact && analytics ? (
        <div className="phase-score-list">
          {analytics.phaseScores.map((item) => (
            <div className="phase-score-row" key={item.key}>
              <span>{item.key.replaceAll("_", " ")}</span>
              <div className="phase-score-track">
                <div className="phase-score-fill" style={{ width: `${Math.min(100, item.score * 100)}%` }} />
              </div>
              <strong>{item.score.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
