"use client";

import { IntersectionType } from "@/lib/simulation/domain/enums";

type SelectorCardProps = {
  intersectionType: IntersectionType;
  onSelect: (intersectionType: IntersectionType) => void;
  compact?: boolean;
};

function RoadPreview2Way() {
  return (
    <svg width="48" height="30" viewBox="0 0 48 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Road */}
      <rect x="18" y="0" width="12" height="30" fill="#3a3a3a" rx="1" />
      {/* Edge lines */}
      <line x1="18" y1="0" x2="18" y2="30" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <line x1="30" y1="0" x2="30" y2="30" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      {/* Double yellow center */}
      <line x1="23" y1="0" x2="23" y2="30" stroke="rgba(255,215,0,0.9)" strokeWidth="1.2" />
      <line x1="25" y1="0" x2="25" y2="30" stroke="rgba(255,215,0,0.9)" strokeWidth="1.2" />
      {/* N arrow */}
      <line x1="21" y1="22" x2="21" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1" markerEnd="url(#a2)" />
      {/* S arrow */}
      <line x1="27" y1="8" x2="27" y2="22" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
      {/* Arrow heads */}
      <polygon points="21,8 19.5,12 22.5,12" fill="rgba(255,255,255,0.5)" />
      <polygon points="27,22 25.5,18 28.5,18" fill="rgba(255,255,255,0.5)" />
    </svg>
  );
}

function RoadPreview3Way() {
  return (
    <svg width="48" height="30" viewBox="0 0 48 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Horizontal road */}
      <rect x="0" y="12" width="48" height="12" fill="#3a3a3a" />
      {/* Vertical road (north only) */}
      <rect x="18" y="0" width="12" height="18" fill="#3a3a3a" />
      {/* Edge lines */}
      <line x1="0" y1="12" x2="18" y2="12" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <line x1="30" y1="12" x2="48" y2="12" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <line x1="0" y1="24" x2="48" y2="24" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <line x1="18" y1="0" x2="18" y2="12" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      <line x1="30" y1="0" x2="30" y2="12" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
      {/* Center lines */}
      <line x1="0" y1="18" x2="18" y2="18" stroke="rgba(255,215,0,0.75)" strokeWidth="1.2" strokeDasharray="4 3" />
      <line x1="30" y1="18" x2="48" y2="18" stroke="rgba(255,215,0,0.75)" strokeWidth="1.2" strokeDasharray="4 3" />
      <line x1="24" y1="0" x2="24" y2="18" stroke="rgba(255,215,0,0.75)" strokeWidth="1.2" strokeDasharray="4 3" />
      {/* Corner fills */}
      <path d="M 18 24 Q 18 30 24 30 L 24 24 Z" fill="#2d5016" />
      <path d="M 30 24 Q 30 30 24 30 L 24 24 Z" fill="#2d5016" />
    </svg>
  );
}

function RoadPreview4Way() {
  return (
    <svg width="48" height="30" viewBox="0 0 48 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Horizontal road */}
      <rect x="0" y="10" width="48" height="10" fill="#3a3a3a" />
      {/* Vertical road */}
      <rect x="19" y="0" width="10" height="30" fill="#3a3a3a" />
      {/* Edge lines */}
      <line x1="0" y1="10" x2="19" y2="10" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      <line x1="29" y1="10" x2="48" y2="10" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      <line x1="0" y1="20" x2="19" y2="20" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      <line x1="29" y1="20" x2="48" y2="20" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      <line x1="19" y1="0" x2="19" y2="10" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      <line x1="29" y1="0" x2="29" y2="10" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      <line x1="19" y1="20" x2="19" y2="30" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      <line x1="29" y1="20" x2="29" y2="30" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
      {/* Center cross */}
      <line x1="0" y1="15" x2="19" y2="15" stroke="rgba(255,215,0,0.75)" strokeWidth="1.2" strokeDasharray="3 3" />
      <line x1="29" y1="15" x2="48" y2="15" stroke="rgba(255,215,0,0.75)" strokeWidth="1.2" strokeDasharray="3 3" />
      <line x1="24" y1="0" x2="24" y2="10" stroke="rgba(255,215,0,0.75)" strokeWidth="1.2" strokeDasharray="3 3" />
      <line x1="24" y1="20" x2="24" y2="30" stroke="rgba(255,215,0,0.75)" strokeWidth="1.2" strokeDasharray="3 3" />
      {/* Corner dots */}
      <circle cx="19" cy="10" r="2.5" fill="#2d5016" />
      <circle cx="29" cy="10" r="2.5" fill="#2d5016" />
      <circle cx="19" cy="20" r="2.5" fill="#2d5016" />
      <circle cx="29" cy="20" r="2.5" fill="#2d5016" />
    </svg>
  );
}

const OPTIONS: Array<{ label: string; value: IntersectionType; desc: string }> = [
  { label: "2-Way Road",  value: "2way",  desc: "Bidirectional, 4 lanes" },
  { label: "T-Junction",  value: "3way",  desc: "3-arm, asymmetric priority" },
  { label: "4-Way Cross", value: "4way",  desc: "Full protected turns" },
];

const PREVIEWS: Record<IntersectionType, React.ReactNode> = {
  "2way": <RoadPreview2Way />,
  "3way": <RoadPreview3Way />,
  "4way": <RoadPreview4Way />,
};

export function SelectorCard({ intersectionType, onSelect, compact = false }: SelectorCardProps) {
  return (
    <section className="card card-section">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Topology</p>
          <h2>Intersection Layout</h2>
        </div>
        {!compact ? (
          <p className="section-copy">
            Switch geometry to compare how the adaptive controller responds to different road structures.
          </p>
        ) : null}
      </div>
      <div className="selector-grid">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`selector-button ${intersectionType === option.value ? "is-active" : ""}`}
            onClick={() => onSelect(option.value)}
            type="button"
          >
            <div className="selector-road-preview">
              {PREVIEWS[option.value]}
            </div>
            <span style={{ fontWeight: 700, fontSize: "0.82rem" }}>{option.label}</span>
            {!compact ? (
              <small>{option.desc}</small>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
