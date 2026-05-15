"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Dashboard } from "@/components/dashboard/Dashboard";
import { TrafficCanvas } from "@/components/scene/TrafficCanvas";
import { useSimulationWorker } from "@/lib/hooks/use-simulation-worker";

const TrafficThreeView = dynamic(
  () => import("@/components/scene/TrafficThreeView").then((mod) => mod.TrafficThreeView),
  {
    ssr: false,
    loading: () => <div className="scene-loading">Preparing 3D view...</div>,
  },
);

export default function DashboardPage() {
  const { frameRef, snapshot, dispatch } = useSimulationWorker();
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "3d") {
      setViewMode("3d");
      return;
    }
    const remembered = window.localStorage.getItem("traffic-view-mode");
    if (remembered === "3d" || remembered === "2d") {
      setViewMode(remembered);
    }
  }, []);

  const onSelectMode = (nextMode: "2d" | "3d") => {
    setViewMode(nextMode);
    window.localStorage.setItem("traffic-view-mode", nextMode);
    const url = new URL(window.location.href);
    if (nextMode === "3d") {
      url.searchParams.set("view", "3d");
    } else {
      url.searchParams.delete("view");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea") return;
      if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        onSelectMode(viewMode === "3d" ? "2d" : "3d");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode]);

  return (
    <main className="page-shell dashboard-page-shell">
      <div className="dashboard-page-frame">
        {snapshot ? (
          <Dashboard mode="full" snapshot={snapshot} dispatch={dispatch} />
        ) : (
          <div className="dashboard-loading">Initialising simulation…</div>
        )}
      </div>
      <aside className="dashboard-monitor">
        <div className="dashboard-monitor-header">
          <span>Live Monitor</span>
          <div className="dashboard-monitor-header-right">
            <strong>{snapshot?.dashboard.phase.currentLabel ?? "…"}</strong>
            <div className="monitor-view-switch" aria-label="Monitor view mode">
              <button
                aria-pressed={viewMode === "2d"}
                className={viewMode === "2d" ? "is-active" : ""}
                onClick={() => onSelectMode("2d")}
                title="2D view (press V to toggle)"
                type="button"
              >
                2D
              </button>
              <button
                aria-pressed={viewMode === "3d"}
                className={viewMode === "3d" ? "is-active" : ""}
                disabled={!snapshot}
                onClick={() => onSelectMode("3d")}
                title="3D view (press V to toggle)"
                type="button"
              >
                3D
              </button>
            </div>
          </div>
        </div>
        <div className="dashboard-monitor-scene">
          {viewMode === "3d" && snapshot ? (
            <TrafficThreeView scene={snapshot.scene} mode="monitor" />
          ) : (
            <TrafficCanvas frameRef={frameRef} mode="monitor" />
          )}
        </div>
      </aside>
    </main>
  );
}
