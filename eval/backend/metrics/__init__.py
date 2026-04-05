# -*- coding: utf-8 -*-
"""评测指标集合"""

from metrics.base import BaseMetric
from metrics.format_metric import FormatMetric
from metrics.playability_metric import ExecutabilityMetric
from metrics.llm_metrics import create_llm_metrics


def get_hard_metrics() -> list[BaseMetric]:
    return [FormatMetric(), ExecutabilityMetric()]


def get_llm_metrics() -> list[BaseMetric]:
    return create_llm_metrics()


def get_all_metrics() -> list[BaseMetric]:
    return get_hard_metrics() + get_llm_metrics()
