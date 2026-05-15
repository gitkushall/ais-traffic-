"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SimulationCommand } from "@/lib/simulation/domain/models";
import type { SimulationSnapshot } from "@/lib/simulation/domain/snapshots";
import type { FrameBuffer, WorkerFrame, WorkerInMessage } from "@/lib/simulation/worker/protocol";

export type { FrameBuffer };

export function useSimulationWorker() {
  const workerRef  = useRef<Worker | null>(null);
  // frameRef is mutated on every worker message but never triggers re-renders.
  // The Canvas rAF loop reads it directly, giving 60 fps without React overhead.
  const frameRef   = useRef<FrameBuffer>({ prev: null, current: null });
  // snapshot drives the sidebar Dashboard — React state is fine at 20 Hz.
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../simulation/worker/simulation.worker.ts", import.meta.url),
    );
    workerRef.current = worker;

    worker.addEventListener("message", (event: MessageEvent<WorkerFrame>) => {
      const frame = event.data;
      frameRef.current = { prev: frameRef.current.current, current: frame };
      // Only push to React state for the dashboard — not the canvas
      setSnapshot({ dashboard: frame.dashboard, scene: frame.scene });
    });

    worker.addEventListener("error", (event) => {
      console.error("[SimWorker] crash:", event.message, event.filename, event.lineno);
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const dispatch = useCallback((command: SimulationCommand) => {
    const msg: WorkerInMessage = { type: "dispatch", command };
    workerRef.current?.postMessage(msg);
  }, []);

  return { frameRef, snapshot, dispatch };
}
