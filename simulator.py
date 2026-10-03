"""Real-time motor simulator (1 kHz, 8 channels).

How it works
------------
The source data (`data/combined_dataset.csv`) contains 10 000 contiguous 1 kHz samples for each of the
six operating conditions.  Within each fault segment the fault *progresses* (e.g. bearing vibration RMS
roughly doubles, temperature climbs).  The simulator exploits that:

  * **severity** (0..1) selects *where* in the fault's progression the stream is played from;
  * playback loops inside a small region around that point, with a decaying offset at the loop seam
    so there are no step artefacts;
  * switching fault cross-fades the two streams over ~1.5 s (a realistic ramp, not a hard cut);
  * an optional sensor-noise level (fraction of each channel's typical noise) can be added to test how
    the classifier degrades;
  * the simulator knows the ground truth, so the dashboard can report a live accuracy number.

It is a *replay-based* simulator: signals are real samples of the supplied synthetic dataset, not a new
physical model.  Nothing here claims to represent a real machine.
"""
from __future__ import annotations

import threading
import time
from collections import deque

import numpy as np
import pandas as pd

CHANNELS = ["voltage", "current", "power_factor", "motor_rpm", "belt_speed", "temperature", "load", "vibration"]
FAULTS = ["Healthy", "Belt Misalignment", "Excessive Load", "Mechanical Imbalance", "Belt Slip", "Bearing Degradation"]
FS = 1000

# seam-smoothing time constants (samples) per channel
_TAU = np.array([40, 40, 40, 200, 200, 3000, 200, 6], dtype=float)
FADE_SAMPLES = 1500
HALF_REGION = 700


class _Playback:
    """Continuous playback of one fault segment around a (movable) severity point."""

    def __init__(self, seg: np.ndarray, severity: float, rng: np.random.Generator):
        self.seg = seg
        self.n = len(seg)
        self.rng = rng
        self.sev = severity
        self.centre = severity * (self.n - 1)
        self.p = int(self._lo() + rng.integers(0, max(1, self._hi() - self._lo())))
        self.off = np.zeros(seg.shape[1])
        self.last = seg[self.p].copy()

    def _lo(self):
        return int(max(0, min(self.centre - HALF_REGION, self.n - 2 * HALF_REGION)))

    def _hi(self):
        return int(min(self.n, self._lo() + 2 * HALF_REGION))

    def set_severity(self, s: float):
        self.sev = s
        # glide the centre towards the target (so a slider drag evolves smoothly)
        self.target = s * (self.n - 1)

    def read(self, m: int) -> np.ndarray:
        # glide centre
        tgt = getattr(self, "target", self.centre)
        self.centre += float(np.clip(tgt - self.centre, -m * 0.8, m * 0.8))
        out = np.empty((m, self.seg.shape[1]))
        got = 0
        first_piece = True
        while got < m:
            lo, hi = self._lo(), self._hi()
            seam = False
            if self.p < lo or self.p >= hi:
                self.p = lo + int(self.rng.integers(0, 40))
                seam = True
            take = min(m - got, hi - self.p)
            raw = self.seg[self.p:self.p + take]
            if seam:
                self.off = self.last - raw[0]
            t = np.arange(take)[:, None]
            piece = raw + self.off * np.exp(-t / _TAU)
            self.off = self.off * np.exp(-take / _TAU)
            out[got:got + take] = piece
            self.last = piece[-1]
            self.p += take
            got += take
            first_piece = False
        return out


