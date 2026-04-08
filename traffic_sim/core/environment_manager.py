"""Weather, road-condition, and incident management."""

from __future__ import annotations

import random
from typing import Iterable, Sequence

from traffic_sim.core.intersection_layout import movement_token
from traffic_sim.core.models import Incident, IncidentType, Intersection, RoadCondition, WeatherMode


class EnvironmentManager:
    """Owns global weather modes and local incident lifecycle."""

    WEATHER_ORDER: Sequence[WeatherMode] = (
        WeatherMode.CLEAR,
        WeatherMode.LIGHT_RAIN,
        WeatherMode.HEAVY_RAIN,
        WeatherMode.FOG,
        WeatherMode.NIGHT,
    )

    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()
        self.weather_elapsed = 0.0
        self.weather_hold = self.rng.uniform(35.0, 70.0)
        self.incident_counter = 0

    def prime(self, intersections: Iterable[Intersection], weather_mode: WeatherMode = WeatherMode.CLEAR) -> None:
        """Initialize environment state on fresh intersections."""

        for intersection in intersections:
            intersection.weather_mode = weather_mode
            self._apply_weather_profile(intersection)

    def update(self, intersections: Iterable[Intersection], dt: float) -> None:
        """Advance automatic weather and incident timers."""

        items = list(intersections)
        if not items:
            return

        if items[0].auto_environment:
            self.weather_elapsed += dt
            if self.weather_elapsed >= self.weather_hold:
                self.weather_elapsed = 0.0
                self.weather_hold = self.rng.uniform(35.0, 70.0)
                self.set_weather(items, self.rng.choice(list(self.WEATHER_ORDER)))

        for intersection in items:
            self._tick_incidents(intersection, dt)
            self._apply_weather_profile(intersection)
            if intersection.auto_environment and self.rng.random() < 0.00012 and not intersection.incidents:
                self.trigger_random_incident(intersection)

    def set_weather(self, intersections: Iterable[Intersection], weather_mode: WeatherMode) -> None:
        """Apply a specific weather mode to all active intersections."""

        for intersection in intersections:
            intersection.weather_mode = weather_mode
            self._apply_weather_profile(intersection)

    def cycle_weather(self, intersections: Iterable[Intersection]) -> WeatherMode:
        """Rotate to the next weather mode and return it."""

        items = list(intersections)
        current = items[0].weather_mode if items else WeatherMode.CLEAR
        index = self.WEATHER_ORDER.index(current)
        next_weather = self.WEATHER_ORDER[(index + 1) % len(self.WEATHER_ORDER)]
        self.set_weather(items, next_weather)
        return next_weather

    def toggle_auto_environment(self, intersections: Iterable[Intersection]) -> bool:
        """Toggle automatic weather/incident changes."""

        enabled = True
        for intersection in intersections:
            intersection.auto_environment = not intersection.auto_environment
            enabled = intersection.auto_environment
        return enabled

    def clear_incidents(self, intersections: Iterable[Intersection]) -> None:
        """Clear all active incidents."""

        for intersection in intersections:
            if intersection.incidents:
                intersection.incidents_cleared += len(intersection.incidents)
            intersection.incidents = []
            intersection.usable_capacity_factor = 1.0
            intersection.road_condition = self._base_condition(intersection.weather_mode)

    def trigger_random_incident(self, intersection: Intersection) -> Incident:
        """Create a realistic lane disruption at one intersection."""

        self.incident_counter += 1
        lane = self.rng.choice(intersection.lanes)
        lane_group = self.rng.choice(["through", "left", "right"])
        blocked_movement = movement_token(lane.id, lane_group)
        incident_type, severity, duration, capacity_factor = self.rng.choice(
            [
                (IncidentType.STALLED_VEHICLE, 0.45, 18.0, 0.45),
                (IncidentType.MINOR_ACCIDENT, 0.65, 24.0, 0.2),
                (IncidentType.BLOCKED_LANE, 0.85, 30.0, 0.0),
                (IncidentType.ROAD_WORK, 0.55, 36.0, 0.35),
            ]
        )
        incident = Incident(
            id=f"inc-{self.incident_counter}",
            incident_type=incident_type,
            location_type="lane",
            target_id=lane.id,
            severity=severity,
            duration=duration,
            capacity_factor=capacity_factor,
            blocked_movement=blocked_movement,
        )
        intersection.incidents.append(incident)
        self._apply_weather_profile(intersection)
        return incident

    def _tick_incidents(self, intersection: Intersection, dt: float) -> None:
        """Advance incident timers and remove expired disruptions."""

        retained = []
        for incident in intersection.incidents:
            incident.elapsed += dt
            if incident.elapsed < incident.duration:
                retained.append(incident)
            else:
                intersection.incidents_cleared += 1
                intersection.incident_delay_history.append(incident.duration)
        intersection.incidents = retained

    def _apply_weather_profile(self, intersection: Intersection) -> None:
        """Translate weather and incidents into movement factors."""

        profile = {
            WeatherMode.CLEAR: (RoadCondition.DRY, 1.0, 1.0, 1.0, 1.0, 1.0),
            WeatherMode.LIGHT_RAIN: (RoadCondition.WET, 0.92, 1.12, 1.08, 1.04, 0.92),
            WeatherMode.HEAVY_RAIN: (RoadCondition.SLIPPERY, 0.82, 1.28, 1.18, 1.08, 0.78),
            WeatherMode.FOG: (RoadCondition.LOW_VISIBILITY, 0.86, 1.18, 1.16, 0.96, 0.86),
            WeatherMode.NIGHT: (RoadCondition.LOW_VISIBILITY, 0.93, 1.08, 1.07, 0.98, 0.93),
        }[intersection.weather_mode]
        (
            intersection.road_condition,
            intersection.weather_speed_factor,
            intersection.weather_braking_factor,
            intersection.weather_headway_factor,
            intersection.weather_ped_speed_factor,
            intersection.discharge_efficiency,
        ) = profile

        capacity_factor = 1.0
        if intersection.incidents:
            capacity_factor = min(incident.capacity_factor for incident in intersection.incidents)
            if capacity_factor < 1.0:
                intersection.road_condition = RoadCondition.PARTIALLY_BLOCKED
        intersection.usable_capacity_factor = min(capacity_factor, intersection.discharge_efficiency)

    def _base_condition(self, weather_mode: WeatherMode) -> RoadCondition:
        """Return the non-incident road condition for a weather mode."""

        return {
            WeatherMode.CLEAR: RoadCondition.DRY,
            WeatherMode.LIGHT_RAIN: RoadCondition.WET,
            WeatherMode.HEAVY_RAIN: RoadCondition.SLIPPERY,
            WeatherMode.FOG: RoadCondition.LOW_VISIBILITY,
            WeatherMode.NIGHT: RoadCondition.LOW_VISIBILITY,
        }[weather_mode]
