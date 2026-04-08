"""Structured UI view models for the sidebar."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from traffic_sim.ai.scoring_engine import WeightProfile
from traffic_sim.core.intersection_layout import get_layout
from traffic_sim.core.models import Intersection, Lane
from traffic_sim.ui import colors


@dataclass
class TextLine:
    """A formatted line of sidebar text."""

    text: str
    color: Tuple[int, int, int] = colors.MUTED_TEXT


@dataclass
class LaneScoreView:
    """Display-ready lane score information."""

    lane_id: str
    title: str
    score: float
    summary: str
    status: str = ""
    status_color: Tuple[int, int, int] = colors.MUTED_TEXT


@dataclass
class SidebarViewModel:
    """Structured data required to render the sidebar."""

    intersection_type: str
    selector_key: str
    lane_scores: List[LaneScoreView] = field(default_factory=list)
    phase_lines: List[TextLine] = field(default_factory=list)
    analytics_lines: List[TextLine] = field(default_factory=list)
    environment_lines: List[TextLine] = field(default_factory=list)
    debug_lines: List[TextLine] = field(default_factory=list)
    chart_history: List[float] = field(default_factory=list)
    paused: bool = False
    debug_mode: bool = False
    simulation_speed: int = 1
    intersection_count: int = 1
    weights: WeightProfile | None = None


class SidebarViewModelBuilder:
    """Builds sidebar-safe structured content from simulation state."""

    def build(
        self,
        intersection: Intersection,
        weights: WeightProfile,
        fps: float,
        paused: bool,
        debug_mode: bool,
        simulation_speed: int,
        intersection_count: int,
        network_summary: Dict[str, object],
    ) -> SidebarViewModel:
        """Return a structured sidebar model for one frame."""

        layout = get_layout(intersection.type)
        model = SidebarViewModel(
            intersection_type=intersection.type,
            selector_key=f"type_{intersection.type}",
            paused=paused,
            debug_mode=debug_mode,
            simulation_speed=simulation_speed,
            intersection_count=intersection_count,
            weights=weights,
        )
        model.lane_scores = [self._lane_score_view(lane, debug_mode) for lane in intersection.lanes]
        model.phase_lines = self._phase_lines(intersection)
        model.analytics_lines = self._analytics_lines(intersection, fps, intersection_count, network_summary)
        model.environment_lines = self._environment_lines(intersection, layout)
        model.debug_lines = self._debug_lines(intersection, layout, network_summary) if debug_mode else []
        model.chart_history = list(intersection.average_wait_history)[-60:]
        return model

    def _lane_score_view(self, lane: Lane, debug_mode: bool) -> LaneScoreView:
        """Format one lane row for sidebar rendering."""

        summary = f"Cars {lane.car_count} | Queue {lane.queue_length} | Wait {lane.waiting_time:.0f}s"
        status = ""
        status_color = colors.MUTED_TEXT
        if lane.has_emergency and lane.emergency_timer > 0:
            status = f"Emergency {lane.emergency_timer}t"
            status_color = colors.RED
        elif debug_mode and lane.vehicles:
            lead = min(lane.vehicles, key=lambda vehicle: vehicle.index)
            status = f"{lead.intent.value} | {lead.lane_group} | {lead.wait_reason or lead.state.value}"
            status_color = colors.MUTED_TEXT
        return LaneScoreView(
            lane_id=lane.id,
            title=lane.id.upper(),
            score=lane.score,
            summary=summary,
            status=status,
            status_color=status_color,
        )

    def _phase_lines(self, intersection: Intersection) -> List[TextLine]:
        """Build active-phase lines."""

        return [
            TextLine(f"Current: {self._phase_name(intersection.current_phase)}", colors.TEXT),
            TextLine(f"Hold: {intersection.green_time_remaining:.1f}s", colors.GREEN),
            TextLine(
                f"Next: {self._phase_name(intersection.next_phase)} | Score {intersection.next_phase_score:.1f}",
                colors.MUTED_TEXT,
            ),
            TextLine(intersection.controller_reason or "Adaptive controller active", colors.MUTED_TEXT),
        ]

    def _analytics_lines(
        self,
        intersection: Intersection,
        fps: float,
        intersection_count: int,
        network_summary: Dict[str, object],
    ) -> List[TextLine]:
        """Build compact analytics lines."""

        lines = [
            TextLine(f"Cars passed {intersection.total_cars_passed}", colors.TEXT),
            TextLine(f"Tick {intersection.tick} | FPS {fps:.0f}", colors.TEXT),
            TextLine(f"Network {intersection_count} intersections", colors.MUTED_TEXT),
        ]
        if network_summary:
            occupancy = ", ".join(
                f"{segment}:{count}"
                for segment, count in sorted(dict(network_summary.get("segment_occupancy", {})).items())
            )
            lines.append(TextLine(f"Segments {occupancy or 'none'}", colors.MUTED_TEXT))
        return lines

    def _environment_lines(self, intersection: Intersection, layout: object) -> List[TextLine]:
        """Build environment and scenario lines."""

        lines = [
            TextLine(f"Weather {intersection.weather_mode.value.replace('_', ' ')}", colors.TEXT),
            TextLine(
                f"Road {intersection.road_condition.value.replace('_', ' ')} | Incidents {len(intersection.incidents)}",
                colors.MUTED_TEXT,
            ),
            TextLine(
                f"Speed x{intersection.weather_speed_factor:.2f} | Cap x{intersection.usable_capacity_factor:.2f}",
                colors.MUTED_TEXT,
            ),
        ]
        return lines

    def _debug_lines(
        self,
        intersection: Intersection,
        layout: object,
        network_summary: Dict[str, object],
    ) -> List[TextLine]:
        """Build detailed diagnostics for debug mode."""

        lines = [
            TextLine(f"Stage {intersection.signal_stage.value} | Mode {intersection.controller_mode.value}", colors.TEXT),
            TextLine(
                f"Occupied {intersection.junction_occupied} | Committed {intersection.committed_vehicle_count}",
                colors.MUTED_TEXT,
            ),
            TextLine(
                f"Emergency {intersection.emergency_detected} | Preempt {intersection.emergency_preemption_active} | Recovery {intersection.emergency_recovery_active}",
                colors.MUTED_TEXT,
            ),
            TextLine(
                f"Allowed {', '.join(intersection.current_phase) if intersection.current_phase else 'none'}",
                colors.MUTED_TEXT,
            ),
            TextLine(
                f"Phase score {intersection.current_phase_score:.1f} -> {intersection.next_phase_score:.1f}",
                colors.MUTED_TEXT,
            ),
            TextLine(
                f"Signal groups {' | '.join('/'.join(group) for group in layout.signal_groups)}",
                colors.MUTED_TEXT,
            ),
        ]
        if intersection.coordination_reason:
            lines.append(TextLine(f"Coordination {intersection.coordination_reason}", colors.MUTED_TEXT))
        elif network_summary:
            lines.append(TextLine(f"Corridor {network_summary.get('pressure', 'balanced')}", colors.MUTED_TEXT))
        return lines

    def _phase_name(self, phase: List[str]) -> str:
        """Return a concise phase label."""

        if not phase:
            return "None"
        parts = []
        for token in phase:
            if "_" in token:
                lane_id, movement = token.split("_", 1)
                movement_short = {"through": "TH", "left": "LT", "right": "RT"}.get(movement, movement[:2].upper())
                parts.append(f"{lane_id[0].upper()}-{movement_short}")
            else:
                parts.append(token[0].upper())
        return " | ".join(parts)
