import { WeatherMode } from "@/lib/simulation/domain/enums";
import { IntersectionState, SimulationWeights } from "@/lib/simulation/domain/models";
import { DashboardSnapshot } from "@/lib/simulation/domain/snapshots";

export function createSidebarSnapshot(
  intersection: IntersectionState,
  weights: SimulationWeights,
  running: boolean,
  debug: boolean,
  speed: number,
  weather: WeatherMode,
): DashboardSnapshot {
  const phaseScores = Object.entries(intersection.phaseScores)
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    intersectionType: intersection.type,
    lanes: intersection.lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      score: lane.score,
      queueLength: lane.queueLength,
      carCount: lane.carCount,
      waitSeconds: lane.waitingTime,
    })),
    phase: {
      currentLabel: intersection.currentPhaseLabel || "None",
      nextLabel: intersection.nextPhaseLabel || "None",
      greenRemaining: intersection.greenRemaining,
      stageLabel: intersection.stage.toUpperCase(),
      reason: intersection.controllerReason,
      controllerMode: intersection.controllerMode,
      preemptionActive: intersection.controllerMode === "emergency_requested" || intersection.controllerMode === "preempt_transition" || intersection.controllerMode === "emergency_serving",
      emergency: {
        detected: !!intersection.emergencyState,
        type: intersection.emergencyState?.type ?? null,
        laneId: intersection.emergencyState?.laneId ?? null,
        movementLane: intersection.emergencyState?.movementLane ?? null,
        distanceToStop: intersection.emergencyState?.distanceToStop ?? null,
      },
      walkCrossings: Object.entries(intersection.crosswalkSignals)
        .filter(([, state]) => state === "walk")
        .map(([crossingId]) => crossingId.replace("cross-", "")),
    },
    controls: {
      running,
      debug,
      speed,
      weights,
      weather,
    },
    weatherLabel: weather.replace("_", " "),
    analytics: {
      tick: intersection.tick,
      stage: intersection.stage.toUpperCase(),
      phaseScores,
      emergencyServedCount: intersection.emergencyServedCount,
    },
  };
}
