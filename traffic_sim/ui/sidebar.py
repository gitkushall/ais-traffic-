"""Sidebar UI widgets, controls, and analytics rendering."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import pygame

from traffic_sim.ai.scoring_engine import WeightProfile
from traffic_sim.ui.view_models import LaneScoreView, SidebarViewModel, TextLine
from traffic_sim.ui import colors


@dataclass
class Button:
    """Simple rectangular button."""

    key: str
    label: str
    rect: pygame.Rect


@dataclass
class Slider:
    """Horizontal slider control."""

    key: str
    label: str
    rect: pygame.Rect
    value: float


class Sidebar:
    """Renders the sidebar and maps user interactions to actions."""

    def __init__(self) -> None:
        self.area = pygame.Rect(800, 0, 480, 720)
        self.buttons: Dict[str, Button] = {}
        self.speed_buttons: Dict[str, Button] = {}
        self.sliders: Dict[str, Slider] = {}
        self.dragging_slider: Optional[str] = None
        self.animated_scores: Dict[str, float] = {}
        self.layout_rects: Dict[str, pygame.Rect] = {}
        self._init_controls()

    def _init_controls(self) -> None:
        """Create control entries before dynamic layout assigns rectangles."""

        for key, label in {
            "type_2way": "2-Way",
            "type_3way": "T-Junction",
            "type_4way": "4-Way",
            "play": "Play",
            "pause": "Pause",
            "reset": "Reset",
            "force_emergency": "Force Emergency",
            "debug": "Debug Mode",
            "cycle_weather": "Weather",
            "trigger_incident": "Incident",
            "clear_incidents": "Clear",
            "auto_environment": "Auto Env",
        }.items():
            self.buttons[key] = Button(key, label, pygame.Rect(0, 0, 0, 0))
        for key, label in {"speed_1": "x1", "speed_2": "x2", "speed_4": "x4"}.items():
            self.speed_buttons[key] = Button(key, label, pygame.Rect(0, 0, 0, 0))
        self.sliders["density"] = Slider("density", "Density Weight", pygame.Rect(0, 0, 0, 0), 0.5)
        self.sliders["wait"] = Slider("wait", "Wait Weight", pygame.Rect(0, 0, 0, 0), 0.3)
        self.sliders["pedestrian"] = Slider("pedestrian", "Pedestrian Weight", pygame.Rect(0, 0, 0, 0), 0.2)

    def draw(
        self,
        surface: pygame.Surface,
        view_model: SidebarViewModel,
        font: pygame.font.Font,
        small_font: pygame.font.Font,
    ) -> None:
        """Render the full sidebar."""

        for slider_key, value in {
            "density": view_model.weights.density if view_model.weights else 0.5,
            "wait": view_model.weights.wait if view_model.weights else 0.3,
            "pedestrian": view_model.weights.pedestrian if view_model.weights else 0.2,
        }.items():
            self.sliders[slider_key].value = value

        self.layout_rects = self._compute_layout(view_model.debug_mode)
        self._position_controls()
        pygame.draw.rect(surface, colors.SIDEBAR_BG, self.area)
        self._draw_card(surface, self.layout_rects["selector"], "Intersection Selector", font)
        self._draw_selector_buttons(surface, view_model.selector_key, small_font)

        self._draw_card(surface, self.layout_rects["lane_scores"], "Lane Scores", font)
        self._draw_lane_scores(surface, self.layout_rects["lane_scores"], view_model.lane_scores, small_font)

        self._draw_card(surface, self.layout_rects["active_phase"], "Active Phase", font)
        self._draw_text_section(surface, self.layout_rects["active_phase"], view_model.phase_lines, small_font)

        self._draw_card(surface, self.layout_rects["analytics"], "Analytics", font)
        self._draw_chart(surface, self.layout_rects["analytics"], view_model.chart_history)
        self._draw_text_section(surface, self.layout_rects["analytics"], view_model.analytics_lines, small_font, top_offset=54)

        self._draw_card(surface, self.layout_rects["environment"], "Environment", font)
        self._draw_text_section(surface, self.layout_rects["environment"], view_model.environment_lines, small_font)
        self._draw_environment_buttons(surface, small_font)

        if view_model.debug_mode:
            self._draw_card(surface, self.layout_rects["debug"], "Debug Info", font)
            self._draw_text_section(surface, self.layout_rects["debug"], view_model.debug_lines, small_font)

        self._draw_card(surface, self.layout_rects["controls"], "Controls", font)
        self._draw_controls(surface, view_model.paused, view_model.debug_mode, view_model.simulation_speed, small_font)

    def _compute_layout(self, debug_mode: bool) -> Dict[str, pygame.Rect]:
        """Return stable sidebar card rectangles."""

        margin = 10
        gap = 6
        x = self.area.x + margin
        width = self.area.width - margin * 2
        y = self.area.y + margin
        rects: Dict[str, pygame.Rect] = {}

        def add(name: str, height: int, x_offset: int = 0, w: int | None = None) -> None:
            rects[name] = pygame.Rect(x + x_offset, y, w or width, height)

        add("selector", 66)
        y += 66 + gap
        add("lane_scores", 148)
        y += 148 + gap
        add("active_phase", 78)
        y += 78 + gap
        half = (width - gap) // 2
        rects["analytics"] = pygame.Rect(x, y, half, 132)
        rects["environment"] = pygame.Rect(x + half + gap, y, width - half - gap, 132)
        y += 132 + gap
        if debug_mode:
            add("debug", 92)
            y += 92 + gap
        add("controls", self.area.bottom - margin - y)
        return rects

    def _position_controls(self) -> None:
        """Assign interactive rectangles from the computed card layout."""

        selector = self._content_rect(self.layout_rects["selector"])
        gap = 8
        button_width = (selector.width - gap * 2) // 3
        for index, key in enumerate(["type_2way", "type_3way", "type_4way"]):
            self.buttons[key].rect = pygame.Rect(selector.x + index * (button_width + gap), selector.y + 2, button_width, 30)

        env = self._content_rect(self.layout_rects["environment"])
        env_top = env.bottom - 58
        env_w = (env.width - 8) // 2
        for idx, key in enumerate(["cycle_weather", "trigger_incident", "clear_incidents", "auto_environment"]):
            row = idx // 2
            col = idx % 2
            self.buttons[key].rect = pygame.Rect(env.x + col * (env_w + 8), env_top + row * 32, env_w, 26)

        controls = self._content_rect(self.layout_rects["controls"])
        row_y = controls.y + 2
        control_gap = 8
        wide = (controls.width - control_gap * 2) // 3
        self.buttons["play"].rect = pygame.Rect(controls.x, row_y, wide, 24)
        self.buttons["pause"].rect = pygame.Rect(controls.x + wide + control_gap, row_y, wide, 24)
        self.buttons["reset"].rect = pygame.Rect(controls.x + (wide + control_gap) * 2, row_y, wide, 24)
        row_y += 30
        self.buttons["force_emergency"].rect = pygame.Rect(controls.x, row_y, controls.width // 2 - 4, 24)
        self.buttons["debug"].rect = pygame.Rect(controls.x + controls.width // 2 + 4, row_y, controls.width // 2 - 4, 24)
        row_y += 30
        speed_width = (controls.width - 16) // 4
        for index, key in enumerate(["speed_1", "speed_2", "speed_4"]):
            self.speed_buttons[key].rect = pygame.Rect(controls.x + index * (speed_width + 8), row_y, speed_width, 20)
        row_y += 26
        for index, key in enumerate(["density", "wait", "pedestrian"]):
            self.sliders[key].rect = pygame.Rect(controls.x, row_y + index * 22 + 12, controls.width - 12, 8)

    def _draw_card(self, surface: pygame.Surface, rect: pygame.Rect, title: str, font: pygame.font.Font) -> None:
        """Draw one titled card."""

        pygame.draw.rect(surface, colors.PANEL_BG, rect, border_radius=14)
        pygame.draw.rect(surface, colors.PANEL_BORDER, rect, width=1, border_radius=14)
        title_surface = font.render(title, True, colors.TEXT)
        surface.blit(title_surface, (rect.x + 12, rect.y + 8))

    def _content_rect(self, card_rect: pygame.Rect) -> pygame.Rect:
        """Return the padded content area inside a card."""

        return pygame.Rect(card_rect.x + 12, card_rect.y + 30, card_rect.width - 24, card_rect.height - 38)

    def _draw_text_with_shadow(
        self,
        surface: pygame.Surface,
        text: str,
        font: pygame.font.Font,
        position: Tuple[int, int],
        color: Tuple[int, int, int],
    ) -> None:
        """Draw legible text with a soft shadow."""

        shadow = font.render(text, True, colors.BLACK)
        surface.blit(shadow, (position[0] + 1, position[1] + 1))
        label = font.render(text, True, color)
        surface.blit(label, position)

    def _draw_selector_buttons(self, surface: pygame.Surface, active_key: str, font: pygame.font.Font) -> None:
        """Draw intersection selector buttons."""

        for key in ["type_2way", "type_3way", "type_4way"]:
            self._draw_button(surface, self.buttons[key], font, active=(key == active_key))

    def _draw_lane_scores(
        self,
        surface: pygame.Surface,
        rect: pygame.Rect,
        lane_rows: List[LaneScoreView],
        font: pygame.font.Font,
    ) -> None:
        """Draw lane score rows inside a clipped card."""

        body = self._content_rect(rect)
        previous_clip = surface.get_clip()
        surface.set_clip(body)
        row_height = 24
        for index, row in enumerate(lane_rows):
            y = body.y + index * (row_height + 8)
            if y + row_height > body.bottom:
                break
            self._draw_text_with_shadow(surface, row.title, font, (body.x, y), colors.TEXT)
            summary = self._truncate_text(font, row.summary, body.width - 132)
            self._draw_text_with_shadow(surface, summary, font, (body.x + 72, y), colors.MUTED_TEXT)
            bar_rect = pygame.Rect(body.x, y + 16, min(120, body.width - 120), 8)
            pygame.draw.rect(surface, colors.SLIDER_TRACK, bar_rect, border_radius=4)
            current_width = self.animated_scores.get(row.lane_id, 0.0)
            target_width = max(0.0, min(1.0, row.score)) * bar_rect.width
            current_width += (target_width - current_width) * 0.25
            self.animated_scores[row.lane_id] = current_width
            pygame.draw.rect(
                surface,
                self._score_color(row.score),
                pygame.Rect(bar_rect.x, bar_rect.y, int(current_width), bar_rect.height),
                border_radius=4,
            )
            if row.status:
                status = self._truncate_text(font, row.status, body.width - 132)
                self._draw_text_with_shadow(surface, status, font, (body.x + 132, y + 14), row.status_color)
        surface.set_clip(previous_clip)

    def _draw_chart(self, surface: pygame.Surface, rect: pygame.Rect, history: List[float]) -> None:
        """Draw a compact chart in the analytics card."""

        body = self._content_rect(rect)
        chart = pygame.Rect(body.x, body.y, body.width, 46)
        pygame.draw.rect(surface, (18, 20, 29), chart, border_radius=8)
        for step in range(4):
            y = chart.y + step * (chart.height // 3)
            pygame.draw.line(surface, colors.CHART_GRID, (chart.x, y), (chart.right, y), 1)
        if len(history) >= 2:
            max_wait = max(max(history), 1.0)
            points: List[Tuple[int, int]] = []
            for idx, value in enumerate(history):
                x = chart.x + 4 + int(idx / max(1, len(history) - 1) * (chart.width - 8))
                y = chart.bottom - 4 - int((value / max_wait) * (chart.height - 8))
                points.append((x, y))
            if len(points) >= 2:
                pygame.draw.lines(surface, colors.CHART_LINE, False, points, 2)

    def _draw_text_section(
        self,
        surface: pygame.Surface,
        rect: pygame.Rect,
        lines: List[TextLine],
        font: pygame.font.Font,
        top_offset: int = 0,
    ) -> None:
        """Draw wrapped lines inside one card without overflow."""

        body = self._content_rect(rect)
        body = pygame.Rect(body.x, body.y + top_offset, body.width, max(0, body.height - top_offset))
        previous_clip = surface.get_clip()
        surface.set_clip(body)
        y = body.y
        line_height = font.get_linesize() + 2
        for line in lines:
            wrapped = self._wrap_text(font, line.text, body.width)
            for item in wrapped:
                if y + line_height > body.bottom:
                    surface.set_clip(previous_clip)
                    return
                self._draw_text_with_shadow(surface, item, font, (body.x, y), line.color)
                y += line_height
        surface.set_clip(previous_clip)

    def _draw_environment_buttons(self, surface: pygame.Surface, font: pygame.font.Font) -> None:
        """Draw environment/scenario buttons."""

        for key in ["cycle_weather", "trigger_incident", "clear_incidents", "auto_environment"]:
            self._draw_button(surface, self.buttons[key], font)

    def _draw_controls(
        self,
        surface: pygame.Surface,
        paused: bool,
        debug_mode: bool,
        simulation_speed: int,
        font: pygame.font.Font,
    ) -> None:
        """Draw control buttons and sliders."""

        self._draw_button(surface, self.buttons["play"], font, active=not paused)
        self._draw_button(surface, self.buttons["pause"], font, active=paused)
        self._draw_button(surface, self.buttons["reset"], font)
        self._draw_button(surface, self.buttons["force_emergency"], font)
        self._draw_button(surface, self.buttons["debug"], font, active=debug_mode)
        for key, button in self.speed_buttons.items():
            self._draw_button(surface, button, font, active=(key == f"speed_{simulation_speed}"))
        for slider in self.sliders.values():
            self._draw_slider(surface, slider, font)

    def _draw_button(
        self,
        surface: pygame.Surface,
        button: Button,
        font: pygame.font.Font,
        active: bool = False,
    ) -> None:
        """Draw a single button."""

        color = colors.ACTIVE_BLUE if active else colors.BUTTON_BG
        pygame.draw.rect(surface, color, button.rect, border_radius=10)
        pygame.draw.rect(surface, colors.PANEL_BORDER, button.rect, 1, border_radius=10)
        label = font.render(button.label, True, colors.WHITE)
        surface.blit(label, label.get_rect(center=button.rect.center))

    def _draw_slider(self, surface: pygame.Surface, slider: Slider, font: pygame.font.Font) -> None:
        """Draw a labeled slider."""

        label = font.render(f"{slider.label}: {slider.value:.2f}", True, colors.TEXT)
        surface.blit(label, (slider.rect.x, slider.rect.y - 13))
        pygame.draw.rect(surface, colors.SLIDER_TRACK, slider.rect, border_radius=9)
        knob_x = slider.rect.x + int(slider.value * slider.rect.width)
        pygame.draw.circle(surface, colors.ACTIVE_BLUE, (knob_x, slider.rect.centery), 8)

    def _score_color(self, score: float) -> Tuple[int, int, int]:
        """Return score bar color based on severity."""

        clamped = max(0.0, min(1.0, score))
        if clamped <= 0.5:
            blend = clamped / 0.5
            return self._lerp_color(colors.GREEN, colors.AMBER, blend)
        blend = (clamped - 0.5) / 0.5
        return self._lerp_color(colors.AMBER, colors.RED, blend)

    def _lerp_color(
        self,
        start: Tuple[int, int, int],
        end: Tuple[int, int, int],
        amount: float,
    ) -> Tuple[int, int, int]:
        """Linearly interpolate between two RGB colors."""

        return tuple(int(a + (b - a) * amount) for a, b in zip(start, end))

    def _wrap_text(self, font: pygame.font.Font, text: str, width: int) -> List[str]:
        """Wrap text to fit a bounded card width."""

        words = text.split()
        if not words:
            return [""]
        lines: List[str] = []
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if font.size(candidate)[0] <= width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
        return lines

    def _truncate_text(self, font: pygame.font.Font, text: str, width: int) -> str:
        """Return a single-line safe label that fits the width."""

        if font.size(text)[0] <= width:
            return text
        value = text
        while value and font.size(f"{value}...")[0] > width:
            value = value[:-1]
        return f"{value}..." if value else "..."

    def handle_event(self, event: pygame.event.Event, weights: WeightProfile) -> Optional[Tuple[str, object]]:
        """Translate a pygame event into a sidebar action."""

        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            position = event.pos
            for key, button in {**self.buttons, **self.speed_buttons}.items():
                if button.rect.collidepoint(position):
                    return self._button_action(key)
            for key, slider in self.sliders.items():
                if slider.rect.collidepoint(position):
                    self.dragging_slider = key
                    self._set_slider_from_x(key, position[0], weights)
                    return ("weights_changed", weights)

        if event.type == pygame.MOUSEBUTTONUP and event.button == 1:
            self.dragging_slider = None

        if event.type == pygame.MOUSEMOTION and self.dragging_slider:
            self._set_slider_from_x(self.dragging_slider, event.pos[0], weights)
            return ("weights_changed", weights)
        return None

    def _button_action(self, key: str) -> Tuple[str, object]:
        """Map button keys to actions."""

        if key.startswith("type_"):
            return ("set_type", key.split("_", 1)[1])
        if key.startswith("speed_"):
            return ("set_speed", int(key.split("_", 1)[1]))
        return (key, True)

    def _set_slider_from_x(self, key: str, mouse_x: int, weights: WeightProfile) -> None:
        """Update one slider and renormalize all three weights."""

        slider = self.sliders[key]
        relative = (mouse_x - slider.rect.x) / slider.rect.width
        new_value = min(1.0, max(0.0, relative))

        current = {
            "density": weights.density,
            "wait": weights.wait,
            "pedestrian": weights.pedestrian,
        }
        current[key] = new_value

        others = [name for name in current if name != key]
        remainder = max(0.0, 1.0 - new_value)
        other_total = current[others[0]] + current[others[1]]
        if other_total <= 0:
            current[others[0]] = remainder / 2
            current[others[1]] = remainder / 2
        else:
            current[others[0]] = remainder * (current[others[0]] / other_total)
            current[others[1]] = remainder * (current[others[1]] / other_total)

        weights.density = current["density"]
        weights.wait = current["wait"]
        weights.pedestrian = current["pedestrian"]
        weights.normalize()
