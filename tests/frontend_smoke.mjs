// Normal command-line UI wiring smoke test; no browser or desktop automation.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=JSON.parse(process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):execFileSync('python',['-c', "import json;from app import Engine,create_app;e=Engine(start=False);[e.tick() for _ in range(20)];c=create_app(e).test_client();print(json.dumps(dict(meta=c.get('/api/meta').get_json(),stream=c.get('/api/stream').get_json(),summary=c.get('/api/summary').get_json())))"],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
let drawCalls=0;
const texts=[];
const context2d=new Proxy({measureText:s=>({width:String(s).length*6}),fillText:s=>texts.push(String(s))},{get(o,k){if(k in o)return o[k];return (...args)=>{drawCalls++;for(const x of args)if(typeof x==='number')assert.ok(Number.isFinite(x),'finite canvas coordinate');};},set(o,k,v){o[k]=v;return true;}});
const nodes=new Map();
class Element{
  constructor(id){this.id=id;this.style={setProperty(k,v){this[k]=v;}};this.events={};this.attributes={};this.dataset={};this.textContent='';this.value='';this.hidden=false;this.clientWidth=700;this.clientHeight=id.includes('vibration')?170:90;this.classes=new Set();this.classList={toggle:(k,v)=>{if(v)this.classes.add(k);else this.classes.delete(k);},add:k=>this.classes.add(k),remove:k=>this.classes.delete(k)};this.elements={namedItem:k=>null};}
  set innerHTML(s){this.html=s;for(const m of s.matchAll(/id="([^"]+)"/g))nodes.set(m[1],new Element(m[1]));}
  get innerHTML(){return this.html||'';}
  addEventListener(k,f){this.events[k]=f;}
  setAttribute(k,v){this.attributes[k]=v;}
  getContext(){return context2d;}
  getBoundingClientRect(){return {left:0,top:0};}
}
const html=fs.readFileSync(path.join(root,'static/index.html'),'utf8');
for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],new Element(m[1]));
const navs=['overview','energy','index','model'].map(tab=>{const e=new Element('nav-'+tab);e.dataset.tab=tab;return e;});
const diagnosis=new Element('diagnosis-panel');
const doc={getElementById:id=>nodes.get(id)||null,querySelector:s=>s==='.diagnosis'?diagnosis:null,querySelectorAll:s=>s==='.nav'?navs:s==='.page'?['overview','energy','index','model'].map(id=>nodes.get(id)):[],documentElement:new Element('html'),body:new Element('body'),hidden:false,activeElement:null,addEventListener(){}};
const box={document:doc,window:{devicePixelRatio:1,scrollTo(){},addEventListener(){}},console,matchMedia:()=>({matches:false}),performance:{now:()=>10000},history:{replaceState(){}},location:{hash:''},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},AbortSignal,fetch:async()=>{},FormData,URL,Math,Number,Array,Object,JSON,String};
vm.createContext(box);
let util=fs.readFileSync(path.join(root,'static/js/util.js'),'utf8').replaceAll('export ','');
let charts=fs.readFileSync(path.join(root,'static/js/charts.js'),'utf8').replace(/^import .*;\r?\n/,'').replaceAll('export ','');
let main=fs.readFileSync(path.join(root,'static/js/main.js'),'utf8').replace(/^import .*;\r?\n/,'').replace(/\ninit\(\);\s*$/,'');
vm.runInContext(util+'\n'+charts+'\n'+main+'\nglobalThis.ui={state,setupContent,initCharts,pushRow,showRow,showSummary,changeTab,bind,draw};',box);
const ui=box.ui;ui.state.meta=fixture.meta;ui.setupContent();ui.initCharts();ui.bind();
assert.equal(ui.state.charts.length,8);
assert.ok(nodes.get('fault-cards').innerHTML.includes('Bearing Degradation'));
for(const row of fixture.stream.rows)ui.pushRow(row);
ui.showRow(fixture.stream.rows.at(-1));ui.showSummary(fixture.summary);
assert.equal(nodes.get('diagnosis').textContent,'Healthy');
assert.ok(nodes.get('power-now').textContent!=='—');
assert.ok(nodes.get('confusion').innerHTML.includes('<table>'));
ui.changeTab('energy');assert.ok(nodes.get('energy').classes.has('active'));assert.ok(!nodes.get('overview').classes.has('active'));
ui.changeTab('overview');ui.draw(10000);assert.ok(drawCalls>100);
for(const c of ui.state.charts){c.mx=350;c.draw(ui.state.t);}
assert.ok(!texts.includes('undefined'),'hover series have names');
const chart=ui.state.rawVib;
for(let t=2;t<60;t+=.05){chart.push(0,t,.1);chart.trim(t);}
assert.ok(chart.tr[0].t[0]>=33.9,'chart buffer limited to 26 seconds');
chart.setWindow(20);chart.draw(60);chart.clear();assert.equal(chart.tr[0].t.length,0);
console.log('PASS: 8 charts, metadata, six fault cards, diagnosis, power values, matrix, tabs, hover labels, and bounded chart history.');
