"""Entry point and game loop for the adaptive traffic simulation."""

from __future__ import annotations

import random
from typing import List

import pygame

from traffic_sim.ai.scoring_engine import ScoringEngine, WeightProfile
from traffic_sim.core.environment_manager import EnvironmentManager
from traffic_sim.core.flow_engine import FlowEngine
from traffic_sim.core.intersection_engine import IntersectionEngine
from traffic_sim.core.network_manager import CorridorNetwork, NetworkManager
from traffic_sim.core.models import ControllerMode, Intersection
from traffic_sim.core.signal_controller import PhaseDecision, SignalController
from traffic_sim.core.traffic_generator import TrafficGenerator
from traffic_sim.data.simulation_log import SimulationLog
from traffic_sim.ui.renderer import Renderer
from traffic_sim.ui.sidebar import Sidebar
from traffic_sim.ui.view_models import SidebarViewModelBuilder


class TrafficSimulationApp:
    """Coordinates simulation state, AI decisions, and the Pygame loop."""

    def __init__(self) -> None:
        pygame.init()
        try:
            pygame.mixer.init()
        except pygame.error:
            pass

        self.screen = pygame.display.set_mode((1280, 720))
        pygame.display.set_caption("Adaptive Multi-Intersection AI Traffic Simulation")
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont("arial", 22)
        self.small_font = pygame.font.SysFont("arial", 16)

        self.intersection_engine = IntersectionEngine()
        self.generator = TrafficGenerator()
        self.weights = WeightProfile()
        self.scoring_engine = ScoringEngine(self.weights)
        self.signal_controller = SignalController()
        self.flow_engine = FlowEngine()
        self.network_manager = NetworkManager()
        self.environment_manager = EnvironmentManager()
        self.renderer = Renderer()
        self.sidebar = Sidebar()
        self.sidebar_view_models = SidebarViewModelBuilder()
        self.simulation_log = SimulationLog()

        self.intersection_type = "4way"
        self.intersections: List[Intersection] = [self.intersection_engine.build(self.intersection_type)]
        self.network: CorridorNetwork | None = None
        self.multi_intersection_mode = False
        self.running = True
        self.paused = False
        self.debug_mode = False
        self.simulation_speed = 1
        self.ai_accumulator = 0.0
        self.spawn_accumulator = 0.0
        self.random = random.Random()
        self.pending_decisions: List[PhaseDecision] = []
        self._prime_intersections()

    def rebuild(self, intersection_type: str) -> None:
        """Reset the simulation to a new intersection topology."""

        self.intersection_type = intersection_type
        if self.multi_intersection_mode:
            self.network = self.network_manager.build_corridor(intersection_type, self.intersection_engine)
            self.intersections = self.network_manager.node_intersections(self.network)
        else:
            self.network = None
            self.intersections = [self.intersection_engine.build(intersection_type)]
        self.ai_accumulator = 0.0
        self.spawn_accumulator = 0.0
        self.pending_decisions = []
        self._prime_intersections()

    def toggle_multi_intersection(self) -> None:
        """Toggle multi-intersection mode and rebuild state."""

        self.multi_intersection_mode = not self.multi_intersection_mode
        self.rebuild(self.intersection_type)

    def run(self) -> None:
        """Start the main simulation loop."""

        while self.running:
            dt = self.clock.tick(60) / 1000.0
            fps = self.clock.get_fps()
            self._handle_events()

            if not self.paused:
                scaled_dt = dt * self.simulation_speed
                self._update_simulation(scaled_dt)

            self.renderer.update(dt)
            self._draw(fps)
            pygame.display.flip()

        pygame.quit()

    def _handle_events(self) -> None:
        """Handle window and sidebar events."""

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.running = False
                return

            if event.type == pygame.KEYDOWN and event.key == pygame.K_m:
                self.toggle_multi_intersection()
                continue

            action = self.sidebar.handle_event(event, self.weights)
            if action is None:
                continue

            name, payload = action
            if name == "set_type":
                mapping = {"2way": "2way", "3way": "3way", "4way": "4way"}
                self.rebuild(mapping[str(payload)])
            elif name == "set_speed":
                self.simulation_speed = int(payload)
            elif name == "play":
                self.paused = False
            elif name == "pause":
                self.paused = True
            elif name == "reset":
                self.rebuild(self.intersection_type)
            elif name == "force_emergency":
                self._force_emergency()
            elif name == "cycle_weather":
                self.environment_manager.cycle_weather(self.intersections)
            elif name == "trigger_incident":
                self._trigger_incident()
            elif name == "clear_incidents":
                self.environment_manager.clear_incidents(self.intersections)
            elif name == "auto_environment":
                self.environment_manager.toggle_auto_environment(self.intersections)
            elif name == "debug":
                self.debug_mode = not self.debug_mode
            elif name == "weights_changed":
                self.scoring_engine.set_weights(
                    self.weights.density,
                    self.weights.wait,
                    self.weights.pedestrian,
                )

    def _update_simulation(self, dt: float) -> None:
        """Advance the simulation by scaled delta time."""

        self.ai_accumulator += dt
        self.spawn_accumulator += dt
        self.environment_manager.update(self.intersections, dt)

        while self.spawn_accumulator >= 1 / 60:
            self.spawn_accumulator -= 1 / 60
            if self.network is not None:
                for node in self.network.nodes:
                    self.generator.spawn_traffic(
                        node.intersection,
                        node.intersection.tick,
                        rng=self.random,
                        spawnable_approaches=self.network_manager.spawnable_approaches(self.network, node.node_id),
                    )
                    self.network_manager.prepare_spawn(self.network, node, self.generator, node.intersection.tick, self.random)
                    node.intersection.tick += 1
                self.network_manager.update_segments(self.network, 1 / 60, self.generator, self.random)
            else:
                for intersection in self.intersections:
                    self.generator.spawn_traffic(intersection, intersection.tick, rng=self.random)
                    intersection.tick += 1

        if self.ai_accumulator >= 0.5 or not self.pending_decisions:
            self.ai_accumulator = 0.0
            if self.network is not None:
                self.network_manager.update_coordination(self.network)
            self.pending_decisions = [self._score_decision(intersection) for intersection in self.intersections]

        for intersection in self.intersections:
            decision = self.pending_decisions[self.intersections.index(intersection)]
            self.signal_controller.update(intersection, dt, decision)
            self.flow_engine.update(intersection, dt)

        if self.network is not None:
            self.network_manager.transfer_exiting_vehicles(self.network, self.generator, self.random)
        else:
            self._apply_downstream_flow()
        for intersection in self.intersections:
            self._record_wait(intersection)
            self.simulation_log.record(intersection)

    def _score_decision(self, intersection: Intersection) -> PhaseDecision:
        """Return the next desired phase from the scoring engine."""
        compatible = self.intersection_engine.get_compatible_phases(intersection.type)
        self.scoring_engine.score_intersection(intersection)
        emergency = self.scoring_engine.detect_emergency(intersection)
        if not emergency["exists"] and intersection.controller_mode == ControllerMode.EMERGENCY_SERVING:
            intersection.emergency_vehicles_served += 1
            if intersection.emergency_wait_timer > 0.0:
                intersection.emergency_wait_history.append(intersection.emergency_wait_timer)
                intersection.emergency_wait_timer = 0.0
        intersection.emergency_vehicle_type = str(emergency["type"])
        intersection.emergency_approach = str(emergency["approach"])
        intersection.emergency_movement = str(emergency["movement"])
        intersection.emergency_distance = float(emergency["distance"])
        intersection.emergency_detected = bool(emergency["detected"])
        if emergency["exists"]:
            intersection.emergency_wait_timer += 0.5
        (
            selected,
            next_phase,
            green_time,
            phase_scores,
            phase_reasons,
            selected_score,
            next_score,
            emergency_phase,
        ) = self.scoring_engine.select_phase(intersection, compatible)
        return PhaseDecision(
            phase=selected,
            next_phase=next_phase,
            green_time=green_time,
            phase_scores=phase_scores,
            phase_reasons=phase_reasons,
            selected_score=selected_score,
            next_score=next_score,
            emergency_phase=emergency_phase,
        )

    def _prime_intersections(self) -> None:
        """Fill fresh intersections so the simulation starts busy."""

        self.pending_decisions = []
        if self.network is not None:
            self.environment_manager.prime(self.intersections)
            for node in self.network.nodes:
                intersection = node.intersection
                self.generator.prime_intersection(intersection, rng=self.random)
                for lane in intersection.lanes:
                    if lane.id not in node.spawnable_approaches:
                        lane.vehicles = []
                intersection.refresh_counts()
                self.network_manager.prepare_spawn(self.network, node, self.generator, intersection.tick, self.random)
                intersection.refresh_counts()
                decision = self._score_decision(intersection)
                intersection.phase_scores = dict(decision.phase_scores)
                intersection.phase_reasons = dict(decision.phase_reasons)
                intersection.current_phase_score = decision.selected_score
                intersection.next_phase_score = decision.next_score
                intersection.controller_reason = decision.phase_reasons.get(
                    "+".join(decision.phase),
                    "Initial adaptive release",
                )
                self.pending_decisions.append(decision)
                self.signal_controller.prime(intersection, decision.phase, decision.green_time)
            self.network_manager.update_coordination(self.network)
            return
        self.environment_manager.prime(self.intersections)
        for intersection in self.intersections:
            self.generator.prime_intersection(intersection, rng=self.random)
            decision = self._score_decision(intersection)
            intersection.phase_scores = dict(decision.phase_scores)
            intersection.phase_reasons = dict(decision.phase_reasons)
            intersection.current_phase_score = decision.selected_score
            intersection.next_phase_score = decision.next_score
            intersection.controller_reason = decision.phase_reasons.get(
                "+".join(decision.phase),
                "Initial adaptive release",
            )
            self.pending_decisions.append(decision)
            self.signal_controller.prime(intersection, decision.phase, decision.green_time)

    def _record_wait(self, intersection: Intersection) -> None:
        """Append current average wait metrics and passed-car totals."""

        if intersection.lanes:
            average_wait = sum(lane.waiting_time for lane in intersection.lanes) / len(intersection.lanes)
            intersection.average_wait_history.append(min(average_wait, 300.0))

        intersection.total_cars_passed = sum(lane.passed_cars for lane in intersection.lanes)

    def _apply_downstream_flow(self) -> None:
        """Feed upstream released traffic into downstream intersections in multi-mode."""

        if len(self.intersections) < 2:
            return

        for index in range(len(self.intersections) - 1):
            upstream = self.intersections[index]
            downstream = self.intersections[index + 1]
            if not upstream.lanes or not downstream.lanes:
                continue
            transfer_lane = downstream.lanes[index % len(downstream.lanes)]
            released = sum(lane.step_passed_cars for lane in upstream.lanes)
            if released > 0:
                for offset in range(released):
                    transfer_lane.vehicles.append(
                        self.generator._build_vehicle(downstream.type, transfer_lane, downstream.tick, self.random)
                    )
                downstream.refresh_counts()

    def _force_emergency(self) -> None:
        """Inject an emergency vehicle into the busiest lane."""

        for intersection in self.intersections:
            if not intersection.lanes:
                continue
            lane = max(intersection.lanes, key=lambda candidate: candidate.car_count + candidate.waiting_time)
            lane.has_emergency = True
            lane.emergency_timer = 30
            vehicle = self.generator._build_vehicle(
                intersection.type,
                lane,
                intersection.tick,
                self.random,
                is_emergency=True,
            )
            vehicle.detected_by_controller = True
            vehicle.x, vehicle.y = self.generator._queue_position(lane.id, vehicle.lane_group, 0, self.random)
            vehicle.current_speed = 0.0
            lane.vehicles.insert(0, vehicle)
            intersection.refresh_counts()

    def _trigger_incident(self) -> None:
        """Create a manual disruption for testing scenario response."""

        if not self.intersections:
            return
        target = max(self.intersections, key=lambda item: sum(l.queue_length for l in item.lanes))
        self.environment_manager.trigger_random_incident(target)

    def _draw(self, fps: float) -> None:
        """Render the canvas and sidebar."""

        self.renderer.draw(self.screen, self.intersections, self.debug_mode, self.font, self.small_font, self.network)
        sidebar_model = self.sidebar_view_models.build(
            self.intersections[0],
            self.weights,
            fps,
            self.paused,
            self.debug_mode,
            self.simulation_speed,
            len(self.intersections),
            self.network.summary if self.network is not None else {},
        )
        self.sidebar.draw(
            self.screen,
            sidebar_model,
            self.font,
            self.small_font,
        )


def main() -> None:
    """Launch the traffic simulation app."""

    app = TrafficSimulationApp()
    app.run()


if __name__ == "__main__":
    main()
