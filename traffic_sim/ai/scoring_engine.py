"""AI scoring and adaptive phase selection."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np

from traffic_sim.ai.pattern_memory import PatternMemory
from traffic_sim.core.models import Intersection, Lane, TurnIntent, VehicleState


@dataclass
class WeightProfile:
    """Runtime-adjustable weights for lane scoring."""

    density: float = 0.5
    wait: float = 0.3
    pedestrian: float = 0.2

    def normalize(self) -> None:
        """Normalize the weights so they always sum to 1.0."""

        total = self.density + self.wait + self.pedestrian
        if total <= 0:
            self.density, self.wait, self.pedestrian = 0.5, 0.3, 0.2
            return
        self.density /= total
        self.wait /= total
        self.pedestrian /= total


class ScoringEngine:
    """Scores lane pressure, selects phases, and calculates green times."""

    def __init__(self, weights: WeightProfile | None = None, memory: PatternMemory | None = None) -> None:
        self.weights = weights or WeightProfile()
        self.weights.normalize()
        self.memory = memory or PatternMemory()

    def score_intersection(self, intersection: Intersection) -> Dict[str, float]:
        """Score every lane in the intersection and update history."""

        scores: Dict[str, float] = {}
        for lane in intersection.lanes:
            score = self.score_lane(lane)
            lane.score = score
            scores[lane.id] = score
            self.memory.remember(lane, score)
        return scores

    def score_lane(self, lane: Lane) -> float:
        """Score a lane using normalized density, wait, and pedestrian pressure."""

        if lane.has_emergency or lane.emergency_timer > 0:
            return 999.0

        density = float(np.clip(lane.car_count / 30.0, 0.0, 1.0))
        wait = float(np.clip(lane.waiting_time / 120.0, 0.0, 1.0))
        pedestrians = float(np.clip(lane.pedestrian_count / 10.0, 0.0, 1.0))

        return (
            density * self.weights.density
            + wait * self.weights.wait
            + pedestrians * self.weights.pedestrian
        )

    def select_phase(
        self,
        intersection: Intersection,
        compatible_phases: Sequence[Sequence[str]],
    ) -> Tuple[List[str], List[str], float, Dict[str, float], Dict[str, str], float, float, bool]:
        """Select the highest-scoring compatible phase and predict the next one."""

        if not compatible_phases:
            return [], [], 10.0, {}, {}, 0.0, 0.0, False

        lane_by_id = {lane.id: lane for lane in intersection.lanes}
        phase_totals: List[Tuple[List[str], float, str, bool]] = []
        phase_score_map: Dict[str, float] = {}
        phase_reason_map: Dict[str, str] = {}
        for phase in compatible_phases:
            total, reason, has_emergency = self.score_phase(intersection, phase)
            phase_list = list(phase)
            phase_totals.append((phase_list, total, reason, has_emergency))
            phase_key = self._phase_key(phase_list)
            phase_score_map[phase_key] = total
            phase_reason_map[phase_key] = reason

        phase_totals.sort(key=lambda item: item[1], reverse=True)
        selected_phase, selected_total, selected_reason, selected_emergency = phase_totals[0]
        next_phase = phase_totals[1][0] if len(phase_totals) > 1 else selected_phase[:]
        next_score = phase_totals[1][1] if len(phase_totals) > 1 else selected_total
        green_time = self.calculate_green_time(intersection, selected_phase, selected_total)
        intersection.phase_scores = phase_score_map
        intersection.phase_reasons = phase_reason_map
        intersection.current_phase_score = phase_score_map.get(self._phase_key(intersection.current_phase), 0.0)
        intersection.next_phase_score = selected_total
        return (
            selected_phase,
            next_phase,
            green_time,
            phase_score_map,
            phase_reason_map,
            selected_total,
            next_score,
            selected_emergency,
        )

    def score_phase(self, intersection: Intersection, phase: Sequence[str]) -> Tuple[float, str, bool]:
        """Calculate an adaptive demand score for a compatible phase."""

        lane_by_id = {lane.id: lane for lane in intersection.lanes}
        movement_stats = [self._movement_stats(intersection, lane_by_id, token) for token in phase]
        active_stats = [stat for stat in movement_stats if stat is not None]
        if not active_stats:
            return 0.0, "no lanes in phase", False

        queue_length = sum(stat["queue"] for stat in active_stats)
        total_waiting = sum(stat["vehicles"] for stat in active_stats)
        avg_wait = sum(stat["wait"] for stat in active_stats) / len(active_stats)
        pedestrian_request = sum(stat["pedestrians"] for stat in active_stats)
        moving_flow = sum(stat["moving"] for stat in active_stats)
        starvation_bonus = sum(min(stat["wait"] / 20.0, 6.0) for stat in active_stats)
        emergency_stats = [stat for stat in active_stats if stat["emergency"]]
        emergency_bonus = 0.0
        emergency_reason = ""
        if emergency_stats:
            best_emergency = min(emergency_stats, key=lambda stat: float(stat["emergency_distance"]))
            proximity_bonus = max(0.0, 280.0 - float(best_emergency["emergency_distance"])) * 7.0
            clearance_bonus = 220.0 if float(best_emergency["emergency_distance"]) < 120.0 else 120.0
            emergency_bonus = 1200.0 + proximity_bonus + clearance_bonus + float(best_emergency["emergency_priority"]) * 300.0
            emergency_reason = (
                f"{best_emergency['emergency_type']} "
                f"{best_emergency['lane_id']} {best_emergency['lane_group']} "
                f"{float(best_emergency['emergency_distance']):.0f}px"
            )
        left_turn_bonus = sum(1 for stat in active_stats if stat["lane_group"] == "left") * 4.0
        network_boost = sum(intersection.network_movement_boosts.get(stat["movement_id"], 0.0) for stat in active_stats)
        network_penalty = sum(intersection.network_movement_penalties.get(stat["movement_id"], 0.0) for stat in active_stats)
        incident_penalty = sum(float(stat["incident_penalty"]) for stat in active_stats)
        blocked_penalty = sum(120.0 for stat in active_stats if bool(stat["blocked"]))
        weather_penalty = (1.0 - intersection.discharge_efficiency) * 40.0
        capacity_penalty = max(0.0, 1.0 - intersection.usable_capacity_factor) * 80.0

        phase_score = (
            queue_length * 4.5
            + total_waiting * 2.0
            + avg_wait * 0.35
            + pedestrian_request * 1.8
            + moving_flow * 2.5
            + starvation_bonus * 6.0
            + left_turn_bonus
            + emergency_bonus
            + network_boost
            - network_penalty
            - incident_penalty
            - blocked_penalty
            - weather_penalty
            - capacity_penalty
        )

        dominant_terms = []
        if emergency_bonus:
            dominant_terms.append(f"emergency priority {emergency_reason}".strip())
        if queue_length:
            dominant_terms.append(f"queue {queue_length}")
        if avg_wait >= 10.0:
            dominant_terms.append(f"avg wait {avg_wait:.0f}s")
        if moving_flow:
            dominant_terms.append(f"moving flow {moving_flow}")
        if pedestrian_request:
            dominant_terms.append(f"ped demand {pedestrian_request}")
        if starvation_bonus >= 3.0:
            dominant_terms.append("starvation prevention")
        if network_boost:
            dominant_terms.append(f"corridor boost {network_boost:.0f}")
        if network_penalty:
            dominant_terms.append(f"downstream hold {network_penalty:.0f}")
        if incident_penalty or blocked_penalty:
            dominant_terms.append("incident constraint")
        if weather_penalty >= 4.0:
            dominant_terms.append(intersection.weather_mode.value.replace("_", " "))

        reason = ", ".join(dominant_terms) if dominant_terms else "low demand"
        return phase_score, reason, emergency_bonus > 0.0

    def calculate_green_time(
        self,
        intersection: Intersection,
        phase: Sequence[str],
        phase_score: float | None = None,
    ) -> float:
        """Calculate a soft adaptive target green based on current pressure."""

        lane_by_id = {lane.id: lane for lane in intersection.lanes}
        stats = [self._movement_stats(intersection, lane_by_id, token) for token in phase]
        active_stats = [stat for stat in stats if stat is not None]
        queued = sum(stat["queue"] for stat in active_stats)
        avg_wait = sum(stat["wait"] for stat in active_stats) / max(1, len(active_stats))
        emergency = any(stat["emergency"] for stat in active_stats)
        emergency_distance = min(
            [float(stat["emergency_distance"]) for stat in active_stats if stat["emergency"]],
            default=999.0,
        )
        blocked = any(bool(stat["blocked"]) for stat in active_stats)

        base_time = 14.0
        queue_extra = min(22.0, queued * 1.35)
        wait_extra = min(10.0, avg_wait * 0.08)
        emergency_extra = 12.0 if emergency else 0.0
        proximity_extra = max(0.0, (220.0 - emergency_distance) / 18.0) if emergency else 0.0
        weather_extra = (1.0 - intersection.discharge_efficiency) * 8.0
        blocked_trim = 6.0 if blocked else 0.0
        green_time = min(60.0, base_time + queue_extra + wait_extra + emergency_extra + proximity_extra + weather_extra - blocked_trim)
        return max(green_time, 15.0)

    def set_weights(self, density: float, wait: float, pedestrian: float) -> None:
        """Update and normalize runtime scoring weights."""

        self.weights = WeightProfile(density=density, wait=wait, pedestrian=pedestrian)
        self.weights.normalize()

    def _phase_key(self, phase: Sequence[str]) -> str:
        """Return a stable identifier for a phase."""

        return "+".join(phase) if phase else "none"

    def _movement_stats(
        self,
        intersection: Intersection,
        lane_by_id: Dict[str, Lane],
        token: str,
    ) -> Dict[str, float | bool | str] | None:
        """Return demand statistics for one movement token."""

        if "_" not in token:
            lane_id, lane_group = token, "through"
        else:
            lane_id, lane_group = token.split("_", 1)
        lane = lane_by_id.get(lane_id)
        if lane is None:
            return None

        intents = {
            "left": {TurnIntent.TURN_LEFT},
            "right": {TurnIntent.TURN_RIGHT},
            "through": {TurnIntent.STRAIGHT},
        }[lane_group]
        vehicles = [vehicle for vehicle in lane.vehicles if self._vehicle_in_group(vehicle, lane_group, intents)]
        queue = len(
            [
                vehicle
                for vehicle in vehicles
                if vehicle.state in {VehicleState.APPROACHING, VehicleState.QUEUED}
            ]
        )
        moving = len(
            [
                vehicle
                for vehicle in vehicles
                if vehicle.state in {
                    VehicleState.ENTERING_INTERSECTION,
                    VehicleState.INSIDE_INTERSECTION,
                    VehicleState.EXITING,
                }
            ]
        )
        emergency_vehicle = min(
            [vehicle for vehicle in vehicles if getattr(vehicle, "is_emergency", False)],
            key=lambda vehicle: self._approach_distance(lane_id, vehicle),
            default=None,
        )
        blocked_incidents = [
            incident
            for incident in intersection.incidents
            if getattr(incident, "blocked_movement", "") == (token if "_" in token else f"{lane_id}_{lane_group}")
        ]
        return {
            "lane_id": lane_id,
            "lane_group": lane_group,
            "movement_id": token if "_" in token else f"{lane_id}_{lane_group}",
            "queue": queue,
            "vehicles": len(vehicles),
            "wait": lane.waiting_time,
            "pedestrians": lane.pedestrian_count,
            "moving": moving,
            "emergency": lane.has_emergency or lane.emergency_timer > 0,
            "emergency_distance": self._approach_distance(lane_id, emergency_vehicle) if emergency_vehicle else 999.0,
            "emergency_priority": getattr(emergency_vehicle, "priority_level", 0.0) if emergency_vehicle else 0.0,
            "emergency_type": getattr(getattr(emergency_vehicle, "emergency_type", None), "value", ""),
            "blocked": any(incident.capacity_factor <= 0.05 for incident in blocked_incidents),
            "incident_penalty": sum((1.0 - incident.capacity_factor) * 60.0 * incident.severity for incident in blocked_incidents),
        }

    def _vehicle_in_group(
        self,
        vehicle: object,
        lane_group: str,
        intents: set[TurnIntent],
    ) -> bool:
        """Return whether a vehicle should count toward one movement group."""

        assigned_group = getattr(vehicle, "lane_group", "")
        if assigned_group:
            return assigned_group == lane_group
        return getattr(vehicle, "intent", None) in intents

    def detect_emergency(self, intersection: Intersection) -> Dict[str, object]:
        """Return the highest-priority approaching emergency vehicle details."""

        detected = []
        for lane in intersection.lanes:
            for vehicle in lane.vehicles:
                if not getattr(vehicle, "is_emergency", False):
                    continue
                distance = self._approach_distance(lane.id, vehicle)
                detected.append(
                    {
                        "vehicle": vehicle,
                        "type": getattr(getattr(vehicle, "emergency_type", None), "value", ""),
                        "approach": lane.id,
                        "movement": getattr(vehicle, "lane_group", ""),
                        "distance": distance,
                        "priority": getattr(vehicle, "priority_level", 0.0),
                        "detected": distance <= 260.0 or vehicle.has_entered_intersection,
                    }
                )
        if not detected:
            return {
                "exists": False,
                "type": "",
                "approach": "",
                "movement": "",
                "distance": 0.0,
                "detected": False,
            }
        best = min(detected, key=lambda item: (not item["detected"], item["distance"], -float(item["priority"])))
        return {
            "exists": True,
            "type": best["type"],
            "approach": best["approach"],
            "movement": best["movement"],
            "distance": float(best["distance"]),
            "detected": bool(best["detected"]),
        }

    def _approach_distance(self, lane_id: str, vehicle: object | None) -> float:
        """Return distance from a vehicle to its stop line along the approach."""

        if vehicle is None:
            return 999.0
        if lane_id == "north":
            return max(0.0, 255.0 - float(getattr(vehicle, "y", 0.0)))
        if lane_id == "south":
            return max(0.0, float(getattr(vehicle, "y", 0.0)) - 465.0)
        if lane_id == "east":
            return max(0.0, float(getattr(vehicle, "x", 0.0)) - 505.0)
        return max(0.0, 295.0 - float(getattr(vehicle, "x", 0.0)))
