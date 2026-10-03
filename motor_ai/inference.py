"""Frozen release ensemble. Simulator labels are never inputs to inference."""
from pathlib import Path
import json
import joblib
import numpy as np
import pandas as pd
from .preprocessing import CHANNELS, extract_features

ROOT = Path(__file__).parent

class MotorHealthModel:
    def __init__(self):
        self.meta = json.loads((ROOT/'config/fault_model_metadata.json').read_text())
        self.classes = self.meta['classes']
        self.et = joblib.load(ROOT/'models/fault_extratrees.joblib')
        self.xgb = joblib.load(ROOT/'models/fault_xgboost.joblib')
        for m in (self.et,self.xgb):
            m.set_params(n_jobs=1)
            if m.n_features_in_ != 143 or list(m.classes_) != list(range(6)):
                raise ValueError('Model feature count/class order does not match metadata')

    def predict_proba_features(self, X):
        X = np.asarray(X, dtype=np.float32)
        if X.ndim != 2 or X.shape[1] != 143 or not np.isfinite(X).all():
            raise ValueError('Expected finite n x 143 feature array')
        return .5*self.et.predict_proba(X) + .5*self.xgb.predict_proba(X)

    def predict_array(self, window):
        a = np.asarray(window,dtype=float)
        if a.shape != (256,8) or not np.isfinite(a).all():
            raise ValueError('Expected 256 x 8 finite sensor samples')
        X = extract_features(pd.DataFrame(a,columns=CHANNELS))[None,:]
        p = self.predict_proba_features(X)[0]
        i = int(p.argmax())
        return dict(fault=self.classes[i],fault_id=i,confidence=float(p[i]),
                    probabilities={c:float(v) for c,v in zip(self.classes,p)})

    def predict_fault(self, window):
        return self.predict_array(window[CHANNELS].to_numpy())
