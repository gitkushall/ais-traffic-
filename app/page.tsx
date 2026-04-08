"use client";

import { useEffect, useState } from "react";

import { Dashboard } from "@/components/dashboard/Dashboard";
import { TrafficScene } from "@/components/scene/TrafficScene";
import { SimulationSnapshot } from "@/lib/simulation/domain/snapshots";
import { simulationStore as store } from "@/lib/store/simulation-client-store";

export default function Page() {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(store.getSnapshot());

  useEffect(() => {
    const unsubscribe = store.subscribe(setSnapshot);
    store.start();
    return () => {
      unsubscribe();
      store.stop();
    };
  }, []);

  return (
    <main className="page-shell">
      <div className="app-shell">
        <section className="scene-shell">
          <TrafficScene scene={snapshot.scene} />
        </section>
        <aside className="dashboard-shell">
          <Dashboard mode="compact" snapshot={snapshot} dispatch={store.dispatch} />
        </aside>
      </div>
    </main>
  );
}
