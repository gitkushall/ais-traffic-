"""Traffic and pedestrian generation for each simulation tick."""

from __future__ import annotations

import random
from typing import Dict, Optional, Sequence

from traffic_sim.core.intersection_layout import get_layout, lane_definition
from traffic_sim.core.models import (
    EmergencyVehicleType,
    Intersection,
    Lane,
    Pedestrian,
    PedestrianState,
    TurnIntent,
    Vehicle,
    VehicleState,
    WeatherMode,
)

CANVAS_CENTER_X = 400.0
CANVAS_CENTER_Y = 360.0
ROAD_HALF = 40.0
PAVEMENT_WIDTH = 30.0
INTERSECTION_HALF = 105.0
SIM_TICK_SECONDS = 1.0 / 60.0
INITIAL_LANE_VEHICLES = 8
BASE_SPAWN_INTERVAL = 1.5
CRUISE_SPEED_PX_PER_FRAME = 2.5

REALISTIC_VEHICLE_COLORS = [
    (245, 245, 245),
    (192, 192, 192),
    (26, 26, 26),
    (85, 85, 85),
    (192, 57, 43),
    (36, 113, 163),
    (27, 79, 114),
    (30, 132, 73),
    (110, 47, 26),
]

PEDESTRIAN_SKIN_TONES = [
    (253, 188, 180),
    (198, 134, 66),
    (141, 85, 36),
    (241, 194, 125),
]

PEDESTRIAN_CLOTHES = [
    (220, 53, 69),
    (52, 152, 219),
    (46, 204, 113),
    (241, 196, 15),
    (142, 68, 173),
]


