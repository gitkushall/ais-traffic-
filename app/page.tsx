"use client";

import { Dashboard } from "@/components/dashboard/Dashboard";
import { TrafficCanvas } from "@/components/scene/TrafficCanvas";
import { useSimulationWorker } from "@/lib/hooks/use-simulation-worker";

export default function Page() {
  const { frameRef, snapshot, dispatch } = useSimulationWorker();

  const caption = snapshot
    ? `CAM-01 ● ${snapshot.dashboard.intersectionType.toUpperCase()} | ${snapshot.dashboard.phase.currentLabel} | ${snapshot.dashboard.phase.stageLabel}`
    : "CAM-01 ● Loading…";

  return (
    <main className="page-shell">
      <div className="app-shell">
        <section className="scene-shell">
          <TrafficCanvas frameRef={frameRef} caption={caption} />
        </section>
        <aside className="dashboard-shell">
          {snapshot ? (
            <Dashboard mode="compact" snapshot={snapshot} dispatch={dispatch} />
          ) : (
            <div className="dashboard-loading">Initialising simulation…</div>
          )}
        </aside>
      </div>
    </main>
  );
}
