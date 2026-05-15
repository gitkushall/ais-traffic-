"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { LaneScoresCard } from "@/components/dashboard/LaneScoresCard";
import { ActivePhaseCard } from "@/components/dashboard/ActivePhaseCard";
import { ControlsCard } from "@/components/dashboard/ControlsCard";
import { SelectorCard } from "@/components/dashboard/SelectorCard";
import { MetricsChart } from "@/components/dashboard/MetricsChart";
import { ScenarioCard } from "@/components/dashboard/ScenarioCard";
import { ComparisonPanel } from "@/components/dashboard/ComparisonPanel";
import { SimulationSnapshot } from "@/lib/simulation/domain/snapshots";
import { SimulationCommand } from "@/lib/simulation/domain/models";

type DashboardProps = {
  snapshot: SimulationSnapshot;
  dispatch: (command: SimulationCommand) => void;
  mode?: "full" | "compact";
};

function NetworkHealthRing({ score }: { score: number }) {
  const r = 56;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score));
  const offset = circumference * (1 - pct);
  const ringColor = pct < 0.35 ? "#58c472" : pct < 0.65 ? "#f7b84b" : "#f0645d";
  const tone = pct < 0.35 ? "Stable" : pct < 0.65 ? "Building" : "Critical";

  return (
    <div className="health-ring-wrap">
      <div className="health-ring">
        <svg width="150" height="150" viewBox="0 0 150 150">
          <defs>
            <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Track */}
          <circle
            cx="75" cy="75" r={r}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="12"
          />
          {/* Glow halo */}
          <circle
            cx="75" cy="75" r={r}
            fill="none"
            stroke={ringColor}
            strokeOpacity="0.18"
            strokeWidth="20"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 75 75)"
            style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease" }}
          />
          {/* Progress arc */}
          <circle
            cx="75" cy="75" r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 75 75)"
            style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease" }}
          />
        </svg>
        <div className="health-ring-center">
          <span className="health-ring-value" style={{ color: ringColor }}>
            {(pct * 100).toFixed(0)}
          </span>
          <span className="health-ring-tone">{tone}</span>
        </div>
      </div>
      <span className="health-ring-footer">Network Load</span>
    </div>
  );
}

function MiniHealthRing({ score }: { score: number }) {
  const r = 28;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score));
  const offset = circumference * (1 - pct);
  const ringColor = pct < 0.35 ? "#58c472" : pct < 0.65 ? "#f7b84b" : "#f0645d";
  const tone = pct < 0.35 ? "OK" : pct < 0.65 ? "Mid" : "High";

  return (
    <div className="health-ring-mini">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={ringColor}
          strokeOpacity="0.2"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 40 40)"
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease" }}
        />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 40 40)"
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease" }}
        />
      </svg>
      <div className="health-ring-mini-center">
        <span className="health-ring-mini-value" style={{ color: ringColor }}>
          {(pct * 100).toFixed(0)}
        </span>
        <span className="health-ring-mini-label">{tone}</span>
      </div>
    </div>
  );
}

