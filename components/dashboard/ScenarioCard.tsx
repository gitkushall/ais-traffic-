"use client";

import { ScenarioPreset } from "@/lib/simulation/domain/models";
import { SimulationCommand } from "@/lib/simulation/domain/models";

const SCENARIOS: { id: ScenarioPreset; label: string; description: string; badge: string }[] = [
  { id: "normal",      label: "Normal Flow",   description: "Balanced traffic on all approaches",        badge: "1×" },
  { id: "rush_hour",   label: "Rush Hour",     description: "Heavy load — typical morning/evening peak", badge: "2.4×" },
  { id: "off_peak",    label: "Off-Peak",      description: "Low demand, sparse arrivals",               badge: "0.35×" },
  { id: "event_surge", label: "Event Surge",   description: "Max load with rain — stress test",          badge: "3.2×" },
];

type ScenarioCardProps = {
  activeScenario: ScenarioPreset;
  dispatch: (command: SimulationCommand) => void;
};

export function ScenarioCard({ activeScenario, dispatch }: ScenarioCardProps) {
  return (
    <section className="card card-section scenario-card">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Research Scenarios</p>
          <h2>Traffic Preset</h2>
        </div>
      </div>
      <div className="scenario-grid">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={`scenario-btn ${activeScenario === s.id ? "is-active" : ""}`}
            onClick={() => dispatch({ type: "setScenario", scenario: s.id })}
          >
            <div className="scenario-btn-top">
              <span className="scenario-btn-label">{s.label}</span>
              <span className="scenario-btn-badge">{s.badge}</span>
            </div>
            <p className="scenario-btn-desc">{s.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
