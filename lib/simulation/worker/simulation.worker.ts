// Runs in a dedicated Web Worker thread — no React, no DOM, just physics.
// Fixed 50 ms timestep eliminates the variable-dt jitter from the main thread.

import { SimulationEngine } from "@/lib/simulation/core/simulation-engine";
import type { WorkerFrame, WorkerInMessage } from "./protocol";

const TICK_MS = 50;           // 20 Hz physics
const DT      = TICK_MS / 1000; // always exactly 0.05 s

const engine = new SimulationEngine();
let seq = 0;

function emit() {
  const snap = engine.snapshot();
  const frame: WorkerFrame = {
    seq: seq++,
    ts: performance.now(),
    scene: snap.scene,
    dashboard: snap.dashboard,
  };
  self.postMessage(frame);
}

// Fixed physics loop
setInterval(() => {
  engine.tick(DT);
  emit();
}, TICK_MS);

self.addEventListener(
  "message",
  (event: MessageEvent<WorkerInMessage>) => {
    if (event.data.type === "dispatch") {
      engine.dispatch(event.data.command);
      emit(); // push an immediate frame so UI feels responsive
    }
  },
);

// Send initial state so the canvas doesn't wait 50 ms for first paint
emit();
