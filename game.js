'use strict';
// Mönkijä Mayhem — a Super Off Road style single-screen ATV racer.
(() => {

// ---------- Constants ----------
const W = 1280, H = 760, HUD_H = 56;
const RES = 2;              // resolution multiplier for the pre-rendered track layers
const LAPS = 3;
const RACES_PER_SEASON = 8;
const GRAVITY = 600;
const TRACK_HW = 64;        // half width of the drivable track
const DS = 4;               // centerline sample spacing (px)
const JUMP_H = 26;
const STEP = 1 / 120;
const ATV_SCALE = 1.2;
// 3/4 view: world y is foreshortened by K on screen and height lifts things straight up.
const K = 0.56;
const WALL_H = 10;           // tyre wall height on screen (px)

const PRIZE = [1000, 600, 350, 150];
const POINTS = [10, 6, 3, 1];
const UP_COST = [300, 550, 850, 1200, 1600];
const MAX_LVL = 5;

// Stadium layouts: corner points in screen space, joined by straights and rounded turns.
const ARENA_TOP = 128;       // screen y of the far stadium wall
const TRACK_DEFS = [
  { name: 'Dust Bowl', seed: 7, hills: 1, jumps: 2, whoops: 1, mud: 2, water: 1,
    pts: [[110,186],[1170,186],[1170,705],[830,705],[830,420],[450,420],[450,705],[110,705]] },
  { name: 'Snake Creek', seed: 21, hills: 1, jumps: 2, whoops: 0, mud: 1, water: 2,
    pts: [[110,186],[1170,186],[1170,335],[290,335],[290,485],[1170,485],[1170,705],[110,705]] },
  { name: 'Mud Flats', seed: 33, hills: 1, jumps: 1, whoops: 1, mud: 4, water: 1,
    pts: [[110,186],[1170,186],[1170,590],[1010,705],[650,705],[650,420],[330,420],[330,705],[110,705]] },
  { name: 'Thunder Ridge', seed: 47, hills: 2, jumps: 2, whoops: 1, mud: 2, water: 1,
    pts: [[110,186],[450,186],[450,340],[830,340],[830,186],[1170,186],[1170,705],[830,705],[830,525],[450,525],[450,705],[110,705]] },
];

const RACER_DEFS = [
  { name: 'YOU',        color: '#e63946', helmet: '#ffffff', isPlayer: true },
  { name: 'DUSTY',      color: '#2f80ed', helmet: '#ffd23f', skill: 0.96, focus: 'speed' },
  { name: 'MUDSLINGER', color: '#f4c430', helmet: '#3a2a1a', skill: 0.92, focus: 'shocks', lovesMud: true },
  { name: 'IRONHOOF',   color: '#2bb673', helmet: '#e8e8e8', skill: 0.94, focus: 'accel' },
];

const SHOP = [
  { key: 'tires',  name: 'Knobby Tires', desc: 'More grip and sharper steering.' },
  { key: 'shocks', name: 'Shocks',       desc: 'Softer landings, less slowdown in mud, water and bumps.' },
  { key: 'accel',  name: 'Engine',       desc: 'Faster acceleration out of corners.' },
  { key: 'speed',  name: 'Top Speed',    desc: 'Higher top speed on the straights.' },
  { key: 'nitro1', name: 'Nitro ×1',     desc: 'One shot of boost.', nitro: 1, cost: 100 },
  { key: 'nitro5', name: 'Nitro ×5',     desc: 'Five shots — bulk discount.', nitro: 5, cost: 400 },
];

// ---------- Helpers ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const ordinal = n => n + (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shade(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const t = a < 0 ? 0 : 255, p = Math.abs(a);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let viewScale = 1, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewScale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = Math.floor(W * viewScale) + 'px';
  canvas.style.height = Math.floor(H * viewScale) + 'px';
  canvas.width = Math.round(W * viewScale * dpr);
  canvas.height = Math.round(H * viewScale * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- Audio ----------
const Sound = {
  ac: null, master: null, engine: null, muted: false,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ac.destination);
      const o1 = this.ac.createOscillator(); o1.type = 'sawtooth';
      const o2 = this.ac.createOscillator(); o2.type = 'square';
      const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      const g = this.ac.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.engine = { o1, o2, f, g };
    } catch (e) { this.ac = null; }
  },
  setEngine(speed, throttle, on) {
    if (!this.engine) return;
    const t = this.ac.currentTime;
    const gear = Math.min(3, Math.floor(speed / 85));
    const r = (speed - gear * 85) / 85;
    const freq = 42 + r * 50 + gear * 9 + (throttle ? 10 : 0);
    this.engine.o1.frequency.setTargetAtTime(freq, t, 0.04);
    this.engine.o2.frequency.setTargetAtTime(freq * 0.5 + 1.3, t, 0.04);
    this.engine.f.frequency.setTargetAtTime(350 + speed * 2.2 + (throttle ? 350 : 0), t, 0.05);
    this.engine.g.gain.setTargetAtTime(on && !this.muted ? (throttle ? 0.11 : 0.06) : 0, t, 0.08);
  },
  blip(freq, dur, type = 'square', vol = 0.12, slide = 0) {
    if (!this.ac || this.muted) return;
    const t = this.ac.currentTime;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.2, freq = 600) {
    if (!this.ac || this.muted) return;
    const t = this.ac.currentTime;
    const len = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ac.createBufferSource(); src.buffer = buf;
    const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ac.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },
};

// ---------- Track ----------
function catmullRom(cp, perSeg) {
  const out = [], n = cp.length;
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n], p3 = cp[(i + 2) % n];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

// Joins corner points with straights and circular fillets of up to `radius`.
function roundedLoop(cp, radius) {
  const out = [], n = cp.length;
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n];
    let d1x = p1.x - p0.x, d1y = p1.y - p0.y;
    const l1 = Math.hypot(d1x, d1y); d1x /= l1; d1y /= l1;
    let d2x = p2.x - p1.x, d2y = p2.y - p1.y;
    const l2 = Math.hypot(d2x, d2y); d2x /= l2; d2y /= l2;
    const cross = d1x * d2y - d1y * d2x, dot = d1x * d2x + d1y * d2y;
    const theta = Math.atan2(Math.abs(cross), dot);
    if (theta < 1e-3) { out.push({ x: p1.x, y: p1.y }); continue; }
    const t = Math.min(radius * Math.tan(theta / 2), l1 * 0.5, l2 * 0.5);
    const r = t / Math.tan(theta / 2);
    const side = Math.sign(cross);
    const sx = p1.x - d1x * t, sy = p1.y - d1y * t;
    const cx = sx - d1y * side * r, cy = sy + d1x * side * r;
    const a0 = Math.atan2(sy - cy, sx - cx);
    const steps = Math.max(2, Math.ceil(theta * r / 3));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + side * theta * k / steps;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  }
  return out;
}

function resampleClosed(poly, ds) {
  const pts = [poly[0]];
  let carry = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = ds - carry;
    while (d <= seg) {
      const t = d / seg;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += ds;
    }
    carry = seg - (d - ds);
  }
  // Drop a trailing point that nearly duplicates the first.
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - pts[0].x, last.y - pts[0].y) < ds * 0.5) pts.pop();
  return pts;
}

