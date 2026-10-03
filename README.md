# MotorPulse

A local motor-condition dashboard with a 3D conveyor, real Python model inference, continuous signal graphs, and electrical power estimates.

## Run on Windows

1. Install **Python 3.11 (64-bit)** with the Python launcher.
2. Extract this entire folder from the ZIP.
3. Double-click **start_windows.bat**. The first run creates a virtual environment and downloads dependencies; keep an internet connection available for setup.
4. Open **http://127.0.0.1:5000** in a modern browser.
5. Press **Ctrl+C** in the terminal to stop.

After setup, runtime assets, models, data, and Three.js are local. No CDN or online model service is required. The 3D view needs WebGL; the dashboard shows a fallback message if it is unavailable.

Manual setup (Windows PowerShell):

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

macOS/Linux, with Python 3.11 installed:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

If port 5000 is busy, use `python app.py --port 5001` and open http://127.0.0.1:5001. Run these commands from this project folder, using the virtual environment's Python. Do not open index.html directly.

## What's included

- **Overview:** always-running synthetic replay; automatic sequence or manual fault selection; progression and noise controls; pause/resume; orbitable 3D motor and conveyor.
- **Six visual states:** smooth healthy rotation, wandering misaligned belt, overload heat and stacked crates, eccentric imbalance, belt slip with slower conveyor, and bearing rattle/debris. Effects are illustrative, not measurements of smoke or physical damage.
- **Four signal panels:** raw vibration, raw electrical signals, AI-coloured vibration, and classified electrical signals. The electrical panel uses separate voltage/current/kW scales. Raw vibration is transported at 1 kHz; electrical traces are averaged to 200 Hz for display. Source samples are used for power calculations.
- **Fault index:** consistent colours, coloured explanatory text, dataset signatures, inspection suggestions, and scenario launch buttons.
- **Power & energy:** active/apparent/non-active magnitude, power-factor and rated-current checks, calibrated baseline applicability, belt-travel index, session kWh/cost/CO2, and energy grouped by predicted condition.
- **Model validation:** live confusion matrix plus validation evidence and limitations.
- **Export:** up to the last 60 simulated seconds as 50 ms sensor averages, scenario, prediction, confidence, and power class.
- **Accessibility:** keyboard controls, responsive layout, reduced-motion setting and OS preference, labelled controls and chart sections.
- **External inference API:** POST /api/predict; external windows do not alter the simulation energy ledger.

## Model and validation

The two fault-model weights and 143-feature extractor are preserved from the supplied release. Predictions use the 50/50 ExtraTrees/XGBoost ensemble. The model sees sensor values only; the simulator's selected fault is used for replay agreement and the scenario animation, never as an inference input.

The incompatible new 230 V synthetic simulator was replaced in the app by the supplied **dataset-based replay simulator**. This fixes the integration mismatch for the demo; it does not establish generalisation beyond that dataset. Progression selects a region of each source segment, not a calibrated physical fault severity.

Reproducible pipeline test: **1,440 non-overlapping windows**, six conditions, progression 0.1/0.5/0.9, noise 0/0.1/0.3/0.6, and a 3-second settle period per scenario.

| Noise setting | Replay agreement |
|---|---:|
| 0% | 100.00% |
| 10% | 100.00% |
| 30% | 99.72% |
| 60% stress | 82.50% |

Noise is relative to the simulator's channel noise reference. All stress results remain in the report. These are **source-data replay compatibility scores**, not independent accuracy on real motors.

The earlier packaged perturbation result was reproduced at **91.78%**. Its 114 base windows match the original dataset; exclusion from training is not proven. The separate temporal retraining experiment achieved **98.81%**, but that measures new fitted copies on a same-segment split, not the deployed frozen weights. Historical 94.41% is not reproducible with its missing original test implementation.

The old electrical ML model is preserved for provenance but **not used by the dashboard**. The supplied updated simulator produced 89.25% aggregate classification and only 69.4% recall for its low-power-factor mode. The app uses explicit engineering rules instead.

