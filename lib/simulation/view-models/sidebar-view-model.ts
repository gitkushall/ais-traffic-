import { WeatherMode } from "@/lib/simulation/domain/enums";
import { ComparisonStats, IntersectionState, MetricSample, ScenarioPreset, SimulationWeights } from "@/lib/simulation/domain/models";
import { DashboardSnapshot } from "@/lib/simulation/domain/snapshots";

function stageDisplayLabel(stage: IntersectionState["stage"]) {
  if (stage === "amber") return "YELLOW";
  if (stage === "all_red") return "ALL RED";
  return "GREEN";
}

export function createSidebarSnapshot(
  intersection: IntersectionState,
  weights: SimulationWeights,
  running: boolean,
  debug: boolean,
  speed: number,
  weather: WeatherMode,
  vehiclesServedCount = 0,
  metricsHistory: MetricSample[] = [],
  activeScenario: ScenarioPreset = "normal",
  isFixedCycle = false,
  comparison: ComparisonStats = {
    adaptiveThroughput: 0, fixedThroughput: 0,
    adaptiveAvgWait: 0, fixedAvgWait: 0,
    adaptiveQueue: 0, fixedQueue: 0,
  },
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
      stageLabel: stageDisplayLabel(intersection.stage),
      reason: intersection.controllerReason,
      controllerMode: intersection.controllerMode,
      preemptionActive:
        intersection.controllerMode === "emergency_requested" ||
        intersection.controllerMode === "preempt_transition" ||
        intersection.controllerMode === "emergency_serving",
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
    controls: { running, debug, speed, weights, weather },
    weatherLabel: weather.replace("_", " "),
    analytics: {
      tick: intersection.tick,
      stage: stageDisplayLabel(intersection.stage),
      phaseScores,
      emergencyServedCount: intersection.emergencyServedCount,
      pedestrianServedCount: intersection.pedestrianServedCount,
      vehiclesServedCount,
      metricsHistory,
      activeScenario,
      isFixedCycle,
      comparison,
    },
  };
}