function buildTrack(defIndex, reversed) {
  const def = TRACK_DEFS[defIndex];
  // Layouts are authored in screen space; stretch y so the 3/4 projection maps them back.
  let cp = def.pts.map(p => ({ x: p[0], y: p[1] / K }));
  if (reversed) cp.reverse();
  let pts = resampleClosed(roundedLoop(cp, 95), DS);
  let N = pts.length;

  const headings = p => p.map((_, i) => {
    const a = p[(i - 1 + N) % N], b = p[(i + 1) % N];
    return Math.atan2(b.y - a.y, b.x - a.x);
  });
  let ang = headings(pts);
  const turnOf = a => a.map((_, i) => Math.abs(angDiff(a[(i + 1) % N], a[i])));
  let turn = turnOf(ang);
  const winCost = (t, i, len) => { let s = 0; for (let k = 0; k < len; k++) s += t[((i + k) % N + N) % N]; return s; };

  // Start line on the straightest stretch (with room for the grid behind it).
  let bestStart = 0, bestCost = Infinity;
  for (let i = 0; i < N; i += 2) {
    const c = winCost(turn, i - 45, 60);
    if (c < bestCost) { bestCost = c; bestStart = i; }
  }
  pts = pts.slice(bestStart).concat(pts.slice(0, bestStart));
  ang = headings(pts);
  turn = turnOf(ang);

  const nrm = ang.map(a => ({ x: -Math.sin(a), y: Math.cos(a) }));
  const rnd = mulberry32(def.seed + (reversed ? 1000 : 0));
  const occ = new Uint8Array(N);
  const mark = (a, len) => { for (let k = 0; k < len; k++) occ[(a + k) % N] = 1; };
  const free = (a, len) => { for (let k = 0; k < len; k++) if (occ[((a + k) % N + N) % N]) return false; return true; };
  mark(N - 75, 75); mark(0, 45);   // keep the grid and start line clear

  // Rolling hills: smooth cosine bumps in the track's elevation (start area stays flat).
  const elev = new Float32Array(N);
  const hillOcc = occ.slice();
  for (let j = 0; j < (def.hills || 0); j++) {
    for (let tries = 0; tries < 80; tries++) {
      const len = Math.round((280 + rnd() * 220) / DS);
      const a = Math.floor(rnd() * N);
      let ok = true;
      for (let k = -20; k < len + 20; k++) if (hillOcc[((a + k) % N + N) % N]) { ok = false; break; }
      for (let k = 0; k < len && ok; k++) if (pts[(a + k) % N].y * K < 270) ok = false;
      if (!ok) continue;
      const h = 22 + rnd() * 16;
      for (let k = 0; k < len; k++) {
        elev[(a + k) % N] += h * 0.5 * (1 - Math.cos(2 * Math.PI * k / len));
        hillOcc[(a + k) % N] = 1;
      }
      break;
    }
  }

  const height = new Float32Array(N);
  const whoops = new Uint8Array(N);
  const jumps = [], bumps = [], puddles = [];

  const placeStraight = (len, pad, count, out) => {
    for (let j = 0; j < count; j++) {
      let bi = -1, bc = Infinity;
      for (let i = 0; i < N; i += 3) {
        if (!free(i - pad, len + pad * 2)) continue;
        const c = winCost(turn, i - 18, len + 30) + rnd() * 0.05;
        if (c < bc) { bc = c; bi = i; }
      }
      if (bi < 0) return;
      mark(bi - pad, len + pad * 2);
      out.push({ a: bi, len });
    }
  };
  placeStraight(Math.round(84 / DS), 30, def.jumps, jumps);
  placeStraight(Math.round(150 / DS), 20, def.whoops, bumps);

  for (const j of jumps) {
    for (let k = 0; k <= j.len; k++) {
      const t = k / j.len;
      height[(j.a + k) % N] = t < 0.75 ? JUMP_H * t / 0.75 : JUMP_H * (1 - t) / 0.25;
    }
  }
  for (const b of bumps) {
    for (let k = 0; k < b.len; k++) {
      const t = k / b.len;
      height[(b.a + k) % N] = 3 * Math.abs(Math.sin(t * Math.PI * 6));
      whoops[(b.a + k) % N] = 1;
    }
  }
  const addPuddles = (type, count) => {
    for (let j = 0; j < count; j++) {
      for (let tries = 0; tries < 60; tries++) {
        const i = Math.floor(rnd() * N);
        if (!free(i - 12, 24)) continue;
        if (Math.abs(elev[(i + 8) % N] - elev[(i - 8 + N) % N]) > 1) continue;   // keep puddles off slopes
        const r = 24 + rnd() * 14;
        const lat = (rnd() * 2 - 1) * (TRACK_HW - r - 4);
        const p = pts[i], n = nrm[i];
        puddles.push({ type, idx: i, lat, r, x: p.x + n.x * lat, y: p.y + n.y * lat, e: elev[i], seed: rnd() * 1e6 | 0 });
        mark(i - 12, 24);
        break;
      }
    }
  };
  addPuddles('mud', def.mud);
  addPuddles('water', def.water);

  const ground = new Float32Array(N);
  for (let i = 0; i < N; i++) ground[i] = elev[i] + height[i];
  const tr = {
    name: def.name + (reversed ? ' (Reverse)' : ''), seed: def.seed + (reversed ? 1000 : 0),
    pts, N, ang, nrm, hw: TRACK_HW, height, elev, ground, whoops, jumps, bumps, puddles,
  };
  tr.image = renderTrackImage(tr);
  return tr;
}

function groundAt(tr, f) {
  const i = Math.floor(f) % tr.N, t = f - Math.floor(f);
  return lerp(tr.ground[i], tr.ground[(i + 1) % tr.N], t);
}

