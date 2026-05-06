import type { SimulationCommand } from "@/lib/simulation/domain/models";
import type { DashboardSnapshot, SceneSnapshot } from "@/lib/simulation/domain/snapshots";

// Messages sent TO the worker
export type WorkerInMessage = { type: "dispatch"; command: SimulationCommand };

// A single physics frame sent FROM the worker
export type WorkerFrame = {
  seq: number;
  ts: number;           // performance.now() at emission — used for interpolation
  scene: SceneSnapshot;
  dashboard: DashboardSnapshot;
};

// Two consecutive frames held in the main thread
export type FrameBuffer = {
  prev: WorkerFrame | null;
  current: WorkerFrame | null;
};
