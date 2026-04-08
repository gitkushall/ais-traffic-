"""Core data models for the traffic simulation."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Deque, Dict, List, Tuple


class TurnIntent(str, Enum):
    """Driving intent for a vehicle approaching the intersection."""

    STRAIGHT = "straight"
    TURN_LEFT = "left"
    TURN_RIGHT = "right"


class VehicleState(str, Enum):
    """High-level vehicle lifecycle state."""

    APPROACHING = "approaching"
    QUEUED = "queued"
    ENTERING_INTERSECTION = "entering_intersection"
    INSIDE_INTERSECTION = "inside_intersection"
    EXITING = "exiting"
    OFFSCREEN = "offscreen"


class PedestrianState(str, Enum):
    """High-level pedestrian lifecycle state."""

    SPAWNING = "spawning"
    WALKING_TO_CURB = "walking_to_curb"
    WAITING_AT_CURB = "waiting_at_curb"
    START_CROSSING = "start_crossing"
    CROSSING = "crossing"
    FINISHING_CROSS = "finishing_cross"
    WALKING_AWAY = "walking_away"
    DESPAWN = "despawn"


class SignalStage(str, Enum):
    """Controller stage for legal signal transitions."""

    GREEN = "green"
    AMBER = "amber"
    ALL_RED = "all_red"


class EmergencyVehicleType(str, Enum):
    """Distinct emergency vehicle classes."""

    AMBULANCE = "ambulance"
    POLICE = "police"
    FIRE_TRUCK = "fire_truck"


class ControllerMode(str, Enum):
    """High-level controller operating mode."""

    NORMAL_ADAPTIVE = "normal_adaptive"
    EMERGENCY_REQUESTED = "emergency_requested"
    PREEMPT_TRANSITION = "preempt_transition"
    EMERGENCY_SERVING = "emergency_serving"
    RECOVERY = "recovery"


class WeatherMode(str, Enum):
    """Global weather modes that affect behavior and visuals."""

    CLEAR = "clear"
    LIGHT_RAIN = "light_rain"
    HEAVY_RAIN = "heavy_rain"
    FOG = "fog"
    NIGHT = "night"


class RoadCondition(str, Enum):
    """Derived road-condition states."""

    DRY = "dry"
    WET = "wet"
    LOW_VISIBILITY = "low_visibility"
    SLIPPERY = "slippery"
    PARTIALLY_BLOCKED = "partially_blocked"


class IncidentType(str, Enum):
    """Traffic disruption types."""

    STALLED_VEHICLE = "stalled_vehicle"
    MINOR_ACCIDENT = "minor_accident"
    BLOCKED_LANE = "blocked_lane"
    ROAD_WORK = "road_work"
    SEGMENT_BLOCKAGE = "segment_blockage"


class PedSignalState(str, Enum):
    """Pedestrian walk signal state for one crossing."""

    WALK = "walk"
    FLASHING_DONT_WALK = "flashing_dont_walk"
    DONT_WALK = "dont_walk"


@dataclass
class Vehicle:
    """A single vehicle tracked as a moving actor."""

    id: str
    lane_id: str
    color: tuple[int, int, int]
    intent: TurnIntent
    x: float
    y: float
    heading: float
    current_speed: float
    desired_speed: float
    max_speed: float
    acceleration: float
    deceleration: float
    follow_gap: float
    state: VehicleState = VehicleState.APPROACHING
    progress: float = 0.0
    is_moving: bool = False
    index: int = 0
    is_emergency: bool = False
    lateral_offset: float = 0.0
    drift_offset: float = 0.0
    drift_target: float = 0.0
    drift_timer: float = 0.0
    exit_progress: float = 0.0
    sub_lane_center: float = 0.0
    has_entered_intersection: bool = False
    committed: bool = False
    turn_progress: float = 0.0
    lane_group: str = "through"
    assigned_lane_id: str = ""
    target_heading: float = 0.0
    exit_direction: str = ""
    wait_reason: str = ""
    reaction_delay: float = 0.0
    reaction_timer: float = 0.0
    minimum_gap: float = 24.0
    comfortable_gap: float = 36.0
    stop_offset: float = 0.0
    vehicle_length: float = 26.0
    driver_profile: str = "balanced"
    discharge_count: int = 0
    emergency_type: EmergencyVehicleType | None = None
    priority_level: float = 0.0
    signal_request_state: str = ""
    detected_by_controller: bool = False
    preemption_active: bool = False
    route_nodes: List[str] = field(default_factory=list)
    route_turns: Dict[str, TurnIntent] = field(default_factory=dict)
    current_node_index: int = 0
    next_node_id: str = ""
    current_segment_id: str = ""
    segment_progress: float = 0.0
    corridor_direction: str = ""
    platoon_id: str = ""


@dataclass
class Pedestrian:
    """A single pedestrian waiting or crossing at a crosswalk."""

    id: str
    lane_id: str
    source_sidewalk: str
    destination_sidewalk: str
    crossing_id: str
    x: float
    y: float
    color: tuple[int, int, int]
    clothing_color: tuple[int, int, int]
    walking_speed: float
    waiting_timer: float
    state: PedestrianState = PedestrianState.SPAWNING
    progress: float = 0.0
    side: int = 0
    heading: float = 0.0
    start_delay: float = 0.0
    start_timer: float = 0.0
    spawn_x: float = 0.0
    spawn_y: float = 0.0
    wait_x: float = 0.0
    wait_y: float = 0.0
    cross_start_x: float = 0.0
    cross_start_y: float = 0.0
    cross_end_x: float = 0.0
    cross_end_y: float = 0.0
    walk_away_x: float = 0.0
    walk_away_y: float = 0.0
    group_id: str = ""
    group_size: int = 1
    drift_offset: float = 0.0
    sway_phase: float = 0.0


@dataclass
class Lane:
    """Represents a single approach lane at an intersection."""

    id: str
    direction: float
    car_count: int = 0
    pedestrian_count: int = 0
    waiting_time: float = 0.0
    is_green: bool = False
    green_timer: float = 0.0
    has_emergency: bool = False
    score: float = 0.0
    emergency_timer: int = 0
    passed_cars: int = 0
    step_passed_cars: int = 0
    discharge_progress: float = 0.0
    score_history: Deque[float] = field(default_factory=lambda: deque(maxlen=1000))
    vehicles: List[Vehicle] = field(default_factory=list)
    spawn_timer: float = 0.0
    stop_line_progress: float = 0.0
    queue_length: int = 0
    lane_queue_lengths: Dict[str, int] = field(default_factory=dict)
    lane_wait_times: Dict[str, float] = field(default_factory=dict)
    lane_discharged: Dict[str, int] = field(default_factory=dict)

    def refresh_counts(self, pedestrian_total: int | None = None) -> None:
        """Synchronize aggregate counters from tracked objects."""

        self.car_count = len([vehicle for vehicle in self.vehicles if vehicle.state != VehicleState.OFFSCREEN])
        self.queue_length = len(
            [
                vehicle
                for vehicle in self.vehicles
                if vehicle.state in {VehicleState.APPROACHING, VehicleState.QUEUED}
            ]
        )
        queue_lengths: Dict[str, int] = {}
        for vehicle in self.vehicles:
            if vehicle.state in {VehicleState.APPROACHING, VehicleState.QUEUED}:
                lane_id = vehicle.assigned_lane_id or f"{self.id}_{vehicle.lane_group}"
                queue_lengths[lane_id] = queue_lengths.get(lane_id, 0) + 1
        self.lane_queue_lengths = queue_lengths
        if pedestrian_total is not None:
            self.pedestrian_count = pedestrian_total


@dataclass
class Intersection:
    """Represents a traffic intersection and its live simulation state."""

    type: str
    lanes: List[Lane]
    tick: int = 0
    cycle_time: float = 30.0
    current_phase: List[str] = field(default_factory=list)
    next_phase: List[str] = field(default_factory=list)
    green_time_remaining: float = 0.0
    average_wait_history: Deque[float] = field(default_factory=lambda: deque(maxlen=60))
    total_cars_passed: int = 0
    predicted_phase: List[str] = field(default_factory=list)
    phase_history: Deque[Tuple[int, List[str]]] = field(default_factory=lambda: deque(maxlen=200))
    pedestrians: List[Pedestrian] = field(default_factory=list)
    signal_stage: SignalStage = SignalStage.GREEN
    amber_timer: float = 0.0
    all_red_timer: float = 0.0
    active_phase_elapsed: float = 0.0
    active_phase_duration: float = 0.0
    minimum_green_time: float = 20.0
    junction_occupied: bool = False
    committed_vehicle_count: int = 0
    phase_locked: bool = False
    lane_signal_states: Dict[str, SignalStage] = field(default_factory=dict)
    phase_scores: Dict[str, float] = field(default_factory=dict)
    phase_reasons: Dict[str, str] = field(default_factory=dict)
    current_phase_score: float = 0.0
    next_phase_score: float = 0.0
    controller_reason: str = ""
    active_emergency: bool = False
    ped_signal_states: Dict[str, PedSignalState] = field(default_factory=dict)
    completed_crossings: int = 0
    pedestrian_wait_history: Deque[float] = field(default_factory=lambda: deque(maxlen=120))
    controller_mode: ControllerMode = ControllerMode.NORMAL_ADAPTIVE
    emergency_vehicle_type: str = ""
    emergency_approach: str = ""
    emergency_movement: str = ""
    emergency_distance: float = 0.0
    emergency_detected: bool = False
    emergency_preemption_active: bool = False
    emergency_recovery_active: bool = False
    emergency_wait_timer: float = 0.0
    emergency_vehicles_served: int = 0
    emergency_preemptions_triggered: int = 0
    emergency_wait_history: Deque[float] = field(default_factory=lambda: deque(maxlen=120))
    network_node_id: str = ""
    network_movement_boosts: Dict[str, float] = field(default_factory=dict)
    network_movement_penalties: Dict[str, float] = field(default_factory=dict)
    downstream_blocked_movements: List[str] = field(default_factory=list)
    incoming_platoon_movements: Dict[str, int] = field(default_factory=dict)
    coordination_reason: str = ""
    weather_mode: WeatherMode = WeatherMode.CLEAR
    road_condition: RoadCondition = RoadCondition.DRY
    incidents: List["Incident"] = field(default_factory=list)
    auto_environment: bool = True
    weather_speed_factor: float = 1.0
    weather_braking_factor: float = 1.0
    weather_headway_factor: float = 1.0
    weather_ped_speed_factor: float = 1.0
    discharge_efficiency: float = 1.0
    usable_capacity_factor: float = 1.0
    incident_delay_history: Deque[float] = field(default_factory=lambda: deque(maxlen=120))
    incidents_cleared: int = 0

    def refresh_counts(self) -> None:
        """Synchronize lane counters from vehicle and pedestrian objects."""

        pedestrian_counts = {lane.id: 0 for lane in self.lanes}
        for pedestrian in self.pedestrians:
            pedestrian_counts[pedestrian.lane_id] = pedestrian_counts.get(pedestrian.lane_id, 0) + 1

        for lane in self.lanes:
            lane.refresh_counts(pedestrian_counts.get(lane.id, 0))


@dataclass
class Incident:
    """A local disruption affecting a lane or movement."""

    id: str
    incident_type: IncidentType
    location_type: str
    target_id: str
    severity: float
    duration: float
    elapsed: float = 0.0
    capacity_factor: float = 0.0
    blocked_movement: str = ""
