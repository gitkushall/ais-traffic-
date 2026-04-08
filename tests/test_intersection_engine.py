"""Unit tests for the intersection engine."""

from traffic_sim.ai.scoring_engine import ScoringEngine
from traffic_sim.core.flow_engine import FlowEngine
from traffic_sim.core.intersection_engine import IntersectionEngine
from traffic_sim.core.signal_controller import PhaseDecision, SignalController
from traffic_sim.core.traffic_generator import TrafficGenerator
from traffic_sim.core.models import (
    ControllerMode,
    EmergencyVehicleType,
    PedSignalState,
    Pedestrian,
    PedestrianState,
    TurnIntent,
    Vehicle,
    VehicleState,
)


def test_build_4way_intersection() -> None:
    engine = IntersectionEngine()
    intersection = engine.build("4way")

    assert intersection.type == "4way"
    assert [lane.id for lane in intersection.lanes] == ["north", "south", "east", "west"]
    assert [lane.direction for lane in intersection.lanes] == [0.0, 180.0, 90.0, 270.0]
    assert intersection.current_phase == ["north_through", "south_through", "north_right", "south_right"]


def test_compatible_phases_for_3way() -> None:
    engine = IntersectionEngine()
    phases = engine.get_compatible_phases("3way")

    assert phases == [
        ["north_left", "north_right"],
        ["east_through", "west_through"],
        ["east_right", "west_left"],
    ]


def test_north_approach_supports_straight_left_and_right_in_4way() -> None:
    generator = TrafficGenerator()

    assert generator._movement_target("4way", "north", TurnIntent.STRAIGHT) == ("south", 180.0)
    assert generator._movement_target("4way", "north", TurnIntent.TURN_LEFT) == ("east", 90.0)
    assert generator._movement_target("4way", "north", TurnIntent.TURN_RIGHT) == ("west", 270.0)


def test_turning_vehicle_yields_to_crossing_pedestrian() -> None:
    engine = IntersectionEngine()
    flow = FlowEngine()
    intersection = engine.build("4way")
    north = next(lane for lane in intersection.lanes if lane.id == "north")
    intersection.current_phase = ["north_right"]
    intersection.ped_signal_states = {lane.id: PedSignalState.DONT_WALK for lane in intersection.lanes}
    intersection.ped_signal_states["west"] = PedSignalState.WALK
    north.vehicles.append(
        Vehicle(
            id="north-right",
            lane_id="north",
            color=(255, 255, 255),
            intent=TurnIntent.TURN_RIGHT,
            x=430.0,
            y=200.0,
            heading=180.0,
            current_speed=0.0,
            desired_speed=2.5,
            max_speed=2.5,
            acceleration=1.2,
            deceleration=2.0,
            follow_gap=28.0,
            lane_group="right",
            sub_lane_center=30.0,
            target_heading=270.0,
            exit_direction="west",
        )
    )
    intersection.pedestrians.append(
        Pedestrian(
            id="ped-west",
            lane_id="west",
            source_sidewalk="south_sidewalk",
            destination_sidewalk="north_sidewalk",
            crossing_id="west-cross",
            x=293.0,
            y=360.0,
            color=(253, 188, 180),
            clothing_color=(220, 53, 69),
            walking_speed=0.8,
            waiting_timer=0.0,
            state=PedestrianState.CROSSING,
            progress=0.4,
        )
    )

    flow.update(intersection, 1.0 / 60.0)

    vehicle = north.vehicles[0]
    assert vehicle.wait_reason == "pedestrian_yield"
    assert vehicle.current_speed == 0.0


def test_green_release_staggers_queue_startup_wave() -> None:
    engine = IntersectionEngine()
    generator = TrafficGenerator()
    flow = FlowEngine()
    intersection = engine.build("4way")
    north = next(lane for lane in intersection.lanes if lane.id == "north")
    intersection.current_phase = ["north_through"]
    intersection.ped_signal_states = {lane.id: PedSignalState.DONT_WALK for lane in intersection.lanes}
    for lane in intersection.lanes:
        lane.is_green = lane.id == "north"

    north.vehicles = []
    for index in range(3):
        vehicle = generator._build_vehicle("4way", north, index, generator.rng)
        vehicle.intent = TurnIntent.STRAIGHT
        vehicle.lane_group = "through"
        vehicle.assigned_lane_id = "north_through"
        vehicle.sub_lane_center = 20.0
        vehicle.x, vehicle.y = generator._queue_position("north", "through", index, generator.rng)
        vehicle.current_speed = 0.0
        vehicle.state = VehicleState.QUEUED
        north.vehicles.append(vehicle)

    start_frames = {}
    for frame in range(180):
        flow.update(intersection, 1.0 / 60.0)
        for queue_index, vehicle in enumerate(sorted(north.vehicles, key=lambda candidate: candidate.index)):
            if vehicle.current_speed > 0.2 and queue_index not in start_frames:
                start_frames[queue_index] = frame
        if len(start_frames) == 3:
            break

    assert len(start_frames) == 3
    assert start_frames[0] < start_frames[1] < start_frames[2]


