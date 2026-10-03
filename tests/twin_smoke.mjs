// Exercise real Three.js scene geometry and each animation without a GPU/browser.
import * as RealThree from '../static/vendor/three.module.js';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get(o,k){return o[k]||(()=>{});},set(o,k,v){o[k]=v;return true;}});
class Renderer {constructor(){this.domElement={};}setPixelRatio(){}setSize(){}render(){} }
class PMREM {fromScene(){return {texture:new RealThree.Texture()};}}
class Controls {constructor(){this.target=new RealThree.Vector3();}update(){}}
const THREE={...RealThree,WebGLRenderer:Renderer,PMREMGenerator:PMREM};
const sandbox={THREE,OrbitControls:Controls,RoomEnvironment:class{},window:{devicePixelRatio:1},document:{createElement:()=>({getContext:()=>ctx})},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},console,Math,Float32Array};
vm.createContext(sandbox);
let code=fs.readFileSync(new URL('../static/js/twin.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
vm.runInContext(code+'\nglobalThis.Twin=MotorTwin;globalThis.presets=PRESETS;',sandbox);
const colors={'Healthy':'#22c55e','Belt Misalignment':'#f59e0b','Excessive Load':'#ef4444','Mechanical Imbalance':'#a855f7','Belt Slip':'#06b6d4','Bearing Degradation':'#ec4899'};
const twin=new sandbox.Twin({clientWidth:700,clientHeight:340,appendChild(){}},colors);
let meshCount=0;twin.scene.traverse(o=>{if(o.isMesh)meshCount++;});assert.ok(meshCount>35);
const states={};
for(const fault of Object.keys(colors)){
    twin.setTarget({...sandbox.presets[fault],fault},true);
    for(let i=0;i<60;i++){twin.t+=1/60;twin._update(1/60);}
    twin.scene.updateMatrixWorld(true);
    twin.scene.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite),fault+' finite transform');if(o.geometry?.attributes.position)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite),fault+' finite geometry');});
    states[fault]={yaw:twin.drivenG.rotation.y,heat:twin.mats.body.emissive.r,mass:twin.imbMass.scale.x,bearing:twin.bearingMat.emissive.r,ratio:twin.d.thr};
}
assert.ok(states['Belt Misalignment'].yaw>.1);
assert.ok(states['Excessive Load'].heat>states.Healthy.heat);
assert.equal(states['Mechanical Imbalance'].mass,1);
assert.ok(states['Bearing Degradation'].bearing>states.Healthy.bearing);
assert.ok(states['Belt Slip'].ratio<states.Healthy.ratio);
const phase=twin.phase;twin.stop();twin.renderStill();assert.equal(twin.phase,phase);
console.log('PASS: real Three.js geometry, six distinct animation states, finite transforms, and stopped-frame stability. GPU rendering not tested.');
