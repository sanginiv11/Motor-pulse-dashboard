"""Reproduce replay compatibility: python tests/validate_pipeline.py"""
import sys,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import numpy as np,pandas as pd
from sklearn.metrics import classification_report,confusion_matrix
from motor_ai import MotorHealthModel
from motor_ai.preprocessing import extract_features,CHANNELS
from simulator import MotorSimulator,FAULTS

def main():
    model=MotorHealthModel();rows=[];truth=[];pred=[]
    for noise in (0.,.1,.3,.6):
        yall=[];pall=[]
        for severity in (.1,.5,.9):
            for k,fault in enumerate(FAULTS):
                sim=MotorSimulator(str(ROOT/'data/combined_dataset.csv'),seed=700+k)
                sim.control(mode='manual',fault=fault,severity=severity,noise=noise)
                for _ in range(60):sim.step(50)
                X=[]
                for _ in range(20):
                    sim.step(256)
                    assert not sim.in_transition()
                    X.append(extract_features(pd.DataFrame(sim.window(),columns=CHANNELS)))
                pp=model.predict_proba_features(X).argmax(1)
                yall += [k]*len(pp);pall+=list(map(int,pp))
                rows.append(dict(fault=fault,severity=severity,noise=noise,n=len(pp),accuracy=float(np.mean(pp==k))))
        report=classification_report(yall,pall,labels=list(range(6)),target_names=FAULTS,output_dict=True,zero_division=0)
        print(f'noise {noise}: {report["accuracy"]:.4%}',flush=True)
        truth+=yall;pred+=pall
    report=dict(kind='Synthetic source-data replay compatibility, not independent model accuracy',classes=FAULTS,
                conditions=rows,accuracy=float(np.mean(np.array(truth)==pred)),
                confusion_matrix=confusion_matrix(truth,pred,labels=list(range(6))).tolist(),
                per_class=classification_report(truth,pred,target_names=FAULTS,output_dict=True),
                by_noise={str(n):float(np.mean([r['accuracy'] for r in rows if r['noise']==n])) for n in (0.,.1,.3,.6)},
                n=len(truth),window_size=256,stride=256,settle_samples=3000,
                model_sha256={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in (ROOT/'motor_ai/models').glob('fault_*.joblib')},
                limitations=['Replay uses model training-domain source data.','Severity selects progression in source data; it is not calibrated physical severity.','Stress conditions are included, not discarded to reach a threshold.','Independent physical-motor accuracy remains unknown.'])
    (ROOT/'reports/pipeline_validation.json').write_text(json.dumps(report,indent=2))
    print('Report saved',flush=True)
if __name__=='__main__':main()

