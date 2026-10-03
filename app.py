"""MotorPulse: local simulation dashboard with actual Python model inference."""
import argparse,csv,io,json,math,threading,time
from collections import deque
from pathlib import Path
from urllib.parse import urlparse
import numpy as np
from flask import Flask,jsonify,request,Response
from motor_ai import MotorHealthModel
from motor_ai.preprocessing import CHANNELS
from simulator import MotorSimulator,FAULTS
from power_analytics import PowerAnalyzer
from fault_info import FAULT_INFO

ROOT=Path(__file__).parent

class Engine:
    def __init__(self,start=True):
        self.lock=threading.RLock(); self.model=MotorHealthModel()
        self.sim=MotorSimulator(str(ROOT/'data/combined_dataset.csv'),seed=42)
        self.power=PowerAnalyzer(ROOT/'data/combined_dataset.csv')
        self.rows=deque(maxlen=1200); self.events=deque(maxlen=80)
        self.seq=0; self.ai=None; self.cm=np.zeros((6,6),int); self.transition_windows=0
        self.probs=None; self.error=None; self.last_success=time.monotonic(); self.running=False
        self.thread=None; self.latest_power=None
        if start:
            self.running=True; self.thread=threading.Thread(target=self.loop,daemon=True); self.thread.start()

    def tick(self):
        with self.lock:
            if self.sim.paused:return
            samples=self.sim.step(50); self.seq+=1
            if self.seq%5==0 and self.sim.window() is not None:
                began=time.perf_counter(); r=self.model.predict_array(self.sim.window())
                p=np.array(list(r['probabilities'].values()))
                self.probs=p if self.probs is None else .55*p+.45*self.probs
                stable=FAULTS[int(self.probs.argmax())]
                transition=self.sim.in_transition()
                if transition:self.transition_windows+=1
                else:self.cm[FAULTS.index(self.sim.fault),r['fault_id']]+=1
                if not self.ai or stable!=self.ai['stable']:
                    self.events.append(dict(t=self.sim.t,message=f'Diagnosis: {stable}',fault=stable))
                self.ai={**r,'stable':stable,'stable_confidence':float(self.probs.max()),
                         'transition':transition,'at':self.sim.t,'latency_ms':(time.perf_counter()-began)*1000,
                         'vibration_rms':float(np.sqrt(np.mean(self.sim.window()[:,7]**2)))}
            attribution='Transition / uncertain' if self.sim.in_transition() or not self.ai or self.ai['confidence']<.6 else self.ai['fault']
            pw=self.power.update(samples,.05,attribution); self.latest_power=pw
            m=samples.mean(0)
            factor=math.sqrt(3) if self.power.cfg.phases==3 else 1
            self.rows.append(dict(seq=self.seq,t=self.sim.t,vib=samples[:,7].tolist(),
                v=samples[:,0].reshape(10,5).mean(1).tolist(),i=samples[:,1].reshape(10,5).mean(1).tolist(),
                p=(factor*samples[:,0]*samples[:,1]*samples[:,2]/1000).reshape(10,5).mean(1).tolist(),
                means=dict(zip(CHANNELS,map(float,m))),truth=self.sim.fault,transition=self.sim.in_transition(),
                ai=self.ai,power=pw))
            self.last_success=time.monotonic();self.error=None

    def loop(self):
        deadline=time.monotonic()
        while self.running:
            delay=deadline-time.monotonic()
            if delay>0:time.sleep(min(delay,.05));continue
            deadline=max(deadline+.05,time.monotonic()-.1)
            try:self.tick()
            except Exception as e:
                with self.lock:self.error=f'{type(e).__name__}: {e}'
                time.sleep(.25)

    def close(self):
        self.running=False
        if self.thread:self.thread.join(timeout=3)

    def reset(self):
        with self.lock:
            self.power.reset();self.rows.clear();self.events.clear();self.cm[:]=0;self.transition_windows=0