// Pre-renders the static course in 3/4 view. "World" drawing uses a y-scale of K, and a
// point raised by e screen pixels is drawn at world y - e / K.
function renderTrackImage(tr) {
  const c = document.createElement('canvas');
  c.width = W * RES; c.height = H * RES;
  const g = c.getContext('2d');
  const rnd = mulberry32(tr.seed * 7 + 3);
  const { pts, N, nrm, hw, elev } = tr;
  const toWorld = gg => gg.setTransform(RES, 0, 0, RES * K, 0, 0);
  const toScreen = gg => gg.setTransform(RES, 0, 0, RES, 0, 0);
  const ey = (y, e) => y - e / K;
  const edge = (i, s, r, e) => [pts[i].x + nrm[i].x * s * r, ey(pts[i].y + nrm[i].y * s * r, e)];
  const poly = (gg, list) => {
    gg.beginPath();
    list.forEach(([x, y], k) => k ? gg.lineTo(x, y) : gg.moveTo(x, y));
    gg.closePath(); gg.fill();
  };
  const quadAt = (i, r, ei, ej) => {
    const j = (i + 1) % N;
    return [edge(i, 1, r, ei), edge(j, 1, r, ej), edge(j, -1, r, ej), edge(i, -1, r, ei)];
  };
  const path = (gg, flat) => {
    gg.beginPath();
    pts.forEach((p, i) => { const y = ey(p.y, flat ? 0 : elev[i]); i ? gg.lineTo(p.x, y) : gg.moveTo(p.x, y); });
    gg.closePath();
  };

  // Arena floor: packed dirt across the whole stadium
  toScreen(g);
  g.fillStyle = '#7a5838';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5200; i++) {
    const l = 24 + rnd() * 22;
    g.fillStyle = `hsla(${25 + rnd() * 10},38%,${l}%,0.3)`;
    g.beginPath();
    g.ellipse(rnd() * W, ARENA_TOP + rnd() * (H - ARENA_TOP), 1 + rnd() * 6, 0.6 + rnd() * 2.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Faint rake lines from the grader
  g.strokeStyle = 'rgba(50,30,15,0.07)'; g.lineWidth = 1;
  for (let y = ARENA_TOP + 4; y < H; y += 7) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 3); g.stroke(); }

  toWorld(g);
  g.lineJoin = 'round'; g.lineCap = 'round';
  path(g, true); g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2 * hw + 40; g.stroke();

  // Hill embankments: extrude every raised segment down to the grass.
  const R = hw + 10;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    if (elev[i] < 0.3 && elev[j] < 0.3) continue;
    g.fillStyle = '#6a4829';
    poly(g, quadAt(i, R, 0, 0));
    for (const s of [1, -1]) poly(g, [edge(i, s, R, 0), edge(j, s, R, 0), edge(j, s, R, elev[j]), edge(i, s, R, elev[i])]);
    // Strata lines on the exposed bank
    g.strokeStyle = 'rgba(40,24,10,0.25)'; g.lineWidth = 1;
    for (const f of [0.35, 0.7]) {
      for (const s of [1, -1]) {
        const p1 = edge(i, s, R, elev[i] * f), p2 = edge(j, s, R, elev[j] * f);
        g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke();
      }
    }
  }

  // Dirt surface
  path(g); g.strokeStyle = '#b0855a'; g.lineWidth = 2 * hw + 2; g.stroke();
  for (let i = 0; i < N; i++) {
    const p = pts[i], n = nrm[i];
    for (let k = 0; k < 7; k++) {
      const off = (rnd() * 2 - 1) * hw * 0.97;
      const dark = rnd() < 0.55;
      g.fillStyle = dark ? `rgba(80,50,25,${0.12 + rnd() * 0.18})` : `rgba(215,175,125,${0.12 + rnd() * 0.2})`;
      g.beginPath();
      g.arc(p.x + n.x * off + (rnd() - 0.5) * 4, ey(p.y + n.y * off + (rnd() - 0.5) * 4, elev[i]), 0.6 + rnd() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  path(g); g.strokeStyle = 'rgba(90,58,30,0.16)'; g.lineWidth = hw * 0.9; g.stroke();

  // Slope shading, lit from the upper left
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const grad = (elev[j] - elev[i]) / DS;
    if (Math.abs(grad) < 0.003) continue;
    const b = -grad * (Math.cos(tr.ang[i]) * -0.6 + Math.sin(tr.ang[i]) * -0.8);
    const a = Math.min(0.3, Math.abs(b) * 1.8);
    g.fillStyle = b > 0 ? `rgba(255,235,200,${a})` : `rgba(30,15,5,${a})`;
    poly(g, quadAt(i, hw + 1, elev[i], elev[j]));
  }

  // Whoops (bump sections)
  for (const bp of tr.bumps) {
    for (let k = 0; k < bp.len; k++) {
      const i = (bp.a + k) % N, j = (i + 1) % N;
      const sn = Math.sin((k / bp.len) * Math.PI * 12);
      g.fillStyle = `hsl(28,35%,${34 + sn * 11}%)`;
      poly(g, quadAt(i, hw, tr.ground[i], tr.ground[j]));
    }
  }

  // Jumps: raised ramps with side walls, drawn back to front.
  const parts = [];
  for (const jp of tr.jumps) {
    for (let k = 0; k < 10; k++) {
      const i = (jp.a + jp.len + k) % N, j = (i + 1) % N;
      g.fillStyle = `rgba(30,18,8,${0.35 * (1 - k / 10)})`;
      poly(g, quadAt(i, hw, elev[i], elev[j]));
    }
    for (let k = 0; k < jp.len; k++) {
      const i = (jp.a + k) % N, j = (i + 1) % N;
      const t = k / jp.len;
      const gi = tr.ground[i], gj = tr.ground[j];
      const depth = pts[i].y;
      for (const s of [1, -1]) {
        parts.push({ depth, col: '#4f3520', q: [edge(i, s, hw, elev[i]), edge(j, s, hw, elev[j]), edge(j, s, hw, gj), edge(i, s, hw, gi)] });
      }
      parts.push({ depth: depth + 0.01, col: t < 0.75 ? `hsl(32,42%,${44 + t * 22}%)` : `hsl(26,38%,${24 + (1 - t) * 10}%)`, q: quadAt(i, hw, gi, gj) });
    }
  }
  parts.sort((a, b) => a.depth - b.depth);
  for (const pt of parts) { g.fillStyle = pt.col; poly(g, pt.q); }
  for (const jp of tr.jumps) {
    const i = (jp.a + Math.round(jp.len * 0.75)) % N;
    const p1 = edge(i, 1, hw, tr.ground[i]), p2 = edge(i, -1, hw, tr.ground[i]);
    g.strokeStyle = 'rgba(255,235,200,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke();
  }

  // Mud and water puddles
  for (const p of tr.puddles) {
    const r2 = mulberry32(p.seed);
    const cy = ey(p.y, p.e);
    const blobs = [];
    for (let k = 0; k < 7; k++) {
      const a = r2() * Math.PI * 2, d = r2() * p.r * 0.45;
      blobs.push([p.x + Math.cos(a) * d, cy + Math.sin(a) * d, p.r * (0.5 + r2() * 0.35)]);
    }
    const fill = (col, grow) => {
      g.fillStyle = col;
      for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r + grow, 0, Math.PI * 2); g.fill(); }
    };
    if (p.type === 'mud') {
      fill('#5b3d22', 4); fill('#46301a', 0);
      for (let k = 0; k < 10; k++) {
        g.fillStyle = 'rgba(255,230,190,0.18)';
        g.beginPath(); g.ellipse(p.x + (r2() - 0.5) * p.r, cy + (r2() - 0.5) * p.r, 2 + r2() * 4, 1 + r2() * 2, r2() * 3, 0, Math.PI * 2); g.fill();
      }
    } else {
      fill('#6b5233', 5); fill('#3f6f8f', 0);
      g.fillStyle = 'rgba(160,210,235,0.5)';
      for (let k = 0; k < 6; k++) {
        g.beginPath(); g.ellipse(p.x + (r2() - 0.5) * p.r, cy + (r2() - 0.5) * p.r, 4 + r2() * 6, 1.6, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // Start / finish line
  g.save();
  g.translate(pts[0].x, ey(pts[0].y, elev[0]));
  g.rotate(tr.ang[0]);
  const sq = (2 * hw) / 10;
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 10; k++) {
      g.fillStyle = (row + k) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(-sq + row * sq, -hw + k * sq, sq, sq);
    }
  }
  g.restore();

  // Tyre walls: a ring stamped upward WALL_H pixels, capped with a red/white curb.
  const ring = paint => {
    const r = document.createElement('canvas');
    r.width = c.width; r.height = c.height;
    const rg = r.getContext('2d');
    toWorld(rg); rg.lineJoin = 'round'; rg.lineCap = 'round';
    paint(rg);
    rg.globalCompositeOperation = 'destination-out';
    rg.setLineDash([]); rg.lineCap = 'round';
    path(rg); rg.lineWidth = 2 * hw; rg.strokeStyle = '#000'; rg.stroke();
    return r;
  };
  const solidRing = col => ring(rg => { path(rg); rg.strokeStyle = col; rg.lineWidth = 2 * hw + 20; rg.stroke(); });
  const face = solidRing('#161616'), faceHi = solidRing('#303030');
  const top = ring(rg => {
    path(rg); rg.strokeStyle = '#c62f2f'; rg.lineWidth = 2 * hw + 20; rg.stroke();
    rg.setLineDash([12, 12]); rg.lineCap = 'butt';
    path(rg); rg.strokeStyle = '#f2f2f2'; rg.stroke();
  });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 0.35; g.drawImage(face, 5 * RES, 4 * RES); g.globalAlpha = 1;
  const steps = WALL_H * RES;
  for (let k = 0; k < steps; k++) {
    const mid = k > steps * 0.35 && k < steps * 0.65;
    g.drawImage(mid ? faceHi : face, 0, -k);
  }
  g.drawImage(top, 0, -steps);

  // Infield props (hay bales and tyre stacks) wherever there's room between the lanes.
  toScreen(g);
  const near = (x, y, m) => {
    for (let i = 0; i < N; i += 2) {
      const dx = pts[i].x - x, dy = pts[i].y - y;
      if (dx * dx + dy * dy < m * m) return true;
    }
    return false;
  };
  const props = [];
  for (let i = 0; i < 400 && props.length < 40; i++) {
    const x = 40 + rnd() * (W - 80), y = (ARENA_TOP + 20 + rnd() * (H - ARENA_TOP - 30)) / K;
    if (near(x, y, hw + 26)) continue;
    if (props.some(p => Math.hypot(p.x - x, p.y / K - y) < 40)) continue;
    props.push({ x, y: y * K, hay: rnd() < 0.6 });
  }
  props.sort((a, b) => a.y - b.y);
  for (const p of props) {
    const { x, y } = p;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.ellipse(x + 5, y + 2, 15, 5, 0, 0, Math.PI * 2); g.fill();
    if (p.hay) {
      const w = 26, d = 14, h = 11;
      g.fillStyle = '#b8902f'; g.fillRect(x - w / 2, y - h, w, h);                 // front face
      g.fillStyle = '#e2bd52'; g.fillRect(x - w / 2, y - h - d * K, w, d * K);     // top
      g.strokeStyle = 'rgba(90,60,10,0.6)'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x - 5, y - h - d * K); g.lineTo(x - 5, y); g.moveTo(x + 5, y - h - d * K); g.lineTo(x + 5, y);
      g.stroke();
    } else {
      for (let k = 0; k < 3; k++) {
        const ty = y - k * 5;
        g.fillStyle = '#121212';
        g.beginPath(); g.ellipse(x, ty, 10, 10 * K, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#2c2c2c';
        g.beginPath(); g.ellipse(x, ty - 2, 10, 10 * K, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#0a0a0a';
      g.beginPath(); g.ellipse(x, y - 12, 4.5, 4.5 * K, 0, 0, Math.PI * 2); g.fill();
    }
  }

  // ---- Stadium ----
  const STAND_TOP = HUD_H - 4, BOARD_H = 20;
  // Grandstand behind the far wall, rows of spectators rising away from the floor
  g.fillStyle = '#2b2733';
  g.fillRect(0, 0, W, ARENA_TOP);
  const shirts = ['#e63946', '#f4c430', '#2f80ed', '#2bb673', '#f2f2f2', '#ff8c42', '#9b5de5', '#1d3557', '#e9c46a', '#ef476f'];
  const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  const rowsBottom = ARENA_TOP - BOARD_H - 2;
  for (let ry = 6, row = 0; ry < rowsBottom; ry += 8, row++) {
    g.fillStyle = row % 2 ? '#38323f' : '#332e3a';
    g.fillRect(0, ry + 3, W, 8);
    for (let x = 3 + (row % 2) * 3; x < W; x += 6 + rnd() * 2) {
      if (rnd() < 0.08) continue;   // empty seat
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      g.fillRect(x - 2.5, ry + 2, 5, 5);
      g.fillStyle = skins[Math.floor(rnd() * skins.length)];
      g.beginPath(); g.arc(x, ry, 2.1, 0, Math.PI * 2); g.fill();
    }
  }
  // Advertising boards on the far wall
  const ads = [
    ['MÖNKIJÄ MAYHEM', '#e63946', '#fff'], ['NITRO X', '#1d5fbf', '#ffd23f'], ['MUDPIT TYRES', '#111', '#f4c430'],
    ['DIRT CO.', '#f4c430', '#2a1408'], ['HAY & SONS', '#2bb673', '#fff'], ['4×4 FUEL', '#ff8c42', '#1a1a1a'],
  ];
  const boardY = ARENA_TOP - BOARD_H;
  const bw = W / 8;
  g.font = '12px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < 8; k++) {
    const [txt, bg, fg] = ads[(k + tr.seed) % ads.length];
    g.fillStyle = bg; g.fillRect(k * bw + 1, boardY, bw - 2, BOARD_H);
    g.fillStyle = fg; g.fillText(txt, k * bw + bw / 2, boardY + BOARD_H / 2 + 1);
  }
  g.fillStyle = '#d8d4cc'; g.fillRect(0, boardY - 3, W, 3);              // wall cap
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, ARENA_TOP, W, 5);     // wall shadow on the floor
  // Side and near walls
  for (const sx of [0, W - 12]) {
    g.fillStyle = '#8f8a82'; g.fillRect(sx, ARENA_TOP - 3, 12, H - ARENA_TOP + 3);
    g.fillStyle = '#bdb8ae'; g.fillRect(sx + (sx ? 0 : 8), ARENA_TOP - 3, 4, H - ARENA_TOP + 3);
  }
  g.fillStyle = '#8f8a82'; g.fillRect(0, H - 6, W, 6);
  g.fillStyle = '#bdb8ae'; g.fillRect(0, H - 6, W, 2);
  // Floodlight towers in the far corners
  for (const lx of [26, W - 26]) {
    g.fillStyle = '#555'; g.fillRect(lx - 2, STAND_TOP + 4, 4, ARENA_TOP - STAND_TOP - 4);
    g.fillStyle = '#ddd'; g.fillRect(lx - 12, STAND_TOP - 2, 24, 9);
    g.fillStyle = '#fffbe0';
    for (let k = 0; k < 4; k++) g.fillRect(lx - 10 + k * 5.5, STAND_TOP, 4, 5);
  }
  return c;
}

// Skid-mark layer persists for the length of a race.
const skidLayer = document.createElement('canvas');
skidLayer.width = W * RES; skidLayer.height = H * RES;
const skidCtx = skidLayer.getContext('2d');
skidCtx.setTransform(RES, 0, 0, RES * K, 0, 0);
skidCtx.lineCap = 'round';

// ---------- Game state ----------
const game = {
  state: 'attract',
  time: 0,
  raceTime: 0,
  countdown: 0,
  lastBeep: 0,
  endT: null,
  finishCount: 0,
  pickT: 2,
  msg: '', msgT: 0,
  wrongT: 0,
  raceNo: 0,
  season: null,
  player: null,
};
let track = null;
let racers = [];
let pickups = [];
let particles = [];
let texts = [];

function newSeason() {
  game.season = { race: 0, points: [0, 0, 0, 0] };
  game.player = { money: 500, nitro: 3, up: { tires: 0, shocks: 0, accel: 0, speed: 0 } };
}

function seasonTrack(r) {
  return { index: r % TRACK_DEFS.length, reversed: r >= TRACK_DEFS.length };
}

function aiUpgrades(def, r) {
  const base = Math.min(MAX_LVL, Math.floor(r * 0.6));
  const up = { tires: base, shocks: base, accel: base, speed: base };
  up[def.focus] = Math.min(MAX_LVL, base + 1);
  return up;
}

function makeAI(skill) {
  return { skill, rubber: 1, lane: 0, laneTarget: 0, laneT: 0, stuckT: 0, reverseT: 0 };
}

function setupRace(attract) {
  const r = attract ? 0 : game.season.race;
  const st = attract ? { index: Math.floor(Math.random() * TRACK_DEFS.length), reversed: Math.random() < 0.5 } : seasonTrack(r);
  track = buildTrack(st.index, st.reversed);
  skidCtx.save(); skidCtx.setTransform(1, 0, 0, 1, 0, 0);
  skidCtx.clearRect(0, 0, skidLayer.width, skidLayer.height); skidCtx.restore();
  pickups = []; particles = []; texts = [];
  game.raceTime = 0; game.endT = null; game.finishCount = 0; game.pickT = 2.5;
  game.msg = ''; game.msgT = 0; game.wrongT = 0;

  game.raceNo = r + 1;
  racers = RACER_DEFS.map((d, k) => {
    const c = {
      ...d, id: k, x: 0, y: 0, h: 0, vx: 0, vy: 0, z: 0, vz: 0, air: false, steer: 0,
      nitroT: 0, nitroHeld: false, prog: 0, f: 0, lastF: null, idx: 0, finished: false, place: 0, lap: 1,
      vF: 0, vL: 0, rear: null, gas: false, surface: 'dirt', ai: null,
    };
    if (attract) {
      c.up = { tires: 2, shocks: 2, accel: 2, speed: 2 };
      c.nitro = 2;
      c.ai = makeAI(d.skill || 0.95);
    } else if (d.isPlayer) {
      c.up = game.player.up;
      c.nitro = game.player.nitro;
    } else {
      c.up = aiUpgrades(d, r);
      c.nitro = 2 + Math.floor(r / 2);
      c.ai = makeAI(d.skill + r * 0.004);
    }
    return c;
  });

  // Grid: championship leaders start at the back.
  const order = racers.map((c, k) => k);
  if (attract) order.sort(() => Math.random() - 0.5);
  else order.sort((a, b) => game.season.points[a] - game.season.points[b] || (a === 0 ? 1 : b === 0 ? -1 : 0));
  order.forEach((k, slot) => {
    const c = racers[k];
    const row = Math.floor(slot / 2), col = slot % 2;
    const i = track.N - 8 - row * 14 - col * 4;
    const lat = (col ? 1 : -1) * track.hw * 0.42;
    c.x = track.pts[i].x + track.nrm[i].x * lat;
    c.y = track.pts[i].y + track.nrm[i].y * lat;
    c.h = track.ang[i];
    c.idx = i;
    locate(c, true);
    c.prog = c.f - track.N;
  });
}

// ---------- Input ----------
const keys = {};
const NITRO_KEYS = ['Space', 'ShiftLeft', 'ShiftRight'];
let nitroTap = false;   // latches quick taps that start and end between physics steps
const touch = { left: false, right: false, gas: false, brake: false, nitro: false };
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) { if (NITRO_KEYS.includes(e.code)) nitroTap = true; onKeyPress(e); }
  keys[e.code] = true;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

