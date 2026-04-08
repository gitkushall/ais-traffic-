"""Legal signal phase switching and clearance logic."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence

from traffic_sim.core.models import ControllerMode, Intersection, PedSignalState, SignalStage


@dataclass
class PhaseDecision:
    """Scoring output for the next desired phase."""

    phase: List[str]
    next_phase: List[str]
    green_time: float
    phase_scores: Dict[str, float]
    phase_reasons: Dict[str, str]
    selected_score: float
    next_score: float
    emergency_phase: bool = False


class SignalController:
    """Applies safe signal transitions around scoring suggestions."""

    def __init__(
        self,
        minimum_green_time: float = 12.0,
        amber_time: float = 3.0,
        all_red_time: float = 1.5,
        score_switch_margin: float = 1.2,
    ) -> None:
        self.minimum_green_time = minimum_green_time
        self.amber_time = amber_time
        self.all_red_time = all_red_time
        self.score_switch_margin = score_switch_margin

    def prime(self, intersection: Intersection, phase: Sequence[str], green_time: float) -> None:
        """Initialize a fresh intersection with a valid green phase."""

        intersection.current_phase = list(phase)
        intersection.next_phase = list(phase)
        intersection.signal_stage = SignalStage.GREEN
        intersection.active_phase_duration = green_time
        intersection.green_time_remaining = green_time
        intersection.active_phase_elapsed = 0.0
        intersection.minimum_green_time = self.minimum_green_time
        intersection.controller_reason = "Initial adaptive release"
        intersection.controller_mode = ControllerMode.NORMAL_ADAPTIVE
        intersection.emergency_preemption_active = False
        intersection.emergency_recovery_active = False
        self._reset_lane_discharges(intersection)
        self._apply_lane_signals(intersection, active_phase=phase, stage=SignalStage.GREEN)

    def update(self, intersection: Intersection, dt: float, decision: PhaseDecision) -> None:
        """Advance the controller by one frame and apply safe signals."""

        if (
            intersection.controller_mode == ControllerMode.RECOVERY
            and not decision.emergency_phase
            and intersection.active_phase_elapsed > 3.0
        ):
            intersection.controller_mode = ControllerMode.NORMAL_ADAPTIVE
            intersection.emergency_recovery_active = False

        intersection.next_phase = list(decision.phase)
        intersection.phase_scores = dict(decision.phase_scores)
        intersection.phase_reasons = dict(decision.phase_reasons)
        intersection.next_phase_score = decision.selected_score
        intersection.active_phase_elapsed += dt

        if intersection.signal_stage == SignalStage.GREEN:
            intersection.green_time_remaining = max(0.0, intersection.green_time_remaining - dt)
            if self._should_hold_green(intersection, decision):
                self._apply_lane_signals(intersection, active_phase=intersection.current_phase, stage=SignalStage.GREEN)
                return
            if decision.emergency_phase:
                intersection.controller_mode = ControllerMode.PREEMPT_TRANSITION
            intersection.controller_reason = self._switch_reason(intersection, decision)
            self._start_amber(intersection)
            return

        if intersection.signal_stage == SignalStage.AMBER:
            intersection.amber_timer = max(0.0, intersection.amber_timer - dt)
            intersection.controller_reason = "Amber clearance before switching"
            if intersection.amber_timer <= 0.0:
                self._start_all_red(intersection)
            else:
                self._apply_lane_signals(intersection, active_phase=intersection.current_phase, stage=SignalStage.AMBER)
            return

        intersection.all_red_timer = max(0.0, intersection.all_red_timer - dt)
        self._apply_lane_signals(intersection, active_phase=intersection.current_phase, stage=SignalStage.ALL_RED)
        intersection.controller_reason = "All-red safety clearance"
        if intersection.all_red_timer > 0.0 or intersection.junction_occupied:
            if intersection.controller_mode == ControllerMode.PREEMPT_TRANSITION:
                intersection.emergency_preemption_active = True
            return

        self._start_green(intersection, decision.phase, decision.green_time, decision.next_phase)

    def _should_hold_green(self, intersection: Intersection, decision: PhaseDecision) -> bool:
        """Return whether the current green must remain active."""

        current_score = self._phase_score(intersection, intersection.current_phase, decision)
        best_score = decision.selected_score
        current_reason = self._phase_reason(intersection, intersection.current_phase, decision)
        intersection.current_phase_score = current_score
        intersection.next_phase_score = best_score
        intersection.active_emergency = "emergency" in current_reason.lower()
        if intersection.active_emergency:
            intersection.controller_mode = ControllerMode.EMERGENCY_REQUESTED

        if intersection.active_phase_elapsed < self.minimum_green_time:
            intersection.controller_reason = "Holding minimum green for stability"
            return True

        if decision.emergency_phase and list(decision.phase) != list(intersection.current_phase):
            if intersection.active_phase_elapsed < max(6.0, min(self.minimum_green_time, 8.0)):
                intersection.controller_reason = "Holding briefly before emergency-safe switch"
                intersection.controller_mode = ControllerMode.EMERGENCY_REQUESTED
                return True
            return False

        if list(decision.phase) == list(intersection.current_phase):
            useful_extension = self._extension_window(intersection, current_score, current_reason)
            if useful_extension > 0.0:
                intersection.green_time_remaining = max(intersection.green_time_remaining, useful_extension)
                intersection.active_phase_duration = max(
                    intersection.active_phase_duration,
                    intersection.active_phase_elapsed + useful_extension,
                )
                intersection.controller_reason = f"Extending current phase: {current_reason}"
                if decision.emergency_phase:
                    intersection.controller_mode = ControllerMode.EMERGENCY_SERVING
                    intersection.emergency_preemption_active = True
                return True
            intersection.controller_reason = "Current phase pressure has dropped"
            return False

        if best_score <= 0.0 and current_score > 0.0:
            intersection.controller_reason = f"Holding current phase: {current_reason}"
            return True

        if current_score > 0.0 and best_score < current_score * self.score_switch_margin:
            useful_extension = self._extension_window(intersection, current_score, current_reason)
            if useful_extension > 0.0:
                intersection.green_time_remaining = max(intersection.green_time_remaining, useful_extension)
                intersection.controller_reason = f"Holding current phase: {current_reason}"
                return True

        return False

    def _extension_window(self, intersection: Intersection, score: float, reason: str) -> float:
        """Return how much useful adaptive green remains for the current phase."""

        if score >= 1000.0:
            return min(10.0, 60.0 - intersection.active_phase_elapsed)
        if score >= 55.0:
            return min(8.0, 60.0 - intersection.active_phase_elapsed)
        if score >= 35.0:
            return min(5.0, 55.0 - intersection.active_phase_elapsed)
        if score >= 18.0:
            return min(3.0, 45.0 - intersection.active_phase_elapsed)
        if "moving flow" in reason.lower():
            return min(2.0, 40.0 - intersection.active_phase_elapsed)
        return 0.0

    def _switch_reason(self, intersection: Intersection, decision: PhaseDecision) -> str:
        """Return a human-readable explanation for a phase switch."""

        current_score = self._phase_score(intersection, intersection.current_phase, decision)
        best_reason = decision.phase_reasons.get(self._phase_key(decision.phase), "higher pressure detected")
        if decision.emergency_phase and list(decision.phase) != list(intersection.current_phase):
            return f"Switching for emergency priority: {best_reason}"
        if decision.selected_score > current_score:
            return f"Switching to higher-demand phase: {best_reason}"
        return "Switching because current phase no longer justifies extension"

    def _phase_score(self, intersection: Intersection, phase: Sequence[str], decision: PhaseDecision) -> float:
        """Return the score for a phase from the latest scoring decision."""

        return decision.phase_scores.get(self._phase_key(phase), 0.0)

    def _phase_reason(self, intersection: Intersection, phase: Sequence[str], decision: PhaseDecision) -> str:
        """Return the debug reason text for a phase."""

        return decision.phase_reasons.get(self._phase_key(phase), "no active pressure")

    def _phase_key(self, phase: Sequence[str]) -> str:
        """Return a stable phase identifier."""

        return "+".join(phase) if phase else "none"

    def _start_amber(self, intersection: Intersection) -> None:
        """Enter amber for the currently active phase."""

        intersection.signal_stage = SignalStage.AMBER
        intersection.amber_timer = self.amber_time
        self._apply_lane_signals(intersection, active_phase=intersection.current_phase, stage=SignalStage.AMBER)

    def _start_all_red(self, intersection: Intersection) -> None:
        """Enter all-red clearance after amber."""

        intersection.signal_stage = SignalStage.ALL_RED
        intersection.all_red_timer = self.all_red_time
        self._apply_lane_signals(intersection, active_phase=intersection.current_phase, stage=SignalStage.ALL_RED)

    def _start_green(
        self,
        intersection: Intersection,
        phase: Sequence[str],
        green_time: float,
        next_phase: Sequence[str],
    ) -> None:
        """Release a new green phase once the junction is clear."""

        intersection.current_phase = list(phase)
        intersection.next_phase = list(next_phase)
        intersection.signal_stage = SignalStage.GREEN
        intersection.active_phase_elapsed = 0.0
        intersection.active_phase_duration = green_time
        intersection.green_time_remaining = green_time
        intersection.current_phase_score = intersection.phase_scores.get(self._phase_key(phase), 0.0)
        intersection.next_phase_score = intersection.phase_scores.get(self._phase_key(next_phase), 0.0)
        intersection.controller_reason = intersection.phase_reasons.get(
            self._phase_key(phase),
            "Adaptive release to highest-pressure legal phase",
        )
        if "emergency" in intersection.controller_reason.lower():
            intersection.controller_mode = ControllerMode.EMERGENCY_SERVING
            intersection.emergency_preemption_active = True
            intersection.emergency_preemptions_triggered += 1
        elif intersection.emergency_preemption_active:
            intersection.controller_mode = ControllerMode.RECOVERY
            intersection.emergency_recovery_active = True
            intersection.emergency_preemption_active = False
        else:
            intersection.controller_mode = ControllerMode.NORMAL_ADAPTIVE
            intersection.emergency_recovery_active = False
        self._reset_lane_discharges(intersection)
        self._apply_lane_signals(intersection, active_phase=phase, stage=SignalStage.GREEN)

    def _reset_lane_discharges(self, intersection: Intersection) -> None:
        """Reset per-lane discharge counts when a new green phase begins."""

        for lane in intersection.lanes:
            lane.lane_discharged = {}

    def _apply_lane_signals(
        self,
        intersection: Intersection,
        active_phase: Sequence[str],
        stage: SignalStage,
    ) -> None:
        """Map the controller stage onto lane booleans and signal metadata."""

        intersection.lane_signal_states = {}
        active_lanes = {token.split("_", 1)[0] for token in active_phase}
        intersection.ped_signal_states = {}
        for lane in intersection.lanes:
            if stage == SignalStage.GREEN and lane.id in active_phase:
                lane.is_green = True
                lane.green_timer = intersection.green_time_remaining
                intersection.lane_signal_states[lane.id] = SignalStage.GREEN
            elif stage == SignalStage.GREEN and lane.id in active_lanes:
                lane.is_green = True
                lane.green_timer = intersection.green_time_remaining
                intersection.lane_signal_states[lane.id] = SignalStage.GREEN
            elif stage == SignalStage.AMBER and lane.id in active_lanes:
                lane.is_green = False
                lane.green_timer = intersection.amber_timer
                intersection.lane_signal_states[lane.id] = SignalStage.AMBER
            else:
                lane.is_green = False
                lane.green_timer = 0.0
                intersection.lane_signal_states[lane.id] = SignalStage.ALL_RED
            intersection.ped_signal_states[lane.id] = (
                PedSignalState.WALK
                if stage == SignalStage.GREEN and lane.id not in active_lanes
                else (
                    PedSignalState.FLASHING_DONT_WALK
                    if lane.id not in active_lanes and stage in {SignalStage.AMBER, SignalStage.ALL_RED}
                    else PedSignalState.DONT_WALK
                )
            )