export function Dashboard({ snapshot, dispatch, mode = "full" }: DashboardProps) {
  const tick = snapshot.dashboard.analytics.tick;
  const [lastAdvancedAt, setLastAdvancedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [mounted, setMounted] = useState(false);

  const averageScore =
    snapshot.dashboard.lanes.reduce((sum, lane) => sum + lane.score, 0) /
    Math.max(snapshot.dashboard.lanes.length, 1);

  const hottestLane = [...snapshot.dashboard.lanes].sort((a, b) => b.score - a.score)[0] ?? null;
  const hasActivePressure = snapshot.dashboard.lanes.some(
    (lane) => lane.score > 0 || lane.queueLength > 0 || lane.carCount > 0 || lane.waitSeconds > 0,
  );

  const emergencyLabel = snapshot.dashboard.phase.emergency.detected
    ? snapshot.dashboard.phase.emergency.type?.replaceAll("_", " ") ?? "Emergency"
    : "None";

  const isCompact = mode === "compact";
  const isStalled = mounted && snapshot.dashboard.controls.running && tick > 0 && now - lastAdvancedAt > 2000;

  const status = !mounted
    ? snapshot.dashboard.controls.running ? "Live" : "Stopped"
    : !snapshot.dashboard.controls.running
      ? tick > 0 ? "Paused" : "Stopped"
      : tick === 0 ? "Stopped"
        : isStalled ? "Stalled"
          : "Live";

  const statusClass = status === "Live" ? "is-live"
    : status === "Paused" ? "is-paused"
      : status === "Stalled" ? "is-stalled"
        : "is-stopped";

  const vehiclesServed = snapshot.dashboard.analytics.vehiclesServedCount;
  const phaseScores = snapshot.dashboard.analytics.phaseScores;
  const currentPhaseLabel = snapshot.dashboard.phase.currentLabel;

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (tick > 0) setLastAdvancedAt(Date.now()); }, [tick]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  if (isCompact) {
    return (
      <div className="dashboard is-compact">
        {/* ── Compact Command Hero ── */}
        <section className="compact-command-hero">
          <div className="compact-command-inner">
            <div className="compact-command-top">
              <div className="compact-command-title-row">
                <div>
                  <div className={`live-indicator ${statusClass}`} style={{ marginBottom: 8 }}>
                    <span className="live-dot" />
                    <span>Simulation {status}</span>
                  </div>
                  <h2 style={{ fontSize: "1rem", margin: 0 }}>Adaptive Signal Command</h2>
                  <p style={{ fontSize: "0.74rem", color: "var(--muted)", margin: "4px 0 0", lineHeight: 1.4 }}>
                    Live intersection control with AI-adaptive phasing.
                  </p>
                </div>
              </div>
              <div className="compact-command-badges">
                <span className="hero-badge">{snapshot.dashboard.intersectionType.toUpperCase()}</span>
                <span className="hero-badge">{snapshot.dashboard.weatherLabel}</span>
                {snapshot.dashboard.phase.emergency.detected && (
                  <span className="hero-badge" style={{ background: "rgba(240,100,93,0.15)", color: "#ffd8d8", borderColor: "rgba(240,100,93,0.3)" }}>
                    Emergency
                  </span>
                )}
              </div>
              <Link className="dashboard-link-button" href="/dashboard" style={{ width: "fit-content", fontSize: "0.78rem" }}>
                Open Full Dashboard
              </Link>
            </div>

            <div className="compact-command-bottom">
              <div className="compact-stat-row">
                <div className="compact-stat">
                  <span className="compact-stat-label">Phase</span>
                  <span className="compact-stat-value" style={{ fontSize: "0.82rem" }}>
                    {snapshot.dashboard.phase.currentLabel}
                  </span>
                </div>
                <div className="compact-stat">
                  <span className="compact-stat-label">Green Left</span>
                  <span className="compact-stat-value">{snapshot.dashboard.phase.greenRemaining.toFixed(1)}s</span>
                </div>
                <div className="compact-stat">
                  <span className="compact-stat-label">Hot Lane</span>
                  <span className="compact-stat-value" style={{ fontSize: "0.82rem" }}>
                    {hasActivePressure ? (hottestLane?.label ?? "—") : "Clear"}
                  </span>
                </div>
                <div className="compact-stat">
                  <span className="compact-stat-label">Served</span>
                  <span className="compact-stat-value">{vehiclesServed}</span>
                </div>
              </div>
              <MiniHealthRing score={averageScore} />
            </div>
          </div>
        </section>

        {/* ── Compact cards ── */}
        <ActivePhaseCard
          phase={snapshot.dashboard.phase}
          weatherLabel={snapshot.dashboard.weatherLabel}
          analytics={snapshot.dashboard.analytics}
          compact={true}
          scene={snapshot.scene}
        />
        <MetricsChart
          history={snapshot.dashboard.analytics.metricsHistory}
          vehiclesServedCount={vehiclesServed}
        />
        <LaneScoresCard lanes={snapshot.dashboard.lanes} compact={true} />
        <ControlsCard
          controls={snapshot.dashboard.controls}
          onToggleRun={() => dispatch({ type: "toggleRunning" })}
          onToggleDebug={() => dispatch({ type: "toggleDebug" })}
          onSetSpeed={(speed) => dispatch({ type: "setSpeed", speed })}
          onSetWeights={(weights) => dispatch({ type: "setWeights", weights })}
          onCycleWeather={() => dispatch({ type: "cycleWeather" })}
          onSpawnEmergency={() => dispatch({ type: "spawnEmergency" })}
          compact={true}
        />
      </div>
    );
  }

  /* ──────────── FULL DASHBOARD ──────────── */
  return (
    <div className="dashboard">
      {/* ── Command Hero ── */}
      <section className="command-hero">
        <div className="command-hero-inner">
          <div className="command-hero-left">
            <div className="command-hero-title">
              <div className={`live-indicator ${statusClass}`}>
                <span className="live-dot" />
                <span>Simulation {status}</span>
              </div>
              <h1>Adaptive Signal Intelligence</h1>
              <p>
                Real-time AI-adaptive traffic signal control with lane-pressure scoring, emergency
                preemption, and pedestrian-safe phasing — all observable in one command view.
              </p>
            </div>

            <div className="hero-badges">
              <span className="hero-badge">{snapshot.dashboard.intersectionType.toUpperCase()}</span>
              <span className="hero-badge">{snapshot.dashboard.weatherLabel}</span>
              <span className="hero-badge vehicles-badge">{vehiclesServed} vehicles served</span>
              {snapshot.dashboard.phase.emergency.detected && (
                <span className="hero-badge" style={{ background: "rgba(240,100,93,0.16)", color: "#ffd8d8", borderColor: "rgba(240,100,93,0.3)" }}>
                  Emergency Active
                </span>
              )}
            </div>

            <div className="command-stats">
              <div className="command-stat">
                <span className="command-stat-label">Network Pressure</span>
                <span className="command-stat-value">{averageScore.toFixed(3)}</span>
                <span className="command-stat-sub">Average lane load score</span>
              </div>
              <div className="command-stat">
                <span className="command-stat-label">Critical Approach</span>
                <span className="command-stat-value" style={{ fontSize: "0.9rem" }}>
                  {hasActivePressure ? (hottestLane?.label ?? "N/A") : "All clear"}
                </span>
                <span className="command-stat-sub">
                  {hasActivePressure && hottestLane
                    ? `${hottestLane.queueLength} queued · ${hottestLane.waitSeconds.toFixed(0)}s wait`
                    : "No active pressure on any approach"}
                </span>
              </div>
              <div className="command-stat">
                <span className="command-stat-label">Signal Mode</span>
                <span className="command-stat-value" style={{ fontSize: "0.88rem" }}>
                  {snapshot.dashboard.phase.controllerMode.replaceAll("_", " ")}
                </span>
                <span className="command-stat-sub">{snapshot.dashboard.phase.reason}</span>
              </div>
              <div className="command-stat">
                <span className="command-stat-label">Priority Event</span>
                <span className="command-stat-value" style={{ fontSize: "0.9rem" }}>{emergencyLabel}</span>
                <span className="command-stat-sub">
                  {snapshot.dashboard.phase.preemptionActive
                    ? "Preemption active — signal override in effect"
                    : "Standard adaptive flow — no preemption"}
                </span>
              </div>
            </div>

            <div className="command-hero-actions">
              <Link className="dashboard-link-button" href="/">
                Back to Simulation
              </Link>
            </div>
          </div>

          <div className="command-hero-right">
            <NetworkHealthRing score={averageScore} />

            <div className="vehicle-counter">
              <span className="vehicle-counter-num">{vehiclesServed}</span>
              <span className="vehicle-counter-label">served</span>
            </div>

            {phaseScores.length > 0 && (
              <div className="phase-mini-wheel">
                {phaseScores.map((item) => {
                  const label = item.key.replaceAll("_", " ");
                  const isActive = currentPhaseLabel.toLowerCase().includes(item.key.split("_")[0] ?? "");
                  return (
                    <div key={item.key} className={`phase-mini-item ${isActive ? "is-active" : ""}`}>
                      <span className="phase-mini-dot" />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
                      <span style={{ marginLeft: "auto", fontWeight: 700, flexShrink: 0 }}>
                        {item.score.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Dashboard body ── */}
      <div className="dashboard-grid">
        <div className="dashboard-column">
          <SelectorCard
            intersectionType={snapshot.dashboard.intersectionType}
            onSelect={(intersectionType) => dispatch({ type: "setIntersectionType", intersectionType })}
          />
          <ScenarioCard
            activeScenario={snapshot.dashboard.analytics.activeScenario}
            dispatch={dispatch}
          />
          <ComparisonPanel
            isFixedCycle={snapshot.dashboard.analytics.isFixedCycle}
            comparison={snapshot.dashboard.analytics.comparison}
            dispatch={dispatch}
          />
          <ActivePhaseCard
            phase={snapshot.dashboard.phase}
            weatherLabel={snapshot.dashboard.weatherLabel}
            analytics={snapshot.dashboard.analytics}
            compact={false}
            scene={snapshot.scene}
          />
          <MetricsChart
            history={snapshot.dashboard.analytics.metricsHistory}
            vehiclesServedCount={vehiclesServed}
          />
          <LaneScoresCard lanes={snapshot.dashboard.lanes} compact={false} />
        </div>

        <div className="dashboard-column">
          <ControlsCard
            controls={snapshot.dashboard.controls}
            onToggleRun={() => dispatch({ type: "toggleRunning" })}
            onToggleDebug={() => dispatch({ type: "toggleDebug" })}
            onSetSpeed={(speed) => dispatch({ type: "setSpeed", speed })}
            onSetWeights={(weights) => dispatch({ type: "setWeights", weights })}
            onCycleWeather={() => dispatch({ type: "cycleWeather" })}
            onSpawnEmergency={() => dispatch({ type: "spawnEmergency" })}
            compact={false}
          />
        </div>
      </div>
    </div>
  );
}
