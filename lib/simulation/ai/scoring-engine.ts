import { EmergencyPriorityState, LaneState, SimulationWeights } from "@/lib/simulation/domain/models";
import { IntersectionLayout } from "@/lib/simulation/core/intersection-layout";
import { LaneId } from "@/lib/simulation/domain/enums";

export type PhaseScore = {
  key: string;
  label: string;
  phase: LaneId[];
  allowedMovements: string[];
  score: number;
  scores: Record<string, number>;
  queues: Record<string, number>;
  waits: Record<string, number>;
  reasons: Record<string, string>;
  emergency: EmergencyPriorityState | null;
};

export class ScoringEngine {
  constructor(private readonly weights: SimulationWeights) {}

  scoreLane(lane: LaneState): number {
    const density = Math.min(lane.carCount / 24, 1);
    const wait = Math.min(lane.waitingTime / 60, 1);
    const pedestrians = Math.min(lane.pedestrianCount / 8, 1);
    return density * this.weights.density + wait * this.weights.wait + pedestrians * this.weights.pedestrian;
  }

  scoreIntersection(lanes: LaneState[]): LaneState[] {
    return lanes.map((lane) => ({ ...lane, score: this.scoreLane(lane) }));
  }

  selectPhase(
    layout: IntersectionLayout,
    lanes: LaneState[],
    movementDemand: Record<string, { score: number; queue: number; wait: number }>,
    emergency: EmergencyPriorityState | null,
  ): PhaseScore {
    const laneMap = new Map(lanes.map((lane) => [lane.id, lane]));
    let bestPhase = layout.phases[0];
    let bestScore = -1;
    const scores: Record<string, number> = {};
    const queues: Record<string, number> = {};
    const waits: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    for (const phase of layout.phases) {
      const laneStates = phase.scoreLanes.map((laneId) => laneMap.get(laneId)).filter(Boolean) as LaneState[];
      const movementStates = phase.allowedMovements.map((movementId) => movementDemand[movementId] ?? { score: 0, queue: 0, wait: 0 });
      const baseTotal = movementStates.reduce((sum, movement) => sum + movement.score, 0);
      const queue = movementStates.reduce((sum, movement) => sum + movement.queue, 0);
      const wait = movementStates.reduce((sum, movement) => sum + movement.wait, 0) / Math.max(1, movementStates.length);
      const laneWait = laneStates.reduce((sum, lane) => sum + lane.waitingTime, 0) / Math.max(1, laneStates.length);
      const starvationBonus = Math.min(1.35, laneWait / 55) * 0.28 + Math.min(0.9, queue / 14) * 0.18;
      const emergencyBonus =
        emergency && phase.allowedMovements.includes(emergency.movementId)
          ? 4.2 + Math.max(0, 1.8 - emergency.distanceToStop / 140) + emergency.priorityScore
          : 0;
      const total = baseTotal + starvationBonus + emergencyBonus;
      const phaseKey = phase.key;
      scores[phaseKey] = total;
      queues[phaseKey] = queue;
      waits[phaseKey] = Math.max(wait, laneWait);
      reasons[phaseKey] =
        emergency && phase.allowedMovements.includes(emergency.movementId)
          ? `${phase.label}: ${emergency.type.replace("_", " ")} priority at ${emergency.distanceToStop.toFixed(0)}px`
          : queue > 8
          ? `${phase.label}: queue pressure ${queue}`
          : Math.max(wait, laneWait) > 10
            ? `${phase.label}: wait pressure ${Math.max(wait, laneWait).toFixed(0)}s`
            : `${phase.label}: balanced low demand`;
      if (total > bestScore) {
        bestScore = total;
        bestPhase = phase;
      }
    }
    return {
      key: bestPhase.key,
      label: bestPhase.label,
      phase: bestPhase.approaches,
      allowedMovements: bestPhase.allowedMovements,
      score: bestScore,
      scores,
      queues,
      waits,
      reasons,
      emergency,
    };
  }
}