class MotorSimulator:
    def __init__(self, csv_path: str, seed: int | None = None):
        df = pd.read_csv(csv_path)
        self.rng = np.random.default_rng(seed)
        self.seg = {f: df[df.operating_condition == f][CHANNELS].to_numpy(dtype=float) for f in FAULTS}
        # typical in-window sensor noise per channel (median window std over all data) -> noise slider reference
        A = df[CHANNELS].to_numpy(dtype=float)
        stds = np.array([A[s:s + 256].std(0) for s in range(0, len(A) - 256, 512)])
        self.noise_ref = np.median(stds, axis=0)
        healthy = self.seg["Healthy"]
        self.healthy_belt_ratio = float(np.median(healthy[:, 4] / healthy[:, 3]))

        self.lock = threading.RLock()
        # control state
        self.mode = "auto"          # auto | manual
        self.fault = "Healthy"
        self.severity = 0.5
        self.noise = 0.0
        self.paused = False
        self.auto_script = []
        self.auto_idx = -1
        self.auto_left = 0.0
        # stream state
        self.cur = _Playback(self.seg[self.fault], self.severity, self.rng)
        self.prev = None
        self.fade = 1.0
        self.since_switch = 10 ** 9
        self.truth = self.fault        # label of the stream currently dominating
        self.t = 0.0                   # simulated seconds
        self.sample_count = 0
        self.buf = np.zeros((4096, 8))   # ring of recent output samples
        self.buf_n = 0
        self.events = deque(maxlen=200)
        self._next_auto()

    # ---- control -------------------------------------------------------------------------------
    def control(self, mode=None, fault=None, severity=None, noise=None, paused=None):
        with self.lock:
            if mode in ("auto", "manual") and mode != self.mode:
                self.mode = mode
                self.events.append((self.t, "info", f"Mode: {mode}"))
                if mode == "auto":
                    self._next_auto()
            if severity is not None:
                self.severity = float(np.clip(severity, 0, 1))
                self.cur.set_severity(self.severity)
            if noise is not None:
                self.noise = float(np.clip(noise, 0, 0.6))
            if paused is not None:
                self.paused = bool(paused)
            if fault is not None and fault in FAULTS:
                self.mode = "manual" if mode is None else self.mode
                self._switch(fault, source="manual")

    def _switch(self, fault, source="auto"):
        if fault == self.fault and self.fade >= 1.0:
            return
        self.prev = self.cur
        self.cur = _Playback(self.seg[fault], self.severity, self.rng)
        self.fault = fault
        self.fade = 0.0
        self.since_switch = 0
        self.events.append((self.t, "inject", f"Simulator → {fault} ({source}, severity {self.severity:.2f})"))

    def _next_auto(self):
        # Healthy → random fault → Healthy → another fault ...
        self.auto_idx += 1
        if self.auto_idx % 2 == 0:
            nxt, dur, sev = "Healthy", float(self.rng.uniform(10, 14)), 0.5
        else:
            nxt = str(self.rng.choice([f for f in FAULTS if f != "Healthy"]))
            dur, sev = float(self.rng.uniform(18, 26)), float(self.rng.uniform(0.15, 0.95))
        self.auto_left = dur
        self.severity = sev
        self._switch_auto(nxt)

    def _switch_auto(self, nxt):
        self.cur.set_severity(self.severity)
        self._switch(nxt, source="auto")
        self.cur.set_severity(self.severity)

    # ---- stepping ------------------------------------------------------------------------------
    def step(self, n: int):
        """Advance n samples; returns (n, 8) array and per-sample ground-truth fault index (as str)."""
        with self.lock:
            if self.mode == "auto":
                self.auto_left -= n / FS
                if self.auto_left <= 0:
                    self._next_auto()
            a = self.cur.read(n)
            if self.fade < 1.0 and self.prev is not None:
                b = self.prev.read(n)
                w = np.clip(self.fade + np.arange(1, n + 1) / FADE_SAMPLES, 0, 1)[:, None]
                w = w * w * (3 - 2 * w)  # smoothstep
                out = w * a + (1 - w) * b
                self.fade = float(min(1.0, self.fade + n / FADE_SAMPLES))
                if self.fade >= 1.0:
                    self.prev = None
            else:
                out = a
            if self.noise > 0:
                out = out + self.rng.normal(0, 1, out.shape) * self.noise_ref * self.noise
            self.t += n / FS
            self.sample_count += n
            self.since_switch += n
            # ring buffer
            k = len(out)
            if k >= len(self.buf):
                self.buf = out[-len(self.buf):].copy()
            else:
                self.buf = np.roll(self.buf, -k, axis=0)
                self.buf[-k:] = out
            self.buf_n = min(len(self.buf), self.buf_n + k)
            return out

    def window(self, size: int = 256):
        with self.lock:
            if self.buf_n < size:
                return None
            return self.buf[-size:].copy()

    def in_transition(self) -> bool:
        """True while a 256-sample analysis window can still contain the previous fault's signal."""
        return self.since_switch < FADE_SAMPLES + 256

    def status(self):
        with self.lock:
            return dict(mode=self.mode, fault=self.fault, severity=self.severity, noise=self.noise,
                        paused=self.paused, auto_left=max(0.0, self.auto_left) if self.mode == "auto" else None,
                        t=self.t, fading=self.fade < 1.0)