The pre-integration review in reports/MODEL_REVIEW.txt records the earlier stop decision. Development subsequently continued at the user's request. It is a historical review, not the current application's run status.

## Power conventions and limitations

Default supply is balanced three-phase: RMS line-to-line voltage, RMS line current, and true power factor:
- S = sqrt(3) × V × I / 1000 kVA
- P = S × PF kW
- Energy = sum(P × sample interval) / 3600 kWh

Single-phase uses factor 1. Power is computed per sample before averaging; a predicted fault never multiplies it. Since true PF may contain distortion, sqrt(S² − P²) is labelled **non-active magnitude**, not measured reactive power.

The healthy reference is a linear fit to the supplied healthy load range. Outside that range, the UI flags extrapolation and does not accumulate excess-reference kWh. Fault energy attribution is an association, not causal waste estimation. The belt-travel index is a proxy and does not measure material throughput.

Rated current (default 12 A), tariff (0.12 USD/kWh), and grid factor (0.70 kg CO2/kWh) are **editable assumptions**, not verified plant values. Changes to tariff/grid factor affect future accumulation only. Pause and reset before changing phases/currency. Settings and ledger are session-only; restart resets them. No persistent industrial alarm, protection relay, real sensor adapter, or metering certification is claimed.

## Reproduce checks

```bash
python -m unittest discover -s tests -v
python tests/validate_pipeline.py
```

The first command tests all six fault scenarios through the backend, API input validation, pause/reset, static assets, and numerical power/energy behaviour. The second overwrites reports/pipeline_validation.json with repeatable metrics, per-condition results, precision/recall/F1, confusion matrix, and model hashes.

Optional JavaScript command-line check (Node.js 22+):

```bash
node tests/frontend_smoke.mjs
node tests/twin_smoke.mjs
```

Run with the virtual environment activated so its `python` is on PATH. These use small DOM/canvas/renderer test doubles, Flask's test client, and real Three.js scene geometry; they do not open a browser or control the desktop. They check UI data wiring, tab state, chart drawing calls, buffer bounds, finite geometry, six distinct animation states, and paused-frame stability. Actual browser/WebGL appearance is not visually verified by these tests.

Serialized XGBoost may emit a cross-version loading warning from the supplied joblib artifact. Dependency versions are pinned to the tested runtime, and frozen predictions reproduce the supplied replacement result. Only load model artifacts you trust.

## API

- GET /api/meta — classes, descriptions, configuration, reports
- GET /api/stream?cursor=0 — incremental sensor batches, prediction and power data
- GET /api/summary — ledger, confusion matrix, events
- POST /api/control — mode, fault, severity [0,1], noise [0,0.6], paused
- POST /api/config — power configuration
- POST /api/reset — session metrics/ledger reset; simulation clock continues
- POST /api/predict — {"window": [[...8 numbers...], ...256 rows...]}
- GET /api/export — recent CSV
- GET /api/health — engine liveness

Channel order: voltage, current, power_factor, motor_rpm, belt_speed, temperature, load, vibration. Expected sample rate: 1 kHz. The inference endpoint checks shape/finiteness and electrical ranges; it cannot establish whether incoming data resembles the training distribution.

Bound to 127.0.0.1 by default. This local prototype uses Flask's development server; it is not an authenticated plant-network service.

## File map

- app.py — thread-safe streaming engine and HTTP API
- simulator.py — continuous source-data replay, transitions, injected sensor noise
- power_analytics.py — electrical calculations and ledger
- motor_ai/ — supplied fault weights, features, and inference wrapper
- static/ — dashboard, canvas traces, Three.js motor animation
- static/vendor/THREE-LICENSE.txt — Three.js 0.170.0 MIT licence
- reports/ — current pipeline validation plus historical review/results
- tests/ — numerical, API and UI wiring checks
