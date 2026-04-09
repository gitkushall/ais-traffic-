import { SimulationEngine } from "@/lib/simulation/core/simulation-engine";
import { SimulationCommand } from "@/lib/simulation/domain/models";
import { SimulationSnapshot } from "@/lib/simulation/domain/snapshots";

export type SimulationStore = {
  getSnapshot: () => SimulationSnapshot;
  subscribe: (listener: (snapshot: SimulationSnapshot) => void) => () => void;
  dispatch: (command: SimulationCommand) => void;
  start: () => void;
  stop: () => void;
};

export function createSimulationStore(): SimulationStore {
  const engine = new SimulationEngine();
  let snapshot = engine.snapshot();
  const listeners = new Set<(snapshot: SimulationSnapshot) => void>();
  let timer: number | ReturnType<typeof setInterval> | null = null;

  const emit = () => {
    snapshot = engine.snapshot();
    listeners.forEach((listener) => listener(snapshot));
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(command) {
      engine.dispatch(command);
      emit();
    },
    start() {
      if (timer === null) {
        try {
          engine.tick(1 / 30);
          emit();
        } catch (error) {
          console.error("Simulation start failed", error);
        }

        timer = window.setInterval(() => {
          try {
            engine.tick(1 / 30);
            emit();
          } catch (error) {
            console.error("Simulation tick failed", error);
          }
        }, 1000 / 30);
        emit();
      }
    },
    stop() {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    },
  };
}