class TrafficGenerator:
    """Spawns cars, pedestrians, and non-repetitive demand patterns."""

    def __init__(self, rng: Optional[random.Random] = None) -> None:
        self.rng = rng or random.Random()
        self.vehicle_counter = 0
        self.pedestrian_counter = 0
        self.current_bias = "north"
        self.bias_hold_seconds = self.rng.uniform(20.0, 40.0)
        self.bias_elapsed = 0.0
        self.global_demand_level = 1.0
        self.global_hold_seconds = self.rng.uniform(30.0, 55.0)
        self.global_elapsed = 0.0
        self.pedestrian_bias = "north"
        self.pedestrian_hold_seconds = self.rng.uniform(15.0, 35.0)
        self.pedestrian_elapsed = 0.0
        self.turn_profile_elapsed = 0.0
        self.turn_profile_hold_seconds = self.rng.uniform(18.0, 32.0)
        self.turn_bias: Dict[str, tuple[float, float, float]] = {
            "north": (0.64, 0.18, 0.18),
            "south": (0.64, 0.18, 0.18),
            "east": (0.64, 0.18, 0.18),
            "west": (0.64, 0.18, 0.18),
        }
        self.lane_pressure: Dict[str, float] = {
            "north": 1.0,
            "south": 1.0,
            "east": 1.0,
            "west": 1.0,
        }

    def prime_intersection(
        self,
        intersection: Intersection,
        rng: Optional[random.Random] = None,
    ) -> None:
        """Populate a new intersection so it starts busy."""

        randomizer = rng or self.rng
        for lane in intersection.lanes:
            while len(lane.vehicles) < INITIAL_LANE_VEHICLES:
                vehicle = self._build_vehicle(intersection.type, lane, intersection.tick, randomizer)
                vehicle.x, vehicle.y = self._queue_position(lane.id, vehicle.lane_group, len(lane.vehicles), randomizer)
                vehicle.current_speed = 0.0
                vehicle.state = VehicleState.QUEUED
                vehicle.index = len(lane.vehicles)
                lane.vehicles.append(vehicle)

        for lane in intersection.lanes:
            for _ in range(randomizer.randint(1, 3)):
                self._spawn_pedestrian_group(intersection, lane, randomizer)
        intersection.refresh_counts()

    def spawn_traffic(
        self,
        intersection: Intersection,
        tick: int,
        rng: Optional[random.Random] = None,
        spawnable_approaches: Sequence[str] | None = None,
    ) -> None:
        """Spawn traffic for each lane with varying demand."""

        randomizer = rng or self.rng
        self._advance_demand_profiles(intersection)
        self._update_emergency_state(intersection)

        for lane in intersection.lanes:
            if spawnable_approaches is None or lane.id in spawnable_approaches:
                interval = self._vehicle_spawn_interval(intersection, lane.id, tick)
                lane.spawn_timer += SIM_TICK_SECONDS
                while lane.spawn_timer >= interval:
                    lane.spawn_timer -= interval
                    lane.vehicles.append(self._build_vehicle(intersection.type, lane, tick, randomizer))

            if self._should_spawn_pedestrian(intersection, lane.id, randomizer):
                waiting_counts = [
                    pedestrian
                    for pedestrian in intersection.pedestrians
                    if pedestrian.lane_id == lane.id
                    and pedestrian.state
                    in {
                        PedestrianState.SPAWNING,
                        PedestrianState.WALKING_TO_CURB,
                        PedestrianState.WAITING_AT_CURB,
                    }
                ]
                if len(waiting_counts) < 10:
                    self._spawn_pedestrian_group(intersection, lane, randomizer)

        has_active_emergency = any(lane.has_emergency for lane in intersection.lanes)
        if intersection.lanes and not has_active_emergency and randomizer.random() < 0.0004:
            emergency_lane = randomizer.choice(intersection.lanes)
            emergency_lane.has_emergency = True
            emergency_lane.emergency_timer = 30
            emergency_lane.vehicles.append(
                self._build_vehicle(intersection.type, emergency_lane, tick, randomizer, is_emergency=True)
            )

        intersection.refresh_counts()

    def _advance_demand_profiles(self, intersection: Intersection) -> None:
        """Shift directional and pedestrian demand over time."""

        active = list(get_layout(intersection.type).active_approaches)
        self.bias_elapsed += SIM_TICK_SECONDS
        self.global_elapsed += SIM_TICK_SECONDS
        self.pedestrian_elapsed += SIM_TICK_SECONDS
        self.turn_profile_elapsed += SIM_TICK_SECONDS

        if self.global_elapsed >= self.global_hold_seconds:
            self.global_elapsed = 0.0
            self.global_hold_seconds = self.rng.uniform(30.0, 55.0)
            self.global_demand_level = self.rng.uniform(0.8, 1.35)

        if self.bias_elapsed >= self.bias_hold_seconds:
            self.bias_elapsed = 0.0
            self.bias_hold_seconds = self.rng.uniform(20.0, 40.0)
            self.current_bias = self.rng.choice(active)
            for lane_id in self.lane_pressure:
                base = self.global_demand_level * self.rng.uniform(0.8, 1.15)
                if lane_id == self.current_bias:
                    base *= self.rng.uniform(1.3, 1.7)
                self.lane_pressure[lane_id] = base

        if self.pedestrian_elapsed >= self.pedestrian_hold_seconds:
            self.pedestrian_elapsed = 0.0
            self.pedestrian_hold_seconds = self.rng.uniform(15.0, 35.0)
            self.pedestrian_bias = self.rng.choice(active)

        if self.turn_profile_elapsed >= self.turn_profile_hold_seconds:
            self.turn_profile_elapsed = 0.0
            self.turn_profile_hold_seconds = self.rng.uniform(18.0, 32.0)
            for lane_id in active:
                straight = self.rng.uniform(0.54, 0.76)
                left = self.rng.uniform(0.08, 0.24)
                right = max(0.05, 1.0 - straight - left)
                total = straight + left + right
                self.turn_bias[lane_id] = (straight / total, left / total, right / total)

    def _vehicle_spawn_interval(self, intersection: Intersection, lane_id: str, tick: int) -> float:
        """Return a varying spawn interval for a lane."""

        hour = (tick // 3600) % 24
        rush = 0.85 if 7 <= hour <= 9 or 16 <= hour <= 19 else 1.0
        quiet = 1.35 if 0 <= hour <= 5 else 1.0
        directional = 1.0 / max(0.65, self.lane_pressure.get(lane_id, 1.0))
        burst = 0.75 if self.rng.random() < 0.002 else 1.0
        weather_factor = {
            WeatherMode.CLEAR: 1.0,
            WeatherMode.LIGHT_RAIN: 1.04,
            WeatherMode.HEAVY_RAIN: 1.12,
            WeatherMode.FOG: 1.08,
            WeatherMode.NIGHT: 0.96,
        }[intersection.weather_mode]
        return max(0.55, BASE_SPAWN_INTERVAL * rush * quiet * directional * burst * weather_factor)

    def _should_spawn_pedestrian(self, intersection: Intersection, lane_id: str, rng: random.Random) -> bool:
        """Return whether to add a new pedestrian to this crossing."""

        base = 0.007
        if lane_id == self.pedestrian_bias:
            base += 0.01
        if intersection.weather_mode == WeatherMode.LIGHT_RAIN:
            base *= 0.92
        elif intersection.weather_mode == WeatherMode.HEAVY_RAIN:
            base *= 0.7
        elif intersection.weather_mode == WeatherMode.FOG:
            base *= 0.82
        elif intersection.weather_mode == WeatherMode.NIGHT:
            base *= 0.78
        if rng.random() < 0.002:
            base += 0.018
        return rng.random() < base

    def _build_vehicle(
        self,
        intersection_type: str,
        lane: Lane,
        tick: int,
        rng: random.Random,
        is_emergency: bool = False,
    ) -> Vehicle:
        """Construct one vehicle approaching from off-screen."""

        self.vehicle_counter += 1
        intent = self._choose_intent(intersection_type, lane.id, rng, is_emergency)
        lane_group = self._lane_group_for_intent(intent)
        lane_meta = lane_definition(intersection_type, lane.id, lane_group)
        x, y, heading, sub_lane_center = self._spawn_position(lane.id, lane_meta.sub_lane_center, rng)
        exit_direction, target_heading = self._movement_target(intersection_type, lane.id, intent)
        profile_name, accel, decel, reaction_delay, min_gap, comfortable_gap = self._driver_profile(rng, is_emergency)
        return Vehicle(
            id=f"{lane.id}-{tick}-{self.vehicle_counter}",
            lane_id=lane.id,
            color=(255, 255, 255) if is_emergency else rng.choice(REALISTIC_VEHICLE_COLORS),
            intent=intent,
            x=x,
            y=y,
            heading=heading,
            current_speed=CRUISE_SPEED_PX_PER_FRAME * 0.6,
            desired_speed=CRUISE_SPEED_PX_PER_FRAME,
            max_speed=rng.uniform(2.1, 2.8) if not is_emergency else 3.0,
            acceleration=accel,
            deceleration=decel,
            follow_gap=comfortable_gap,
            state=VehicleState.APPROACHING,
            is_moving=False,
            is_emergency=is_emergency,
            lateral_offset=rng.uniform(-2.5, 2.5),
            drift_target=rng.uniform(-1.0, 1.0),
            sub_lane_center=sub_lane_center,
            lane_group=lane_group,
            assigned_lane_id=lane_meta.lane_id,
            target_heading=target_heading,
            exit_direction=exit_direction,
            reaction_delay=reaction_delay,
            reaction_timer=reaction_delay,
            minimum_gap=min_gap,
            comfortable_gap=comfortable_gap,
            stop_offset=rng.uniform(2.0, 8.0),
            vehicle_length=rng.uniform(24.0, 29.0),
            driver_profile=profile_name,
            emergency_type=self._emergency_type(rng) if is_emergency else None,
            priority_level=self._emergency_priority() if is_emergency else 0.0,
            signal_request_state="requested" if is_emergency else "",
        )

    def _spawn_position(self, lane_id: str, sub_lane_center: float, rng: random.Random) -> tuple[float, float, float, float]:
        """Return an off-screen spawn position for a given approach."""

        if lane_id == "north":
            x = CANVAS_CENTER_X + sub_lane_center + rng.uniform(-2.0, 2.0)
            return x, -60.0, 180.0, sub_lane_center
        if lane_id == "south":
            x = CANVAS_CENTER_X + sub_lane_center + rng.uniform(-2.0, 2.0)
            return x, 780.0, 0.0, sub_lane_center
        if lane_id == "east":
            y = CANVAS_CENTER_Y + sub_lane_center + rng.uniform(-2.0, 2.0)
            return 860.0, y, 270.0, sub_lane_center
        y = CANVAS_CENTER_Y + sub_lane_center + rng.uniform(-2.0, 2.0)
        return -60.0, y, 90.0, sub_lane_center

    def _queue_position(self, lane_id: str, lane_group: str, queue_index: int, rng: random.Random) -> tuple[float, float]:
        """Return an on-camera queued position behind the stop line."""

        spacing = 30.0
        sub_lane_center = self._sub_lane_center(lane_id, lane_group)
        if lane_id == "north":
            return CANVAS_CENTER_X + sub_lane_center + rng.uniform(-2.0, 2.0), (
                CANVAS_CENTER_Y - INTERSECTION_HALF - 18.0 - queue_index * spacing
            )
        if lane_id == "south":
            return CANVAS_CENTER_X + sub_lane_center + rng.uniform(-2.0, 2.0), (
                CANVAS_CENTER_Y + INTERSECTION_HALF + 18.0 + queue_index * spacing
            )
        if lane_id == "east":
            return (
                CANVAS_CENTER_X + INTERSECTION_HALF + 18.0 + queue_index * spacing,
                CANVAS_CENTER_Y + sub_lane_center + rng.uniform(-2.0, 2.0),
            )
        return (
            CANVAS_CENTER_X - INTERSECTION_HALF - 18.0 - queue_index * spacing,
            CANVAS_CENTER_Y + sub_lane_center + rng.uniform(-2.0, 2.0),
        )

    def _choose_intent(
        self,
        intersection_type: str,
        lane_id: str,
        rng: random.Random,
        is_emergency: bool,
    ) -> TurnIntent:
        """Choose a legal intent for one approach."""

        if is_emergency or intersection_type == "2way":
            return TurnIntent.STRAIGHT
        if intersection_type == "3way":
            if lane_id == "north":
                left_bias = self.turn_bias.get(lane_id, (0.5, 0.5, 0.0))[1]
                right_bias = self.turn_bias.get(lane_id, (0.5, 0.5, 0.0))[2] or 0.5
                return rng.choices(
                    [TurnIntent.TURN_LEFT, TurnIntent.TURN_RIGHT],
                    weights=[left_bias, right_bias],
                    k=1,
                )[0]
            if lane_id == "east":
                straight, _, right = self.turn_bias.get(lane_id, (0.7, 0.0, 0.3))
                return rng.choices([TurnIntent.STRAIGHT, TurnIntent.TURN_RIGHT], weights=[straight, right], k=1)[0]
            straight, left, _ = self.turn_bias.get(lane_id, (0.7, 0.3, 0.0))
            return rng.choices([TurnIntent.STRAIGHT, TurnIntent.TURN_LEFT], weights=[straight, left], k=1)[0]
        straight, left, right = self.turn_bias.get(lane_id, (0.62, 0.2, 0.18))
        return rng.choices(
            [TurnIntent.STRAIGHT, TurnIntent.TURN_LEFT, TurnIntent.TURN_RIGHT],
            weights=[straight, left, right],
            k=1,
        )[0]

    def _lane_group_for_intent(self, intent: TurnIntent) -> str:
        """Map a turn intent to its physical lane group."""

        if intent == TurnIntent.TURN_LEFT:
            return "left"
        if intent == TurnIntent.TURN_RIGHT:
            return "right"
        return "through"

    def _sub_lane_center(self, lane_id: str, lane_group: str) -> float:
        """Return the sub-lane center offset for one approach and lane group."""

        mapping = {
            "north": {"left": 10.0, "through": 20.0, "right": 30.0},
            "south": {"left": -10.0, "through": -20.0, "right": -30.0},
            "east": {"left": 10.0, "through": 20.0, "right": 30.0},
            "west": {"left": -10.0, "through": -20.0, "right": -30.0},
        }
        return mapping[lane_id][lane_group]

    def _driver_profile(self, rng: random.Random, is_emergency: bool) -> tuple[str, float, float, float, float, float]:
        """Return a subtle driver-style profile for one vehicle."""

        if is_emergency:
            return ("emergency", 1.8, 2.8, 0.0, 20.0, 26.0)
        profiles = [
            ("calm", 1.05, 1.9, 0.45, 28.0, 38.0),
            ("balanced", 1.25, 2.1, 0.28, 25.0, 34.0),
            ("alert", 1.45, 2.3, 0.16, 22.0, 30.0),
        ]
        return rng.choices(profiles, weights=[0.28, 0.5, 0.22], k=1)[0]

    def _emergency_type(self, rng: random.Random) -> EmergencyVehicleType:
        """Return a rare emergency vehicle class."""

        return rng.choices(
            [
                EmergencyVehicleType.AMBULANCE,
                EmergencyVehicleType.POLICE,
                EmergencyVehicleType.FIRE_TRUCK,
            ],
            weights=[0.45, 0.35, 0.20],
            k=1,
        )[0]

    def _emergency_priority(self) -> float:
        """Return the base emergency priority level."""

        return 1.0

    def _movement_target(
        self,
        intersection_type: str,
        lane_id: str,
        intent: TurnIntent,
    ) -> tuple[str, float]:
        """Return exit direction and target heading for a movement."""

        if intersection_type == "2way" or intent == TurnIntent.STRAIGHT:
            straight = {"north": ("south", 180.0), "south": ("north", 0.0), "east": ("west", 270.0), "west": ("east", 90.0)}
            return straight[lane_id]
        if intersection_type == "3way":
            mapping = {
                ("north", TurnIntent.TURN_LEFT): ("east", 90.0),
                ("north", TurnIntent.TURN_RIGHT): ("west", 270.0),
                ("east", TurnIntent.TURN_RIGHT): ("north", 0.0),
                ("west", TurnIntent.TURN_LEFT): ("north", 0.0),
            }
            return mapping.get((lane_id, intent), ("west" if lane_id == "east" else "east", 270.0 if lane_id == "east" else 90.0))
        mapping = {
            ("north", TurnIntent.TURN_LEFT): ("east", 90.0),
            ("north", TurnIntent.TURN_RIGHT): ("west", 270.0),
            ("south", TurnIntent.TURN_LEFT): ("west", 270.0),
            ("south", TurnIntent.TURN_RIGHT): ("east", 90.0),
            ("east", TurnIntent.TURN_LEFT): ("south", 180.0),
            ("east", TurnIntent.TURN_RIGHT): ("north", 0.0),
            ("west", TurnIntent.TURN_LEFT): ("north", 0.0),
            ("west", TurnIntent.TURN_RIGHT): ("south", 180.0),
        }
        return mapping[(lane_id, intent)]

    def _spawn_pedestrian_group(self, intersection: Intersection, lane: Lane, rng: random.Random) -> None:
        """Spawn one pedestrian or a loose small group on a sidewalk."""

        group_size = rng.choices([1, 2, 3, 4], weights=[0.5, 0.26, 0.16, 0.08], k=1)[0]
        side = rng.randint(0, 1)
        group_id = f"{lane.id}-grp-{self.pedestrian_counter + 1}"
        for member_index in range(group_size):
            pedestrian = self._build_pedestrian(lane, side, rng, group_id, group_size, member_index)
            intersection.pedestrians.append(pedestrian)

    def _build_pedestrian(
        self,
        lane: Lane,
        side: int,
        rng: random.Random,
        group_id: str = "",
        group_size: int = 1,
        member_index: int = 0,
    ) -> Pedestrian:
        """Construct one pedestrian waiting in a sidewalk zone."""

        self.pedestrian_counter += 1
        (
            spawn_x,
            spawn_y,
            wait_x,
            wait_y,
            start_x,
            start_y,
            end_x,
            end_y,
            walk_away_x,
            walk_away_y,
            source,
            destination,
        ) = self._pedestrian_geometry(
            lane.id,
            side,
            rng,
            member_index,
            group_size,
        )
        return Pedestrian(
            id=f"ped-{lane.id}-{self.pedestrian_counter}",
            lane_id=lane.id,
            source_sidewalk=source,
            destination_sidewalk=destination,
            crossing_id=f"{lane.id}-cross",
            x=spawn_x,
            y=spawn_y,
            color=rng.choice(PEDESTRIAN_SKIN_TONES),
            clothing_color=rng.choice(PEDESTRIAN_CLOTHES),
            walking_speed=rng.uniform(0.42, 0.72),
            waiting_timer=0.0,
            state=PedestrianState.SPAWNING,
            side=side,
            heading=0.0,
            start_delay=rng.uniform(0.0, 0.6) + member_index * rng.uniform(0.08, 0.2),
            start_timer=0.0,
            spawn_x=spawn_x,
            spawn_y=spawn_y,
            wait_x=wait_x,
            wait_y=wait_y,
            cross_start_x=start_x,
            cross_start_y=start_y,
            cross_end_x=end_x,
            cross_end_y=end_y,
            walk_away_x=walk_away_x,
            walk_away_y=walk_away_y,
            group_id=group_id or f"{lane.id}-grp-{self.pedestrian_counter}",
            group_size=group_size,
            drift_offset=rng.uniform(-1.0, 1.0),
            sway_phase=rng.uniform(0.0, 6.28),
        )

    def _pedestrian_geometry(
        self,
        lane_id: str,
        side: int,
        rng: random.Random,
        member_index: int,
        group_size: int,
    ) -> tuple[float, float, float, float, float, float, float, float, float, float, str, str]:
        """Return precise sidewalk and crosswalk coordinates."""

        cluster_x = (member_index - (group_size - 1) / 2.0) * rng.uniform(5.0, 8.0)
        cluster_y = rng.uniform(-4.0, 4.0)
        if lane_id == "north":
            wait_x = rng.uniform(CANVAS_CENTER_X - ROAD_HALF - PAVEMENT_WIDTH + 6.0, CANVAS_CENTER_X - ROAD_HALF - 5.0) + cluster_x
            wait_y = CANVAS_CENTER_Y - INTERSECTION_HALF - 10.0 + cluster_y
            spawn_x = wait_x - rng.uniform(12.0, 26.0)
            spawn_y = wait_y + rng.uniform(-10.0, 10.0)
            return (
                spawn_x,
                spawn_y,
                wait_x,
                wait_y,
                CANVAS_CENTER_X - ROAD_HALF,
                wait_y,
                CANVAS_CENTER_X + ROAD_HALF + 12.0,
                wait_y,
                CANVAS_CENTER_X + ROAD_HALF + 22.0,
                wait_y + rng.uniform(-6.0, 6.0),
                "west_sidewalk",
                "east_sidewalk",
            )
        if lane_id == "south":
            wait_x = rng.uniform(CANVAS_CENTER_X + ROAD_HALF + 5.0, CANVAS_CENTER_X + ROAD_HALF + PAVEMENT_WIDTH - 6.0) + cluster_x
            wait_y = CANVAS_CENTER_Y + INTERSECTION_HALF + 10.0 + cluster_y
            spawn_x = wait_x + rng.uniform(12.0, 26.0)
            spawn_y = wait_y + rng.uniform(-10.0, 10.0)
            return (
                spawn_x,
                spawn_y,
                wait_x,
                wait_y,
                CANVAS_CENTER_X + ROAD_HALF,
                wait_y,
                CANVAS_CENTER_X - ROAD_HALF - 12.0,
                wait_y,
                CANVAS_CENTER_X - ROAD_HALF - 22.0,
                wait_y + rng.uniform(-6.0, 6.0),
                "east_sidewalk",
                "west_sidewalk",
            )
        if lane_id == "east":
            wait_y = rng.uniform(CANVAS_CENTER_Y - ROAD_HALF - PAVEMENT_WIDTH + 6.0, CANVAS_CENTER_Y - ROAD_HALF - 5.0) + cluster_y
            wait_x = CANVAS_CENTER_X + INTERSECTION_HALF + 10.0 + cluster_x
            spawn_x = wait_x + rng.uniform(-10.0, 10.0)
            spawn_y = wait_y - rng.uniform(12.0, 26.0)
            return (
                spawn_x,
                spawn_y,
                wait_x,
                wait_y,
                wait_x,
                CANVAS_CENTER_Y - ROAD_HALF,
                wait_x,
                CANVAS_CENTER_Y + ROAD_HALF + 12.0,
                wait_x + rng.uniform(-6.0, 6.0),
                CANVAS_CENTER_Y + ROAD_HALF + 22.0,
                "north_sidewalk",
                "south_sidewalk",
            )

        wait_y = rng.uniform(CANVAS_CENTER_Y + ROAD_HALF + 5.0, CANVAS_CENTER_Y + ROAD_HALF + PAVEMENT_WIDTH - 6.0) + cluster_y
        wait_x = CANVAS_CENTER_X - INTERSECTION_HALF - 10.0 + cluster_x
        spawn_x = wait_x + rng.uniform(-10.0, 10.0)
        spawn_y = wait_y + rng.uniform(12.0, 26.0)
        return (
            spawn_x,
            spawn_y,
            wait_x,
            wait_y,
            wait_x,
            CANVAS_CENTER_Y + ROAD_HALF,
            wait_x,
            CANVAS_CENTER_Y - ROAD_HALF - 12.0,
            wait_x + rng.uniform(-6.0, 6.0),
            CANVAS_CENTER_Y - ROAD_HALF - 22.0,
            "south_sidewalk",
            "north_sidewalk",
        )

    def _update_emergency_state(self, intersection: Intersection) -> None:
        """Tick down emergency timers and clear flags once handled."""

        for lane in intersection.lanes:
            active_emergency_present = any(
                vehicle.is_emergency and vehicle.state != VehicleState.OFFSCREEN
                for vehicle in lane.vehicles
            )
            if lane.emergency_timer > 0 and active_emergency_present:
                lane.emergency_timer -= 1
            elif lane.has_emergency and not active_emergency_present:
                lane.has_emergency = False
                lane.emergency_timer = 0