for (const el of document.querySelectorAll('#touch .tb')) {
  const k = el.dataset.k;
  const on = e => { e.preventDefault(); touch[k] = true; if (k === 'nitro') nitroTap = true; el.classList.add('on'); Sound.init(); };
  const off = e => { e.preventDefault(); touch[k] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
const isTouch = window.matchMedia('(pointer: coarse)').matches;

function playerInput() {
  const right = keys.ArrowRight || keys.KeyD || touch.right;
  const left = keys.ArrowLeft || keys.KeyA || touch.left;
  return {
    gas: !!(keys.ArrowUp || keys.KeyW || touch.gas),
    brake: !!(keys.ArrowDown || keys.KeyS || touch.brake),
    steer: (right ? 1 : 0) - (left ? 1 : 0),
    nitro: consumeNitroTap() || !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touch.nitro),
  };
}

function consumeNitroTap() { const t = nitroTap; nitroTap = false; return t; }

function onKeyPress(e) {
  Sound.init();
  if (e.code === 'KeyM') { Sound.muted = !Sound.muted; return; }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (game.state === 'race' || game.state === 'countdown') { pause(); return; }
    if (game.state === 'paused') { resume(); return; }
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    const btn = overlay.querySelector('.btn.primary');
    if (overlay.classList.contains('show') && btn) { e.preventDefault(); btn.click(); }
    return;
  }
  if (game.state === 'shop') {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= SHOP.length) buy(SHOP[n - 1].key);
  }
}

// ---------- Physics ----------
function stats(c) {
  const u = c.up;
  const ai = c.ai;
  return {
    accel: 300 + 38 * u.accel,
    max: (280 + 20 * u.speed) * (ai ? ai.skill * ai.rubber : 1),
    grip: 5 + 1.5 * u.tires,
    turn: 3.3 + 0.12 * u.tires,
    shocks: u.shocks,
  };
}

// Find the nearest centerline segment and update lap progress.
function locate(c, global) {
  const P = track.pts, N = track.N;
  let best = Infinity, bi = 0, bt = 0;
  const from = global ? 0 : c.idx - 30, to = global ? N : c.idx + 30;
  for (let k = from; k < to; k++) {
    const i = ((k % N) + N) % N;
    const a = P[i], b = P[(i + 1) % N];
    const ex = b.x - a.x, ey = b.y - a.y;
    let t = ((c.x - a.x) * ex + (c.y - a.y) * ey) / (ex * ex + ey * ey);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = c.x - (a.x + ex * t), dy = c.y - (a.y + ey * t);
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; bi = i; bt = t; }
  }
  const a = P[bi], b = P[(bi + 1) % N];
  let ex = b.x - a.x, ey = b.y - a.y;
  const L = Math.hypot(ex, ey) || 1;
  const px = a.x + ex * bt, py = a.y + ey * bt;
  ex /= L; ey /= L;
  c.idx = bi;
  c.tx = ex; c.ty = ey; c.nx = -ey; c.ny = ex;
  c.lat = (c.x - px) * c.nx + (c.y - py) * c.ny;
  const f = bi + bt;
  if (c.lastF !== null) {
    let d = f - c.lastF;
    if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    c.prog += d;
  }
  c.lastF = f; c.f = f;
}

