"use client";

import { useEffect, useState } from "react";

import { Dashboard } from "@/components/dashboard/Dashboard";
import { TrafficScene } from "@/components/scene/TrafficScene";
import { SimulationSnapshot } from "@/lib/simulation/domain/snapshots";
import { simulationStore as store } from "@/lib/store/simulation-client-store";

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(store.getSnapshot());

  useEffect(() => {
    const unsubscribe = store.subscribe(setSnapshot);
    store.start();
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <main className="page-shell dashboard-page-shell">
      <div className="dashboard-page-frame">
        <Dashboard mode="full" snapshot={snapshot} dispatch={store.dispatch} />
      </div>
      <aside className="dashboard-monitor">
        <div className="dashboard-monitor-header">
          <span>Live Monitor</span>
          <strong>{snapshot.dashboard.phase.currentLabel}</strong>
        </div>
        <div className="dashboard-monitor-scene">
          <TrafficScene mode="monitor" scene={snapshot.scene} />
        </div>
      </aside>
    </main>
  );
}
