"""Lightweight in-memory simulation logging."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List

from traffic_sim.core.models import Intersection


@dataclass
class SimulationSnapshot:
    """One aggregated analytics sample captured from the simulation."""

    tick: int
    average_wait: float
    total_cars_passed: int
    active_phase: str
    lane_scores: Dict[str, float]


class SimulationLog:
    """Stores recent snapshots for dashboards or later export."""

    def __init__(self, maxlen: int = 600) -> None:
        self.snapshots: Deque[SimulationSnapshot] = deque(maxlen=maxlen)

    def record(self, intersection: Intersection) -> None:
        """Store a snapshot for one intersection."""

        average_wait = (
            sum(lane.waiting_time for lane in intersection.lanes) / len(intersection.lanes)
            if intersection.lanes
            else 0.0
        )
        self.snapshots.append(
            SimulationSnapshot(
                tick=intersection.tick,
                average_wait=average_wait,
                total_cars_passed=intersection.total_cars_passed,
                active_phase="+".join(intersection.current_phase),
                lane_scores={lane.id: lane.score for lane in intersection.lanes},
            )
        )

    def latest(self) -> SimulationSnapshot | None:
        """Return the most recent snapshot if one exists."""

        return self.snapshots[-1] if self.snapshots else None

    def latest_wait_series(self, count: int = 60) -> List[float]:
        """Return the most recent average wait series."""

        return [snapshot.average_wait for snapshot in list(self.snapshots)[-count:]]