function physics(c, inp, dt) {
  const st = stats(c);
  const g0 = groundAt(track, c.f);
  const onGround = c.z <= g0 + 0.6;

  let surf = 1, gripMul = 1, inMud = false, inWater = false;
  for (const p of track.puddles) {
    const dx = c.x - p.x, dy = c.y - p.y;
    if (dx * dx + dy * dy < p.r * p.r) { if (p.type === 'mud') inMud = true; else inWater = true; }
  }
  if (onGround) {
    if (inMud) { surf *= 0.5 + 0.06 * st.shocks; gripMul *= 0.55; }
    if (inWater) { surf *= 0.62 + 0.05 * st.shocks; gripMul *= 0.7; }
    if (track.whoops[c.idx]) surf *= 0.72 + 0.05 * st.shocks;
  }
  c.surface = inMud ? 'mud' : inWater ? 'water' : 'dirt';

  // Nitro (edge-triggered)
  if (inp.nitro && !c.nitroHeld && c.nitro > 0 && c.nitroT <= 0) {
    c.nitro--; c.nitroT = 1.6;
    if (c.isPlayer && !c.ai) Sound.noise(0.6, 0.25, 1400);
  }
  c.nitroHeld = inp.nitro;
  if (c.nitroT > 0) c.nitroT -= dt;
  const boost = c.nitroT > 0;

  c.steer += (inp.steer - c.steer) * Math.min(1, dt * 12);
  c.gas = inp.gas;
  const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = -fy, ry = fx;
  let vF = c.vx * fx + c.vy * fy, vL = c.vx * rx + c.vy * ry;

  if (onGround) {
    const maxS = st.max * surf * (boost ? 1.4 : 1);
    if (inp.gas && !inp.brake) {
      if (vF < maxS) vF = Math.min(maxS, vF + st.accel * (boost ? 1.9 : 1) * (vF < 0 ? 2.2 : 1) * dt);
    } else if (inp.brake) {
      if (vF > 5) vF -= 560 * dt; else vF = Math.max(-95, vF - 260 * dt);
    } else {
      const fr = 140 * dt;
      vF = Math.abs(vF) < fr ? 0 : vF - Math.sign(vF) * fr;
    }
    // Hills: gravity pulls along the slope.
    const grad = (track.elev[(c.idx + 1) % track.N] - track.elev[c.idx]) / DS;
    vF -= GRAVITY * 0.7 * grad * Math.cos(c.h - track.ang[c.idx]) * dt;
    if (vF > maxS) vF -= (vF - maxS) * Math.min(1, 2.5 * dt);
    const spdF = clamp(vF / 80, -1, 1);
    const hiDamp = 1 - 0.3 * clamp(Math.abs(vF) / st.max, 0, 1);
    c.h += c.steer * st.turn * spdF * hiDamp * dt;
    vL *= Math.exp(-st.grip * gripMul * dt);
    c.vx = fx * vF + rx * vL; c.vy = fy * vF + ry * vL;
  } else {
    c.h += c.steer * 0.8 * dt;
    const k = 1 - 0.08 * dt;
    c.vx *= k; c.vy *= k;
  }
  c.vF = vF; c.vL = vL;

  c.x += c.vx * dt; c.y += c.vy * dt;
  locate(c, false);

  // Tyre walls
  const lim = track.hw - 13;
  if (Math.abs(c.lat) > lim) {
    const s = Math.sign(c.lat), over = Math.abs(c.lat) - lim;
    c.x -= c.nx * s * over; c.y -= c.ny * s * over;
    const vn = (c.vx * c.nx + c.vy * c.ny) * s;
    if (vn > 0) {
      c.vx -= c.nx * s * vn * 1.35; c.vy -= c.ny * s * vn * 1.35;
      c.vx *= 0.97; c.vy *= 0.97;
      if (vn > 90) {
        for (let k = 0; k < 6; k++) spawn(c.x + c.nx * s * 10, c.y + c.ny * s * 10, c.z + 4, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 0.5, 3, [60, 60, 60], 0.6);
        if (c.isPlayer) Sound.noise(0.15, 0.25, 300);
      }
    }
    c.lat = s * lim;
  }

  // Vertical motion: follow the ground, fly off ramp lips.
  const g1 = groundAt(track, c.f);
  c.vz -= GRAVITY * dt;
  c.z += c.vz * dt;
  if (c.z <= g1) {
    if (c.air && c.vz < -170) {
      const loss = clamp((-c.vz - 150) / 300, 0, 0.3) * (1 - st.shocks * 0.15);
      c.vx *= 1 - loss; c.vy *= 1 - loss;
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2;
        spawn(c.x, c.y, c.z, Math.cos(a) * 70, Math.sin(a) * 70, 0.7, 4, [190, 150, 100], 0.6);
      }
      if (c.isPlayer) Sound.noise(0.25, 0.4, 200);
    }
    c.vz = (g1 - g0) / dt;
    c.z = g1;
    c.air = false;
  } else if (c.z > g1 + 2) {
    c.air = true;
  }

  effects(c, inp, onGround);
}

function effects(c, inp, onGround) {
  const fx = Math.cos(c.h), fy = Math.sin(c.h), rx = -fy, ry = fx;
  const rear = [
    { x: c.x - fx * 11 + rx * 11.5, y: c.y - fy * 11 + ry * 11.5 },
    { x: c.x - fx * 11 - rx * 11.5, y: c.y - fy * 11 - ry * 11.5 },
  ];
  const spd = Math.hypot(c.vx, c.vy);
  if (onGround && c.rear) {
    const sliding = Math.abs(c.vL) > 40 || (inp.brake && c.vF > 60) || (inp.gas && c.vF > 5 && c.vF < 70);
    if (sliding || c.surface !== 'dirt') {
      skidCtx.strokeStyle = c.surface === 'water' ? 'rgba(40,30,20,0.10)' : 'rgba(60,35,18,0.14)';
      skidCtx.lineWidth = 3;
      for (let k = 0; k < 2; k++) {
        skidCtx.beginPath();
        skidCtx.moveTo(c.rear[k].x, c.rear[k].y - c.rearE / K);
        skidCtx.lineTo(rear[k].x, rear[k].y - c.z / K);
        skidCtx.stroke();
      }
    }
    if (spd > 50 && Math.random() < spd / 260) {
      const w = rear[Math.random() < 0.5 ? 0 : 1];
      const col = c.surface === 'mud' ? [70, 45, 22] : c.surface === 'water' ? [170, 210, 235] : [195, 158, 110];
      const life = c.surface === 'dirt' ? 0.9 : 0.5;
      spawn(w.x, w.y, c.z, -c.vx * 0.15 + (Math.random() - 0.5) * 40, -c.vy * 0.15 + (Math.random() - 0.5) * 40,
        life, c.surface === 'dirt' ? 3 : 2.5, col, c.surface === 'dirt' ? 0.35 : 0.8, c.surface === 'dirt' ? 14 : 4);
    }
  }
  c.rear = rear;
  c.rearE = c.z;
}

function spawn(x, y, z, vx, vy, life, r, col, alpha, grow = 6) {
  if (particles.length > 700) return;
  particles.push({ x, y, z, vx, vy, life, max: life, r, col, alpha, grow });
}

function collide() {
  const R = 26;
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i], b = racers[j];
      if (Math.abs(a.z - b.z) > 12) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = (R - d) / 2;
      a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
      const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vrel > 0) {
        const imp = vrel * 0.8;
        a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp;
        if (vrel > 60 && (a.isPlayer || b.isPlayer)) Sound.blip(90, 0.12, 'square', 0.15, -40);
      }
    }
  }
}

// ---------- AI ----------
function aiInput(c, dt) {
  const a = c.ai, N = track.N;
  const st = stats(c);
  const spd = Math.hypot(c.vx, c.vy);
  const inp = { gas: true, brake: false, steer: 0, nitro: false };

  a.laneT -= dt;
  if (a.laneT <= 0) { a.laneT = 1.5 + Math.random() * 2.5; a.laneTarget = (Math.random() * 2 - 1) * 0.45; }
  const look = Math.round((28 + spd * 0.32) / DS);
  if (!c.lovesMud) {
    for (const p of track.puddles) {
      const ahead = ((p.idx - c.idx) % N + N) % N;
      if (ahead > 4 && ahead < look * 2.5 && Math.abs(p.lat - a.laneTarget * track.hw) < p.r + 14) {
        a.laneTarget = clamp((p.lat > 0 ? p.lat - p.r - 18 : p.lat + p.r + 18) / track.hw, -0.7, 0.7);
      }
    }
  }
  a.lane += (a.laneTarget - a.lane) * Math.min(1, dt * 1.8);

  const i = (c.idx + look) % N;
  const p = track.pts[i], n = track.nrm[i];
  const tx = p.x + n.x * a.lane * track.hw, ty = p.y + n.y * a.lane * track.hw;
  const diff = angDiff(Math.atan2(ty - c.y, tx - c.x), c.h);
  const curv = Math.abs(angDiff(track.ang[(c.idx + Math.round(look * 2.4)) % N], track.ang[c.idx]));

  if (a.reverseT > 0) {
    a.reverseT -= dt;
    inp.gas = false; inp.brake = true; inp.steer = -Math.sign(diff) || 1;
    return inp;
  }
  if (spd < 25 && game.raceTime > 1.5) {
    a.stuckT += dt;
    if (a.stuckT > 1.2) { a.reverseT = 0.9; a.stuckT = 0; }
  } else a.stuckT = 0;

  inp.steer = clamp(diff * 2.6, -1, 1);
  const cornerSpeed = st.max * (1 - Math.min(0.55, curv * 0.5));
  if (spd > cornerSpeed + 10) {
    inp.gas = false;
    if (spd > cornerSpeed + 45) inp.brake = true;
  }
  if (c.nitro > 0 && c.nitroT <= 0 && curv < 0.25 && Math.abs(diff) < 0.15 && Math.random() < dt * 0.3) inp.nitro = true;
  return inp;
}

