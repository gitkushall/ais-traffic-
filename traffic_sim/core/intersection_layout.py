"""Shared physical layout definitions for each intersection type."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class LaneDefinition:
    """Physical and legal definition for a single approach lane."""

    lane_id: str
    approach: str
    lane_group: str
    allowed_movements: Tuple[str, ...]
    sub_lane_center: float
    queue_stop_offset: float = 0.0


@dataclass(frozen=True)
class IntersectionLayout:
    """Physical map configuration for one supported intersection type."""

    intersection_type: str
    active_approaches: Tuple[str, ...]
    road_shapes: Tuple[str, ...]
    pedestrian_crossings: Tuple[str, ...]
    signal_groups: Tuple[Tuple[str, ...], ...]
    movement_phases: Tuple[Tuple[str, ...], ...]
    lane_definitions: Tuple[LaneDefinition, ...]
    junction_half: float
    missing_arms: Tuple[str, ...] = ()


LAYOUTS: Dict[str, IntersectionLayout] = {
    "2way": IntersectionLayout(
        intersection_type="2way",
        active_approaches=("north", "south"),
        road_shapes=("vertical_full",),
        pedestrian_crossings=("north", "south"),
        signal_groups=(("north", "south"),),
        movement_phases=(("north_through", "south_through"),),
        lane_definitions=(
            LaneDefinition("north_through", "north", "through", ("south",), 20.0),
            LaneDefinition("south_through", "south", "through", ("north",), -20.0),
        ),
        junction_half=42.0,
        missing_arms=("east", "west"),
    ),
    "3way": IntersectionLayout(
        intersection_type="3way",
        active_approaches=("north", "east", "west"),
        road_shapes=("vertical_top", "horizontal_full"),
        pedestrian_crossings=("north", "east", "west"),
        signal_groups=(("north",), ("east", "west")),
        movement_phases=(
            ("north_left", "north_right"),
            ("east_through", "west_through"),
            ("east_right", "west_left"),
        ),
        lane_definitions=(
            LaneDefinition("north_left", "north", "left", ("east",), 10.0),
            LaneDefinition("north_right", "north", "right", ("west",), 30.0),
            LaneDefinition("east_through", "east", "through", ("west",), 20.0),
            LaneDefinition("east_right", "east", "right", ("north",), 30.0),
            LaneDefinition("west_through", "west", "through", ("east",), -20.0),
            LaneDefinition("west_left", "west", "left", ("north",), -10.0),
        ),
        junction_half=105.0,
        missing_arms=("south",),
    ),
    "4way": IntersectionLayout(
        intersection_type="4way",
        active_approaches=("north", "south", "east", "west"),
        road_shapes=("vertical_full", "horizontal_full"),
        pedestrian_crossings=("north", "south", "east", "west"),
        signal_groups=(("north", "south"), ("east", "west")),
        movement_phases=(
            ("north_through", "south_through", "north_right", "south_right"),
            ("east_through", "west_through", "east_right", "west_right"),
            ("north_left", "south_left"),
            ("east_left", "west_left"),
        ),
        lane_definitions=(
            LaneDefinition("north_left", "north", "left", ("east",), 10.0),
            LaneDefinition("north_through", "north", "through", ("south",), 20.0),
            LaneDefinition("north_right", "north", "right", ("west",), 30.0),
            LaneDefinition("south_left", "south", "left", ("west",), -10.0),
            LaneDefinition("south_through", "south", "through", ("north",), -20.0),
            LaneDefinition("south_right", "south", "right", ("east",), -30.0),
            LaneDefinition("east_left", "east", "left", ("south",), 10.0),
            LaneDefinition("east_through", "east", "through", ("west",), 20.0),
            LaneDefinition("east_right", "east", "right", ("north",), 30.0),
            LaneDefinition("west_left", "west", "left", ("north",), -10.0),
            LaneDefinition("west_through", "west", "through", ("east",), -20.0),
            LaneDefinition("west_right", "west", "right", ("south",), -30.0),
        ),
        junction_half=105.0,
    ),
}


def get_layout(intersection_type: str) -> IntersectionLayout:
    """Return the physical layout definition for an intersection type."""

    if intersection_type not in LAYOUTS:
        raise ValueError(f"Unsupported intersection type: {intersection_type}")
    return LAYOUTS[intersection_type]


def movement_token(approach: str, lane_group: str) -> str:
    """Return a stable movement token for one approach and lane group."""

    return f"{approach}_{lane_group}"


def lane_definition(intersection_type: str, approach: str, lane_group: str) -> LaneDefinition:
    """Return the lane definition for one approach/lane group pair."""

    layout = get_layout(intersection_type)
    target = movement_token(approach, lane_group)
    for definition in layout.lane_definitions:
        if definition.lane_id == target:
            return definition
    raise ValueError(f"Unsupported lane definition for {intersection_type}:{target}")
