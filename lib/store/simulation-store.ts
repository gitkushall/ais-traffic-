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
  let timer = 0;

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
      if (timer === 0) {
        timer = window.setInterval(() => {
          engine.tick(1 / 30);
          emit();
        }, 1000 / 30);
      }
    },
    stop() {
      if (timer !== 0) {
        window.clearInterval(timer);
        timer = 0;
      }
    },
  };
}
