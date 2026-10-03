"""Command-line integration and numerical tests: python -m unittest discover -s tests"""
import sys,unittest,math,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import numpy as np
from app import Engine,create_app
from power_analytics import PowerAnalyzer
from simulator import FAULTS

class PowerTests(unittest.TestCase):
    def setUp(self):self.p=PowerAnalyzer(ROOT/'data/combined_dataset.csv')
    def samples(self):return np.tile([400.,10.,.8,1500.,.8,30.,58.,.02],(50,1))
    def test_three_phase_and_hour_energy(self):
        x=self.samples();r=self.p.update(x,3600,'Healthy')
        expected=math.sqrt(3)*400*10*.8/1000
        self.assertAlmostEqual(r['p_kw'],expected,12)
        self.assertAlmostEqual(self.p.ledger()['kwh'],expected,12)
        self.assertAlmostEqual(r['s_kva'],math.sqrt(3)*4,12)
    def test_power_uses_average_of_products(self):
        x=self.samples();x[:25,0]=300;x[25:,0]=500;x[:25,1]=5;x[25:,1]=15
        got=self.p.instant(x)['p_kw'];expected=math.sqrt(3)*np.mean(x[:,0]*x[:,1]*x[:,2])/1000
        self.assertAlmostEqual(got,expected,12)
        self.assertNotAlmostEqual(got,math.sqrt(3)*x[:,0].mean()*x[:,1].mean()*.8/1000)
    def test_single_phase_reference_scales(self):
        a=self.p.instant(self.samples());self.p.configure({'phases':1});b=self.p.instant(self.samples())
        self.assertAlmostEqual(a['p_kw']/b['p_kw'],math.sqrt(3))
        self.assertAlmostEqual(a['ref_kw']/b['ref_kw'],math.sqrt(3))
    def test_settings_atomic_and_finite(self):
        before=self.p.config()
        for bad in [{'phases':2},{'tariff_per_kwh':float('nan')},{'rated_current_a':0},{'elevated_pct':50,'critical_pct':10},{'currency':'<x>'}]:
            with self.assertRaises(ValueError):self.p.configure(bad)
            self.assertEqual(before,self.p.config())
    def test_ledger_preserves_historical_cost(self):
        x=self.samples();self.p.update(x,3600,'Healthy');cost=self.p.cost;kwh=self.p.kwh
        self.p.configure({'tariff_per_kwh':.24});self.assertEqual(self.p.cost,cost)
        self.p.update(x,3600,'Belt Slip');self.assertAlmostEqual(self.p.cost,cost+kwh*.24)
        with self.assertRaises(ValueError):self.p.configure({'phases':1})
    def test_uncalibrated_reference_never_books_excess(self):
        x=self.samples();x[:,6]=120;self.p.update(x,3600,'Excessive Load')
        self.assertFalse(self.p.instant(x)['reference_valid']);self.assertEqual(self.p.excess_kwh,0)
    def test_fault_label_cannot_change_power(self):
        x=self.samples();a=self.p.update(x,.05,'Healthy');b=self.p.update(x,.05,'Bearing Degradation')
        self.assertEqual(a['p_kw'],b['p_kw'])
    def test_invalid_measurements(self):
        for column,value in [(0,-1),(1,-2),(2,1.2),(7,float('nan'))]:
            x=self.samples();x[:,column]=value
            with self.assertRaises(ValueError):self.p.instant(x)

class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.e=Engine(start=False);cls.client=create_app(cls.e).test_client()
    def test_01_all_fault_scenarios(self):
        for fault in FAULTS:
            self.assertEqual(self.client.post('/api/control',json={'mode':'manual','fault':fault,'severity':.5,'noise':0,'paused':False}).status_code,200)
            for _ in range(65):self.e.tick()
            self.assertEqual(self.e.ai['fault'],fault)
            self.assertFalse(self.e.ai['transition'])
            r=self.client.get('/api/stream?cursor='+str(self.e.seq-2)).get_json()
            self.assertEqual(len(r['rows']),2);self.assertEqual(len(r['rows'][0]['vib']),50)
            self.assertAlmostEqual(sum(self.e.ai['probabilities'].values()),1,5)
        self.assertEqual(self.e.cm.shape,(6,6))
    def test_pause_does_not_accumulate_energy(self):
        self.client.post('/api/control',json={'paused':True});seq=self.e.seq;kwh=self.e.power.kwh
        for _ in range(10):self.e.tick()
        self.assertEqual(seq,self.e.seq);self.assertEqual(kwh,self.e.power.kwh)
        self.client.post('/api/control',json={'paused':False})
    def test_bad_requests(self):
        for data in [{'fault':'fake'},{'noise':1},{'paused':'false'},{'severity':None},{'mode':'other'}]:
            self.assertEqual(self.client.post('/api/control',json=data).status_code,400)
        for data in [{},{'window':[[1]*8]*3},{'window':[[float('nan')]*8]*256}]:
            self.assertEqual(self.client.post('/api/predict',json=data).status_code,400)
        self.assertEqual(self.client.post('/api/control',data='{}').status_code,415)
        self.assertEqual(self.client.post('/api/control',json={},headers={'Origin':'https://unrelated.example'}).status_code,403)
    def test_external_prediction_no_ledger_side_effect(self):
        energy=self.e.power.kwh
        w=self.e.sim.seg['Healthy'][:256].tolist();r=self.client.post('/api/predict',json={'window':w})
        self.assertEqual(r.status_code,200);self.assertEqual(r.get_json()['fault'],'Healthy')
        self.assertEqual(self.e.power.kwh,energy)
    def test_http_assets_and_report(self):
        for path in ['/','/api/meta','/api/health','/api/summary','/api/export','/static/app.css','/static/js/main.js','/static/vendor/three.module.js','/static/vendor/OrbitControls.js','/static/vendor/RoomEnvironment.js']:
            response=self.client.get(path);self.assertEqual(response.status_code,200,path);response.close()
        self.assertIn('pipeline_validation',self.client.get('/api/meta').get_json()['reports'])
        def invalid_constant(value):raise AssertionError('Non-standard JSON constant: '+value)
        json.loads(self.client.get('/api/meta').text,parse_constant=invalid_constant)
        self.assertIn('prediction',self.client.get('/api/export').text.splitlines()[0])
    def test_reset(self):
        self.client.post('/api/reset',json={});self.assertEqual(self.e.power.kwh,0);self.assertEqual(self.e.cm.sum(),0)
    def test_frontend_ids_and_relative_imports(self):
        html=(ROOT/'static/index.html').read_text(encoding='utf-8');js=(ROOT/'static/js/main.js').read_text(encoding='utf-8')
        ids=re.findall(r'\bid="([^"]+)"',html);self.assertEqual(len(ids),len(set(ids)))
        for ident in re.findall(r"\$\('([^']+)'\)",js):self.assertIn(ident,ids)
        for path in (ROOT/'static/js').glob('*.js'):
            for imp in re.findall(r"from ['\"](\./[^'\"]+)['\"]",path.read_text(encoding='utf-8')):self.assertTrue((path.parent/imp).exists())

if __name__=='__main__':unittest.main(verbosity=2)
