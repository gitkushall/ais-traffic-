"use client";

import { Dashboard } from "@/components/dashboard/Dashboard";
import { TrafficCanvas } from "@/components/scene/TrafficCanvas";
import { useSimulationWorker } from "@/lib/hooks/use-simulation-worker";

export default function DashboardPage() {
  const { frameRef, snapshot, dispatch } = useSimulationWorker();

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
          <strong>{snapshot?.dashboard.phase.currentLabel ?? "…"}</strong>
        </div>
        <div className="dashboard-monitor-scene">
          <TrafficCanvas frameRef={frameRef} mode="monitor" />
        </div>
      </aside>
    </main>
  );
}
