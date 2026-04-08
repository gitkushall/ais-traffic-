"""Unit tests for connected corridor network behavior."""

import random

from traffic_sim.core.intersection_engine import IntersectionEngine
from traffic_sim.core.network_manager import NetworkManager
from traffic_sim.core.traffic_generator import TrafficGenerator
from traffic_sim.core.models import TurnIntent, VehicleState


def test_build_corridor_creates_connected_two_node_network() -> None:
    manager = NetworkManager()
    engine = IntersectionEngine()

    network = manager.build_corridor("4way", engine)

    assert len(network.nodes) == 2
    assert len(network.segments) == 2
    assert [node.node_id for node in network.nodes] == ["A", "B"]


def test_prepare_spawn_assigns_corridor_route_from_external_edge() -> None:
    manager = NetworkManager()
    engine = IntersectionEngine()
    generator = TrafficGenerator(random.Random(1))
    network = manager.build_corridor("4way", engine)
    node_a = network.nodes[0]
    west_lane = next(lane for lane in node_a.intersection.lanes if lane.id == "west")
    vehicle = generator._build_vehicle("4way", west_lane, 0, generator.rng)
    west_lane.vehicles.append(vehicle)

    manager.prepare_spawn(network, node_a, generator, 0, generator.rng)

    assert vehicle.route_nodes == ["A", "B"]
    assert vehicle.route_turns["A"] == TurnIntent.STRAIGHT
    assert vehicle.next_node_id == "B"


def test_segment_delivery_moves_vehicle_to_downstream_intersection() -> None:
    manager = NetworkManager()
    engine = IntersectionEngine()
    generator = TrafficGenerator(random.Random(2))
    network = manager.build_corridor("4way", engine)
    segment = network.segments[0]
    vehicle = generator._build_vehicle("4way", network.nodes[0].intersection.lanes[3], 0, generator.rng)
    vehicle.route_nodes = ["A", "B"]
    vehicle.route_turns = {"A": TurnIntent.STRAIGHT, "B": TurnIntent.TURN_RIGHT}
    vehicle.current_node_index = 0
    vehicle.next_node_id = "B"
    vehicle.segment_progress = 0.99
    segment.vehicles.append(vehicle)

    manager.update_segments(network, 1.0, generator, generator.rng)

    downstream = next(lane for lane in network.nodes[1].intersection.lanes if lane.id == "west")
    assert not segment.vehicles
    assert downstream.vehicles
    assert downstream.vehicles[0].lane_id == "west"
    assert downstream.vehicles[0].state == VehicleState.APPROACHING


def test_coordination_marks_downstream_blockage() -> None:
    manager = NetworkManager()
    engine = IntersectionEngine()
    generator = TrafficGenerator(random.Random(3))
    network = manager.build_corridor("4way", engine)
    segment = network.segments[0]
    for _ in range(segment.capacity):
        segment.vehicles.append(
            generator._build_vehicle("4way", network.nodes[0].intersection.lanes[3], 0, generator.rng)
        )

    manager.update_coordination(network)

    upstream = network.nodes[0].intersection
    assert upstream.network_movement_penalties
    assert upstream.downstream_blocked_movements