// ---------- Race flow ----------
function step(dt) {
  game.time += dt;
  if (game.msgT > 0) game.msgT -= dt;
  const player = racers[0];

  if (game.state === 'countdown') {
    game.countdown -= dt;
    const sec = Math.ceil(game.countdown);
    if (sec !== game.lastBeep && sec >= 1 && sec <= 3) { game.lastBeep = sec; Sound.blip(440, 0.18, 'square', 0.14); }
    const inp = playerInput();
    Sound.setEngine(inp.gas ? 160 + Math.sin(game.time * 30) * 20 : 0, inp.gas, true);
    if (game.countdown <= 0) {
      game.state = 'race';
      Sound.blip(880, 0.45, 'square', 0.16);
      flash('GO!', 1);
    }
    updateParticles(dt);
    return;
  }

  const racing = game.state === 'race';
  if (racing) game.raceTime += dt;

  for (const c of racers) {
    if (c.ai && racing && !c.isPlayer) {
      const gap = c.prog - player.prog;
      c.ai.rubber = player.finished ? 1 : gap > track.N * 0.25 ? 0.93 : gap < -track.N * 0.2 ? 1.06 : 1;
    }
    const inp = c.ai ? aiInput(c, dt) : playerInput();
    physics(c, inp, dt);
    if (c.isPlayer && game.state !== 'attract') Sound.setEngine(Math.abs(c.vF), inp.gas, true);
  }
  if (game.state === 'attract') Sound.setEngine(0, false, false);
  collide();

  if (racing) {
    updatePickups(dt);
    for (const c of racers) {
      const lap = Math.max(1, Math.floor(c.prog / track.N) + 1);
      if (c.isPlayer && !c.finished && lap !== c.lap) {
        if (lap === LAPS) { flash('FINAL LAP!', 2); Sound.blip(660, 0.3, 'triangle', 0.15, 300); }
        else if (lap > c.lap) Sound.blip(520, 0.15, 'triangle', 0.12);
      }
      c.lap = lap;
      if (!c.finished && c.prog >= LAPS * track.N) {
        c.finished = true;
        c.place = ++game.finishCount;
        c.finishTime = game.raceTime;
        if (c.isPlayer) {
          flash(`${ordinal(c.place)} PLACE!`, 4);
          Sound.blip(c.place === 1 ? 784 : 523, 0.6, 'triangle', 0.18, c.place === 1 ? 400 : 0);
          c.ai = makeAI(0.8);   // autopilot the victory lap
        }
      }
    }
    // Wrong-way warning
    const along = player.vx * player.tx + player.vy * player.ty;
    game.wrongT = (!player.finished && along < -30) ? game.wrongT + dt : 0;

    if (game.endT === null && (player.finished || game.finishCount >= 3)) game.endT = player.finished ? 5 : 2.5;
    if (game.endT !== null) {
      if (game.finishCount >= racers.length) game.endT = Math.min(game.endT, 1.2);
      game.endT -= dt;
      if (game.endT <= 0) finishRace();
    }
  }
  updateParticles(dt);
}

function updatePickups(dt) {
  game.pickT -= dt;
  if (game.pickT <= 0 && pickups.length < 3) {
    game.pickT = 3 + Math.random() * 3;
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(Math.random() * track.N);
      if (track.height[i] > 0) continue;
      const lat = (Math.random() * 2 - 1) * (track.hw - 18);
      const p = track.pts[i], n = track.nrm[i];
      const cash = Math.random() < 0.4;
      pickups.push({ x: p.x + n.x * lat, y: p.y + n.y * lat, z: track.elev[i], type: cash ? 'cash' : 'nitro', value: cash ? 50 * (2 + Math.floor(Math.random() * 4)) : 1, life: 14 });
      break;
    }
  }
  for (let k = pickups.length - 1; k >= 0; k--) {
    const p = pickups[k];
    p.life -= dt;
    let taken = false;
    for (const c of racers) {
      if (c.z - groundAt(track, c.f) > 16) continue;
      const dx = c.x - p.x, dy = c.y - p.y;
      if (dx * dx + dy * dy < 20 * 20) {
        taken = true;
        if (p.type === 'nitro') c.nitro++;
        else if (c.isPlayer) game.player.money += p.value;
        if (c.isPlayer) {
          Sound.blip(880, 0.12, 'square', 0.12, 600);
          texts.push({ x: p.x, y: p.y, z: p.z, text: p.type === 'nitro' ? '+NITRO' : `+$${p.value}`, life: 1.2, col: p.type === 'nitro' ? '#7cc7ff' : '#8ee07a' });
        }
        break;
      }
    }
    if (taken || p.life <= 0) pickups.splice(k, 1);
  }
}

function updateParticles(dt) {
  for (let k = particles.length - 1; k >= 0; k--) {
    const p = particles[k];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(k, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt;
    p.r += p.grow * dt;
    p.z += 8 * dt;
  }
  for (let k = texts.length - 1; k >= 0; k--) {
    texts[k].life -= dt;
    texts[k].y -= 30 * dt;
    if (texts[k].life <= 0) texts.splice(k, 1);
  }
}

function flash(text, t) { game.msg = text; game.msgT = t; }

function standings() {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.place - b.place;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.prog - a.prog;
  });
}

function finishRace() {
  const order = standings();
  const rows = order.map((c, i) => {
    const prize = PRIZE[i], pts = POINTS[i];
    game.season.points[c.id] += pts;
    if (c.isPlayer) game.player.money += prize;
    return { c, pos: i + 1, prize, pts };
  });
  game.player.nitro = racers[0].nitro;
  game.season.race++;
  game.state = 'results';
  Sound.setEngine(0, false, false);
  const last = game.season.race >= RACES_PER_SEASON;
  show(`
    <div class="panel">
      <h2>Race ${game.season.race} results</h2>
      <p class="sub">${track.name}</p>
      <table>
        <tr><th>Pos</th><th>Rider</th><th class="num">Prize</th><th class="num">Pts</th><th class="num">Total</th></tr>
        ${rows.map(r => `
          <tr class="${r.c.isPlayer ? 'me' : ''}">
            <td class="pos">${ordinal(r.pos)}</td>
            <td><span class="sw" style="background:${r.c.color}"></span>${r.c.name}</td>
            <td class="num">${r.c.isPlayer ? '$' + r.prize : '—'}</td>
            <td class="num">+${r.pts}</td>
            <td class="num">${game.season.points[r.c.id]}</td>
          </tr>`).join('')}
      </table>
      <div class="money">$${game.player.money}</div>
      <button class="btn primary" data-act="${last ? 'season-end' : 'shop'}">${last ? 'Final standings' : 'To the pit shop'} ▶</button>
    </div>`, true);
}

// ---------- Overlay screens ----------
const overlay = document.getElementById('overlay');
const touchEl = document.getElementById('touch');

function show(html, clear) {
  overlay.innerHTML = html;
  overlay.classList.add('show');
  overlay.classList.toggle('clear', !!clear);
  touchEl.classList.remove('show');
}
function hide() {
  overlay.classList.remove('show');
  touchEl.classList.toggle('show', isTouch);
}

overlay.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  Sound.init();
  const act = btn.dataset.act;
  if (act === 'start') { newSeason(); startRace(); }
  else if (act === 'shop') showShop();
  else if (act === 'next') startRace();
  else if (act === 'season-end') showSeasonEnd();
  else if (act === 'title') showTitle();
  else if (act === 'resume') resume();
  else if (act === 'buy') buy(btn.dataset.key);
});

function showTitle() {
  game.state = 'attract';
  setupRace(true);
  Sound.setEngine(0, false, false);
  show(`
    <div class="panel">
      <div class="logo">MÖNKIJÄ<br><span>MAYHEM</span></div>
      <p class="tag">Four-wheel off-road ATV racing · ${RACES_PER_SEASON}-race season · ${LAPS} laps a race</p>
      <button class="btn primary" data-act="start">Start season ▶</button>
      <div class="keys">
        <span><kbd>↑</kbd> / <kbd>W</kbd></span><span>Gas</span>
        <span><kbd>↓</kbd> / <kbd>S</kbd></span><span>Brake / reverse</span>
        <span><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd></span><span>Steer</span>
        <span><kbd>Space</kbd> / <kbd>Shift</kbd></span><span>Nitro</span>
        <span><kbd>P</kbd> / <kbd>Esc</kbd></span><span>Pause</span>
        <span><kbd>M</kbd></span><span>Mute</span>
      </div>
    </div>`, true);
}

function startRace() {
  setupRace(false);
  game.state = 'countdown';
  game.countdown = 3.5;
  game.lastBeep = 0;
  hide();
}

function pause() {
  game.prevState = game.state;
  game.state = 'paused';
  Sound.setEngine(0, false, false);
  show(`
    <div class="panel">
      <h2>Paused</h2>
      <p class="sub">${track.name} · Race ${game.season.race + 1} of ${RACES_PER_SEASON}</p>
      <button class="btn primary" data-act="resume">Resume</button>
      <button class="btn secondary" data-act="title">Quit to title</button>
    </div>`);
}
function resume() {
  game.state = game.prevState || 'race';
  hide();
}

