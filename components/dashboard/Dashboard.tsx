"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { LaneScoresCard } from "@/components/dashboard/LaneScoresCard";
import { ActivePhaseCard } from "@/components/dashboard/ActivePhaseCard";
import { ControlsCard } from "@/components/dashboard/ControlsCard";
import { SelectorCard } from "@/components/dashboard/SelectorCard";
import { SimulationSnapshot } from "@/lib/simulation/domain/snapshots";
import { SimulationCommand } from "@/lib/simulation/domain/models";

type DashboardProps = {
  snapshot: SimulationSnapshot;
  dispatch: (command: SimulationCommand) => void;
  mode?: "full" | "compact";
};

export function Dashboard({ snapshot, dispatch, mode = "full" }: DashboardProps) {
  const tick = snapshot.dashboard.analytics.tick;
  const [lastAdvancedAt, setLastAdvancedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [mounted, setMounted] = useState(false);
  const averageScore =
    snapshot.dashboard.lanes.reduce((sum, lane) => sum + lane.score, 0) / Math.max(snapshot.dashboard.lanes.length, 1);
  const hottestLane = [...snapshot.dashboard.lanes].sort((a, b) => b.score - a.score)[0] ?? null;
  const hasActivePressure = snapshot.dashboard.lanes.some(
    (lane) => lane.score > 0 || lane.queueLength > 0 || lane.carCount > 0 || lane.waitSeconds > 0,
  );
  const emergencyLabel = snapshot.dashboard.phase.emergency.detected
    ? snapshot.dashboard.phase.emergency.type?.replaceAll("_", " ") ?? "Emergency"
    : "No emergency";
  const isCompact = mode === "compact";
  const isStalled = mounted && snapshot.dashboard.controls.running && tick > 0 && now - lastAdvancedAt > 2000;
  const status = !mounted
    ? snapshot.dashboard.controls.running
      ? "Live"
      : "Stopped"
    : !snapshot.dashboard.controls.running
      ? tick > 0
        ? "Paused"
        : "Stopped"
      : tick === 0
        ? "Stopped"
        : isStalled
          ? "Stalled"
          : "Live";
  const statusClass =
    status === "Live" ? "is-live" : status === "Paused" ? "is-paused" : status === "Stalled" ? "is-stalled" : "is-stopped";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (tick > 0) {
      setLastAdvancedAt(Date.now());
    }
  }, [tick]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`dashboard ${isCompact ? "is-compact" : ""}`}>
      <section className={`card ${isCompact ? "compact-hero" : "dashboard-hero"}`}>
        <div className="dashboard-hero-copy">
          <p className="eyebrow">{isCompact ? "Main View Control" : "Adaptive Signal Command"}</p>
          <h1>{isCompact ? "Core intersection controls, without the noise." : "Intersection control with live situational awareness."}</h1>
          <p className="hero-text">
            {isCompact
              ? "Keep the map front and center while still seeing the current phase, top pressure points, and operator actions."
              : "Read congestion, phase intent, pedestrian exposure, and emergency priority at a glance without digging through noisy controls."}
          </p>
          <div className="hero-badges">
            <span className="hero-badge">{snapshot.dashboard.intersectionType.toUpperCase()}</span>
            <span className="hero-badge">{snapshot.dashboard.weatherLabel}</span>
            <span className={`hero-badge ${statusClass}`}>
              Simulation {status}
            </span>
          </div>
          <div className="hero-actions">
            <Link className="dashboard-link-button" href={isCompact ? "/dashboard" : "/"}>
              {isCompact ? "Open Full Dashboard" : "Back To Simulation"}
            </Link>
          </div>
        </div>
        <div className="hero-stat-grid">
          <div className="hero-stat">
            <span className="hero-stat-label">Network Pressure</span>
            <strong>{averageScore.toFixed(2)}</strong>
            <span className="hero-stat-meta">Average lane load score</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Critical Approach</span>
            <strong>{hasActivePressure ? hottestLane?.label ?? "N/A" : "No active pressure"}</strong>
            <span className="hero-stat-meta">
              {hasActivePressure && hottestLane ? `${hottestLane.queueLength} queued, ${hottestLane.waitSeconds.toFixed(0)}s wait` : "All approaches are currently clear"}
            </span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Signal Mode</span>
            <strong>{snapshot.dashboard.phase.controllerMode.replaceAll("_", " ")}</strong>
            <span className="hero-stat-meta">{snapshot.dashboard.phase.reason}</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Priority Event</span>
            <strong>{emergencyLabel}</strong>
            <span className="hero-stat-meta">
              {snapshot.dashboard.phase.preemptionActive ? "Preemption active" : "Standard adaptive flow"}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-column">
          {!isCompact ? (
            <SelectorCard
              intersectionType={snapshot.dashboard.intersectionType}
              onSelect={(intersectionType) => dispatch({ type: "setIntersectionType", intersectionType })}
            />
          ) : null}
          <ActivePhaseCard
            phase={snapshot.dashboard.phase}
            weatherLabel={snapshot.dashboard.weatherLabel}
            analytics={snapshot.dashboard.analytics}
            compact={isCompact}
            scene={snapshot.scene}
          />
          <LaneScoresCard lanes={snapshot.dashboard.lanes} compact={isCompact} />
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
            compact={isCompact}
          />
        </div>
      </div>
    </div>
  );
}
