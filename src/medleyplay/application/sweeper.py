"""Asking the enrichers set to find all, soon after something may have given them more to ask.

A scan, a Download, or a Track added makes Tracks an enricher may be asked about, and
a day passing makes a video asked about yesterday one again. Each notice asks for a
sweep a few seconds on, so a busy scan sweeps once; a tick sweeps every hour besides.
A sweep that fails is logged and the next goes ahead.
"""

import logging
import threading
import time
from datetime import timedelta
from typing import Final, Protocol

DELAY: Final = timedelta(seconds=5)
"""How long after a notice the sweep runs, so notices close together sweep once."""
TICK: Final = timedelta(hours=1)
"""How long a sweep waits for a notice before it runs anyway."""

_log = logging.getLogger(__name__)


class Sweeps(Protocol):
    """What a sweeper runs: the enrichment service's sweep."""

    def sweep(self) -> int:
        """Queue what the enrichers set to find all may ask about; return how many."""
        ...


class EnrichmentSweeper:
    """Sweep the enrichers set to find all on a thread of its own, when asked and every tick."""

    def __init__(
        self, enrichment: Sweeps, *, delay: timedelta = DELAY, tick: timedelta = TICK
    ) -> None:
        """Create a sweeper over `enrichment`, not yet started."""
        self._enrichment = enrichment
        self._delay = delay.total_seconds()
        self._tick = tick.total_seconds()
        self._wake = threading.Condition()
        self._due_at: float | None = None
        self._stopping = False
        self._thread: threading.Thread | None = None

    def request(self, *_: object) -> None:
        """Ask for a sweep soon; callable from any thread, with whatever a notice passes."""
        with self._wake:
            if self._due_at is None:
                self._due_at = time.monotonic() + self._delay
            self._wake.notify()

    def start(self) -> None:
        """Start sweeping, once now, then when asked or a tick on."""
        with self._wake:
            self._stopping = False
            self._due_at = time.monotonic()
        self._thread = threading.Thread(target=self._run, name="enrichment-sweep", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop sweeping, after the sweep running now, if any, finishes."""
        with self._wake:
            self._stopping = True
            self._wake.notify()
        if self._thread is not None:
            self._thread.join()
            self._thread = None

    def _run(self) -> None:
        next_tick = time.monotonic() + self._tick
        while True:
            with self._wake:
                while not self._stopping:
                    deadline = next_tick if self._due_at is None else min(self._due_at, next_tick)
                    if time.monotonic() >= deadline:
                        break
                    self._wake.wait(deadline - time.monotonic())
                if self._stopping:
                    return
                self._due_at = None
                next_tick = time.monotonic() + self._tick
            try:
                self._enrichment.sweep()
            except Exception:  # noqa: BLE001 -- any failure is logged, and the next sweep goes ahead
                _log.exception("Sweeping the enrichers failed; trying again when next asked")
