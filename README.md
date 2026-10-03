# MotorPulse — AI-Powered Industrial Motor Monitoring Dashboard

**MotorPulse** is a simulation-based industrial motor monitoring and predictive maintenance dashboard that combines **signal processing, machine learning, energy analytics, and real-time visualization** to monitor the operating condition of industrial motors.

🌐 **Live Dashboard:**  
https://motor-pulse-dashboard.onrender.com/

---

## Overview

Industrial motors are critical components of manufacturing and conveyor systems. Unexpected motor failures can lead to downtime, maintenance costs, and production losses.

MotorPulse provides a unified dashboard for monitoring simulated motor data and identifying potential operating and fault conditions.

The system combines:

- ⚡ Energy and power analytics
- 📈 Digital Signal Processing (DSP)
- 🔊 FFT-based frequency analysis
- 🤖 Machine-learning-based diagnostics
- 🔧 Fault classification
- 📊 Real-time simulation
- 🏭 Motor production monitoring
- 📉 Predictive-maintenance insights

The dashboard is designed as a **simulation and monitoring system**, rather than a direct physical motor diagnostic device.

---

## Key Features

### 1. Motor Monitoring

The dashboard continuously simulates motor operating data and presents important operating parameters through an interactive interface.

Monitored information includes:

- Motor operating condition
- Power consumption
- Energy usage
- Production information
- Signal characteristics
- Fault status
- Diagnostic information

---

### 2. DSP & FFT Analysis

Motor signals can contain frequency-domain information that helps identify changes in machine behavior.

MotorPulse applies **Fast Fourier Transform (FFT)** analysis to simulated motor signals to visualize their frequency components.

This allows the dashboard to provide:

- Time-domain signal visualization
- Frequency-domain analysis
- Dominant frequency information
- Signal-based monitoring

---

### 3. AI-Based Diagnostics

Machine-learning models are used to classify motor operating and fault conditions based on the available dataset features.

The project includes trained models for fault-related analysis using:

- Extra Trees
- XGBoost

The models are integrated into the Flask backend and their outputs are displayed through the dashboard.

---

### 4. Energy Analytics

MotorPulse analyzes simulated electrical and energy-related measurements to provide insights into motor power consumption.

The dashboard can display information such as:

- Power consumption
- Energy usage
- Operating efficiency-related metrics
- Production-related analytics

---

### 5. Fault Detection

The system uses machine-learning models to identify different motor fault/operating conditions represented in the underlying dataset.

The dashboard presents the model output as an easily understandable diagnostic result rather than exposing raw machine-learning predictions directly to the user.

---

### 6. Real-Time Simulation

MotorPulse operates in **simulation mode**.

The backend uses the project's dataset and simulator to generate a continuously changing stream of motor measurements.

This allows the dashboard to demonstrate how a predictive-maintenance monitoring system could behave without requiring a physical industrial motor or sensor setup.

---

## System Architecture

```text
                 ┌─────────────────────┐
                 │   Motor Dataset     │
                 │ combined_dataset.csv│
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │     Simulator       │
                 │ Motor Measurements  │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌────────────┐
        │   DSP    │  │  Energy  │  │ ML Models  │
        │ FFT      │  │Analytics │  │ Diagnostics│
        └────┬─────┘  └────┬─────┘  └─────┬──────┘
             │             │              │
             └─────────────┼──────────────┘
                           ▼
                 ┌─────────────────────┐
                 │    Flask Backend    │
                 │       app.py        │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │   MotorPulse UI     │
                 │ Monitoring Dashboard│
                 └─────────────────────┘
```

---

## Technologies Used

### Backend

- Python
- Flask
- Gunicorn
- NumPy
- Pandas
- SciPy
- Scikit-learn
- XGBoost

### Frontend

- HTML
- CSS
- JavaScript

### Machine Learning

- Extra Trees Classifier
- XGBoost
- Feature-based motor fault classification

### Signal Processing

- FFT
- Frequency-domain analysis
- Digital signal processing techniques

### Deployment

- GitHub
- Render
- Gunicorn

---

## Project Structure

```text
Motor-pulse-dashboard/
│
├── app.py
├── requirements.txt
├── README.md
├── fault_info.py
├── power_analytics.py
├── simulator.py
│
├── data/
│   └── combined_dataset.csv
│
├── motor_ai/
│   ├── inference.py
│   ├── models/
│   │   ├── fault_extratrees.joblib
│   │   └── fault_xgboost.joblib
│   └── ...
│
├── reports/
│
├── static/
│   ├── css/
│   ├── js/
│   └── ...
│
└── tests/
```

