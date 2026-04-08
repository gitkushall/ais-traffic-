"""Historical lane scoring memory used for congestion prediction."""

from __future__ import annotations

from typing import Iterable

import numpy as np

from traffic_sim.core.models import Lane

try:
    from sklearn.linear_model import LinearRegression
except ImportError:  # pragma: no cover - optional dependency
    LinearRegression = None


class PatternMemory:
    """Stores score history and estimates rising congestion trends."""

    def remember(self, lane: Lane, score: float) -> None:
        """Persist a score sample for one lane."""

        lane.score_history.append(score)

    def rolling_average(self, lane: Lane, window: int = 30) -> float:
        """Return the rolling average score for the lane."""

        values = list(self._tail(lane.score_history, window))
        return float(np.mean(np.asarray(values, dtype=float))) if values else 0.0

    def trend(self, lane: Lane, window: int = 30) -> float:
        """Return a simple trend signal based on recent versus older scores."""

        values = list(self._tail(lane.score_history, window * 2))
        if len(values) < 4:
            return 0.0
        data = np.asarray(values, dtype=float)
        if LinearRegression is not None and len(values) >= 6:
            x_axis = np.arange(len(values), dtype=float).reshape(-1, 1)
            model = LinearRegression()
            model.fit(x_axis, data)
            return max(0.0, float(model.coef_[0]))
        midpoint = len(data) // 2
        older = data[:midpoint]
        newer = data[midpoint:]
        return max(0.0, float(np.mean(newer) - np.mean(older)))

    def _tail(self, values: Iterable[float], count: int) -> Iterable[float]:
        """Return the last `count` values from an iterable."""

        values_list = list(values)
        return values_list[-count:]
