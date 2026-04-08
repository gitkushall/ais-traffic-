"""Connected corridor network management for multiple intersections."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from traffic_sim.core.intersection_layout import movement_token
from traffic_sim.core.models import Intersection, TurnIntent, Vehicle, VehicleState


@dataclass
class IntersectionNode:
    """One intersection node in the corridor network."""

    node_id: str
    intersection: Intersection
    center: Tuple[int, int]
    spawnable_approaches: Tuple[str, ...]


@dataclass
class RoadSegment:
    """A directed road segment connecting two intersections."""

    segment_id: str
    start_node: str
    end_node: str
    entry_approach: str
    exit_approach: str
    travel_time: float
    capacity: int
    vehicles: List[Vehicle] = field(default_factory=list)


@dataclass
class CorridorNetwork:
    """A small connected traffic network for corridor coordination."""

    orientation: str
    nodes: List[IntersectionNode]
    segments: List[RoadSegment]
    summary: Dict[str, object] = field(default_factory=dict)


class NetworkManager:
    """Owns connected intersections, routed transfers, and corridor coordination."""

    def __init__(self) -> None:
        self.platoon_counter = 0

    def build_corridor(self, intersection_type: str, engine: object) -> CorridorNetwork:
        """Build a two-node connected corridor for the selected topology."""

        orientation = "horizontal" if intersection_type in {"3way", "4way"} else "vertical"
        if orientation == "horizontal":
            node_specs = [
                ("A", (220, 360), ("north", "south", "west")),
                ("B", (580, 360), ("north", "south", "east")),
            ]
            segments = [
                RoadSegment("A_to_B", "A", "B", "west", "west", 3.8, 10),
                RoadSegment("B_to_A", "B", "A", "east", "east", 3.8, 10),
            ]
        else:
            node_specs = [
                ("A", (400, 210), ("north",)),
                ("B", (400, 510), ("south",)),
            ]
            segments = [
                RoadSegment("A_to_B", "A", "B", "north", "north", 3.8, 10),
                RoadSegment("B_to_A", "B", "A", "south", "south", 3.8, 10),
            ]

        nodes: List[IntersectionNode] = []
        for node_id, center, spawnable in node_specs:
            intersection = engine.build(intersection_type)
            intersection.network_node_id = node_id
            nodes.append(
                IntersectionNode(
                    node_id=node_id,
                    intersection=intersection,
                    center=center,
                    spawnable_approaches=spawnable,
                )
            )

        return CorridorNetwork(orientation=orientation, nodes=nodes, segments=segments)

    def node_intersections(self, network: CorridorNetwork) -> List[Intersection]:
        """Return the live intersection list for the corridor."""

        return [node.intersection for node in network.nodes]

    def spawnable_approaches(self, network: CorridorNetwork, node_id: str) -> Tuple[str, ...]:
        """Return the external spawn approaches for one node."""

        node = self._node(network, node_id)
        return node.spawnable_approaches

    def prepare_spawn(self, network: CorridorNetwork, node: IntersectionNode, generator: object, tick: int, rng: object) -> None:
        """Assign network routes to newly spawned corridor-edge vehicles."""

        for lane in node.intersection.lanes:
            if lane.id not in node.spawnable_approaches:
                continue
            for vehicle in lane.vehicles:
                if vehicle.route_nodes:
                    continue
                route = self._route_for_spawn(network, node.node_id, lane.id, node.intersection.type, generator, rng)
                if not route:
                    continue
                vehicle.route_nodes = route["nodes"]
                vehicle.route_turns = route["turns"]
                vehicle.current_node_index = 0
                vehicle.next_node_id = route["nodes"][1] if len(route["nodes"]) > 1 else ""
                vehicle.corridor_direction = str(route["direction"])
                vehicle.platoon_id = route["platoon_id"]
                self._configure_vehicle_for_node(
                    vehicle,
                    node.intersection.type,
                    lane.id,
                    route["turns"][node.node_id],
                    generator,
                    rng,
                    from_segment=False,
                )

    def update_coordination(self, network: CorridorNetwork) -> None:
        """Populate network-aware boosts and penalties for each node."""

        for node in network.nodes:
            node.intersection.network_movement_boosts = {}
            node.intersection.network_movement_penalties = {}
            node.intersection.downstream_blocked_movements = []
            node.intersection.incoming_platoon_movements = {}
            node.intersection.coordination_reason = ""

        pressure_lines: List[str] = []
        for segment in network.segments:
            downstream = self._node(network, segment.end_node).intersection
            upstream = self._node(network, segment.start_node).intersection
            occupancy = len(segment.vehicles) / max(1, segment.capacity)
            incoming = [vehicle for vehicle in segment.vehicles if vehicle.segment_progress >= 0.55]
            for vehicle in incoming:
                if vehicle.current_node_index + 1 >= len(vehicle.route_nodes):
                    continue
                target_node = vehicle.route_nodes[vehicle.current_node_index + 1]
                if target_node != segment.end_node:
                    continue
                planned_intent = vehicle.route_turns.get(target_node, TurnIntent.STRAIGHT)
                movement_id = movement_token(segment.exit_approach, self._lane_group(planned_intent))
                downstream.network_movement_boosts[movement_id] = downstream.network_movement_boosts.get(movement_id, 0.0) + 18.0
                downstream.incoming_platoon_movements[movement_id] = downstream.incoming_platoon_movements.get(movement_id, 0) + 1

            blocked = occupancy >= 0.8 or self._receiving_queue(downstream, segment.exit_approach) >= 6
            if blocked:
                outbound_movement = self._corridor_outbound_movement(network, segment.start_node)
                upstream.network_movement_penalties[outbound_movement] = upstream.network_movement_penalties.get(outbound_movement, 0.0) + 42.0
                upstream.downstream_blocked_movements.append(outbound_movement)
                pressure_lines.append(f"{segment.segment_id} blocked")
            elif incoming:
                pressure_lines.append(f"{segment.segment_id} platoon {len(incoming)}")

            emergency_in_segment = next((vehicle for vehicle in segment.vehicles if vehicle.is_emergency), None)
            if emergency_in_segment is not None:
                target_node = segment.end_node
                planned_intent = emergency_in_segment.route_turns.get(target_node, TurnIntent.STRAIGHT)
                emergency_movement = movement_token(segment.exit_approach, self._lane_group(planned_intent))
                target_intersection = self._node(network, target_node).intersection
                target_intersection.network_movement_boosts[emergency_movement] = (
                    target_intersection.network_movement_boosts.get(emergency_movement, 0.0) + 250.0
                )
                target_intersection.coordination_reason = f"Preparing downstream emergency path from {segment.segment_id}"
                pressure_lines.append(f"{segment.segment_id} emergency")

        for node in network.nodes:
            if not node.intersection.coordination_reason:
                boosts = sum(node.intersection.network_movement_boosts.values())
                penalties = sum(node.intersection.network_movement_penalties.values())
                if boosts > 0:
                    node.intersection.coordination_reason = f"Incoming platoon boost {boosts:0.0f}"
                elif penalties > 0:
                    node.intersection.coordination_reason = f"Downstream hold {penalties:0.0f}"

        network.summary = {
            "nodes": len(network.nodes),
            "segments": len(network.segments),
            "segment_occupancy": {segment.segment_id: len(segment.vehicles) for segment in network.segments},
            "pressure": ", ".join(pressure_lines[:4]) if pressure_lines else "balanced corridor",
            "cooperating": [node.node_id for node in network.nodes if node.intersection.coordination_reason],
        }

    def transfer_exiting_vehicles(self, network: CorridorNetwork, generator: object, rng: object) -> None:
        """Move routed vehicles from intersections onto corridor segments."""

        for node in network.nodes:
            for lane in node.intersection.lanes:
                retained: List[Vehicle] = []
                for vehicle in lane.vehicles:
                    if self._should_enter_segment(network, node.node_id, vehicle):
                        segment = self._segment_between(network, node.node_id, vehicle.next_node_id)
                        if segment is not None and len(segment.vehicles) < segment.capacity:
                            vehicle.current_segment_id = segment.segment_id
                            vehicle.segment_progress = 0.0
                            segment.vehicles.append(vehicle)
                            continue
                    retained.append(vehicle)
                lane.vehicles = retained
            node.intersection.refresh_counts()

    def update_segments(self, network: CorridorNetwork, dt: float, generator: object, rng: object) -> None:
        """Advance vehicles along road segments and inject them into downstream nodes."""

        for segment in network.segments:
            retained: List[Vehicle] = []
            for vehicle in segment.vehicles:
                speed_factor = 1.0 + min(0.4, max(0.0, vehicle.current_speed / 3.0))
                vehicle.segment_progress += (dt / segment.travel_time) * speed_factor
                if vehicle.segment_progress >= 1.0:
                    self._deliver_to_downstream(network, segment, vehicle, generator, rng)
                    continue
                retained.append(vehicle)
            segment.vehicles = retained

    def _deliver_to_downstream(
        self,
        network: CorridorNetwork,
        segment: RoadSegment,
        vehicle: Vehicle,
        generator: object,
        rng: object,
    ) -> None:
        """Place a segment vehicle onto the downstream intersection approach."""

        downstream_node = self._node(network, segment.end_node)
        downstream = downstream_node.intersection
        vehicle.current_node_index += 1
        vehicle.current_segment_id = ""
        vehicle.segment_progress = 0.0
        vehicle.next_node_id = vehicle.route_nodes[vehicle.current_node_index + 1] if vehicle.current_node_index + 1 < len(vehicle.route_nodes) else ""
        next_intent = vehicle.route_turns.get(downstream.network_node_id, TurnIntent.STRAIGHT)
        self._configure_vehicle_for_node(
            vehicle,
            downstream.type,
            segment.exit_approach,
            next_intent,
            generator,
            rng,
            from_segment=True,
        )
        lane = next((candidate for candidate in downstream.lanes if candidate.id == segment.exit_approach), None)
        if lane is not None:
            lane.vehicles.append(vehicle)
            downstream.refresh_counts()

    def _configure_vehicle_for_node(
        self,
        vehicle: Vehicle,
        intersection_type: str,
        approach: str,
        intent: TurnIntent,
        generator: object,
        rng: object,
        from_segment: bool,
    ) -> None:
        """Retarget a routed vehicle for a specific node approach."""

        vehicle.lane_id = approach
        vehicle.intent = intent
        vehicle.lane_group = generator._lane_group_for_intent(intent)
        vehicle.assigned_lane_id = movement_token(approach, vehicle.lane_group)
        vehicle.exit_direction, vehicle.target_heading = generator._movement_target(intersection_type, approach, intent)
        x, y, heading, sub_lane_center = generator._spawn_position(approach, generator._sub_lane_center(approach, vehicle.lane_group), rng)
        if from_segment:
            x, y, heading, sub_lane_center = generator._spawn_position(approach, generator._sub_lane_center(approach, vehicle.lane_group), rng)
        vehicle.x = x
        vehicle.y = y
        vehicle.heading = heading
        vehicle.sub_lane_center = sub_lane_center
        vehicle.state = VehicleState.APPROACHING
        vehicle.has_entered_intersection = False
        vehicle.committed = False
        vehicle.turn_progress = 0.0
        vehicle.wait_reason = ""
        vehicle.reaction_timer = vehicle.reaction_delay

    def _route_for_spawn(
        self,
        network: CorridorNetwork,
        node_id: str,
        approach: str,
        intersection_type: str,
        generator: object,
        rng: object,
    ) -> Optional[Dict[str, object]]:
        """Return a route for an externally spawned vehicle, if it joins the corridor."""

        if network.orientation == "horizontal" and node_id == "A" and approach == "west":
            if rng.random() < 0.72:
                final_intent = generator._choose_intent(intersection_type, "west", rng, False)
                self.platoon_counter += 1
                return {
                    "nodes": ["A", "B"],
                    "turns": {"A": TurnIntent.STRAIGHT, "B": final_intent},
                    "direction": "eastbound",
                    "platoon_id": f"plt-{self.platoon_counter}",
                }
        if network.orientation == "horizontal" and node_id == "B" and approach == "east":
            if rng.random() < 0.72:
                final_intent = generator._choose_intent(intersection_type, "east", rng, False)
                self.platoon_counter += 1
                return {
                    "nodes": ["B", "A"],
                    "turns": {"B": TurnIntent.STRAIGHT, "A": final_intent},
                    "direction": "westbound",
                    "platoon_id": f"plt-{self.platoon_counter}",
                }
        if network.orientation == "vertical" and node_id == "A" and approach == "north":
            self.platoon_counter += 1
            return {
                "nodes": ["A", "B"],
                "turns": {"A": TurnIntent.STRAIGHT, "B": TurnIntent.STRAIGHT},
                "direction": "southbound",
                "platoon_id": f"plt-{self.platoon_counter}",
            }
        if network.orientation == "vertical" and node_id == "B" and approach == "south":
            self.platoon_counter += 1
            return {
                "nodes": ["B", "A"],
                "turns": {"B": TurnIntent.STRAIGHT, "A": TurnIntent.STRAIGHT},
                "direction": "northbound",
                "platoon_id": f"plt-{self.platoon_counter}",
            }
        return None

    def _should_enter_segment(self, network: CorridorNetwork, node_id: str, vehicle: Vehicle) -> bool:
        """Return whether an exiting vehicle should transition onto a segment."""

        if vehicle.current_segment_id or not vehicle.route_nodes:
            return False
        if vehicle.current_node_index + 1 >= len(vehicle.route_nodes):
            return False
        if vehicle.route_nodes[vehicle.current_node_index] != node_id:
            return False
        if vehicle.state != VehicleState.EXITING:
            return False
        next_node = vehicle.route_nodes[vehicle.current_node_index + 1]
        if node_id == "A" and next_node == "B" and vehicle.exit_direction in {"east", "south"}:
            return vehicle.exit_direction == ("east" if network.orientation == "horizontal" else "south")
        if node_id == "B" and next_node == "A" and vehicle.exit_direction in {"west", "north"}:
            return vehicle.exit_direction == ("west" if network.orientation == "horizontal" else "north")
        return False

    def _corridor_outbound_movement(self, network: CorridorNetwork, node_id: str) -> str:
        """Return the movement token that pushes corridor traffic downstream."""

        if network.orientation == "horizontal":
            return "west_through" if node_id == "A" else "east_through"
        return "north_through" if node_id == "A" else "south_through"

    def _receiving_queue(self, intersection: Intersection, approach: str) -> int:
        """Return queue length on a receiving approach."""

        lane = next((candidate for candidate in intersection.lanes if candidate.id == approach), None)
        return lane.queue_length if lane is not None else 0

    def _lane_group(self, intent: TurnIntent) -> str:
        """Return the lane group for a turn intent."""

        if intent == TurnIntent.TURN_LEFT:
            return "left"
        if intent == TurnIntent.TURN_RIGHT:
            return "right"
        return "through"

    def _segment_between(self, network: CorridorNetwork, start: str, end: str) -> Optional[RoadSegment]:
        """Return the segment between two nodes, if any."""

        return next((segment for segment in network.segments if segment.start_node == start and segment.end_node == end), None)

    def _node(self, network: CorridorNetwork, node_id: str) -> IntersectionNode:
        """Return a network node by id."""

        return next(node for node in network.nodes if node.node_id == node_id)
