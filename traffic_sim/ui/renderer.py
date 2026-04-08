"""Pygame renderer for an overhead traffic-camera view."""

from __future__ import annotations

import math
from typing import Dict, Iterable, Tuple

import pygame

from traffic_sim.core.intersection_layout import get_layout
from traffic_sim.core.network_manager import CorridorNetwork, RoadSegment
from traffic_sim.core.models import (
    IncidentType,
    Intersection,
    Lane,
    Pedestrian,
    PedestrianState,
    SignalStage,
    TurnIntent,
    Vehicle,
)
from traffic_sim.ui import colors


class Renderer:
    """Draw a realistic top-down overhead traffic scene."""

    WINDOW_SIZE = (1280, 720)
    CANVAS_WIDTH = 800
    CENTER = (400, 360)
    ROAD_WIDTH = 80
    SIDEWALK_WIDTH = 30
    INTERSECTION_SIZE = 210
    STOP_LINE_OFFSET = 0
    MAX_VISIBLE_CARS = 10

    def __init__(self) -> None:
        self.flash_elapsed = 0.0

    def update(self, dt: float) -> None:
        """Advance renderer-local timers."""

        self.flash_elapsed += dt

    def draw(
        self,
        surface: pygame.Surface,
        intersections: Iterable[Intersection],
        debug_mode: bool,
        font: pygame.font.Font,
        small_font: pygame.font.Font,
        network: CorridorNetwork | None = None,
    ) -> None:
        """Draw the full simulation canvas."""

        canvas_rect = pygame.Rect(0, 0, self.CANVAS_WIDTH, self.WINDOW_SIZE[1])
        surface.fill(colors.GRASS, canvas_rect)
        layout = list(intersections)
        if not layout:
            return

        if network is not None:
            self._draw_network(surface, network, debug_mode, font, small_font)
        elif len(layout) == 1:
            self._draw_intersection(surface, layout[0], self.CENTER, debug_mode, font, small_font)
        else:
            positions = [(220, 220), (580, 220), (220, 520), (580, 520)]
            for intersection, center in zip(layout[:4], positions):
                self._draw_intersection(surface, intersection, center, debug_mode, font, small_font, mini=True)

        self._draw_weather_overlay(surface, layout[0])
        self._draw_vignette(surface)

    def _draw_network(
        self,
        surface: pygame.Surface,
        network: CorridorNetwork,
        debug_mode: bool,
        font: pygame.font.Font,
        small_font: pygame.font.Font,
    ) -> None:
        """Draw a connected two-intersection corridor network."""

        self._draw_network_corridor(surface, network)
        for node in network.nodes:
            self._draw_intersection(surface, node.intersection, node.center, debug_mode, font, small_font, mini=True)
        for segment in network.segments:
            self._draw_segment_vehicles(surface, network, segment, 0.82, small_font if debug_mode else None)

    def _draw_network_corridor(self, surface: pygame.Surface, network: CorridorNetwork) -> None:
        """Draw connecting corridor roads between intersections."""

        if network.orientation == "horizontal":
            y = network.nodes[0].center[1]
            road = pygame.Rect(network.nodes[0].center[0], y - self.ROAD_WIDTH // 2, network.nodes[1].center[0] - network.nodes[0].center[0], self.ROAD_WIDTH)
        else:
            x = network.nodes[0].center[0]
            road = pygame.Rect(x - self.ROAD_WIDTH // 2, network.nodes[0].center[1], self.ROAD_WIDTH, network.nodes[1].center[1] - network.nodes[0].center[1])
        pygame.draw.rect(surface, colors.SIDEWALK, road.inflate(self.SIDEWALK_WIDTH * 2, self.SIDEWALK_WIDTH * 2))
        pygame.draw.rect(surface, colors.ROAD, road)

    def _draw_segment_vehicles(
        self,
        surface: pygame.Surface,
        network: CorridorNetwork,
        segment: RoadSegment,
        scale: float,
        font: pygame.font.Font | None,
    ) -> None:
        """Draw vehicles traveling along corridor road segments."""

        start = next(node.center for node in network.nodes if node.node_id == segment.start_node)
        end = next(node.center for node in network.nodes if node.node_id == segment.end_node)
        for vehicle in segment.vehicles:
            if network.orientation == "horizontal":
                start_x = start[0] + 92 if segment.segment_id == "A_to_B" else start[0] - 92
                end_x = end[0] - 92 if segment.segment_id == "A_to_B" else end[0] + 92
                x = start_x + (end_x - start_x) * vehicle.segment_progress
                y = start[1] - 17 if segment.segment_id == "A_to_B" else start[1] + 17
                vehicle.heading = 90.0 if segment.segment_id == "A_to_B" else 270.0
            else:
                start_y = start[1] + 92 if segment.segment_id == "A_to_B" else start[1] - 92
                end_y = end[1] - 92 if segment.segment_id == "A_to_B" else end[1] + 92
                y = start_y + (end_y - start_y) * vehicle.segment_progress
                x = start[0] + 17 if segment.segment_id == "A_to_B" else start[0] - 17
                vehicle.heading = 180.0 if segment.segment_id == "A_to_B" else 0.0
            sprite = self._vehicle_sprite(vehicle, scale)
            rotated = pygame.transform.rotate(sprite, self._rotation_for_direction(vehicle.heading))
            rect = rotated.get_rect(center=(int(x), int(y)))
            surface.blit(rotated, rect)
            if font is not None:
                label = font.render(vehicle.platoon_id[-4:] if vehicle.platoon_id else segment.segment_id, True, colors.DEBUG)
                surface.blit(label, (rect.x, rect.y - 12))

    def _draw_weather_overlay(self, surface: pygame.Surface, intersection: Intersection) -> None:
        """Draw a subtle overlay for the current weather mode."""

        overlay = pygame.Surface((self.CANVAS_WIDTH, self.WINDOW_SIZE[1]), pygame.SRCALPHA)
        mode = intersection.weather_mode.value
        if mode == "light_rain":
            for x in range(0, self.CANVAS_WIDTH, 28):
                pygame.draw.line(overlay, (185, 210, 235, 45), (x, 0), (x - 18, self.WINDOW_SIZE[1]), 1)
        elif mode == "heavy_rain":
            overlay.fill((28, 36, 52, 40))
            for x in range(0, self.CANVAS_WIDTH, 18):
                pygame.draw.line(overlay, (180, 210, 235, 70), (x, 0), (x - 22, self.WINDOW_SIZE[1]), 1)
        elif mode == "fog":
            overlay.fill((220, 225, 235, 36))
        elif mode == "night":
            overlay.fill((8, 12, 24, 55))
        surface.blit(overlay, (0, 0))

    def _draw_incidents(
        self,
        surface: pygame.Surface,
        intersection: Intersection,
        center: Tuple[int, int],
        scale: float,
    ) -> None:
        """Draw disruption markers near affected lanes."""

        for incident in intersection.incidents:
            x, y = self._incident_marker_position(intersection.type, incident.target_id, center, scale)
            pygame.draw.circle(surface, (255, 170, 40), (int(x), int(y)), max(5, int(7 * scale)))
            if incident.incident_type in {IncidentType.BLOCKED_LANE, IncidentType.ROAD_WORK}:
                pygame.draw.rect(
                    surface,
                    (255, 95, 75),
                    pygame.Rect(int(x - 10 * scale), int(y - 4 * scale), int(20 * scale), int(8 * scale)),
                    border_radius=2,
                )
            else:
                pygame.draw.polygon(
                    surface,
                    (255, 120, 80),
                    [(x, y - 8 * scale), (x - 6 * scale, y + 6 * scale), (x + 6 * scale, y + 6 * scale)],
                )

    def _incident_marker_position(
        self,
        intersection_type: str,
        lane_id: str,
        center: Tuple[int, int],
        scale: float,
    ) -> Tuple[float, float]:
        """Return a marker anchor for an affected lane."""

        cx, cy = center
        half = self._junction_half(intersection_type) * scale
        if lane_id == "north":
            return cx + 18 * scale, cy - half - 44 * scale
        if lane_id == "south":
            return cx - 18 * scale, cy + half + 44 * scale
        if lane_id == "east":
            return cx + half + 44 * scale, cy + 18 * scale
        return cx - half - 44 * scale, cy - 18 * scale

    def _draw_intersection(
        self,
        surface: pygame.Surface,
        intersection: Intersection,
        center: Tuple[int, int],
        debug_mode: bool,
        font: pygame.font.Font,
        small_font: pygame.font.Font,
        mini: bool = False,
    ) -> None:
        """Draw one intersection scene."""

        scale = 0.7 if mini else 1.0
        self._draw_environment(surface, intersection, center, scale)
        self._draw_roads(surface, intersection.type, center, scale)
        self._draw_intersection_markings(surface, intersection.type, center, scale)
        self._draw_incidents(surface, intersection, center, scale)

        for lane in intersection.lanes:
            self._draw_stop_line(surface, intersection.type, lane.id, center, scale)
            self._draw_crosswalk(surface, intersection.type, lane.id, center, scale)
            self._draw_lane_arrow(surface, lane.id, center, scale)
            self._draw_signal(surface, intersection, lane, center, scale)
            self._draw_lane_vehicles(surface, intersection.type, lane, center, scale, small_font, debug_mode)

        self._draw_pedestrians(surface, intersection, center, scale, debug_mode, small_font)
        self._draw_camera_overlay(surface, intersection.tick, small_font, mini)

        if debug_mode:
            for lane in intersection.lanes:
                self._draw_debug(surface, lane, center, font, scale)

    def _draw_environment(
        self,
        surface: pygame.Surface,
        intersection: Intersection,
        center: Tuple[int, int],
        scale: float,
    ) -> None:
        """Draw grass, sidewalks, trees, and ambient details."""

        cx, cy = center
        road = self.ROAD_WIDTH * scale
        sidewalk = self.SIDEWALK_WIDTH * scale
        layout = get_layout(intersection.type)

        sidewalk_rects = []
        if "vertical_full" in layout.road_shapes:
            sidewalk_rects.append(
                pygame.Rect(cx - road / 2 - sidewalk, 0, road + sidewalk * 2, self.WINDOW_SIZE[1])
            )
        if "vertical_top" in layout.road_shapes:
            sidewalk_rects.append(
                pygame.Rect(cx - road / 2 - sidewalk, 0, road + sidewalk * 2, cy + sidewalk)
            )
        if "horizontal_full" in layout.road_shapes:
            sidewalk_rects.append(
                pygame.Rect(0, cy - road / 2 - sidewalk, self.CANVAS_WIDTH, road + sidewalk * 2)
            )
        for rect in sidewalk_rects:
            pygame.draw.rect(surface, colors.SIDEWALK, rect)

        tree_centers = {
            "2way": [
                (cx - 160 * scale, cy - 160 * scale),
                (cx + 160 * scale, cy + 160 * scale),
            ],
            "3way": [
                (cx - 160 * scale, cy - 160 * scale),
                (cx + 160 * scale, cy - 160 * scale),
                (cx - 160 * scale, cy + 160 * scale),
            ],
            "4way": [
                (cx - 160 * scale, cy - 160 * scale),
                (cx + 160 * scale, cy - 160 * scale),
                (cx - 160 * scale, cy + 160 * scale),
                (cx + 160 * scale, cy + 160 * scale),
            ],
        }.get(
            intersection.type,
            [
                (cx - 160 * scale, cy - 160 * scale),
                (cx + 160 * scale, cy - 160 * scale),
                (cx - 160 * scale, cy + 160 * scale),
                (cx + 160 * scale, cy + 160 * scale),
            ],
        )
        for tree_center in tree_centers:
            self._draw_tree(surface, tree_center, scale)

    def _draw_roads(self, surface: pygame.Surface, intersection_type: str, center: Tuple[int, int], scale: float) -> None:
        """Draw overhead road surfaces and dividers."""

        cx, cy = center
        road = self.ROAD_WIDTH * scale
        layout = get_layout(intersection_type)
        if "vertical_full" in layout.road_shapes:
            pygame.draw.rect(surface, colors.ROAD, pygame.Rect(cx - road / 2, 0, road, self.WINDOW_SIZE[1]))
        if "vertical_top" in layout.road_shapes:
            pygame.draw.rect(surface, colors.ROAD, pygame.Rect(cx - road / 2, 0, road, cy + road / 2))
        if "horizontal_full" in layout.road_shapes:
            pygame.draw.rect(surface, colors.ROAD, pygame.Rect(0, cy - road / 2, self.CANVAS_WIDTH, road))

        self._draw_road_texture(surface, intersection_type, center, scale)
        self._draw_lane_divider(surface, intersection_type, center, scale)
        self._draw_road_edges(surface, intersection_type, center, scale)

    def _draw_road_texture(self, surface: pygame.Surface, intersection_type: str, center: Tuple[int, int], scale: float) -> None:
        """Draw faint tarmac texture lines."""

        texture = pygame.Surface((self.CANVAS_WIDTH, self.WINDOW_SIZE[1]), pygame.SRCALPHA)
        color = (*colors.ROAD_TEXTURE, 50)
        spacing = int(60 * scale)
        layout = get_layout(intersection_type)
        if any(shape.startswith("vertical") for shape in layout.road_shapes):
            x0 = int(center[0] - self.ROAD_WIDTH * scale / 2)
            x1 = int(center[0] + self.ROAD_WIDTH * scale / 2)
            y_limit = self.WINDOW_SIZE[1] if "vertical_full" in layout.road_shapes else int(center[1] + self.ROAD_WIDTH * scale / 2)
            for y in range(0, y_limit, spacing):
                pygame.draw.line(texture, color, (x0, y), (x1, y), 1)
        if "horizontal_full" in layout.road_shapes:
            y0 = int(center[1] - self.ROAD_WIDTH * scale / 2)
            y1 = int(center[1] + self.ROAD_WIDTH * scale / 2)
            for x in range(0, self.CANVAS_WIDTH, spacing):
                pygame.draw.line(texture, color, (x, y0), (x, y1), 1)
        surface.blit(texture, (0, 0))

    def _draw_lane_divider(self, surface: pygame.Surface, intersection_type: str, center: Tuple[int, int], scale: float) -> None:
        """Draw dashed yellow center dividers."""

        divider = pygame.Surface((self.CANVAS_WIDTH, self.WINDOW_SIZE[1]), pygame.SRCALPHA)
        color = (*colors.ROAD_DASH_YELLOW, 178)
        dash = int(14 * scale)
        gap = int(10 * scale)
        cx, cy = center
        layout = get_layout(intersection_type)
        if any(shape.startswith("vertical") for shape in layout.road_shapes):
            y_limit = self.WINDOW_SIZE[1] if "vertical_full" in layout.road_shapes else int(cy + self.ROAD_WIDTH * scale / 2)
            for y in range(0, y_limit, dash + gap):
                pygame.draw.line(divider, color, (cx, y), (cx, min(y_limit, y + dash)), 2)
        if "horizontal_full" in layout.road_shapes:
            for x in range(0, self.CANVAS_WIDTH, dash + gap):
                pygame.draw.line(divider, color, (x, cy), (min(self.CANVAS_WIDTH, x + dash), cy), 2)
        surface.blit(divider, (0, 0))

    def _draw_road_edges(self, surface: pygame.Surface, intersection_type: str, center: Tuple[int, int], scale: float) -> None:
        """Draw solid white road boundary lines."""

        cx, cy = center
        road = self.ROAD_WIDTH * scale
        layout = get_layout(intersection_type)
        if "vertical_full" in layout.road_shapes:
            pygame.draw.line(surface, colors.ROAD_EDGE, (cx - road / 2, 0), (cx - road / 2, self.WINDOW_SIZE[1]), 1)
            pygame.draw.line(surface, colors.ROAD_EDGE, (cx + road / 2, 0), (cx + road / 2, self.WINDOW_SIZE[1]), 1)
        elif "vertical_top" in layout.road_shapes:
            pygame.draw.line(surface, colors.ROAD_EDGE, (cx - road / 2, 0), (cx - road / 2, cy + road / 2), 1)
            pygame.draw.line(surface, colors.ROAD_EDGE, (cx + road / 2, 0), (cx + road / 2, cy + road / 2), 1)
        if "horizontal_full" in layout.road_shapes:
            pygame.draw.line(surface, colors.ROAD_EDGE, (0, cy - road / 2), (self.CANVAS_WIDTH, cy - road / 2), 1)
            pygame.draw.line(surface, colors.ROAD_EDGE, (0, cy + road / 2), (self.CANVAS_WIDTH, cy + road / 2), 1)

    def _draw_intersection_markings(
        self,
        surface: pygame.Surface,
        intersection_type: str,
        center: Tuple[int, int],
        scale: float,
    ) -> None:
        """Draw subtle intersection box details and center manhole."""

        cx, cy = center
        half = self._junction_half(intersection_type) * scale
        marker = pygame.Surface((self.CANVAS_WIDTH, self.WINDOW_SIZE[1]), pygame.SRCALPHA)
        mark_color = (*colors.WHITE, 70)
        corner = int(18 * scale)
        if intersection_type == "4way":
            pygame.draw.line(marker, mark_color, (cx - half, cy - half + corner), (cx - half, cy - half), 2)
            pygame.draw.line(marker, mark_color, (cx - half, cy - half), (cx - half + corner, cy - half), 2)
            pygame.draw.line(marker, mark_color, (cx + half, cy - half + corner), (cx + half, cy - half), 2)
            pygame.draw.line(marker, mark_color, (cx + half, cy - half), (cx + half - corner, cy - half), 2)
            pygame.draw.line(marker, mark_color, (cx - half, cy + half - corner), (cx - half, cy + half), 2)
            pygame.draw.line(marker, mark_color, (cx - half, cy + half), (cx - half + corner, cy + half), 2)
            pygame.draw.line(marker, mark_color, (cx + half, cy + half - corner), (cx + half, cy + half), 2)
            pygame.draw.line(marker, mark_color, (cx + half, cy + half), (cx + half - corner, cy + half), 2)
        elif intersection_type == "3way":
            pygame.draw.line(marker, mark_color, (cx - half, cy - half + corner), (cx - half, cy - half), 2)
            pygame.draw.line(marker, mark_color, (cx - half, cy - half), (cx - half + corner, cy - half), 2)
            pygame.draw.line(marker, mark_color, (cx + half, cy - half + corner), (cx + half, cy - half), 2)
            pygame.draw.line(marker, mark_color, (cx + half, cy - half), (cx + half - corner, cy - half), 2)
        surface.blit(marker, (0, 0))
        pygame.draw.circle(surface, colors.LIGHT_OFF, (int(cx), int(cy)), max(4, int(8 * scale)))

    def _draw_stop_line(
        self,
        surface: pygame.Surface,
        intersection_type: str,
        lane_id: str,
        center: Tuple[int, int],
        scale: float,
    ) -> None:
        """Draw a stop line before the intersection."""

        rect = self._stop_line_rect(intersection_type, lane_id, center, scale)
        pygame.draw.rect(surface, colors.WHITE, rect)

    def _draw_crosswalk(
        self,
        surface: pygame.Surface,
        intersection_type: str,
        lane_id: str,
        center: Tuple[int, int],
        scale: float,
    ) -> None:
        """Draw zebra stripes at the lane mouth."""

        cx, cy = center
        half = self._junction_half(intersection_type) * scale
        stripe_width = int(40 * scale)
        stripe_height = int(10 * scale)
        gap = int(6 * scale)
        for idx in range(6):
            offset = idx * (stripe_height + gap)
            if lane_id == "north":
                rect = pygame.Rect(cx - 20 * scale, cy - half - offset - stripe_height, 40 * scale, stripe_height)
            elif lane_id == "south":
                rect = pygame.Rect(cx - 20 * scale, cy + half + offset, 40 * scale, stripe_height)
            elif lane_id == "east":
                rect = pygame.Rect(cx + half + offset, cy - 20 * scale, stripe_height, 40 * scale)
            else:
                rect = pygame.Rect(cx - half - offset - stripe_height, cy - 20 * scale, stripe_height, 40 * scale)
            worn = pygame.Surface((int(rect.width), int(rect.height)), pygame.SRCALPHA)
            worn.fill((*colors.WHITE, 216))
            surface.blit(worn, rect.topleft)

    def _draw_lane_arrow(self, surface: pygame.Surface, lane_id: str, center: Tuple[int, int], scale: float) -> None:
        """Draw a faint road arrow showing lane direction."""

        overlay = pygame.Surface((self.CANVAS_WIDTH, self.WINDOW_SIZE[1]), pygame.SRCALPHA)
        color = (*colors.WHITE, 128)
        x, y = self._arrow_center(lane_id, center, scale)
        if lane_id == "north":
            points = [(x, y - 12 * scale), (x - 6 * scale, y), (x - 2 * scale, y), (x - 2 * scale, y + 14 * scale), (x + 2 * scale, y + 14 * scale), (x + 2 * scale, y), (x + 6 * scale, y)]
        elif lane_id == "south":
            points = [(x, y + 12 * scale), (x - 6 * scale, y), (x - 2 * scale, y), (x - 2 * scale, y - 14 * scale), (x + 2 * scale, y - 14 * scale), (x + 2 * scale, y), (x + 6 * scale, y)]
        elif lane_id == "east":
            points = [(x + 12 * scale, y), (x, y - 6 * scale), (x, y - 2 * scale), (x - 14 * scale, y - 2 * scale), (x - 14 * scale, y + 2 * scale), (x, y + 2 * scale), (x, y + 6 * scale)]
        else:
            points = [(x - 12 * scale, y), (x, y - 6 * scale), (x, y - 2 * scale), (x + 14 * scale, y - 2 * scale), (x + 14 * scale, y + 2 * scale), (x, y + 2 * scale), (x, y + 6 * scale)]
        pygame.draw.polygon(overlay, color, points)
        surface.blit(overlay, (0, 0))

    def _draw_signal(
        self,
        surface: pygame.Surface,
        intersection: Intersection,
        lane: Lane,
        center: Tuple[int, int],
        scale: float,
    ) -> None:
        """Draw pole-mounted traffic lights at the corner."""

        pole_start, pole_end, housing = self._signal_geometry(intersection.type, lane.id, center, scale)
        pygame.draw.line(surface, (85, 85, 85), pole_start, pole_end, 3)
        pygame.draw.rect(surface, (26, 26, 26), housing, border_radius=4)

        lane_stage = intersection.lane_signal_states.get(lane.id, SignalStage.ALL_RED)

        radius = max(4, int(6 * scale))
        centers = self._signal_centers(housing, radius)
        for idx, center_point in enumerate(centers):
            color = (42, 42, 42)
            if lane_stage == SignalStage.ALL_RED and idx == 0:
                color = (255, 59, 48)
            elif lane_stage == SignalStage.AMBER and idx == 1:
                color = (255, 149, 0)
            elif lane_stage == SignalStage.GREEN and idx == 2:
                color = (52, 199, 89)
            if color != (42, 42, 42):
                halo = pygame.Surface((radius * 6, radius * 6), pygame.SRCALPHA)
                pygame.draw.circle(halo, (*color, 70), (radius * 3, radius * 3), radius + 4)
                surface.blit(halo, (center_point[0] - radius * 3, center_point[1] - radius * 3))
            pygame.draw.circle(surface, color, center_point, radius)

    def _draw_lane_vehicles(
        self,
        surface: pygame.Surface,
        intersection_type: str,
        lane: Lane,
        center: Tuple[int, int],
        scale: float,
        font: pygame.font.Font,
        debug_mode: bool,
    ) -> None:
        """Draw queued and departing vehicles."""

        visible = sorted(
            lane.vehicles,
            key=lambda vehicle: self._distance_to_stop_line(intersection_type, lane.id, vehicle),
        )[: self.MAX_VISIBLE_CARS]
        for vehicle in visible:
            self._draw_vehicle(surface, lane, vehicle, center, scale)
            if debug_mode:
                self._draw_vehicle_debug(surface, vehicle, center, font)

        overflow = max(0, len(lane.vehicles) - len(visible))
        if overflow > 0:
            x, y = self._overflow_position(intersection_type, lane.id, center, scale)
            label = font.render(f"+{overflow} more", True, colors.TEXT)
            fade = pygame.Surface((label.get_width(), label.get_height()), pygame.SRCALPHA)
            fade.blit(label, (0, 0))
            fade.set_alpha(178)
            surface.blit(fade, (x, y))

    def _draw_vehicle(
        self,
        surface: pygame.Surface,
        lane: Lane,
        vehicle: Vehicle,
        center: Tuple[int, int],
        scale: float,
    ) -> None:
        """Draw one top-down car silhouette."""

        sprite = self._vehicle_sprite(vehicle, scale)
        x, y = self._vehicle_position(vehicle, center)
        rotation = self._rotation_for_direction(vehicle.heading)
        rotated = pygame.transform.rotate(sprite, rotation)
        rect = rotated.get_rect(center=(int(x), int(y)))
        surface.blit(rotated, rect)

    def _draw_vehicle_debug(
        self,
        surface: pygame.Surface,
        vehicle: Vehicle,
        center: Tuple[int, int],
        font: pygame.font.Font,
    ) -> None:
        """Draw a compact per-vehicle debug label."""

        x, y = self._vehicle_position(vehicle, center)
        wait = vehicle.wait_reason or vehicle.state.value
        emergency = f" {vehicle.emergency_type.value[:4]}" if vehicle.is_emergency and vehicle.emergency_type else ""
        label = f"{vehicle.assigned_lane_id}:{vehicle.intent.value[0].upper()} q{vehicle.index} {wait[:6]}{emergency}"
        text = font.render(label, True, colors.DEBUG)
        shadow = font.render(label, True, colors.BLACK)
        surface.blit(shadow, (x + 7, y - 16))
        surface.blit(text, (x + 6, y - 17))

    def _vehicle_sprite(self, vehicle: Vehicle, scale: float) -> pygame.Surface:
        """Create a realistic top-down car sprite."""

        if vehicle.is_emergency:
            if getattr(vehicle.emergency_type, "value", "") == "fire_truck":
                width = max(22, int(34 * scale))
            elif getattr(vehicle.emergency_type, "value", "") == "ambulance":
                width = max(20, int(30 * scale))
            else:
                width = max(18, int(28 * scale))
            height = max(10, int(14 * scale))
        else:
            width = max(16, int(26 * scale))
            height = max(10, int(14 * scale))

        sprite = pygame.Surface((width, height), pygame.SRCALPHA)
        if vehicle.is_emergency and getattr(vehicle.emergency_type, "value", "") == "ambulance":
            body_color = (245, 245, 245)
        elif vehicle.is_emergency and getattr(vehicle.emergency_type, "value", "") == "police":
            body_color = (42, 55, 78)
        elif vehicle.is_emergency and getattr(vehicle.emergency_type, "value", "") == "fire_truck":
            body_color = (181, 35, 30)
        else:
            body_color = vehicle.color
        roof_color = tuple(max(0, int(channel * 0.7)) for channel in body_color)
        pygame.draw.rect(sprite, body_color, (0, 0, width, height), border_radius=4)
        pygame.draw.rect(sprite, roof_color, (width // 2 - 8, height // 2 - 5, 16, 10), border_radius=3)
        pygame.draw.rect(sprite, (170, 170, 170), (width - 9, height // 2 - 4, 8, 9), border_radius=2)
        pygame.draw.rect(sprite, (170, 170, 170), (1, height // 2 - 4, 6, 8), border_radius=2)

        if vehicle.is_emergency:
            if getattr(vehicle.emergency_type, "value", "") == "ambulance":
                pygame.draw.rect(sprite, colors.EMERGENCY_STRIPE, (width // 2 - 1, 2, 2, height - 4))
                pygame.draw.rect(sprite, colors.EMERGENCY_STRIPE, (width // 2 - 5, height // 2 - 1, 10, 2))
            elif getattr(vehicle.emergency_type, "value", "") == "police":
                pygame.draw.rect(sprite, (245, 245, 245), (width // 3, 0, width // 4, height), border_radius=3)
            else:
                pygame.draw.rect(sprite, (245, 245, 245), (2, 2, width - 4, 3), border_radius=2)
            left = colors.EMERGENCY_STRIPE if int(self.flash_elapsed / 0.3) % 2 == 0 else colors.EMERGENCY_BLUE
            right = colors.EMERGENCY_BLUE if int(self.flash_elapsed / 0.3) % 2 == 0 else colors.EMERGENCY_STRIPE
            pygame.draw.circle(sprite, left, (4, 3), 2)
            pygame.draw.circle(sprite, right, (width - 4, 3), 2)
            return sprite

        if vehicle.intent == TurnIntent.TURN_LEFT:
            self._draw_turn_signal(sprite, width, height, left=True)
        elif vehicle.intent == TurnIntent.TURN_RIGHT:
            self._draw_turn_signal(sprite, width, height, left=False)
        return sprite

    def _draw_turn_signal(self, sprite: pygame.Surface, width: int, height: int, left: bool) -> None:
        """Draw blinking turn indicators on the car corners."""

        if int(self.flash_elapsed / 0.5) % 2 != 0:
            return
        x = 2 if left else width - 5
        pygame.draw.rect(sprite, colors.SIGNAL_AMBER, (x, 2, 3, 4), border_radius=1)
        pygame.draw.rect(sprite, colors.SIGNAL_AMBER, (x, height - 6, 3, 4), border_radius=1)

    def _draw_pedestrians(
        self,
        surface: pygame.Surface,
        intersection: Intersection,
        center: Tuple[int, int],
        scale: float,
        debug_mode: bool,
        font: pygame.font.Font,
    ) -> None:
        """Draw top-down pedestrian silhouettes."""

        for pedestrian in intersection.pedestrians:
            x, y = self._pedestrian_position(pedestrian, center, scale)
            sprite = self._pedestrian_sprite(pedestrian, scale)
            rotated = pygame.transform.rotate(sprite, -pedestrian.heading)
            rect = rotated.get_rect(center=(int(x), int(y)))
            surface.blit(rotated, rect)
            if debug_mode:
                label = f"{pedestrian.id[-4:]} {pedestrian.state.value[:10]} {pedestrian.crossing_id}"
                text = font.render(label, True, colors.DEBUG)
                shadow = font.render(label, True, colors.BLACK)
                surface.blit(shadow, (x + 5, y - 15))
                surface.blit(text, (x + 4, y - 16))

    def _pedestrian_sprite(self, pedestrian: Pedestrian, scale: float) -> pygame.Surface:
        """Create a compact top-down human silhouette."""

        width = max(10, int(10 * scale))
        height = max(16, int(16 * scale))
        sprite = pygame.Surface((width, height), pygame.SRCALPHA)
        sway = math.sin(self.flash_elapsed * 4.0 + pedestrian.sway_phase) * (
            1.0 if pedestrian.state in {PedestrianState.CROSSING, PedestrianState.FINISHING_CROSS, PedestrianState.WALKING_AWAY} else 0.35
        )
        shadow = pygame.Surface((width + 4, height // 2), pygame.SRCALPHA)
        pygame.draw.ellipse(shadow, (0, 0, 0, 70), (0, 0, width + 2, max(4, height // 3)))
        sprite.blit(shadow, (-1, height // 2))
        body_rect = pygame.Rect(width // 2 - 3 + int(sway), height // 2 - 1, 6, 8)
        pygame.draw.ellipse(sprite, pedestrian.clothing_color, body_rect)
        pygame.draw.circle(sprite, pedestrian.color, (width // 2, max(4, height // 2 - 3)), max(3, int(4 * scale)))
        return sprite

    def _vehicle_position(
        self,
        vehicle: Vehicle,
        center: Tuple[int, int],
    ) -> Tuple[float, float]:
        """Map a vehicle's world coordinates into the active canvas center."""

        dx = center[0] - self.CENTER[0]
        dy = center[1] - self.CENTER[1]
        return vehicle.x + dx, vehicle.y + dy

    def _pedestrian_position(self, pedestrian: Pedestrian, center: Tuple[int, int], scale: float) -> Tuple[float, float]:
        """Map a pedestrian's progress into world coordinates."""

        dx = center[0] - 400
        dy = center[1] - 360
        if pedestrian.state in {
            PedestrianState.SPAWNING,
            PedestrianState.WALKING_TO_CURB,
            PedestrianState.WAITING_AT_CURB,
        }:
            return pedestrian.x + dx, pedestrian.y + dy
        return pedestrian.x + dx, pedestrian.y + dy

    def _distance_to_stop_line(self, intersection_type: str, lane_id: str, vehicle: Vehicle) -> float:
        """Return scalar distance from a vehicle to its stop line for draw ordering."""

        stop_line = self._stop_line_axis(intersection_type, lane_id)
        if lane_id in {"north", "south"}:
            return abs(stop_line - vehicle.y)
        return abs(stop_line - vehicle.x)

    def _stop_line_axis(self, intersection_type: str, lane_id: str) -> float:
        """Return the world-axis stop line coordinate for a lane."""

        half = self._junction_half(intersection_type)
        if lane_id == "north":
            return self.CENTER[1] - half
        if lane_id == "south":
            return self.CENTER[1] + half
        if lane_id == "east":
            return self.CENTER[0] + half
        return self.CENTER[0] - half

    def _signal_geometry(
        self,
        intersection_type: str,
        lane_id: str,
        center: Tuple[int, int],
        scale: float,
    ) -> Tuple[Tuple[int, int], Tuple[int, int], pygame.Rect]:
        """Return pole and housing geometry for one signal."""

        cx, cy = center
        half = self._junction_half(intersection_type) * scale
        housing_size = (16 * scale, 52 * scale)
        if lane_id == "north":
            pole_end = (int(cx + 54 * scale), int(cy - half - 8 * scale))
            pole_start = (pole_end[0], pole_end[1] + int(40 * scale))
        elif lane_id == "south":
            pole_end = (int(cx - 54 * scale), int(cy + half + 8 * scale))
            pole_start = (pole_end[0], pole_end[1] - int(40 * scale))
        elif lane_id == "east":
            pole_end = (int(cx + half + 8 * scale), int(cy + 54 * scale))
            pole_start = (pole_end[0] - int(40 * scale), pole_end[1])
        else:
            pole_end = (int(cx - half - 8 * scale), int(cy - 54 * scale))
            pole_start = (pole_end[0] + int(40 * scale), pole_end[1])
        housing = pygame.Rect(
            int(pole_end[0] - housing_size[0] / 2),
            int(pole_end[1] - housing_size[1] / 2),
            int(housing_size[0]),
            int(housing_size[1]),
        )
        return pole_start, pole_end, housing

    def _signal_centers(self, housing: pygame.Rect, radius: int) -> Tuple[Tuple[int, int], Tuple[int, int], Tuple[int, int]]:
        """Return the lamp centers inside a signal housing."""

        center_x = housing.centerx
        return (
            (center_x, housing.y + radius + 6),
            (center_x, housing.y + housing.height // 2),
            (center_x, housing.bottom - radius - 6),
        )

    def _stop_line_rect(
        self,
        intersection_type: str,
        lane_id: str,
        center: Tuple[int, int],
        scale: float,
    ) -> pygame.Rect:
        """Return stop line geometry."""

        cx, cy = center
        road = self.ROAD_WIDTH * scale
        half = self._junction_half(intersection_type) * scale
        thickness = max(2, int(3 * scale))
        if lane_id == "north":
            return pygame.Rect(cx - road / 2, cy - half, road, thickness)
        if lane_id == "south":
            return pygame.Rect(cx - road / 2, cy + half - thickness, road, thickness)
        if lane_id == "east":
            return pygame.Rect(cx + half - thickness, cy - road / 2, thickness, road)
        return pygame.Rect(cx - half, cy - road / 2, thickness, road)

    def _arrow_center(self, lane_id: str, center: Tuple[int, int], scale: float) -> Tuple[float, float]:
        """Return the painted road-arrow position."""

        cx, cy = center
        offset = 55 * scale
        lane_center_offset = self.ROAD_WIDTH * scale / 4
        if lane_id == "north":
            return cx + lane_center_offset, cy - offset
        if lane_id == "south":
            return cx - lane_center_offset, cy + offset
        if lane_id == "east":
            return cx + offset, cy + lane_center_offset
        return cx - offset, cy - lane_center_offset

    def _overflow_position(
        self,
        intersection_type: str,
        lane_id: str,
        center: Tuple[int, int],
        scale: float,
    ) -> Tuple[int, int]:
        """Return where overflow text should be drawn."""

        cx, cy = center
        half = self._junction_half(intersection_type) * scale
        if lane_id == "north":
            stop_line_y = cy - half - 2
            sub_lane_center_x = cx + 20 * scale
            last_car_y = stop_line_y - (self.MAX_VISIBLE_CARS * 26 * scale)
            return int(sub_lane_center_x), int(last_car_y - 14 * scale)
        if lane_id == "south":
            stop_line_y = cy + half + 2
            sub_lane_center_x = cx - 20 * scale
            last_car_y = stop_line_y + (self.MAX_VISIBLE_CARS * 26 * scale)
            return int(sub_lane_center_x), int(last_car_y + 14 * scale)
        if lane_id == "east":
            stop_line_x = cx + half + 2
            sub_lane_center_y = cy + 20 * scale
            last_car_x = stop_line_x + (self.MAX_VISIBLE_CARS * 26 * scale)
            return int(last_car_x + 14 * scale), int(sub_lane_center_y)
        stop_line_x = cx - half - 2
        sub_lane_center_y = cy - 20 * scale
        last_car_x = stop_line_x - (self.MAX_VISIBLE_CARS * 26 * scale)
        return int(last_car_x - 40 * scale), int(sub_lane_center_y)

    def _draw_camera_overlay(self, surface: pygame.Surface, tick: int, font: pygame.font.Font, mini: bool) -> None:
        """Draw a small camera-rec overlay."""

        if mini:
            return
        overlay = font.render(f"CAM-01  ● REC  {tick}", True, colors.WHITE)
        fade = pygame.Surface((overlay.get_width(), overlay.get_height()), pygame.SRCALPHA)
        fade.blit(overlay, (0, 0))
        fade.set_alpha(128)
        surface.blit(fade, (12, 10))

    def _draw_vignette(self, surface: pygame.Surface) -> None:
        """Draw a faint vignette around the canvas edges."""

        vignette = pygame.Surface((self.CANVAS_WIDTH, self.WINDOW_SIZE[1]), pygame.SRCALPHA)
        border_color = (0, 0, 0, 25)
        pygame.draw.rect(vignette, border_color, vignette.get_rect(), width=28)
        surface.blit(vignette, (0, 0))

    def _draw_tree(self, surface: pygame.Surface, center: Tuple[float, float], scale: float) -> None:
        """Draw a top-down tree canopy with shadow and highlight."""

        x, y = center
        shadow = pygame.Surface((40, 26), pygame.SRCALPHA)
        pygame.draw.ellipse(shadow, (26, 58, 8, 102), (0, 0, int(28 * scale), int(18 * scale)))
        surface.blit(shadow, (x - 10 * scale + 4, y - 8 * scale + 4))
        pygame.draw.circle(surface, (45, 106, 10), (int(x), int(y)), max(8, int(16 * scale)))
        pygame.draw.circle(surface, (61, 138, 10), (int(x - 3 * scale), int(y - 3 * scale)), max(5, int(10 * scale)))

    def _draw_debug(
        self,
        surface: pygame.Surface,
        lane: Lane,
        center: Tuple[int, int],
        font: pygame.font.Font,
        scale: float,
    ) -> None:
        """Draw debug labels when explicitly enabled."""

        cx, cy = center
        positions: Dict[str, Tuple[float, float]] = {
            "north": (cx - 64 * scale, cy - 170 * scale),
            "south": (cx - 64 * scale, cy + 154 * scale),
            "east": (cx + 106 * scale, cy - 20 * scale),
            "west": (cx - 174 * scale, cy - 20 * scale),
        }
        label = font.render(f"{lane.id}:{lane.score:.2f}", True, colors.DEBUG)
        surface.blit(label, positions.get(lane.id, center))

    def _rotation_for_direction(self, direction: float) -> float:
        """Map model direction degrees (0=N, 90=E, 180=S, 270=W) to pygame rotation."""

        return 90.0 - direction

    def _junction_half(self, intersection_type: str) -> float:
        """Return the half-size of the active junction core."""

        return get_layout(intersection_type).junction_half
