"use client";

import { DashboardControlsSnapshot } from "@/lib/simulation/domain/snapshots";

type ControlsCardProps = {
  controls: DashboardControlsSnapshot;
  onToggleRun: () => void;
  onToggleDebug: () => void;
  onSetSpeed: (speed: number) => void;
  onSetWeights: (weights: DashboardControlsSnapshot["weights"]) => void;
  onCycleWeather: () => void;
  onSpawnEmergency: () => void;
  compact?: boolean;
};

export function ControlsCard({
  controls,
  onToggleRun,
  onToggleDebug,
  onSetSpeed,
  onSetWeights,
  onCycleWeather,
  onSpawnEmergency,
  compact = false,
}: ControlsCardProps) {
  const totalWeight = controls.weights.density + controls.weights.wait + controls.weights.pedestrian;

  const setWeight = (key: keyof DashboardControlsSnapshot["weights"], value: number) => {
    const nextWeights = { ...controls.weights, [key]: value };
    const nextTotal = nextWeights.density + nextWeights.wait + nextWeights.pedestrian;
    if (nextTotal <= 0) {
      onSetWeights(nextWeights);
      return;
    }
    onSetWeights({
      density: nextWeights.density / nextTotal,
      wait: nextWeights.wait / nextTotal,
      pedestrian: nextWeights.pedestrian / nextTotal,
    });
  };

  return (
    <section className="card card-section controls-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Operations</p>
          <h2>Control Panel</h2>
        </div>
        <p className="section-copy">High-frequency actions stay upfront. Tuning controls are grouped by operational intent.</p>
      </div>

      <div className="controls-stack">
        <div className="control-cluster">
          <span className="cluster-label">Simulation state</span>
          <div className="button-row">
            <button className={`control-button control-button-wide ${controls.running ? "is-active" : ""}`} onClick={onToggleRun} type="button">
              {controls.running ? "Pause Simulation" : "Resume Simulation"}
            </button>
            <button className={`control-button ${controls.debug ? "is-active" : ""}`} onClick={onToggleDebug} type="button">
              Debug Overlay
            </button>
          </div>
        </div>

        <div className="control-cluster">
          <span className="cluster-label">Environment + incidents</span>
          <div className="button-row">
            <button className="control-button control-button-wide" onClick={onCycleWeather} type="button">
              Cycle Weather: {controls.weather}
            </button>
            <button className="control-button control-button-alert" onClick={onSpawnEmergency} type="button">
              Dispatch Emergency
            </button>
          </div>
        </div>

        <div className="control-cluster">
          <span className="cluster-label">Playback speed</span>
          <div className="segmented-row">
            {[1, 2, 4].map((speed) => (
              <button
                className={`control-button segmented-button ${controls.speed === speed ? "is-active" : ""}`}
                key={speed}
                onClick={() => onSetSpeed(speed)}
                type="button"
              >
                x{speed}
              </button>
            ))}
          </div>
        </div>

        {!compact ? (
          <div className="control-cluster">
            <span className="cluster-label">Adaptive scoring weights</span>
            <p className="section-copy">Weights are applied live and normalized to a total of 1.00 so phase scoring changes immediately.</p>
            <div className="range-group">
              <label>
                <span className="range-label-row">
                  <span>Density</span>
                  <strong>{controls.weights.density.toFixed(2)}</strong>
                </span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => setWeight("density", Number(event.target.value))}
                  step={0.05}
                  type="range"
                  value={controls.weights.density}
                />
              </label>
              <label>
                <span className="range-label-row">
                  <span>Wait Time</span>
                  <strong>{controls.weights.wait.toFixed(2)}</strong>
                </span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => setWeight("wait", Number(event.target.value))}
                  step={0.05}
                  type="range"
                  value={controls.weights.wait}
                />
              </label>
              <label>
                <span className="range-label-row">
                  <span>Pedestrian</span>
                  <strong>{controls.weights.pedestrian.toFixed(2)}</strong>
                </span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) => setWeight("pedestrian", Number(event.target.value))}
                  step={0.05}
                  type="range"
                  value={controls.weights.pedestrian}
                />
              </label>
            </div>
            <div className="metric-tile">
              <span>Weight total</span>
              <strong>{totalWeight.toFixed(2)}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
