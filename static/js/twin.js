import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';

/** Typical operating point per fault (from the dataset) - used by the Fault Index preview. */
export const PRESETS = {
  'Healthy': { rpm: 1470, thr: 1.0, temp: 30, load: 58, vib: 0.024 },
  'Belt Misalignment': { rpm: 1465, thr: 1.0, temp: 34, load: 60, vib: 0.062 },
  'Excessive Load': { rpm: 1430, thr: 1.0, temp: 40, load: 105, vib: 0.047 },
  'Mechanical Imbalance': { rpm: 1467, thr: 1.0, temp: 32, load: 60, vib: 0.080 },
  'Belt Slip': { rpm: 1479, thr: 0.80, temp: 29, load: 49, vib: 0.043 },
  'Bearing Degradation': { rpm: 1465, thr: 1.0, temp: 36, load: 61, vib: 0.065 },
};
const KEY = { 'Healthy': 'ok', 'Belt Misalignment': 'mis', 'Excessive Load': 'load', 'Mechanical Imbalance': 'imb', 'Belt Slip': 'slip', 'Bearing Degradation': 'brg' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const randn = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;

/* ------------------------------------------------------------------ particles */
class Particles {
  constructor(scene, N = 480) {
    this.N = N; this.i = 0;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.size = new Float32Array(N); this.alpha = new Float32Array(N);
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.grav = new Float32Array(N); this.grow = new Float32Array(N); this.s0 = new Float32Array(N); this.bounce = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 520 } },
      vertexShader: 'attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale; void main(){ vC=aColor; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d)*vA; if(a<0.004) discard; gl_FragColor=vec4(vC*a,a); }',
    });
    this.mesh = new THREE.Points(g, m); this.mesh.frustumCulled = false; scene.add(this.mesh); this.mat = m;
    this.life.fill(0);
  }
  emit(o) {
    const k = this.i = (this.i + 1) % this.N, c = new THREE.Color(o.color || '#fff');
    this.pos.set([o.x, o.y, o.z], k * 3); this.vel.set([o.vx || 0, o.vy || 0, o.vz || 0], k * 3);
    this.col.set([c.r, c.g, c.b], k * 3); this.s0[k] = this.size[k] = o.size || .1; this.grow[k] = o.grow || 0; this.grav[k] = o.grav || 0; this.bounce[k] = o.bounce || 0;
    this.life[k] = this.max[k] = o.life || 1; this.alpha[k] = 0;
  }
  update(dt) {
    for (let k = 0; k < this.N; k++) {
      if (this.life[k] <= 0) { this.alpha[k] = 0; continue; }
      this.life[k] -= dt; const f = clamp(this.life[k] / this.max[k], 0, 1), j = k * 3;
      this.vel[j + 1] -= this.grav[k] * dt; this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.bounce[k] && this.pos[j + 1] < -1.86) { this.pos[j + 1] = -1.86; this.vel[j + 1] *= -this.bounce[k]; this.vel[j] *= .6; this.vel[j + 2] *= .6; }
      this.size[k] = this.s0[k] + this.grow[k] * (1 - f);
      this.alpha[k] = Math.min(1, (1 - f) * 9) * Math.pow(f, .8);
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ the twin */
export class MotorTwin {
  constructor(container, colors) {
    this.box = container; this.colors = colors; this.running = false; this.clock = new THREE.Clock(); this.t = 0;
    this.d = { rpm: 1470, thr: 1, temp: 30, load: 58, vib: .024 };       // smoothed data
    this.tgt = { ...this.d, fault: 'Healthy', sev: .5 };
    this.fx = { ok: 1, mis: 0, load: 0, imb: 0, slip: 0, brg: 0 };
    this.col = new THREE.Color(colors['Healthy']); this.colTarget = new THREE.Color(colors['Healthy']);
    this.phase = 0; this.beltOff = 0; this.convOff = 0; this.acc = { sp: 0, sm: 0, dr: 0, ring: 0, hs: 0, rev: 0, deb: 0 };
    this._build(); this._onResize = () => this.resize(); new ResizeObserver(this._onResize).observe(container); this.resize();
  }

  setTarget(d, instant = false) { Object.assign(this.tgt, d); if (instant) { for (const k of ['rpm','thr','temp','load','vib']) this.d[k] = this.tgt[k]; const active = KEY[this.tgt.fault] || 'ok'; for (const k in this.fx) this.fx[k] = k === active ? 1 : 0; this.col.set(this.colors[this.tgt.fault]); this._update(0); } }
  start() { if (!this.running) { this.running = true; this.clock.getDelta(); this._loop(); } }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  renderStill() { this.controls.update(); this.R.render(this.scene, this.cam); }
  resize() { const w = this.box.clientWidth, h = this.box.clientHeight; if (!w || !h) return; if (this.lastWidth === w && this.lastHeight === h) return; this.lastWidth = w; this.lastHeight = h; this.R.setSize(w, h, false); this.cam.aspect = w / h; this.cam.fov = w / h < 1.4 ? 48 : 36; this.cam.updateProjectionMatrix(); this.parts.mat.uniforms.uScale.value = h * 0.62; }
  _loop() { if (!this.running) return; this.raf = requestAnimationFrame(() => this._loop()); const dt = Math.min(this.clock.getDelta(), 0.05); this.t += dt; this._update(dt); this.controls.update(); this.R.render(this.scene, this.cam); }

  /* ---------------------------------------------------------------- scene */
  _build() {
    const R = this.R = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05; R.outputColorSpace = THREE.SRGBColorSpace;
    this.box.appendChild(R.domElement);
    const sc = this.scene = new THREE.Scene(); sc.fog = new THREE.Fog(0x070c13, 16, 34);
    const pm = new THREE.PMREMGenerator(R); sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.cam = new THREE.PerspectiveCamera(36, 1, 0.1, 80); this.cam.position.set(7.8, 4.2, 14.4);
    const oc = this.controls = new OrbitControls(this.cam, R.domElement); oc.target.set(2.0, -0.35, 0.6); oc.enableDamping = true; oc.dampingFactor = .07; oc.minDistance = 5; oc.maxDistance = 22; oc.maxPolarAngle = Math.PI * .52; oc.autoRotate = false;
    sc.add(new THREE.HemisphereLight(0x9ab6d6, 0x0a1018, .55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(5, 8, 7); sc.add(key);
    this.rim = new THREE.PointLight(this.col, 40, 22, 1.6); this.rim.position.set(-4, 2.2, -2); sc.add(this.rim);
    this.fill = new THREE.PointLight(this.col, 22, 16, 1.6); this.fill.position.set(7, 1.2, 4); sc.add(this.fill);
    this.hot = new THREE.PointLight(0xff3b6b, 0, 5, 1.8); this.hot.position.set(0, 0, 1.2); sc.add(this.hot);

    const M = (c, m = .7, r = .4, extra = {}) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r, ...extra });
    this.mats = {
      body: M(0x1c4f78, .55, .38, { emissive: 0x000000 }), fin: M(0x16425f, .6, .4), steel: M(0xb2bcc6, .95, .28), dark: M(0x1a232c, .6, .5), cap: M(0x2a3947, .7, .4),
      flange: M(0x8995a1, .9, .32), floor: M(0x0b121a, .3, .8), crate: M(0x9a7447, .1, .75), crateTop: M(0xb48650, .1, .7),
    };
    this.bearingMat = M(0x303d4a, .85, .3, { emissive: 0x000000 });
    this.rig = new THREE.Group(); sc.add(this.rig);
    this.motorG = new THREE.Group(); this.rig.add(this.motorG);
    this.fixedG = new THREE.Group(); this.rig.add(this.fixedG);

    // floor, grid, state ring, contact shadow
    const fl = new THREE.Mesh(new THREE.CircleGeometry(15, 64), this.mats.floor); fl.rotation.x = -Math.PI / 2; fl.position.y = -1.92; this.rig.add(fl);
    const grid = new THREE.GridHelper(30, 60, 0x1d2b3a, 0x121c28); grid.position.y = -1.91; this.rig.add(grid);
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.col, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    this.floorRing = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.72, 96), this.ringMat); this.floorRing.rotation.x = -Math.PI / 2; this.floorRing.position.set(2.0, -1.9, 0.7); this.rig.add(this.floorRing);
    this.floorRing2 = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.66, 96), this.ringMat.clone()); this.floorRing2.rotation.x = -Math.PI / 2; this.floorRing2.position.copy(this.floorRing.position); this.rig.add(this.floorRing2);
    const sh = document.createElement('canvas'); sh.width = sh.height = 128; { const g = sh.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.set(2.2, -1.9, 0.6); this.rig.add(shadow);

    this._buildMotor(); this._buildBelt(); this._buildConveyor();
    this.parts = new Particles(sc);
    this.rings = []; for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(1, .025, 8, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); m.visible = false; m.userData = { age: 9, dur: 1 }; this.rig.add(m); this.rings.push(m); }
  }

  _buildMotor() {
    const { mats, motorG } = this;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3.3, 56), mats.body); body.rotation.x = Math.PI / 2; body.position.z = -1.65; motorG.add(body);
    for (let i = 0; i < 11; i++) { const f = new THREE.Mesh(new THREE.TorusGeometry(1.03, .05, 8, 56), mats.fin); f.position.z = -0.35 - i * .28; motorG.add(f); }
    const de = new THREE.Mesh(new THREE.CylinderGeometry(.98, 1.02, .38, 56), mats.cap); de.rotation.x = Math.PI / 2; de.position.z = .19; motorG.add(de);
    const hous = new THREE.Mesh(new THREE.CylinderGeometry(.5, .56, .3, 40), mats.flange); hous.rotation.x = Math.PI / 2; hous.position.z = .5; motorG.add(hous);
    this.bearing = new THREE.Mesh(new THREE.TorusGeometry(.43, .075, 16, 48), this.bearingMat); this.bearing.position.z = .67; motorG.add(this.bearing);
    const nde = new THREE.Mesh(new THREE.CylinderGeometry(1.0, .94, .4, 56), mats.cap); nde.rotation.x = Math.PI / 2; nde.position.z = -3.42; motorG.add(nde);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, s = new THREE.Mesh(new THREE.BoxGeometry(.05, .5, .3), mats.dark); s.position.set(Math.cos(a) * .55, Math.sin(a) * .55, -3.66); s.rotation.z = a; motorG.add(s); }
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(.94, .94, .12, 40), mats.dark); fan.rotation.x = Math.PI / 2; fan.position.z = -3.7; motorG.add(fan);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(.95, .5, .85), mats.cap); tb.position.set(0, 1.12, -1.4); motorG.add(tb);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 16), new THREE.MeshBasicMaterial({ color: this.col })); this.lamp.position.set(0, 1.45, -1.4); motorG.add(this.lamp);
    for (const sx of [-1, 1]) for (const z of [-0.2, -2.7]) { const ft = new THREE.Mesh(new THREE.BoxGeometry(.4, .36, .5), mats.cap); ft.position.set(sx * .95, -.92, z); motorG.add(ft); }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.9, .2, 4.4), mats.dark); plate.position.set(0, -1.15, -1.55); this.fixedG.add(plate);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(3.1, .65, 4.6), mats.cap); ped.position.set(0, -1.58, -1.55); this.fixedG.add(ped);

    // rotating assembly: shaft + drive pulley (+ eccentric mass)
    this.shaftG = new THREE.Group(); this.shaftG.position.z = 0; this.motorG.add(this.shaftG);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, 1.6, 24), mats.steel); shaft.rotation.x = Math.PI / 2; shaft.position.z = .8; this.shaftG.add(shaft);
    this.pulley1 = this._pulley(.78, .52); this.pulley1.position.z = 1.1; this.shaftG.add(this.pulley1);
    this.imbMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: .9, metalness: .3, roughness: .4 });
    this.imbMass = new THREE.Mesh(new THREE.SphereGeometry(.2, 24, 24), this.imbMat); this.imbMass.position.set(.52, 0, 1.45); this.imbMass.scale.setScalar(.001); this.shaftG.add(this.imbMass);
  }
  _pulley(r, w) {
    const g = new THREE.Group(), core = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 56), this.mats.steel); core.rotation.x = Math.PI / 2; g.add(core);
    for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(r + .09, r + .09, .06, 56), this.mats.flange); f.rotation.x = Math.PI / 2; f.position.z = s * (w / 2 + .01); g.add(f); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * .24, r * .24, w + .16, 28), this.mats.dark); hub.rotation.x = Math.PI / 2; g.add(hub);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, sp = new THREE.Mesh(new THREE.BoxGeometry(r * .78, .055, .04), this.mats.dark); sp.position.set(Math.cos(a) * r * .55, Math.sin(a) * r * .55, w / 2 + .05); sp.rotation.z = a; g.add(sp); }
    const mark = new THREE.Mesh(new THREE.BoxGeometry(.16, .1, .05), new THREE.MeshBasicMaterial({ color: 0xffffff })); mark.position.set(r - .05, 0, w / 2 + .09); g.add(mark);
    return g;
  }

  _buildBelt() {
    this.r1 = .78 + .035; this.r2 = 1.12 + .035; this.c1 = new THREE.Vector2(0, 0); this.c2 = new THREE.Vector2(3.8, 0); this.bz = 1.1;
    // driven pulley + stand
    this.drivenG = new THREE.Group(); this.drivenG.position.set(this.c2.x, 0, this.bz); this.rig.add(this.drivenG);
    this.pulley2 = this._pulley(1.12, .52); this.drivenG.add(this.pulley2);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, 1.7, 24), this.mats.steel); axle.rotation.x = Math.PI / 2; axle.position.z = -.4; this.drivenG.add(axle);
    for (const z of [-.95, .2]) { const blk = new THREE.Mesh(new THREE.BoxGeometry(.6, .5, .4), this.mats.cap); blk.position.set(this.c2.x, -.1, z + this.bz - .1); this.fixedG.add(blk); const st = new THREE.Mesh(new THREE.BoxGeometry(.4, 1.4, .3), this.mats.cap); st.position.set(this.c2.x, -1.15, z + this.bz - .1); this.fixedG.add(st); }
    // belt path (uniform arc-length samples)
    const d = this.c2.x - this.c1.x, th = Math.acos((this.r1 - this.r2) / d), pts = [];
    const arc = (c, r, a0, a1, n) => { for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]); } };
    const seg = (p, q, n) => { for (let i = 0; i < n; i++) pts.push([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]); };
    const T1t = [this.c1.x + this.r1 * Math.cos(th), this.r1 * Math.sin(th)], T2t = [this.c2.x + this.r2 * Math.cos(th), this.r2 * Math.sin(th)];
    const T2b = [T2t[0], -T2t[1]], T1b = [T1t[0], -T1t[1]];
    seg(T1t, T2t, 60); arc(this.c2, this.r2, th, -th, 50); seg(T2b, T1b, 60); arc(this.c1, this.r1, -th, th - Math.PI * 2, 40);
    // resample uniformly
    const cum = [0]; for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    this.L = cum[cum.length - 1]; const N = this.N = 240; this.bp = [];
    for (let k = 0; k < N; k++) { const s = k / N * this.L; let i = 1; while (cum[i] < s) i++; const a = pts[i - 1], b = pts[i % pts.length], f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); this.bp.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, s]); }
    const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 2 * 2), idx = [];
    for (let k = 0; k <= N; k++) { const p = this.bp[k % N]; uv.set([k / N, 0, k / N, 1], k * 4); if (k < N) { const a = k * 2, b = (k + 1) * 2; idx.push(a, a + 1, b, a + 1, b + 1, b); } }
    const g = this.beltGeo = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    const tc = document.createElement('canvas'); tc.width = 256; tc.height = 32; { const c = tc.getContext('2d'); c.fillStyle = '#1b1f24'; c.fillRect(0, 0, 256, 32); c.fillStyle = '#39424c'; c.fillRect(0, 0, 256, 3); c.fillRect(0, 29, 256, 3); c.fillStyle = '#6b7885'; for (let i = 0; i < 2; i++) c.fillRect(i * 128 + 54, 4, 20, 24); c.fillStyle = '#ffffff'; c.fillRect(120, 6, 8, 20); }
    this.beltTex = new THREE.CanvasTexture(tc); this.beltTex.wrapS = THREE.RepeatWrapping; this.beltTex.repeat.set(22, 1); this.beltTex.colorSpace = THREE.SRGBColorSpace; this.beltTex.anisotropy = 4;
    this.beltMat = new THREE.MeshStandardMaterial({ map: this.beltTex, side: THREE.DoubleSide, roughness: .75, metalness: .05, emissive: 0x000000 });
    this.belt = new THREE.Mesh(g, this.beltMat); this.belt.frustumCulled = false; this.rig.add(this.belt);
    this._beltZ(0, 0);
  }
  /** rebuild belt vertex z (lateral wander) - amplitude a, wave speed w */
  _beltZ(a, tw) {
    const p = this.beltGeo.attributes.position, hw = .245, N = this.N;
    for (let k = 0; k <= N; k++) { const q = this.bp[k % N], s = q[2] / this.L, z = this.bz + a * Math.sin(s * Math.PI * 2 * 1.5 - tw) * (0.5 + 0.5 * Math.sin(s * Math.PI * 2 + tw * .3)); p.setXYZ(k * 2, q[0], q[1], z - hw); p.setXYZ(k * 2 + 1, q[0], q[1], z + hw); }
    p.needsUpdate = true; this.beltGeo.computeVertexNormals();
  }

  _buildConveyor() {
    const { mats, rig } = this, x0 = 3.8, len = 5.2, cz = this.bz;
    const tc = document.createElement('canvas'); tc.width = 128; tc.height = 64; { const c = tc.getContext('2d'); c.fillStyle = '#20262d'; c.fillRect(0, 0, 128, 64); c.fillStyle = '#323a44'; for (let i = 0; i < 4; i++) c.fillRect(i * 32 + 10, 0, 6, 64); c.fillStyle = '#4a5560'; c.fillRect(0, 0, 128, 3); c.fillRect(0, 61, 128, 3); }
    this.convTex = new THREE.CanvasTexture(tc); this.convTex.wrapS = this.convTex.wrapT = THREE.RepeatWrapping; this.convTex.repeat.set(10, 1); this.convTex.colorSpace = THREE.SRGBColorSpace;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(len, .14, 1.9), [mats.dark, mats.dark, new THREE.MeshStandardMaterial({ map: this.convTex, roughness: .8 }), mats.dark, mats.dark, mats.dark]); bed.position.set(x0 + len / 2, -1.2, cz); rig.add(bed);
    for (const z of [-.98, .98]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(len, .26, .08), mats.flange); rail.position.set(x0 + len / 2, -1.06, cz + z); rig.add(rail); }
    for (const x of [x0 + .6, x0 + len - .3]) for (const z of [-.8, .8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.14, .72, .14), mats.cap); leg.position.set(x, -1.56, cz + z); rig.add(leg); }
    this.conv = { x0, len, cz }; this.crates = [];
    for (let i = 0; i < 5; i++) { const g = new THREE.Group(), b = new THREE.Mesh(new THREE.BoxGeometry(.62, .5, .62), mats.crate), t = new THREE.Mesh(new THREE.BoxGeometry(.52, .42, .52), mats.crateTop); b.position.y = .25; t.position.y = .71; g.add(b, t); g.userData = { x: x0 + .35 + i * (len - .4) / 5, lane: rnd(-.45, .45), top: t }; g.position.set(g.userData.x, -1.13, cz + g.userData.lane); rig.add(g); this.crates.push(g); }
  }

  /* ---------------------------------------------------------------- per-frame */
  _ring(color, x, y, z, scale0, scale1, dur, rotY = 0) {
    const m = this.rings.find(r => r.userData.age >= r.userData.dur); if (!m) return;
    m.material.color.set(color); m.position.set(x, y, z); m.rotation.set(0, rotY, 0); m.userData = { age: 0, dur, s0: scale0, s1: scale1 }; m.visible = true;
  }
  _update(dt) {
    const T = this.t, D = this.d, G = this.tgt, K = (r) => 1 - Math.exp(-r * dt);
    // smooth data
    for (const k of ['rpm', 'thr', 'temp', 'load', 'vib']) D[k] += (G[k] - D[k]) * K(4);
    // fault intensities (cross-fade between visual states)
    const act = KEY[G.fault] || 'ok'; for (const k in this.fx) this.fx[k] += ((k === act ? 1 : 0) - this.fx[k]) * K(2.6);
    const fx = this.fx, fcol = this.colors[G.fault] || '#22c55e'; this.colTarget.set(fcol); this.col.lerp(this.colTarget, K(3));
    const volt = clamp((D.vib - .022) / .06, 0, 1.4), heatN = clamp((D.temp - 31) / 11, 0, 1);

    // rotation (visual speed scaled down) + belt kinematics
    const w = D.rpm / 1500 * 7.2; this.phase += w * dt; this.shaftG.rotation.z = -this.phase;
    const vBelt = w * this.r1 * D.thr, w2 = vBelt / this.r2; this.pulley2.rotation.z -= w2 * dt;
    this.beltTex.offset.x -= vBelt * dt / this.L * this.beltTex.repeat.x; this.convTex.offset.x -= vBelt * dt / this.conv.len * this.convTex.repeat.x;

    // --- misalignment: driven pulley yaw + belt wander
    const misA = fx.mis; this.drivenG.rotation.y = misA * (.16 + .04 * Math.sin(T * 1.7)); this.drivenG.position.x = this.c2.x;
    this._beltZ(misA * .17 + fx.slip * .012, T * 3.2);

    // --- shake: imbalance (1x), bearing (broadband rattle), misalignment (2x), plus generic vibration level
    const base = volt * .012, imbA = fx.imb * (.045 + .03 * volt), brgA = fx.brg * (.012 + .012 * volt), misS = fx.mis * .012;
    const ph = this.phase;
    this.motorG.position.set(imbA * Math.cos(ph) + misS * Math.cos(2 * ph) + brgA * randn() + base * randn() * .5, imbA * .7 * Math.sin(ph) + brgA * randn() + base * randn() * .5, 0);
    this.motorG.rotation.z = brgA * .5 * randn() + imbA * .03 * Math.sin(ph);
    this.shaftG.position.set(fx.imb * .035 * Math.cos(-ph * 1) + fx.brg * .012 * randn(), fx.imb * .035 * Math.sin(-ph) + fx.brg * .012 * randn(), 0);
    this.belt.position.set(imbA * Math.cos(ph) * .6, imbA * .4 * Math.sin(ph) * .6, 0);
    this.imbMass.scale.setScalar(Math.max(.001, fx.imb)); this.imbMat.emissiveIntensity = .5 + .5 * Math.abs(Math.sin(T * 6));

    // --- thermal glow / bearing glow / belt tint
    const pulse = .5 + .5 * Math.sin(T * 5);
    const heat = fx.load * (.38 + .22 * pulse) + heatN * (.12 + .25 * fx.load);
    this.mats.body.emissive.setRGB(1, .2 + .1 * (1 - heat), .04).multiplyScalar(clamp(heat, 0, .85));
    this.mats.fin.emissive.copy(this.mats.body.emissive).multiplyScalar(.55);
    const bg = fx.brg * (.65 + .35 * Math.random()) + heatN * .15;
    this.bearingMat.emissive.set(0xff2d7a).multiplyScalar(clamp(bg, 0, 1.2)); this.hot.intensity = fx.brg * 14 * (.6 + .4 * Math.random()) + fx.load * 6 * pulse;
    this.hot.color.set(fx.load > fx.brg ? 0xff5522 : 0xff2d7a);
    this.beltMat.emissive.set(0xf59e0b).multiplyScalar(fx.mis * .22).add(new THREE.Color(0x06b6d4).multiplyScalar(fx.slip * .14 * (.7 + .3 * pulse)));

    // --- status lighting
    this.rim.color.copy(this.col); this.fill.color.copy(this.col); this.rim.intensity = 32 + 12 * Math.sin(T * 1.6); this.fill.intensity = 18;
    this.ringMat.color.copy(this.col); this.floorRing2.material.color.copy(this.col);
    const rs = 1 + .035 * Math.sin(T * (act === 'ok' ? 1.2 : 3.2)); this.floorRing.scale.set(rs, rs, 1); this.ringMat.opacity = .38 + .22 * (act === 'ok' ? Math.sin(T * 1.2) * .5 + .5 : pulse);
    const ex = (T * .35) % 1; this.floorRing2.scale.set(.82 + ex * .5, .82 + ex * .5, 1); this.floorRing2.material.opacity = (1 - ex) * .35;
    this.lamp.material.color.copy(this.col).multiplyScalar(act === 'ok' ? 1 : .35 + .65 * (Math.sin(T * (act === 'load' ? 9 : 5)) > 0 ? 1 : .15));

    // --- crates ride the conveyor; stack up under overload
    const cs = .78 + .22 * clamp(D.load / 100, 0, 1.2);
    for (const c of this.crates) { const u = c.userData; u.x += vBelt * dt * 1.0; if (u.x > this.conv.x0 + this.conv.len - .4) { u.x = this.conv.x0 + .3; u.lane = rnd(-.45, .45); } c.position.set(u.x, -1.13, this.conv.cz + u.lane); c.scale.set(cs, cs, cs); u.top.visible = fx.load > .35 || D.load > 90; }

    // --- particles & rings
    this._emit(dt, T, fx, volt, heatN);
    for (const r of this.rings) { const u = r.userData; if (u.age < u.dur) { u.age += dt; const f = u.age / u.dur, s = u.s0 + (u.s1 - u.s0) * (1 - Math.pow(1 - f, 2)); r.scale.setScalar(s); r.material.opacity = (1 - f) * .75; if (f >= 1) r.visible = false; } }
    this.parts.update(dt);
  }

  _emit(dt, T, fx, volt, heatN) {
    const P = this.parts, a = this.acc, c1 = this.c1, z = this.bz, ph = this.phase, col = this.colors;
    // belt slip: friction sparks + smoke at the drive-pulley contact line
    a.sp += dt * (fx.slip * 70); while (a.sp > 1) { a.sp--; const side = Math.random() < .5 ? 1 : -1, ang = side > 0 ? 1.7 : -1.7;
      P.emit({ x: c1.x + this.r1 * Math.cos(ang) * 1 + rnd(-.2, .2) + 0.55, y: side * (this.r1 - .02) + rnd(-.05, .05), z: z + rnd(-.25, .25), vx: rnd(-.4, 1.2), vy: side * rnd(.1, .9), vz: rnd(-.3, .3), life: rnd(.25, .6), size: rnd(.05, .12), color: Math.random() < .5 ? '#7ae8ff' : '#e8fbff', grav: 2.0 }); }
    a.sm += dt * (fx.slip * 11); while (a.sm > 1) { a.sm--; P.emit({ x: rnd(.2, 1.4), y: this.r1 * (Math.random() < .5 ? 1 : -1) * .9, z: z + rnd(-.2, .2), vx: rnd(-.1, .3), vy: rnd(.3, .7), vz: rnd(-.1, .1), life: rnd(1, 1.8), size: .22, grow: .55, color: '#2b8fa0', grav: -.1 }); }
    // excessive load: heat shimmer / smoke rising from the motor
    a.hs += dt * (fx.load * 26 + heatN * 3); while (a.hs > 1) { a.hs--; P.emit({ x: rnd(-.6, .6), y: 1.05, z: rnd(-3, -.4), vx: rnd(-.05, .05), vy: rnd(.45, .9), vz: rnd(-.05, .05), life: rnd(1.3, 2.4), size: .28, grow: .7, color: '#ff6a2a', grav: -.05 }); }
    // misalignment: amber edge-wear sparks at the pulley flange
    a.dr += dt * (fx.mis * 16); while (a.dr > 1) { a.dr--; const ang = rnd(0, Math.PI * 2), rr = 1.14, px = this.c2.x + Math.cos(ang) * rr, py = Math.sin(ang) * rr; P.emit({ x: px, y: py, z: z + (Math.random() < .5 ? .3 : -.3) + this.drivenG.rotation.y * 1.1, vx: Math.cos(ang) * rnd(.2, .9), vy: Math.sin(ang) * rnd(.2, .9) + .3, vz: rnd(-.4, .4), life: rnd(.3, .7), size: rnd(.04, .09), color: '#ffc23d', grav: 2.2 }); }
    // bearing: metal debris falling and bouncing
    a.deb += dt * (fx.brg * 22); while (a.deb > 1) { a.deb--; P.emit({ x: rnd(-.35, .35), y: -.3, z: .7 + rnd(-.1, .1), vx: rnd(-.3, .3), vy: rnd(0, .6), vz: rnd(.0, .7), life: rnd(1.1, 1.9), size: rnd(.04, .08), color: Math.random() < .5 ? '#ff7ab0' : '#ffd7e6', grav: 5.5, bounce: .45 }); }
    // pulse rings: imbalance once per revolution, bearing at defect rate, healthy occasional
    a.rev += dt * (this.d.rpm / 1500 * 7.2) / (Math.PI * 2);
    if (a.rev >= 1) { a.rev -= 1; if (fx.imb > .4) this._ring(col['Mechanical Imbalance'], 0, 0, z, .8, 2.7, .9); }
    a.ring += dt; if (fx.brg > .4 && a.ring > .17) { a.ring = 0; this._ring(col['Bearing Degradation'], 0, 0, .68, .5, 1.5, .5); }
    if (fx.ok > .6 && a.ring > 2.4) { a.ring = 0; this._ring(col['Healthy'], 0, 0, z + .3, .8, 3.4, 1.8); }
  }
}