def test_pedestrian_walks_from_sidewalk_to_curb_and_waits() -> None:
    engine = IntersectionEngine()
    generator = TrafficGenerator()
    flow = FlowEngine()
    intersection = engine.build("4way")
    north = next(lane for lane in intersection.lanes if lane.id == "north")
    intersection.ped_signal_states = {lane.id: PedSignalState.DONT_WALK for lane in intersection.lanes}

    pedestrian = generator._build_pedestrian(north, 0, generator.rng)
    intersection.pedestrians = [pedestrian]

    for _ in range(240):
        flow.update(intersection, 1.0 / 60.0)
        if pedestrian.state == PedestrianState.WAITING_AT_CURB:
            break

    assert pedestrian.state == PedestrianState.WAITING_AT_CURB
    assert abs(pedestrian.x - pedestrian.wait_x) < 1.0
    assert abs(pedestrian.y - pedestrian.wait_y) < 1.0


def test_pedestrian_finishes_crossing_on_flashing_dont_walk() -> None:
    engine = IntersectionEngine()
    flow = FlowEngine()
    intersection = engine.build("4way")
    intersection.ped_signal_states = {lane.id: PedSignalState.DONT_WALK for lane in intersection.lanes}
    intersection.ped_signal_states["west"] = PedSignalState.FLASHING_DONT_WALK
    pedestrian = Pedestrian(
        id="ped-west",
        lane_id="west",
        source_sidewalk="south_sidewalk",
        destination_sidewalk="north_sidewalk",
        crossing_id="west-cross",
        x=290.0,
        y=372.0,
        color=(253, 188, 180),
        clothing_color=(220, 53, 69),
        walking_speed=0.7,
        waiting_timer=1.0,
        state=PedestrianState.CROSSING,
        progress=0.8,
        cross_start_x=290.0,
        cross_start_y=400.0,
        cross_end_x=290.0,
        cross_end_y=320.0,
        walk_away_x=290.0,
        walk_away_y=300.0,
    )
    intersection.pedestrians = [pedestrian]

    for _ in range(120):
        flow.update(intersection, 1.0 / 60.0)
        if not intersection.pedestrians:
            break

    assert intersection.completed_crossings == 1


def test_controller_enters_emergency_serving_mode_for_detected_emergency() -> None:
    engine = IntersectionEngine()
    scoring = ScoringEngine()
    controller = SignalController()
    intersection = engine.build("4way")
    north = next(lane for lane in intersection.lanes if lane.id == "north")
    north.vehicles.append(
        Vehicle(
            id="north-ems",
            lane_id="north",
            color=(255, 255, 255),
            intent=TurnIntent.STRAIGHT,
            x=420.0,
            y=160.0,
            heading=180.0,
            current_speed=0.0,
            desired_speed=3.0,
            max_speed=3.0,
            acceleration=1.8,
            deceleration=2.8,
            follow_gap=28.0,
            is_emergency=True,
            emergency_type=EmergencyVehicleType.AMBULANCE,
            priority_level=1.0,
            lane_group="through",
            assigned_lane_id="north_through",
        )
    )
    north.has_emergency = True
    north.emergency_timer = 30
    compatible = engine.get_compatible_phases("4way")

    scoring.score_intersection(intersection)
    phase, next_phase, green_time, phase_scores, phase_reasons, selected_score, next_score, emergency_phase = scoring.select_phase(
        intersection,
        compatible,
    )
    controller.prime(intersection, phase, green_time)
    decision = PhaseDecision(
        phase=phase,
        next_phase=next_phase,
        green_time=green_time,
        phase_scores=phase_scores,
        phase_reasons=phase_reasons,
        selected_score=selected_score,
        next_score=next_score,
        emergency_phase=emergency_phase,
    )

    controller.update(intersection, 1.0 / 60.0, decision)

    assert emergency_phase is True
    assert "north_through" in phase
    assert intersection.controller_mode in {ControllerMode.EMERGENCY_SERVING, ControllerMode.EMERGENCY_REQUESTED}