def create_app(engine=None):
    app=Flask(__name__,static_folder=str(ROOT/'static'))
    app.config['MAX_CONTENT_LENGTH']=2*1024*1024
    engine=engine or Engine();app.config['ENGINE']=engine

    @app.before_request
    def local_api():
        if request.method=='POST':
            origin=request.headers.get('Origin')
            if origin and urlparse(origin).netloc!=request.host:return jsonify(error='Origin mismatch'),403
            if not request.is_json:return jsonify(error='Use application/json'),415

    @app.errorhandler(ValueError)
    @app.errorhandler(TypeError)
    def invalid(e):return jsonify(error=str(e)),400

    @app.get('/')
    def index():return app.send_static_file('index.html')

    @app.get('/api/meta')
    def meta():
        reports={}
        for name in ['validation_results','updated_validation_results','pipeline_validation']:
            file=ROOT/f'reports/{name}.json'
            if file.exists():reports[name]=json.loads(file.read_text(),parse_constant=lambda _:None)
        return jsonify(faults=FAULT_INFO,classes=FAULTS,channels=CHANNELS,fs=1000,window=256,
                       model=engine.model.meta,reports=reports,power=engine.power.config())

    @app.get('/api/stream')
    def stream():
        cursor=int(request.args.get('cursor',0))
        with engine.lock:
            rows=[r for r in engine.rows if r['seq']>cursor]
            gap=bool(rows and rows[0]['seq']>cursor+1)
            if len(rows)>100:rows=rows[-100:];gap=True
            return jsonify(cursor=engine.seq,rows=rows,gap=gap,status=engine.sim.status(),error=engine.error)

    @app.get('/api/summary')
    def summary():
        with engine.lock:
            total=int(engine.cm.sum())
            return jsonify(ledger=engine.power.ledger(),events=list(engine.events),ai=engine.ai,
                power=engine.latest_power,cm=engine.cm.tolist(),windows=total,
                replay_agreement=float(np.trace(engine.cm)/total) if total else None,
                transition_windows=engine.transition_windows,status=engine.sim.status())

    @app.post('/api/control')
    def control():
        b=request.get_json()
        if not isinstance(b,dict) or set(b)-{'mode','fault','severity','noise','paused'}:raise ValueError('Unknown control')
        if 'mode' in b and b['mode'] not in ('auto','manual'):raise ValueError('Invalid mode')
        if 'fault' in b and b['fault'] not in FAULTS:raise ValueError('Invalid fault')
        for key,maximum in [('severity',1),('noise',.6)]:
            if key in b:
                v=b[key]
                if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=maximum:raise ValueError(f'Invalid {key}')
        if 'paused' in b and not isinstance(b['paused'],bool):raise ValueError('paused must be boolean')
        with engine.lock:engine.sim.control(**b);return jsonify(engine.sim.status())

    @app.post('/api/config')
    def configure():
        with engine.lock:return jsonify(engine.power.configure(request.get_json()))

    @app.post('/api/reset')
    def reset():engine.reset();return jsonify(ok=True)

    @app.post('/api/predict')
    def predict():
        b=request.get_json()
        if not isinstance(b,dict) or 'window' not in b:raise ValueError('Provide window: 256 rows x 8 channels')
        with engine.lock:
            r=engine.model.predict_array(b['window']);r['power']=engine.power.instant(b['window'])
        return jsonify(r)

    @app.get('/api/export')
    def export():
        with engine.lock:rows=list(engine.rows)
        out=io.StringIO(); w=csv.writer(out)
        w.writerow(['sim_seconds','scenario','prediction','confidence','transition',*CHANNELS,'power_kw','power_class'])
        for r in rows:
            ai=r['ai'] or {};w.writerow([r['t'],r['truth'],ai.get('fault','warming up'),ai.get('confidence',''),r['transition'],
                *[r['means'][c] for c in CHANNELS],r['power']['p_kw'],r['power']['classification']])
        return Response(out.getvalue(),mimetype='text/csv',headers={'Content-Disposition':'attachment; filename=motorpulse-last-60s.csv'})

    @app.get('/api/health')
    def health():
        with engine.lock:
            ok=engine.error is None and (engine.sim.paused or time.monotonic()-engine.last_success<3)
            return jsonify(ok=ok,error=engine.error,ticks=engine.seq),200 if ok else 503
    return app

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=5000);a=p.parse_args()
    application=create_app()
    print(f'Open http://127.0.0.1:{a.port} — Ctrl+C to stop')
    try:application.run(host='127.0.0.1',port=a.port,threaded=True,debug=False)
    finally:application.config['ENGINE'].close()