function shopHTML() {
  const p = game.player;
  const next = seasonTrack(game.season.race);
  const nextName = TRACK_DEFS[next.index].name + (next.reversed ? ' (Reverse)' : '');
  return `
    <div class="panel">
      <h2>Pit shop</h2>
      <p class="sub">Spend your winnings before race ${game.season.race + 1} of ${RACES_PER_SEASON} · <span class="money">$${p.money}</span> · Nitro: ${p.nitro}</p>
      <div class="shop">
        ${SHOP.map((it, k) => {
          let cost, label, disabled;
          if (it.nitro) {
            cost = it.cost; label = `Buy · $${cost}`; disabled = p.money < cost;
          } else {
            const lvl = p.up[it.key];
            cost = UP_COST[lvl];
            disabled = lvl >= MAX_LVL || p.money < cost;
            label = lvl >= MAX_LVL ? 'Maxed out' : `Upgrade · $${cost}`;
          }
          const pips = it.nitro ? '' : `<div class="pips">${Array.from({ length: MAX_LVL }, (_, i) => `<span class="pip ${i < p.up[it.key] ? 'on' : ''}"></span>`).join('')}</div>`;
          return `
            <div class="item">
              <h3>${it.name} <span class="hotkey">[${k + 1}]</span></h3>
              ${pips}
              <p>${it.desc}</p>
              <button class="btn" data-act="buy" data-key="${it.key}" ${disabled ? 'disabled' : ''}>${label}</button>
            </div>`;
        }).join('')}
      </div>
      <button class="btn primary" data-act="next">Next race: ${nextName} ▶</button>
    </div>`;
}
function showShop() {
  game.state = 'shop';
  show(shopHTML());
}
function buy(key) {
  const it = SHOP.find(s => s.key === key);
  const p = game.player;
  if (!it) return;
  if (it.nitro) {
    if (p.money < it.cost) return;
    p.money -= it.cost; p.nitro += it.nitro;
  } else {
    const lvl = p.up[key];
    if (lvl >= MAX_LVL || p.money < UP_COST[lvl]) return;
    p.money -= UP_COST[lvl]; p.up[key]++;
  }
  Sound.blip(660, 0.1, 'square', 0.1, 300);
  const scroll = overlay.querySelector('.panel')?.scrollTop || 0;
  show(shopHTML());
  const panel = overlay.querySelector('.panel');
  if (panel) panel.scrollTop = scroll;
}

function showSeasonEnd() {
  game.state = 'season';
  const order = RACER_DEFS.map((d, k) => ({ d, k, pts: game.season.points[k] }))
    .sort((a, b) => b.pts - a.pts || (a.k === 0 ? -1 : b.k === 0 ? 1 : 0));
  const pos = order.findIndex(o => o.k === 0) + 1;
  show(`
    <div class="panel">
      <div class="logo" style="font-size:clamp(30px,6vw,52px)">${pos === 1 ? 'CHAMPION!' : 'SEASON OVER'}</div>
      <p class="tag">${pos === 1 ? 'You took the championship. The mud is yours.' : `You finished the season ${ordinal(pos).toLowerCase()} overall.`}</p>
      <table>
        <tr><th>Pos</th><th>Rider</th><th class="num">Points</th></tr>
        ${order.map((o, i) => `
          <tr class="${o.k === 0 ? 'me' : ''}">
            <td class="pos">${ordinal(i + 1)}</td>
            <td><span class="sw" style="background:${o.d.color}"></span>${o.d.name}</td>
            <td class="num">${o.pts}</td>
          </tr>`).join('')}
      </table>
      <p class="sub">Prize money left over: $${game.player.money}</p>
      <button class="btn primary" data-act="start">New season ▶</button>
      <button class="btn secondary" data-act="title">Title screen</button>
    </div>`, true);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (game.state === 'race' || game.state === 'countdown')) pause();
});

// ---------- Rendering ----------
// ATVs are drawn as stacked horizontal slices ("sprite stacking"): each slice is a
// top-down outline, foreshortened by K and lifted by its height, which reads as a solid
// 3/4-view model at any heading.
function drawATV(g, c) {
  const S = ATV_SCALE;
  const sy = c.y * K;
  const gz = groundAt(track, c.f);
  const air = c.z - gz;

  g.save();
  g.translate(c.x + 4 + air * 0.4, sy - gz + 2);
  g.scale(1, K); g.rotate(c.h); g.scale(S, S);
  g.fillStyle = `rgba(0,0,0,${0.34 - Math.min(0.16, air / 180)})`;
  rr(g, -15, -13, 30, 26, 8); g.fill();
  g.restore();

  const layer = (hz, fn) => {
    g.save();
    g.translate(c.x, sy - c.z - hz * S);
    g.scale(1, K); g.rotate(c.h); g.scale(S, S);
    fn();
    g.restore();
  };
  const dark = shade(c.color, -0.45), mid = shade(c.color, -0.22), light = shade(c.color, 0.2);
  const wheels = [[9, -9.5, 1], [9, 9.5, 1], [-9, -9.5, 0], [-9, 9.5, 0]];
  const drawWheels = (col, tread) => {
    for (const [wx, wy, front] of wheels) {
      g.save();
      g.translate(wx, wy);
      if (front) g.rotate(c.steer * 0.45);
      g.fillStyle = col; rr(g, -5.5, -3, 11, 6, 2.5); g.fill();
      if (tread) { g.fillStyle = '#3c3c3c'; for (let k = -4; k <= 4; k += 2) g.fillRect(k - 0.5, -3, 1, 6); }
      g.restore();
    }
  };

  // Nitro flame
  if (c.nitroT > 0) {
    layer(6, () => {
      const fl = 10 + Math.random() * 12;
      g.fillStyle = 'rgba(255,170,40,0.9)';
      g.beginPath(); g.moveTo(-13, -4); g.lineTo(-13 - fl, 0); g.lineTo(-13, 4); g.fill();
      g.fillStyle = 'rgba(140,210,255,0.95)';
      g.beginPath(); g.moveTo(-13, -2); g.lineTo(-13 - fl * 0.55, 0); g.lineTo(-13, 2); g.fill();
    });
  }
  // Wheels
  for (let hz = 0; hz <= 5; hz++) layer(hz, () => drawWheels(hz === 5 ? '#262626' : '#111', hz === 5));
  // Frame and body sides
  for (let hz = 4; hz <= 6; hz++) layer(hz, () => { g.fillStyle = '#222'; rr(g, -12, -6, 24, 12, 4); g.fill(); });
  layer(7, () => {
    g.fillStyle = dark;
    rr(g, 4, -12, 10, 24, 4); g.fill();
    rr(g, -14, -12, 10, 24, 4); g.fill();
    rr(g, -12, -7.5, 24, 15, 5); g.fill();
  });
  layer(8, () => {
    g.fillStyle = mid;
    rr(g, 4, -12, 10, 24, 4); g.fill();
    rr(g, -14, -12, 10, 24, 4); g.fill();
    rr(g, -12, -7.5, 24, 15, 5); g.fill();
  });
  layer(9, () => {
    g.fillStyle = c.color;
    rr(g, -12, -7.5, 24, 15, 5); g.fill();
    g.fillStyle = light;
    rr(g, 5, -11.5, 8, 23, 3); g.fill();
    rr(g, -13, -11.5, 8, 23, 3); g.fill();
    g.fillStyle = '#fff6c8';
    g.fillRect(12.5, -5, 1.8, 2.6); g.fillRect(12.5, 2.4, 1.8, 2.6);
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(12, -6); g.lineTo(15, -6); g.lineTo(15, 6); g.lineTo(12, 6);
    g.moveTo(-12, -6); g.lineTo(-15, -6); g.lineTo(-15, 6); g.lineTo(-12, 6);
    g.stroke();
  });
  // Seat, legs and handlebar post
  layer(10, () => {
    g.fillStyle = '#1e1e1e'; rr(g, -10, -4.5, 12, 9, 3); g.fill();
    g.fillStyle = '#222'; g.fillRect(5, -1.5, 3, 3);
    g.fillStyle = '#2b2b33';
    g.beginPath(); g.ellipse(0, -5.5, 4, 1.8, 0, 0, Math.PI * 2); g.ellipse(0, 5.5, 4, 1.8, 0, 0, Math.PI * 2); g.fill();
  });
  layer(11, () => { g.fillStyle = '#2b2b33'; g.beginPath(); g.ellipse(-3, 0, 4.5, 5, 0, 0, Math.PI * 2); g.fill(); });
  layer(12, () => {
    g.strokeStyle = '#111'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(7, -7.5); g.lineTo(7, 7.5); g.stroke();
  });
  // Torso, leaning forward
  for (let hz = 12; hz <= 17; hz++) {
    layer(hz, () => {
      g.fillStyle = hz === 17 ? c.color : mid;
      g.beginPath(); g.ellipse(-4 + (hz - 12) * 0.35, 0, 4.2, 5.6, 0, 0, Math.PI * 2); g.fill();
    });
  }
  layer(15, () => {
    g.strokeStyle = dark; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-1.5, -4.8); g.lineTo(6.5, -7); g.moveTo(-1.5, 4.8); g.lineTo(6.5, 7); g.stroke();
  });
  // Helmet: stacked discs approximating a sphere, with a dark visor facing forward
  for (let hz = 17; hz <= 24; hz++) {
    const r = 4.4 * Math.sqrt(Math.max(0.05, 1 - ((hz - 20.5) / 4) ** 2));
    layer(hz, () => {
      g.fillStyle = c.helmet;
      g.beginPath(); g.arc(-1, 0, r, 0, Math.PI * 2); g.fill();
      if (hz >= 19 && hz <= 21) {
        g.fillStyle = '#151515';
        g.beginPath(); g.arc(-1, 0, r, -0.85, 0.85); g.lineTo(-1, 0); g.fill();
      }
      if (hz === 24) { g.fillStyle = c.color; g.fillRect(-4, -0.9, 6, 1.8); }
    });
  }
}

