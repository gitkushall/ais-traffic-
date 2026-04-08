import { SignalStage } from "@/lib/simulation/domain/enums";
import { IntersectionState } from "@/lib/simulation/domain/models";
import { PhaseScore } from "@/lib/simulation/ai/scoring-engine";

export class SignalController {
  constructor(
    private readonly minimumGreenSeconds = 8,
    private readonly amberSeconds = 3,
    private readonly allRedSeconds = 1,
    private readonly scoreSwitchMargin = 0.08,
    private readonly maximumGreenSeconds = 18,
  ) {}

  tick(intersection: IntersectionState, decision: PhaseScore, dtSeconds: number): IntersectionState {
    let nextStage = intersection.stage;
    let currentPhase = intersection.currentPhase;
    let nextPhase = intersection.nextPhase;
    let currentPhaseKey = intersection.currentPhaseKey;
    let currentPhaseLabel = intersection.currentPhaseLabel;
    let nextPhaseKey = intersection.nextPhaseKey;
    let nextPhaseLabel = intersection.nextPhaseLabel;
    let allowedMovements = intersection.allowedMovements;
    let nextAllowedMovements = intersection.nextAllowedMovements;
    let greenRemaining = intersection.greenRemaining;
    let activePhaseElapsed = intersection.activePhaseElapsed + dtSeconds;
    let controllerReason = intersection.controllerReason;
    let controllerMode = intersection.controllerMode;
    const emergency = decision.emergency;
    const emergencyForCurrentPhase = !!emergency && intersection.currentPhaseKey === emergency.phaseKey;
    const emergencyForNextPhase = !!emergency && decision.key === emergency.phaseKey;
    const recoveringFromEmergency =
      !emergency &&
      (intersection.controllerMode === "emergency_serving" ||
        intersection.controllerMode === "preempt_transition" ||
        intersection.controllerMode === "emergency_requested");
    const normalMode = recoveringFromEmergency ? "recovery" : emergency ? "emergency_requested" : "normal_adaptive";

    if (intersection.stage === "green") {
      greenRemaining = Math.max(0, intersection.greenRemaining - dtSeconds);
      const currentScore = decision.scores[intersection.currentPhaseKey] ?? 0;
      const currentQueue = decision.queues[intersection.currentPhaseKey] ?? 0;
      const challengerQueue = decision.queues[decision.key] ?? 0;
      const currentWait = decision.waits[intersection.currentPhaseKey] ?? 0;
      const challengerWait = decision.waits[decision.key] ?? 0;
      const challengerOverloaded = challengerQueue >= currentQueue + 3 || challengerWait >= currentWait + 12;
      const shouldSwitch =
        activePhaseElapsed >= this.minimumGreenSeconds &&
        decision.key !== intersection.currentPhaseKey &&
        (decision.score > currentScore + this.scoreSwitchMargin || challengerOverloaded);

      if (emergency && emergencyForCurrentPhase) {
        controllerMode = "emergency_serving";
        greenRemaining = Math.max(greenRemaining, Math.min(10, 4.5 + emergency.priorityScore * 1.3));
        controllerReason = `${emergency.type.replace("_", " ")} priority hold`;
      } else if (emergency && emergencyForNextPhase && activePhaseElapsed >= Math.min(2.5, this.minimumGreenSeconds * 0.45)) {
        nextStage = "amber";
        greenRemaining = this.amberSeconds;
        nextPhase = decision.phase;
        nextPhaseKey = decision.key;
        nextPhaseLabel = decision.label;
        nextAllowedMovements = decision.allowedMovements;
        controllerMode = "preempt_transition";
        controllerReason = `${emergency.type.replace("_", " ")} preemption requested`;
      } else if (shouldSwitch) {
        nextStage = "amber";
        greenRemaining = this.amberSeconds;
        nextPhase = decision.phase;
        nextPhaseKey = decision.key;
        nextPhaseLabel = decision.label;
        nextAllowedMovements = decision.allowedMovements;
        controllerMode = "normal_adaptive";
        controllerReason = decision.reasons[decision.key] ?? "Switching to higher pressure phase";
      } else if (activePhaseElapsed < this.minimumGreenSeconds) {
        controllerMode = normalMode;
        controllerReason = recoveringFromEmergency ? "Emergency cleared, stabilizing flow" : "Holding minimum green";
      } else if (activePhaseElapsed >= this.maximumGreenSeconds) {
        nextStage = "amber";
        greenRemaining = this.amberSeconds;
        nextPhase = decision.phase;
        nextPhaseKey = decision.key;
        nextPhaseLabel = decision.label;
        nextAllowedMovements = decision.allowedMovements;
        controllerMode = normalMode;
        controllerReason = "Maximum green reached, reevaluating corridor demand";
      } else if (decision.key === intersection.currentPhaseKey) {
        greenRemaining = Math.max(
          greenRemaining,
          Math.min(this.maximumGreenSeconds - Math.min(activePhaseElapsed, this.maximumGreenSeconds), 3 + currentScore * 5 + currentQueue * 0.22),
        );
        controllerMode = normalMode;
        controllerReason = recoveringFromEmergency ? "Recovery hold before returning to adaptive control" : "Adaptive hold for active demand";
      } else {
        controllerMode = normalMode;
        controllerReason = challengerOverloaded ? "Competing phase overload is building" : "Competing phase is building pressure";
      }
    } else if (intersection.stage === "amber") {
      greenRemaining = Math.max(0, intersection.greenRemaining - dtSeconds);
      controllerMode = emergency ? "preempt_transition" : controllerMode;
      controllerReason = emergency ? "Emergency amber clearance" : "Amber clearance";
      if (greenRemaining <= 0) {
        nextStage = "all_red";
        greenRemaining = this.allRedSeconds;
      }
    } else {
      greenRemaining = Math.max(0, intersection.greenRemaining - dtSeconds);
      controllerMode = emergency ? "preempt_transition" : controllerMode;
      controllerReason = emergency ? "Emergency all-red clearance" : "All-red safety clearance";
      if (greenRemaining <= 0) {
        nextStage = "green";
        currentPhase = nextPhase;
        currentPhaseKey = nextPhaseKey;
        currentPhaseLabel = nextPhaseLabel;
        allowedMovements = nextAllowedMovements;
        activePhaseElapsed = 0;
        greenRemaining = Math.max(this.minimumGreenSeconds, 6 + decision.score * 10);
        controllerMode = emergencyForNextPhase ? "emergency_serving" : intersection.controllerMode === "emergency_serving" ? "recovery" : "normal_adaptive";
        controllerReason = emergencyForNextPhase ? "Released emergency-serving phase" : "Released best adaptive phase";
      }
    }

    if (!emergency && controllerMode === "emergency_serving") {
      controllerMode = "recovery";
      controllerReason = "Emergency cleared, returning to adaptive control";
    } else if (!emergency && controllerMode === "emergency_requested") {
      controllerMode = "recovery";
    } else if (!emergency && controllerMode === "preempt_transition" && nextStage === "green") {
      controllerMode = "recovery";
    } else if (
      !emergency &&
      controllerMode === "recovery" &&
      intersection.controllerMode === "recovery" &&
      activePhaseElapsed >= this.minimumGreenSeconds * 0.5
    ) {
      controllerMode = "normal_adaptive";
    }

    const lanes = intersection.lanes.map((lane) => ({
      ...lane,
      isGreen: nextStage === "green" && currentPhase.includes(lane.id),
    }));

    return {
      ...intersection,
      lanes,
      stage: nextStage,
      currentPhaseKey,
      currentPhaseLabel,
      currentPhase,
      nextPhaseKey,
      nextPhaseLabel,
      nextPhase,
      allowedMovements,
      nextAllowedMovements,
      greenRemaining,
      activePhaseElapsed,
      controllerReason,
      controllerMode,
      phaseScores: decision.scores,
      phaseReasonMap: decision.reasons,
      emergencyState: emergency,
    };
  }
}