---

## Dataset

MotorPulse uses a prepared motor dataset located at:

```text
data/combined_dataset.csv
```

The dataset provides the underlying measurements used by the simulation, analytics, and machine-learning components.

The dashboard should therefore be interpreted as a **dataset-driven simulation**, not as a live connection to industrial motor sensors.

---

## Machine Learning

The project includes trained machine-learning models for motor fault analysis.

### Models

**Extra Trees**

```text
motor_ai/models/fault_extratrees.joblib
```

**XGBoost**

```text
motor_ai/models/fault_xgboost.joblib
```

The models are loaded by the backend and used during the diagnostic process.

The project also contains an electrical-health model used during local development. Due to its large file size, it is not stored in the GitHub repository.

---

## Local Installation

### 1. Clone the repository

```bash
git clone https://github.com/sanginiv11/Motor-pulse-dashboard.git
cd Motor-pulse-dashboard
```

### 2. Install Python

Python **3.13** is recommended for this project.

Check your Python version:

```bash
python --version
```

or:

```bash
py --version
```

---

### 3. Create a virtual environment

Windows:

```bash
py -3.13 -m venv venv
```

Activate it:

```bash
venv\Scripts\activate
```

---

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

---

### 5. Run the application

```bash
python app.py
```

Alternatively:

```bash
py -3.13 app.py
```

The application will normally be available at:

```text
http://127.0.0.1:5000
```

---

## Running With Gunicorn

For deployment environments such as Render:

```bash
gunicorn "app:create_app()"
```

The application uses a Flask application factory:

```python
def create_app(engine=None):
    ...
    return app
```

Therefore, Gunicorn must load the factory rather than searching for a global `app` variable.

---

## Deployment

MotorPulse is deployed using **Render**.

The production deployment uses:

```text
Build Command:
pip install -r requirements.txt
```

and:

```text
Start Command:
gunicorn "app:create_app()"
```

Python 3.13 is specified for deployment to ensure compatible binary packages are used for dependencies such as SciPy.

### Live Deployment

**MotorPulse Dashboard**

https://motor-pulse-dashboard.onrender.com/

---

## Important Limitations

MotorPulse is currently a **simulation-based predictive-maintenance dashboard**.

It does not directly connect to:

- Industrial motors
- PLCs
- SCADA systems
- Physical vibration sensors
- Current/voltage sensors
- Industrial IoT hardware

The displayed measurements and diagnostic outputs are therefore based on the project's dataset and simulation pipeline.

### AI Diagnostic Limitation

The machine-learning predictions should be interpreted as predictions within the conditions represented by the training dataset.

They should not be treated as definitive physical diagnosis of an industrial motor without validation against real sensor measurements.

---

## Why MotorPulse?

MotorPulse demonstrates how multiple E&TC and AI concepts can be combined into a single industrial monitoring system:

```text
Sensors / Dataset
       ↓
Signal Processing
       ↓
FFT Analysis
       ↓
Feature Extraction
       ↓
Machine Learning
       ↓
Fault Detection
       ↓
Energy Analytics
       ↓
Predictive Maintenance Dashboard
```

This creates a bridge between:

**Electronics & Telecommunication Engineering**

and

**Artificial Intelligence / Machine Learning**

for industrial applications.

---

## Future Improvements

Potential future extensions include:

- Real-time IoT sensor integration
- ESP32/STM32-based motor monitoring
- Accelerometer-based vibration sensing
- Real current and voltage measurement
- MQTT communication
- Live industrial motor data
- Automated maintenance alerts
- Remaining Useful Life (RUL) prediction
- Cloud database integration
- Model retraining using real-world data
- Edge-AI deployment
- Digital-twin integration

---

## Project Status

**Current version:** Simulation / Demonstration

**Deployment:** Live

**Backend:** Flask

**ML:** Integrated

**DSP/FFT:** Integrated

**Energy Analytics:** Integrated

**Real Industrial Hardware:** Not currently connected

---

## Author

**Sangini Verma**

B.Tech — Electronics & Telecommunication Engineering

Symbiosis Institute of Technology, Pune

---

## Links

🌐 **Live Dashboard:**  
https://motor-pulse-dashboard.onrender.com/

💻 **GitHub:**  
https://github.com/sanginiv11/Motor-pulse-dashboard