function drawPickup(g, p) {
  const bob = Math.sin(game.time * 5 + p.x) * 2;
  const fade = p.life < 2 ? (Math.sin(game.time * 20) > 0 ? 1 : 0.3) : 1;
  const sy = p.y * K - p.z;
  g.save();
  g.globalAlpha = fade;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(p.x + 2, sy + 1, 8, 3.5, 0, 0, Math.PI * 2); g.fill();
  g.translate(p.x, sy - 12 + bob);
  if (p.type === 'nitro') {
    g.fillStyle = '#1d5fbf'; rr(g, -6, -9, 12, 18, 4); g.fill();
    g.fillStyle = '#7cc7ff'; rr(g, -4, -7, 3, 14, 1.5); g.fill();
    g.fillStyle = '#ddd'; g.fillRect(-3, -12, 6, 3);
    g.fillStyle = '#fff'; g.font = 'bold 9px Barlow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', 1.5, 1);
  } else {
    g.fillStyle = '#2e7d32'; g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8ee07a'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 12px Barlow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('$', 0, 1);
  }
  g.restore();
}

// Start flags: a pole on each side of the line with a waving checkered flag.
function drawStartFlags(g) {
  const p = track.pts[0], n = track.nrm[0], e = track.elev[0];
  const off = track.hw + 8, POLE = 34, CELL = 3.5;
  for (const s of [1, -1]) {
    const x = p.x + n.x * off * s, y = (p.y + n.y * off * s) * K - e - WALL_H;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.ellipse(x + 3, y + 1, 4, 1.5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d9d9d9'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - POLE); g.stroke();
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 3; row++) {
        const wave = Math.sin(game.time * 8 - col * 0.9) * 1.5;
        g.fillStyle = (col + row) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x + 1 + col * CELL, y - POLE + row * CELL + wave * (col / 3), CELL, CELL);
      }
    }
  }
}

function drawHUD(g) {
  g.fillStyle = 'rgba(18,12,7,0.9)';
  g.fillRect(0, 0, W, HUD_H);
  g.fillStyle = '#f0a04b';
  g.fillRect(0, HUD_H - 2, W, 2);
  const order = standings();
  const pw = W / 4;
  racers.forEach((c, k) => {
    const x = k * pw;
    const pos = order.indexOf(c) + 1;
    g.fillStyle = c.color;
    g.fillRect(x + 10, 9, 6, HUD_H - 20);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = c.isPlayer ? '#fff' : '#e8d9c2';
    g.font = '17px Bungee, Impact, sans-serif';
    g.fillText(c.name, x + 24, 27);
    g.font = '600 13px Barlow, sans-serif';
    g.fillStyle = '#c9b393';
    const lapTxt = c.finished ? 'FINISHED' : `LAP ${Math.min(LAPS, c.lap)}/${LAPS}`;
    g.fillText(lapTxt, x + 24, 45);
    // Nitro canisters
    const nx = x + 110;
    const shown = Math.min(c.nitro, 8);
    for (let i = 0; i < shown; i++) {
      g.fillStyle = '#3b8de0'; g.fillRect(nx + i * 8, 36, 6, 10);
      g.fillStyle = '#9fd3ff'; g.fillRect(nx + i * 8 + 1, 37, 2, 8);
    }
    if (c.nitro > 8) { g.fillStyle = '#9fd3ff'; g.fillText(`+${c.nitro - 8}`, nx + 66, 45); }
    // Position
    g.textAlign = 'right';
    g.font = '26px Bungee, Impact, sans-serif';
    g.fillStyle = pos === 1 ? '#ffd23f' : '#f5e6cf';
    g.fillText(ordinal(pos), x + pw - 12, 38);
    if (c.isPlayer && game.player) {
      g.font = '600 13px Barlow, sans-serif';
      g.fillStyle = '#8ee07a';
      g.fillText(`$${game.player.money}`, x + pw - 12, 52);
    }
  });

  // Footer info
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = '600 13px Barlow, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillText(`RACE ${game.raceNo}/${RACES_PER_SEASON} · ${track.name.toUpperCase()}`, 12, H - 8);
  g.textAlign = 'right';
  const t = game.raceTime;
  g.fillText(`${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}${Sound.muted ? ' · MUTED' : ''}`, W - 12, H - 8);
}

function bigText(g, text, y, size, col = '#ffd23f') {
  g.save();
  g.font = `${size}px Bungee, Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = size / 7; g.strokeStyle = '#2a1408'; g.lineJoin = 'round';
  g.strokeText(text, W / 2, y);
  g.fillStyle = col;
  g.fillText(text, W / 2, y);
  g.restore();
}

function render() {
  const k = viewScale * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (!track) return;
  ctx.drawImage(track.image, 0, 0, W, H);
  ctx.drawImage(skidLayer, 0, 0, W, H);
  // Camera flashes in the crowd
  if (game.state === 'race' || game.state === 'attract') {
    for (let i = 0; i < 2; i++) {
      if (Math.random() < 0.12) {
        ctx.fillStyle = 'rgba(255,255,240,0.9)';
        ctx.beginPath(); ctx.arc(Math.random() * W, 10 + Math.random() * (ARENA_TOP - 40), 1.5 + Math.random() * 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  for (const p of pickups) drawPickup(ctx, p);
  for (const p of particles) {
    const a = (p.life / p.max) * p.alpha;
    ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${a})`;
    ctx.beginPath(); ctx.arc(p.x, p.y * K - p.z, p.r, 0, Math.PI * 2); ctx.fill();
  }
  // Painter's order: riders further up the screen are drawn first.
  const sorted = [...racers].sort((a, b) => a.y - b.y);
  for (const c of sorted) drawATV(ctx, c);
  drawStartFlags(ctx);

  // "YOU" marker early in the race
  const player = racers[0];
  if (game.state !== 'attract' && (game.state === 'countdown' || game.raceTime < 3)) {
    ctx.save();
    ctx.translate(player.x, player.y * K - player.z - 44 + Math.sin(game.time * 6) * 3);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, 8); ctx.fill();
    ctx.font = '12px Bungee, Impact, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('YOU', 0, -4);
    ctx.restore();
  }

  for (const t of texts) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.font = '14px Bungee, Impact, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = '#1a0f05'; ctx.strokeText(t.text, t.x, t.y * K - t.z - 14);
    ctx.fillStyle = t.col; ctx.fillText(t.text, t.x, t.y * K - t.z - 14);
    ctx.restore();
  }

  if (game.state === 'attract') return;
  drawHUD(ctx);

  if (game.state === 'countdown') {
    const n = Math.ceil(game.countdown);
    if (n <= 3) bigText(ctx, String(n), H / 2, 120, '#fff');
    else bigText(ctx, track.name.toUpperCase(), H / 2, 54, '#f5e6cf');
    // Start lights
    for (let i = 0; i < 3; i++) {
      const lit = n <= 3 && 3 - n >= i;
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(W / 2 - 50 + i * 50, H / 2 + 90, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lit ? '#ff3b30' : '#3a1a1a';
      ctx.beginPath(); ctx.arc(W / 2 - 50 + i * 50, H / 2 + 90, 13, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (game.msgT > 0) bigText(ctx, game.msg, H / 2 - 40, 72);
  if (game.wrongT > 0.8 && Math.sin(game.time * 10) > -0.3) bigText(ctx, 'WRONG WAY', H / 2 + 50, 56, '#ff5a4f');
}

// ---------- Main loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.state === 'attract' || game.state === 'countdown' || game.state === 'race') {
    acc += dt;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
  } else {
    acc = 0;
  }
  render();
  requestAnimationFrame(frame);
}

const fontsLoaded = document.fonts
  ? Promise.all([document.fonts.load('12px Bungee'), document.fonts.load('600 13px Barlow')]).catch(() => {})
  : Promise.resolve();
Promise.race([fontsLoaded, new Promise(r => setTimeout(r, 2000))])
  .then(() => { showTitle(); requestAnimationFrame(frame); });

// Exposed for debugging and automated tests.
window.__game = { game, step, setupRace, makeAI, startRace, render, get racers() { return racers; }, get track() { return track; } };
})();
