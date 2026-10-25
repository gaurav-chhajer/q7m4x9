"""Tunable constants.

All timestamps are UTC. In January, UK local time (GMT) equals UTC, so a
"09:00 cutoff" is the same wall-clock time for a UK trader.
"""
import os
from pathlib import Path

DATA_ROOT = Path(os.environ.get("WINDWARD_DATA_DIR") or Path(__file__).resolve().parent.parent / "data")

DEFAULT_CUTOFF = "09:00"          # when the day-ahead decision is assumed to be made, on D-1
CUTOFF_OPTIONS = [f"{h:02d}:{m:02d}" for h in range(6, 15) for m in (0, 30)]
MAX_HORIZON_H = 48                # forecasts further out than this are not used
MIN_HISTORY_DAYS = 3              # below this, the error band is flagged as in-sample
MAPE_MIN_ACTUAL_MW = 100.0        # MAPE ignores half-hours with almost no wind (division blow-up)
HISTOGRAM_BIN_MW = 250
HORIZON_BIN_H = 3
LEVEL_EDGES_MW = [0, 2000, 4000, 6000, 8000, 10000]
