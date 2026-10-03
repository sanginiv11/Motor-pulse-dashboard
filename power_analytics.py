"""Engineering estimates from RMS voltage/current and true power factor.

Balanced three-phase assumes line-to-line V and line current. This is not a
waveform power-quality meter. No fault-label penalties alter measured power.
"""
import math
from dataclasses import dataclass,asdict,replace
import numpy as np
import pandas as pd

@dataclass
class PowerConfig:
    phases: int = 3
    tariff_per_kwh: float = .12
    currency: str = 'USD'
    emission_factor: float = .70
    elevated_pct: float = 6.
    critical_pct: float = 15.
    rated_current_a: float = 12.

class PowerAnalyzer:
    def __init__(self,csv):
        self.cfg=PowerConfig()
        h=pd.read_csv(csv); h=h[h.operating_condition=='Healthy']
        # Calibration normalized to single-phase VI*PF; phase multiplier applied at use.
        A=np.c_[np.ones(len(h)),h.load]
        self.coef=np.linalg.lstsq(A,h.voltage*h.current*h.power_factor/1000,rcond=None)[0]
        self.load_range=[float(h.load.min()),float(h.load.max())]
        self.nominal_voltage=float(h.voltage.median())
        self.belt_ratio=float(np.median(h.belt_speed/h.motor_rpm))
        self.reset()

    def reset(self):
        self.seconds=0.; self.kwh=0.; self.excess_kwh=0.; self.cost=0.; self.co2=0.
        self.by_fault={}; self.smoothed=0.; self.classification='NORMAL'

    def config(self):
        return {**asdict(self.cfg),'nominal_voltage':self.nominal_voltage,
                'calibration_load_range':self.load_range,'belt_ratio':self.belt_ratio}

    def configure(self,data):
        allowed=set(asdict(self.cfg))
        if not isinstance(data,dict) or set(data)-allowed: raise ValueError('Unknown power setting')
        values={}
        for k,v in data.items():
            if k=='currency':
                if not isinstance(v,str) or len(v)!=3 or not v.isascii() or not v.isalpha():
                    raise ValueError('Use a three-letter currency code')
                values[k]=v.upper()
            else:
                if isinstance(v,bool): raise ValueError('Settings must be numeric')
                v=float(v)
                if not math.isfinite(v) or v<0: raise ValueError('Settings must be finite and non-negative')
                values[k]=v
        c=replace(self.cfg,**values)
        if c.phases not in (1,3): raise ValueError('Phases must be 1 or 3')
        if not 0<c.elevated_pct<c.critical_pct<=200: raise ValueError('Require 0 < elevated < critical <= 200')
        if not 0<c.rated_current_a<=10000: raise ValueError('Rated current must be positive')
        if c.tariff_per_kwh>10000 or c.emission_factor>100: raise ValueError('Tariff or emissions factor out of range')
        if self.seconds and (c.phases!=self.cfg.phases or c.currency!=self.cfg.currency):
            raise ValueError('Reset session before changing phases or currency')
        self.cfg=c
        return self.config()

    def instant(self,samples):
        a=np.asarray(samples,dtype=float)
        if a.ndim!=2 or a.shape[1]!=8 or not np.isfinite(a).all(): raise ValueError('Invalid sensor data')
        if (a[:,:2]<0).any() or (np.abs(a[:,2])>1).any(): raise ValueError('RMS V/I must be non-negative; power factor within [-1,1]')
        c=self.cfg; factor=math.sqrt(3) if c.phases==3 else 1.
        apparent=factor*a[:,0]*a[:,1]/1000; real=apparent*a[:,2]
        m=a.mean(0); p=float(real.mean()); s=float(apparent.mean())
        # True PF can include distortion; this is non-active magnitude, not measured reactive power.
        nonactive=float(np.sqrt(np.maximum(0,apparent**2-real**2)).mean())
        ref=max(.01,float(factor*(self.coef[0]+self.coef[1]*m[6])))
        valid=self.load_range[0]<=m[6]<=self.load_range[1]
        ratio=float(m[4]/max(m[3],1)/self.belt_ratio)
        excess=100*(p/ref-1)
        alerts=[]
        if m[1]>c.rated_current_a: alerts.append('Current above configured rating')
        if abs(m[0]/self.nominal_voltage-1)>.1: alerts.append('Voltage outside ±10% reference')
        if m[2]<.8: alerts.append('Low power factor')
        if m[6]>100: alerts.append('Load exceeds 100%')
        return dict(p_kw=p,s_kva=s,nonactive_kva=nonactive,pf=float(m[2]),ref_kw=ref,
                    reference_valid=bool(valid),excess_pct=excess,
                    slip_pct=float(100*(1-ratio)),travel_energy_index=float(p/ref/max(ratio,.1)),
                    alerts=alerts,load=float(m[6]),current=float(m[1]),voltage=float(m[0]))

    def update(self,samples,dt,fault):
        if not math.isfinite(dt) or dt<=0: raise ValueError('Positive finite dt required')
        x=self.instant(samples); c=self.cfg
        self.smoothed+=(max(x['excess_pct'],0)-self.smoothed)*(1-math.exp(-dt/1.5))
        if x['alerts']: self.classification='CHECK ELECTRICAL'
        elif not x['reference_valid']: self.classification='OUTSIDE BASELINE'
        else:
            # 1 percentage point release hysteresis avoids threshold chatter.
            if self.smoothed>=c.critical_pct: self.classification='HIGH EXCESS'
            elif self.classification=='HIGH EXCESS' and self.smoothed>=c.critical_pct-1: pass
            elif self.smoothed>=c.elevated_pct: self.classification='ELEVATED'
            elif self.classification=='ELEVATED' and self.smoothed>=c.elevated_pct-1: pass
            else: self.classification='NORMAL'
        e=x['p_kw']*dt/3600; excess=max(0,x['p_kw']-x['ref_kw'])*dt/3600 if x['reference_valid'] else 0.
        self.seconds+=dt; self.kwh+=e; self.excess_kwh+=excess
        self.cost+=e*c.tariff_per_kwh; self.co2+=e*c.emission_factor
        row=self.by_fault.setdefault(fault,dict(seconds=0.,kwh=0.))
        row['seconds']+=dt; row['kwh']+=e
        return {**x,'classification':self.classification,'smoothed_excess_pct':self.smoothed}

    def ledger(self):
        return dict(seconds=self.seconds,kwh=self.kwh,excess_kwh=self.excess_kwh,cost=self.cost,
                    co2_kg=self.co2,currency=self.cfg.currency,by_fault=self.by_fault)
