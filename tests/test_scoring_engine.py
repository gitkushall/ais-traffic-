"""Unit tests for the scoring engine."""

from traffic_sim.ai.scoring_engine import ScoringEngine, WeightProfile
from traffic_sim.core.environment_manager import EnvironmentManager
from traffic_sim.core.models import EmergencyVehicleType, Intersection, Incident, IncidentType, Lane, TurnIntent, Vehicle, WeatherMode


def test_emergency_lane_forces_top_score() -> None:
    engine = ScoringEngine()
    lane = Lane(id="north", direction=0.0, has_emergency=True)

    score = engine.score_lane(lane)

    assert score == 999.0


def test_select_phase_chooses_highest_combined_score() -> None:
    weights = WeightProfile(0.5, 0.3, 0.2)
    engine = ScoringEngine(weights=weights)
    intersection = Intersection(
        type="4way",
        lanes=[
            Lane(id="north", direction=0.0, car_count=10, waiting_time=85.0, pedestrian_count=1),
            Lane(id="south", direction=180.0, car_count=8, waiting_time=70.0, pedestrian_count=0),
            Lane(id="east", direction=90.0, car_count=2, waiting_time=1.0, pedestrian_count=0),
            Lane(id="west", direction=270.0, car_count=3, waiting_time=1.0, pedestrian_count=0),
        ],
    )
    engine.score_intersection(intersection)

    phase, next_phase, green_time, phase_scores, phase_reasons, selected_score, next_score, emergency_phase = engine.select_phase(
        intersection,
        [["north", "south"], ["east", "west"]],
    )

    assert phase == ["north", "south"]
    assert next_phase == ["east", "west"]
    assert green_time >= 15.0
    assert selected_score > next_score
    assert not emergency_phase
    assert phase_scores["north+south"] > phase_scores["east+west"]
    assert "queue" in phase_reasons["north+south"] or "wait" in phase_reasons["north+south"]


def test_fixed_normalization_matches_spec() -> None:
    engine = ScoringEngine()
    lane = Lane(id="west", direction=270.0, car_count=15, waiting_time=60.0, pedestrian_count=5)

    score = engine.score_lane(lane)

    assert score == 0.5


def test_green_time_uses_busy_city_timing() -> None:
    engine = ScoringEngine()
    lane_north = Lane(id="north", direction=0.0)
    lane_south = Lane(id="south", direction=180.0)
    for index in range(8):
        lane_north.vehicles.append(
            Vehicle(
                id=f"n-{index}",
                lane_id="north",
                color=(255, 255, 255),
                intent=TurnIntent.STRAIGHT,
                x=0.0,
                y=0.0,
                heading=180.0,
                current_speed=0.0,
                desired_speed=2.5,
                max_speed=2.5,
                acceleration=1.2,
                deceleration=2.0,
                follow_gap=28.0,
            )
        )
    for index in range(2):
        lane_south.vehicles.append(
            Vehicle(
                id=f"s-{index}",
                lane_id="south",
                color=(255, 255, 255),
                intent=TurnIntent.STRAIGHT,
                x=0.0,
                y=0.0,
                heading=0.0,
                current_speed=0.0,
                desired_speed=2.5,
                max_speed=2.5,
                acceleration=1.2,
                deceleration=2.0,
                follow_gap=28.0,
            )
        )
    intersection = Intersection(type="2way", lanes=[lane_north, lane_south])

    green_time = engine.calculate_green_time(intersection, ["north"])

    assert green_time >= 15.0


def test_lane_group_prevents_turning_vehicles_from_counting_as_through_pressure() -> None:
    engine = ScoringEngine()
    lane = Lane(id="north", direction=0.0)
    lane.vehicles.append(
        Vehicle(
            id="north-right-1",
            lane_id="north",
            color=(255, 255, 255),
            intent=TurnIntent.TURN_RIGHT,
            x=0.0,
            y=0.0,
            heading=180.0,
            current_speed=0.0,
            desired_speed=2.5,
            max_speed=2.5,
            acceleration=1.2,
            deceleration=2.0,
            follow_gap=28.0,
            lane_group="right",
        )
    )

    intersection = Intersection(type="2way", lanes=[lane])
    through_stats = engine._movement_stats(intersection, {"north": lane}, "north_through")
    right_stats = engine._movement_stats(intersection, {"north": lane}, "north_right")

    assert through_stats is not None
    assert right_stats is not None
    assert through_stats["vehicles"] == 0
    assert right_stats["vehicles"] == 1


def test_detect_emergency_reports_approach_and_distance() -> None:
    engine = ScoringEngine()
    lane = Lane(id="north", direction=0.0)
    lane.vehicles.append(
        Vehicle(
            id="ems-1",
            lane_id="north",
            color=(255, 255, 255),
            intent=TurnIntent.STRAIGHT,
            x=420.0,
            y=120.0,
            heading=180.0,
            current_speed=0.0,
            desired_speed=2.5,
            max_speed=3.0,
            acceleration=1.5,
            deceleration=2.4,
            follow_gap=28.0,
            is_emergency=True,
            emergency_type=EmergencyVehicleType.AMBULANCE,
            priority_level=1.0,
            lane_group="through",
        )
    )
    intersection = Intersection(type="2way", lanes=[lane, Lane(id="south", direction=180.0)])

    detected = engine.detect_emergency(intersection)

    assert detected["exists"] is True
    assert detected["approach"] == "north"
    assert detected["type"] == "ambulance"
    assert detected["distance"] > 0.0


def test_weather_profile_reduces_speed_and_capacity_in_heavy_rain() -> None:
    intersection = Intersection(type="4way", lanes=[Lane(id="north", direction=0.0)])

    EnvironmentManager().prime([intersection], WeatherMode.HEAVY_RAIN)

    assert intersection.weather_mode == WeatherMode.HEAVY_RAIN
    assert intersection.weather_speed_factor < 1.0
    assert intersection.weather_braking_factor > 1.0
    assert intersection.discharge_efficiency < 1.0


def test_blocked_incident_penalizes_phase_score() -> None:
    engine = ScoringEngine()
    lane = Lane(id="north", direction=0.0, waiting_time=32.0)
    lane.vehicles.append(
        Vehicle(
            id="north-through-1",
            lane_id="north",
            color=(255, 255, 255),
            intent=TurnIntent.STRAIGHT,
            x=400.0,
            y=100.0,
            heading=180.0,
            current_speed=0.0,
            desired_speed=2.5,
            max_speed=2.5,
            acceleration=1.2,
            deceleration=2.0,
            follow_gap=28.0,
            lane_group="through",
        )
    )
    free_intersection = Intersection(type="2way", lanes=[lane])
    blocked_lane = Lane(id="north", direction=0.0, waiting_time=32.0, vehicles=list(lane.vehicles))
    blocked_intersection = Intersection(
        type="2way",
        lanes=[blocked_lane],
        incidents=[
            Incident(
                id="inc-1",
                incident_type=IncidentType.BLOCKED_LANE,
                location_type="lane",
                target_id="north",
                severity=0.9,
                duration=30.0,
                capacity_factor=0.0,
                blocked_movement="north_through",
            )
        ],
    )

    free_score, _, _ = engine.score_phase(free_intersection, ["north_through"])
    blocked_score, reason, _ = engine.score_phase(blocked_intersection, ["north_through"])

    assert blocked_score < free_score
    assert "incident" in reason or "constraint" in reason
