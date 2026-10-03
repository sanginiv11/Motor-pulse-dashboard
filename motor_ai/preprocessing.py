"""Reproducible 143-feature extractor for the rebuilt motor-health classifier.

Input: pandas DataFrame with these 8 columns, containing exactly 256 samples:
voltage, current, power_factor, motor_rpm, belt_speed, temperature, load, vibration
Output: numpy float32 vector of shape (143,).
"""
import numpy as np
from scipy.stats import skew, kurtosis

CHANNELS=['voltage','current','power_factor','motor_rpm','belt_speed','temperature','load','vibration']
FS=1000
WINDOW_SIZE=256
FEATURE_NAMES=[]
_C=['mean','std','min','max','median','q25','q75','iqr','rms','abs_mean','skew','kurtosis','peak_to_peak','crest_factor','dominant_freq_hz','spectral_centroid_hz']
for ch in CHANNELS:
    FEATURE_NAMES += [f'{ch}_{n}' for n in _C]
FEATURE_NAMES += ['mean_power','std_power','mean_torque_proxy','corr_voltage_current','corr_current_load','corr_vibration_load','corr_vibration_rpm','corr_temperature_load','mean_belt_rpm_ratio','mean_vibration_rpm_ratio','rpm_cv','mean_load','mean_current','mean_power_factor','mean_temperature']
assert len(FEATURE_NAMES)==143

def _corr(a,b):
    if np.std(a)<1e-12 or np.std(b)<1e-12: return 0.0
    return float(np.corrcoef(a,b)[0,1])

def _channel(x):
    x=np.asarray(x,dtype=float)
    mu=float(np.mean(x)); sd=float(np.std(x)); rms=float(np.sqrt(np.mean(x*x)))
    q25=float(np.percentile(x,25)); q75=float(np.percentile(x,75))
    spec=np.abs(np.fft.rfft(x-mu)); freqs=np.fft.rfftfreq(len(x),1/FS)
    k=1+int(np.argmax(spec[1:])) if len(spec)>1 else 0
    dom=float(freqs[k]) if len(spec)>1 else 0.0
    den=float(np.sum(spec[1:]))+1e-12
    centroid=float(np.sum(freqs[1:]*spec[1:])/den) if len(spec)>1 else 0.0
    return [mu,sd,float(np.min(x)),float(np.max(x)),float(np.median(x)),q25,q75,q75-q25,rms,float(np.mean(np.abs(x))),float(np.nan_to_num(skew(x),nan=0.0)),float(np.nan_to_num(kurtosis(x),nan=0.0)),float(np.ptp(x)),float(np.max(np.abs(x))/(rms+1e-9)),dom,centroid]

def extract_features(window):
    missing=[c for c in CHANNELS if c not in window.columns]
    if missing: raise ValueError(f'Missing columns: {missing}')
    if len(window)!=WINDOW_SIZE: raise ValueError(f'Expected {WINDOW_SIZE} samples, got {len(window)}')
    a={c:window[c].to_numpy(dtype=float) for c in CHANNELS}
    out=[]
    for c in CHANNELS: out.extend(_channel(a[c]))
    v,i,pf,rpm,bs,temp,load,vib=[a[c] for c in CHANNELS]
    power=v*i*pf; torque=power/(rpm+1e-6)
    out += [float(np.mean(power)),float(np.std(power)),float(np.mean(torque)),_corr(v,i),_corr(i,load),_corr(vib,load),_corr(vib,rpm),_corr(temp,load),float(np.mean(bs/(rpm+1e-6))),float(np.mean(vib/(rpm+1e-6))),float(np.std(rpm)/(np.mean(rpm)+1e-9)),float(np.mean(load)),float(np.mean(i)),float(np.mean(pf)),float(np.mean(temp))]
    x=np.asarray(out,dtype=np.float32)
    if x.shape!=(143,) or not np.isfinite(x).all(): raise ValueError('Feature extraction produced invalid output')
    return x
