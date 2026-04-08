"""Intersection construction and phase compatibility rules."""

from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

from traffic_sim.core.intersection_layout import get_layout
from traffic_sim.core.models import Intersection, Lane, PedSignalState, SignalStage


class IntersectionEngine:
    """Builds supported intersection topologies and their phase groups."""

    CONFIGS: Dict[str, Sequence[Tuple[str, float]]] = {
        "2way": [("north", 0.0), ("south", 180.0)],
        "3way": [("north", 0.0), ("east", 90.0), ("west", 270.0)],
        "4way": [
            ("north", 0.0),
            ("south", 180.0),
            ("east", 90.0),
            ("west", 270.0),
        ],
    }

    COMPATIBLE: Dict[str, List[List[str]]] = {
        key: [list(phase) for phase in get_layout(key).movement_phases]
        for key in CONFIGS
    }

    def build(self, intersection_type: str) -> Intersection:
        """Build an intersection with lanes and default runtime state."""

        if intersection_type not in self.CONFIGS:
            raise ValueError(f"Unsupported intersection type: {intersection_type}")

        lanes = [
            Lane(id=lane_id, direction=angle)
            for lane_id, angle in self.CONFIGS[intersection_type]
        ]
        intersection = Intersection(type=intersection_type, lanes=lanes)
        intersection.current_phase = self.get_compatible_phases(intersection_type)[0][:]
        intersection.next_phase = intersection.current_phase[:]
        intersection.lane_signal_states = {lane.id: SignalStage.ALL_RED for lane in lanes}
        intersection.ped_signal_states = {lane.id: PedSignalState.DONT_WALK for lane in lanes}
        return intersection

    def get_compatible_phases(self, intersection_type: str) -> List[List[str]]:
        """Return the compatible green phases for the given topology."""

        if intersection_type not in self.COMPATIBLE:
            raise ValueError(f"Unsupported intersection type: {intersection_type}")
        return [phase[:] for phase in self.COMPATIBLE[intersection_type]]
