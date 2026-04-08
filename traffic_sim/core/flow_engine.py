"""Vehicle and pedestrian movement logic."""

from __future__ import annotations

import math
from typing import Dict, List

from traffic_sim.core.intersection_layout import get_layout, movement_token
from traffic_sim.core.models import (
    Incident,
    Intersection,
    Lane,
    Pedestrian,
    PedSignalState,
    PedestrianState,
    WeatherMode,
    SignalStage,
    TurnIntent,
    Vehicle,
    VehicleState,
)


class FlowEngine:
    """Owns all entity movement and junction occupancy logic."""

    def __init__(self) -> None:
        self.canvas_width = 800.0
        self.canvas_height = 720.0
        self.center_x = 400.0
        self.center_y = 360.0
        self.road_half = 40.0
        self.intersection_half = 105.0
        self.clearance_half = 128.0
        self.stop_buffer = 2.0
        self.entry_speed_cap = 2.5

    def update(self, intersection: Intersection, dt: float) -> None:
        """Advance vehicles and pedestrians one frame."""

        for lane in intersection.lanes:
            self._update_lane_vehicles(intersection, lane, dt)

        self._update_pedestrians(intersection, dt)
        self._refresh_occupancy(intersection)
        intersection.refresh_counts()

    def _update_lane_vehicles(self, intersection: Intersection, lane: Lane, dt: float) -> None:
        """Advance vehicles for a single lane."""

        ordered = sorted(
            lane.vehicles,
            key=lambda vehicle: self._distance_to_stop_line(intersection.type, lane, vehicle),
        )
        retained: List[Vehicle] = []
        retained_by_lane: Dict[str, Vehicle] = {}
        lane.step_passed_cars = 0

        for vehicle in ordered:
            lane_key = vehicle.assigned_lane_id or movement_token(lane.id, vehicle.lane_group)
            leader = retained_by_lane.get(lane_key)
            stop_line = self._stop_line_value(intersection.type, lane.id)
            before_stop = self._is_before_stop_line(lane.id, vehicle, stop_line)
            movement_id = movement_token(lane.id, vehicle.lane_group)
            active_movement = movement_id in intersection.current_phase
            if vehicle.is_emergency:
                vehicle.detected_by_controller = intersection.emergency_detected and intersection.emergency_approach == lane.id
                vehicle.preemption_active = intersection.emergency_preemption_active and active_movement
            pedestrian_conflict = self._turn_blocked_by_pedestrian(intersection, vehicle)
            incident_blocked = self._movement_blocked_by_incident(intersection, movement_id)
            conflict_clear = not self._conflicting_occupied(intersection, movement_id)
            signal_open = active_movement and not pedestrian_conflict and conflict_clear and not incident_blocked
            startup_ready = self._startup_wave_ready(intersection, vehicle, leader, lane.id, dt, signal_open)
            leader_blocked = self._leader_blocks_progress(vehicle, leader, lane.id)
            allowed_to_enter = signal_open and startup_ready and not leader_blocked
            vehicle.wait_reason = ""

            if vehicle.has_entered_intersection:
                self._continue_committed_vehicle(intersection, vehicle, lane, dt)
            elif allowed_to_enter:
                self._accelerate(intersection, vehicle, dt)
                self._move_vehicle(intersection.type, vehicle, lane, dt)
                if not self._is_before_stop_line(lane.id, vehicle, stop_line):
                    vehicle.has_entered_intersection = True
                    vehicle.committed = True
                    vehicle.state = VehicleState.ENTERING_INTERSECTION
            else:
                if not active_movement:
                    vehicle.wait_reason = "signal"
                elif pedestrian_conflict:
                    vehicle.wait_reason = "pedestrian_yield"
                elif incident_blocked:
                    vehicle.wait_reason = "incident_blockage"
                elif not conflict_clear:
                    vehicle.wait_reason = "conflict_clearance"
                elif not startup_ready and leader is None:
                    vehicle.wait_reason = "reaction_delay"
                else:
                    vehicle.wait_reason = "lead_vehicle"
                self._decelerate(intersection, vehicle, dt)
                if before_stop:
                    self._move_vehicle(intersection.type, vehicle, lane, dt, leader=leader)
                    if not self._is_before_stop_line(lane.id, vehicle, stop_line):
                        self._clamp_to_stop_line(vehicle, lane.id, self._target_stop_line(vehicle, lane.id, stop_line))
                        vehicle.state = VehicleState.QUEUED
                else:
                    self._clamp_to_stop_line(vehicle, lane.id, self._target_stop_line(vehicle, lane.id, stop_line))
                    vehicle.state = VehicleState.QUEUED

            if leader is not None and vehicle.state in {VehicleState.APPROACHING, VehicleState.QUEUED}:
                self._maintain_headway(intersection, vehicle, leader, lane.id)

            self._update_vehicle_state_from_position(intersection.type, vehicle)
            self._update_vehicle_drift(vehicle, dt)

            if self._is_offscreen(vehicle):
                lane.step_passed_cars += 1
                lane.passed_cars += 1
                lane_key = vehicle.assigned_lane_id or f"{lane.id}_{vehicle.lane_group}"
                lane.lane_discharged[lane_key] = lane.lane_discharged.get(lane_key, 0) + 1
                vehicle.state = VehicleState.OFFSCREEN
                continue

            retained.append(vehicle)
            retained_by_lane[lane_key] = vehicle

        lane.vehicles = retained
        lane.lane_wait_times = self._lane_wait_times(lane)
        for index, vehicle in enumerate(
            sorted(
                lane.vehicles,
                key=lambda candidate: self._distance_to_stop_line(intersection.type, lane, candidate),
            )
        ):
            vehicle.index = index
        if lane.is_green:
            lane.waiting_time = 0.0
        else:
            lane.waiting_time += dt * max(1, lane.queue_length)

    def _continue_committed_vehicle(self, intersection: Intersection, vehicle: Vehicle, lane: Lane, dt: float) -> None:
        """Continue a vehicle through and beyond the intersection once committed."""

        self._accelerate(intersection, vehicle, dt)
        self._move_vehicle(intersection.type, vehicle, lane, dt)
        if self._inside_junction(vehicle, intersection.type):
            vehicle.state = VehicleState.INSIDE_INTERSECTION
        else:
            vehicle.state = VehicleState.EXITING

    def _accelerate(self, intersection: Intersection, vehicle: Vehicle, dt: float) -> None:
        """Accelerate toward the desired cruise speed."""

        speed_factor = 1.0 if vehicle.is_emergency else intersection.weather_speed_factor
        vehicle.desired_speed = min(vehicle.max_speed * speed_factor, self._movement_speed_cap(vehicle) * speed_factor)
        accel_factor = 1.0 if vehicle.is_emergency else intersection.discharge_efficiency / max(0.82, intersection.weather_braking_factor)
        vehicle.current_speed = min(
            vehicle.desired_speed,
            vehicle.current_speed + vehicle.acceleration * accel_factor * dt * 60.0,
        )
        vehicle.is_moving = True

    def _decelerate(self, intersection: Intersection, vehicle: Vehicle, dt: float) -> None:
        """Brake smoothly toward a stop."""

        braking_factor = 1.0 if vehicle.is_emergency else intersection.weather_braking_factor
        vehicle.current_speed = max(0.0, vehicle.current_speed - (vehicle.deceleration / braking_factor) * dt * 60.0)
        vehicle.is_moving = vehicle.current_speed > 0.01

    def _move_vehicle(
        self,
        intersection_type: str,
        vehicle: Vehicle,
        lane: Lane,
        dt: float,
        leader: Vehicle | None = None,
    ) -> None:
        """Advance a vehicle along its lane heading."""

        distance = vehicle.current_speed * 60.0 * dt
        if vehicle.has_entered_intersection and vehicle.intent != TurnIntent.STRAIGHT and vehicle.exit_direction:
            self._move_turning_vehicle(intersection_type, vehicle, lane.id, distance)
        elif lane.id == "north":
            vehicle.y += distance
            vehicle.x = self.center_x + vehicle.sub_lane_center + max(-3.0, min(3.0, vehicle.lateral_offset + vehicle.drift_offset))
            vehicle.heading = 180.0
        elif lane.id == "south":
            vehicle.y -= distance
            vehicle.x = self.center_x + vehicle.sub_lane_center + max(-3.0, min(3.0, vehicle.lateral_offset + vehicle.drift_offset))
            vehicle.heading = 0.0
        elif lane.id == "east":
            vehicle.x -= distance
            vehicle.y = self.center_y + vehicle.sub_lane_center + max(-3.0, min(3.0, vehicle.lateral_offset + vehicle.drift_offset))
            vehicle.heading = 270.0
        else:
            vehicle.x += distance
            vehicle.y = self.center_y + vehicle.sub_lane_center + max(-3.0, min(3.0, vehicle.lateral_offset + vehicle.drift_offset))
            vehicle.heading = 90.0

        if leader is not None and not vehicle.has_entered_intersection:
            self._maintain_headway(None, vehicle, leader, lane.id)

    def _move_turning_vehicle(self, intersection_type: str, vehicle: Vehicle, lane_id: str, distance: float) -> None:
        """Advance a turning vehicle along a simple curved path."""

        if not self._ready_to_turn(vehicle, lane_id):
            if lane_id == "north":
                vehicle.y += distance
            elif lane_id == "south":
                vehicle.y -= distance
            elif lane_id == "east":
                vehicle.x -= distance
            else:
                vehicle.x += distance
            return

        vehicle.turn_progress = min(1.0, vehicle.turn_progress + distance / 90.0)
        curve = vehicle.turn_progress
        lateral = math.sin(curve * math.pi / 2.0) * distance * (
            0.9 if vehicle.intent == TurnIntent.TURN_RIGHT else 1.25
        )
        forward = max(
            0.12,
            1.0 - curve * (0.62 if vehicle.intent == TurnIntent.TURN_LEFT else 0.45),
        ) * distance

        if lane_id == "north":
            vehicle.y += forward
            vehicle.x += lateral if vehicle.exit_direction == "east" else -lateral
        elif lane_id == "south":
            vehicle.y -= forward
            vehicle.x += -lateral if vehicle.exit_direction == "west" else lateral
        elif lane_id == "east":
            vehicle.x -= forward
            vehicle.y += lateral if vehicle.exit_direction == "south" else -lateral
        else:
            vehicle.x += forward
            vehicle.y += -lateral if vehicle.exit_direction == "north" else lateral

        vehicle.heading += (vehicle.target_heading - vehicle.heading) * min(1.0, curve * 0.35)
        self._snap_to_exit_lane(intersection_type, vehicle)

    def _maintain_headway(
        self,
        intersection: Intersection | None,
        vehicle: Vehicle,
        leader: Vehicle,
        lane_id: str,
    ) -> None:
        """Prevent queued vehicles from overlapping the car ahead."""

        headway_factor = intersection.weather_headway_factor if intersection is not None else 1.0
        gap = max(vehicle.minimum_gap, vehicle.follow_gap * headway_factor)
        if leader.is_emergency or vehicle.is_emergency:
            gap += 6.0
        if lane_id == "north":
            vehicle.y = min(vehicle.y, leader.y - gap)
        elif lane_id == "south":
            vehicle.y = max(vehicle.y, leader.y + gap)
        elif lane_id == "east":
            vehicle.x = max(vehicle.x, leader.x + gap)
        else:
            vehicle.x = min(vehicle.x, leader.x - gap)

    def _ready_to_turn(self, vehicle: Vehicle, lane_id: str) -> bool:
        """Return whether the vehicle has reached the point where it should start turning."""

        trigger = 24.0
        if lane_id == "north":
            return vehicle.y >= self.center_y - trigger
        if lane_id == "south":
            return vehicle.y <= self.center_y + trigger
        if lane_id == "east":
            return vehicle.x <= self.center_x + trigger
        return vehicle.x >= self.center_x - trigger

    def _snap_to_exit_lane(self, intersection_type: str, vehicle: Vehicle) -> None:
        """Keep a turning vehicle aligned with the correct exit lane once it has turned."""

        if vehicle.turn_progress < 0.75:
            return
        exit_center = self._exit_lane_center(intersection_type, vehicle.exit_direction, vehicle.intent)
        if vehicle.exit_direction in {"north", "south"}:
            vehicle.x += (self.center_x + exit_center - vehicle.x) * 0.18
        else:
            vehicle.y += (self.center_y + exit_center - vehicle.y) * 0.18
        vehicle.heading += (vehicle.target_heading - vehicle.heading) * 0.18

    def _exit_lane_center(self, intersection_type: str, exit_direction: str, intent: TurnIntent) -> float:
        """Return the exit sub-lane center for a turning vehicle."""

        lane_group = "through" if intent == TurnIntent.TURN_LEFT else "right"
        if intersection_type == "3way" and exit_direction == "north":
            lane_group = "through"
        mapping = {
            "north": {"left": -10.0, "through": -20.0, "right": -30.0},
            "south": {"left": 10.0, "through": 20.0, "right": 30.0},
            "east": {"left": -10.0, "through": -20.0, "right": -30.0},
            "west": {"left": 10.0, "through": 20.0, "right": 30.0},
        }
        return mapping[exit_direction][lane_group]

    def _stop_line_value(self, intersection_type: str, lane_id: str) -> float:
        """Return the stop line axis value for one lane."""

        half = get_layout(intersection_type).junction_half
        if lane_id == "north":
            return self.center_y - half - self.stop_buffer
        if lane_id == "south":
            return self.center_y + half + self.stop_buffer
        if lane_id == "east":
            return self.center_x + half + self.stop_buffer
        return self.center_x - half - self.stop_buffer

    def _movement_speed_cap(self, vehicle: Vehicle) -> float:
        """Return a realistic speed cap for the current vehicle movement."""

        if vehicle.intent == TurnIntent.TURN_LEFT:
            return min(self.entry_speed_cap, 1.55 if vehicle.turn_progress < 1.0 else 2.05)
        if vehicle.intent == TurnIntent.TURN_RIGHT:
            return min(self.entry_speed_cap, 1.8 if vehicle.turn_progress < 1.0 else 2.15)
        return self.entry_speed_cap

    def _is_before_stop_line(self, lane_id: str, vehicle: Vehicle, stop_line: float) -> bool:
        """Return whether the vehicle is still before its stop line."""

        if lane_id == "north":
            return vehicle.y < stop_line
        if lane_id == "south":
            return vehicle.y > stop_line
        if lane_id == "east":
            return vehicle.x > stop_line
        return vehicle.x < stop_line

    def _clamp_to_stop_line(self, vehicle: Vehicle, lane_id: str, stop_line: float) -> None:
        """Hard-stop a vehicle at the stop line."""

        if lane_id in {"north", "south"}:
            vehicle.y = stop_line
        else:
            vehicle.x = stop_line
        vehicle.current_speed = 0.0
        vehicle.is_moving = False

    def _distance_to_stop_line(self, intersection_type: str, lane: Lane, vehicle: Vehicle) -> float:
        """Return scalar distance from the vehicle to the stop line."""

        stop_line = self._stop_line_value(intersection_type, lane.id)
        if lane.id in {"north", "south"}:
            return abs(stop_line - vehicle.y)
        return abs(stop_line - vehicle.x)

    def _inside_junction(self, vehicle: Vehicle, intersection_type: str) -> bool:
        """Return whether the vehicle is occupying the conflict zone."""

        half = get_layout(intersection_type).junction_half
        return (
            self.center_x - half <= vehicle.x <= self.center_x + half
            and self.center_y - half <= vehicle.y <= self.center_y + half
        )

    def _refresh_occupancy(self, intersection: Intersection) -> None:
        """Update intersection occupancy counters after movement."""

        committed = 0
        for lane in intersection.lanes:
            for vehicle in lane.vehicles:
                if vehicle.has_entered_intersection and self._occupies_conflict_zone(intersection.type, vehicle):
                    committed += 1
        intersection.committed_vehicle_count = committed
        intersection.junction_occupied = committed > 0

    def _conflicting_occupied(self, intersection: Intersection, movement_id: str) -> bool:
        """Return whether a conflicting path is still inside the junction."""

        if not intersection.junction_occupied:
            return False
        for lane in intersection.lanes:
            for vehicle in lane.vehicles:
                vehicle_movement = movement_token(lane.id, vehicle.lane_group)
                if vehicle_movement == movement_id or vehicle_movement in intersection.current_phase:
                    continue
                if vehicle.has_entered_intersection and self._occupies_conflict_zone(intersection.type, vehicle):
                    return True
        return False

    def _turn_blocked_by_pedestrian(self, intersection: Intersection, vehicle: Vehicle) -> bool:
        """Return whether a turning vehicle must yield to an active crosswalk."""

        if vehicle.intent == TurnIntent.STRAIGHT or not vehicle.exit_direction:
            return False
        if intersection.ped_signal_states.get(vehicle.exit_direction) == PedSignalState.DONT_WALK:
            return False
        for pedestrian in intersection.pedestrians:
            if pedestrian.lane_id != vehicle.exit_direction:
                continue
            if pedestrian.state in {
                PedestrianState.START_CROSSING,
                PedestrianState.CROSSING,
                PedestrianState.FINISHING_CROSS,
            }:
                return True
        return False

    def _occupies_conflict_zone(self, intersection_type: str, vehicle: Vehicle) -> bool:
        """Return whether a committed vehicle still occupies the junction clearance box."""

        base_half = get_layout(intersection_type).junction_half
        clearance_half = max(base_half + 12.0, 54.0 if intersection_type == "2way" else self.clearance_half)
        return (
            self.center_x - clearance_half <= vehicle.x <= self.center_x + clearance_half
            and self.center_y - clearance_half <= vehicle.y <= self.center_y + clearance_half
        )

    def _update_vehicle_state_from_position(self, intersection_type: str, vehicle: Vehicle) -> None:
        """Update state labels after movement."""

        if vehicle.has_entered_intersection:
            if self._inside_junction(vehicle, intersection_type):
                vehicle.state = VehicleState.INSIDE_INTERSECTION
            else:
                vehicle.state = VehicleState.EXITING
            return
        if vehicle.current_speed <= 0.05:
            vehicle.state = VehicleState.QUEUED
        else:
            vehicle.state = VehicleState.APPROACHING

    def _update_vehicle_drift(self, vehicle: Vehicle, dt: float) -> None:
        """Apply subtle lane-centering variation."""

        vehicle.drift_timer += dt
        if vehicle.drift_timer >= 0.5:
            vehicle.drift_timer = 0.0
            vehicle.drift_target = -vehicle.drift_target if abs(vehicle.drift_target) > 0.1 else 0.6
        vehicle.drift_offset += (vehicle.drift_target - vehicle.drift_offset) * min(1.0, dt * 4.0)

    def _startup_wave_ready(
        self,
        intersection: Intersection,
        vehicle: Vehicle,
        leader: Vehicle | None,
        lane_id: str,
        dt: float,
        signal_open: bool,
    ) -> bool:
        """Return whether the vehicle has reacted and is ready to move this frame."""

        if not signal_open:
            vehicle.reaction_timer = min(
                vehicle.reaction_delay * intersection.weather_braking_factor,
                vehicle.reaction_timer + dt * 1.5,
            )
            return False

        if leader is not None:
            gap = self._leader_gap(vehicle, leader, lane_id)
            leader_released = leader.current_speed > 0.2 or leader.has_entered_intersection or leader.state == VehicleState.EXITING
            if not leader_released or gap < vehicle.comfortable_gap * intersection.weather_headway_factor:
                vehicle.reaction_timer = min(
                    vehicle.reaction_delay * intersection.weather_braking_factor,
                    vehicle.reaction_timer + dt * 0.75,
                )
                return False

        vehicle.reaction_timer = max(0.0, vehicle.reaction_timer - dt)
        return vehicle.reaction_timer <= 0.0

    def _leader_blocks_progress(self, vehicle: Vehicle, leader: Vehicle | None, lane_id: str) -> bool:
        """Return whether the leader ahead still blocks this vehicle's movement."""

        if leader is None:
            return False
        gap = self._leader_gap(vehicle, leader, lane_id)
        return gap <= vehicle.minimum_gap

    def _leader_gap(self, vehicle: Vehicle, leader: Vehicle, lane_id: str) -> float:
        """Return the bumper-to-bumper gap to the leader in the same lane."""

        if lane_id == "north":
            return leader.y - vehicle.y - leader.vehicle_length
        if lane_id == "south":
            return vehicle.y - leader.y - leader.vehicle_length
        if lane_id == "east":
            return vehicle.x - leader.x - leader.vehicle_length
        return leader.x - vehicle.x - leader.vehicle_length

    def _target_stop_line(self, vehicle: Vehicle, lane_id: str, stop_line: float) -> float:
        """Return the lane-appropriate queued stop coordinate for a vehicle."""

        if lane_id == "north":
            return stop_line - vehicle.stop_offset
        if lane_id == "south":
            return stop_line + vehicle.stop_offset
        if lane_id == "east":
            return stop_line + vehicle.stop_offset
        return stop_line - vehicle.stop_offset

    def _lane_wait_times(self, lane: Lane) -> Dict[str, float]:
        """Return average queued wait time per physical lane."""

        totals: Dict[str, float] = {}
        counts: Dict[str, int] = {}
        for vehicle in lane.vehicles:
            if vehicle.state not in {VehicleState.APPROACHING, VehicleState.QUEUED}:
                continue
            lane_id = vehicle.assigned_lane_id or f"{lane.id}_{vehicle.lane_group}"
            totals[lane_id] = totals.get(lane_id, 0.0) + lane.waiting_time
            counts[lane_id] = counts.get(lane_id, 0) + 1
        return {lane_id: totals[lane_id] / counts[lane_id] for lane_id in counts}

    def _movement_blocked_by_incident(self, intersection: Intersection, movement_id: str) -> bool:
        """Return whether an active incident blocks this movement."""

        for incident in intersection.incidents:
            if incident.blocked_movement == movement_id and incident.capacity_factor <= 0.05:
                return True
        return False

    def _update_pedestrians(self, intersection: Intersection, dt: float) -> None:
        """Move pedestrians only when their lane traffic is stopped."""

        lane_map: Dict[str, Lane] = {lane.id: lane for lane in intersection.lanes}
        remaining: List[Pedestrian] = []
        for pedestrian in intersection.pedestrians:
            lane = lane_map.get(pedestrian.lane_id)
            if lane is None:
                continue
            signal = intersection.ped_signal_states.get(lane.id, PedSignalState.DONT_WALK)
            self._advance_pedestrian(intersection, pedestrian, signal, dt)
            if pedestrian.state == PedestrianState.DESPAWN:
                intersection.completed_crossings += 1
                continue
            remaining.append(pedestrian)

        intersection.pedestrians = remaining
        active_waits = [ped.waiting_timer for ped in intersection.pedestrians if ped.state == PedestrianState.WAITING_AT_CURB]
        if active_waits:
            intersection.pedestrian_wait_history.append(sum(active_waits) / len(active_waits))

    def _advance_pedestrian(
        self,
        intersection: Intersection,
        pedestrian: Pedestrian,
        signal: PedSignalState,
        dt: float,
    ) -> None:
        """Advance one pedestrian through sidewalk, curb, crossing, and exit states."""

        if pedestrian.state == PedestrianState.SPAWNING:
            pedestrian.state = PedestrianState.WALKING_TO_CURB

        if pedestrian.state == PedestrianState.WALKING_TO_CURB:
            reached = self._move_pedestrian_toward(intersection, pedestrian, pedestrian.wait_x, pedestrian.wait_y, dt)
            if reached:
                pedestrian.state = PedestrianState.WAITING_AT_CURB
                pedestrian.x = pedestrian.wait_x
                pedestrian.y = pedestrian.wait_y
            return

        if pedestrian.state == PedestrianState.WAITING_AT_CURB:
            pedestrian.waiting_timer += dt
            start_delay = pedestrian.start_delay * (
                1.18 if intersection.weather_mode in {WeatherMode.HEAVY_RAIN, WeatherMode.FOG} else 1.0
            )
            pedestrian.start_timer = min(start_delay, pedestrian.start_timer + dt)
            pedestrian.x = pedestrian.wait_x
            pedestrian.y = pedestrian.wait_y
            pedestrian.heading = self._pedestrian_heading(pedestrian.x, pedestrian.y, pedestrian.cross_start_x, pedestrian.cross_start_y)
            if signal == PedSignalState.WALK and pedestrian.start_timer >= start_delay:
                pedestrian.state = PedestrianState.START_CROSSING
                pedestrian.progress = 0.0
            return

        if pedestrian.state == PedestrianState.START_CROSSING:
            if signal == PedSignalState.DONT_WALK:
                pedestrian.state = PedestrianState.WAITING_AT_CURB
                pedestrian.start_timer = 0.0
                return
            pedestrian.state = PedestrianState.CROSSING

        if pedestrian.state == PedestrianState.CROSSING:
            speed_factor = intersection.weather_ped_speed_factor * (
                1.05 if intersection.weather_mode in {WeatherMode.LIGHT_RAIN, WeatherMode.HEAVY_RAIN} else 1.0
            )
            pedestrian.progress += pedestrian.walking_speed * speed_factor * dt
            progress = min(1.0, pedestrian.progress)
            self._set_pedestrian_cross_position(pedestrian, progress)
            if pedestrian.progress >= 1.0:
                pedestrian.state = PedestrianState.FINISHING_CROSS
            return

        if pedestrian.state == PedestrianState.FINISHING_CROSS:
            reached = self._move_pedestrian_toward(intersection, pedestrian, pedestrian.walk_away_x, pedestrian.walk_away_y, dt)
            if reached:
                pedestrian.state = PedestrianState.WALKING_AWAY
            return

        if pedestrian.state == PedestrianState.WALKING_AWAY:
            reached = self._move_pedestrian_toward(
                intersection,
                pedestrian,
                pedestrian.walk_away_x + (pedestrian.walk_away_x - pedestrian.cross_end_x) * 0.35,
                pedestrian.walk_away_y + (pedestrian.walk_away_y - pedestrian.cross_end_y) * 0.35,
                dt,
            )
            if reached:
                pedestrian.state = PedestrianState.DESPAWN

    def _set_pedestrian_cross_position(self, pedestrian: Pedestrian, progress: float) -> None:
        """Set a pedestrian along the marked zebra crossing."""

        pedestrian.x = pedestrian.cross_start_x + (pedestrian.cross_end_x - pedestrian.cross_start_x) * progress
        pedestrian.y = pedestrian.cross_start_y + (pedestrian.cross_end_y - pedestrian.cross_start_y) * progress
        pedestrian.heading = self._pedestrian_heading(
            pedestrian.cross_start_x,
            pedestrian.cross_start_y,
            pedestrian.cross_end_x,
            pedestrian.cross_end_y,
        )

    def _move_pedestrian_toward(
        self,
        intersection: Intersection,
        pedestrian: Pedestrian,
        target_x: float,
        target_y: float,
        dt: float,
    ) -> bool:
        """Move a pedestrian toward a target point with human-scale speed."""

        dx = target_x - pedestrian.x
        dy = target_y - pedestrian.y
        distance = math.hypot(dx, dy)
        if distance <= 0.5:
            pedestrian.x = target_x
            pedestrian.y = target_y
            return True
        step = min(distance, pedestrian.walking_speed * intersection.weather_ped_speed_factor * 60.0 * dt)
        pedestrian.x += dx / distance * step
        pedestrian.y += dy / distance * step
        pedestrian.heading = self._pedestrian_heading(pedestrian.x, pedestrian.y, target_x, target_y)
        return distance <= step + 0.25

    def _pedestrian_heading(self, x0: float, y0: float, x1: float, y1: float) -> float:
        """Return a top-down heading angle for one pedestrian movement."""

        return math.degrees(math.atan2(y1 - y0, x1 - x0))

    def _is_offscreen(self, vehicle: Vehicle) -> bool:
        """Return whether a vehicle has fully left the visible roads."""

        return (
            vehicle.x < -80.0
            or vehicle.x > self.canvas_width + 80.0
            or vehicle.y < -80.0
            or vehicle.y > self.canvas_height + 80.0
        )
