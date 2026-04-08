"use client";

import { IntersectionType } from "@/lib/simulation/domain/enums";

type SelectorCardProps = {
  intersectionType: IntersectionType;
  onSelect: (intersectionType: IntersectionType) => void;
  compact?: boolean;
};

const OPTIONS: Array<{ label: string; value: IntersectionType }> = [
  { label: "2-Way", value: "2way" },
  { label: "T-Junction", value: "3way" },
  { label: "4-Way", value: "4way" },
];

export function SelectorCard({ intersectionType, onSelect, compact = false }: SelectorCardProps) {
  return (
    <section className="card card-section">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Topology</p>
          <h2>Intersection Layout</h2>
        </div>
        {!compact ? <p className="section-copy">Switch the geometry and compare how the controller behaves under different traffic structures.</p> : null}
      </div>
      <div className="selector-grid">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`selector-button ${intersectionType === option.value ? "is-active" : ""}`}
            onClick={() => onSelect(option.value)}
            type="button"
          >
            <span>{option.label}</span>
            {!compact ? (
              <small>{option.value === "2way" ? "4 lanes, bidirectional" : option.value === "3way" ? "Asymmetric priority" : "Full protected turns"}</small>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
