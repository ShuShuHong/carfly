/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 启动、主循环（1/120 s 固定步长累加器 + 渲染插值）、状态机、相机、事件分发。
import * as THREE from 'three';
import { CFG, OPEN, PAR_TIME } from './config.js';
import { Sim } from './sim.js';
import { Input } from './input.js';
import { buildCar } from './car.js';
import { World } from './world.js';
import { Particles } from './vfx.js';
import { Stunt } from './stunt.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { TEXT } from './text.js';

const $ = s => document.querySelector(s);
const LS = { best: 'carfly_best', bestStunt: 'carfly_best_stunt', low: 'carfly_lowq', sound: 'carfly_sound' };
const getNum = k => Number(localStorage.getItem(k) || 0);

// ---------------- 布局：9:16 竖屏，HUD 按 1080 宽缩放 ----------------
const gameEl = $('#game'), hudEl = $('#hud'), canvas = $('#gl');
let layout = { s: 1, W: 1080, H: 1920, w: 0, h: 0, left: 0 };
function doLayout() {
  const vw = innerWidth, vh = innerHeight;
  const w = vw / vh > 9 / 16 ? Math.round(vh * 9 / 16) : vw;   // 桌面横屏：居中 9:16；手机：铺满
  const left = Math.round((vw - w) / 2);
  Object.assign(gameEl.style, { left: `${left}px`, width: `${w}px`, right: 'auto' });
  const s = w / 1080, H = vh / s;
  hudEl.style.setProperty('--s', s);
  hudEl.style.setProperty('--H', `${H}px`);
  // 摇杆中心：(200, H−320) / (880, H−320)，在 1920 高时即规格的 (200,1600)/(880,1600)
  CFG.input.L[1] = CFG.input.R[1] = H - 320;
  layout = { s, W: 1080, H, w, h: vh, left };
  if (renderer) {
    renderer.setSize(w, vh, false);                               // 只 setSize，不重建 renderer
    camera.aspect = w / vh; camera.updateProjectionMatrix();
    fx.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(CFG.cam.fov / 2))));
  }
}

// ---------------- 渲染器 ----------------
let lowQ = localStorage.getItem(LS.low) === '1';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const applyDpr = () => renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowQ ? 1.5 : 2));  // dpr cap 2，低画质 1.5
applyDpr();
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(CFG.cam.fov, 9 / 16, 0.1, 900);
const world = new World(renderer);
const car = buildCar();
world.scene.add(car.root);
const fx = new Particles(world.scene);
const stunt = new Stunt(car, fx, world);
const hud = new Hud(hudEl);
const audio = new Audio();
doLayout();
addEventListener('resize', doLayout);
addEventListener('orientationchange', () => setTimeout(doLayout, 200));

const input = new Input(gameEl, (cx, cy) => {
  const r = gameEl.getBoundingClientRect();
  return [(cx - r.left) / layout.s, (cy - r.top) / layout.s];
}, {
  L: { ring: $('#stick-L .ring'), knob: $('#stick-L .knob') },
  R: { ring: $('#stick-R .ring'), knob: $('#stick-R .knob') },
});

// ---------------- 文案 ----------------
$('#t-title').textContent = TEXT.title;
$('#t-sub').textContent = TEXT.subtitle;
$('#howto').innerHTML = TEXT.howto.map(([a, b]) => `<div><b>${a}</b>${b}</div>`).join('');
$('#btn-start').textContent = TEXT.start;
$('#btn-again').textContent = TEXT.again;
$('#t-low').textContent = TEXT.lowQ;
$('#t-sound').textContent = TEXT.sound;
$('#r-title').textContent = TEXT.result.title;
$('#rotate').textContent = TEXT.rotate;
const optLow = $('#opt-low'), optSound = $('#opt-sound');
optLow.checked = lowQ;
optSound.checked = localStorage.getItem(LS.sound) !== '0';
optLow.addEventListener('change', () => { lowQ = optLow.checked; localStorage.setItem(LS.low, lowQ ? '1' : '0'); applyDpr(); doLayout(); });
optSound.addEventListener('change', () => { localStorage.setItem(LS.sound, optSound.checked ? '1' : '0'); setMute(); });
function setMute() { audio.muted = !optSound.checked; if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.7; }
function showBest() {
  const t = `${TEXT.best} ${getNum(LS.best).toLocaleString('en-US')} · ${TEXT.bestStunt} ${getNum(LS.bestStunt).toLocaleString('en-US')}`;
  $('#menu-best').textContent = t; $('#r-best').textContent = t;
}
showBest();

// ---------------- 状态机 ----------------
let sim = new Sim();
let state = 'menu';         // menu | countdown | race | outro | result
let pendingResult = null;
let countdown = 0, acc = 0, tutorialStep = 0, wrongFloatAcc = 0;
let prevCar = null; const prevTruckZ = new Map();
const cam = { x: sim.c.x, h: { x: 0, v: 0 }, sp: { x: 0, v: 0 }, fov: CFG.cam.fov, guard: 0 };

async function start() {
  await audio.unlock();     // iOS 音频解锁点
  setMute();
  try { if (screen.orientation?.lock) await screen.orientation.lock('portrait').catch(() => {}); } catch { /* iOS 不支持 */ }
  $('#menu').classList.remove('show'); $('#result').classList.remove('show');
  sim = new Sim();
  stunt.reset(); fx.clear(); world.clearTrucks(); prevTruckZ.clear(); prevCar = null;
  resetCam(sim.c.x);
  tutorialStep = 0; wrongFloatAcc = 0; acc = 0; pendingResult = null;
  state = 'countdown'; countdown = 3.0;
  input.enabled = true;
  hudEl.classList.add('playing');
  hud.tip(TEXT.tips.stickL, 3);
}
$('#btn-start').addEventListener('click', start);
$('#btn-again').addEventListener('click', start);

// 过线白闪：HUD 层一记 0.32 s 的白闪 + 轻微缩放，是"这一刻"最直接的仪式感
function flashScreen() {
  const el = $('#flash');
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
}
// 冲线：不立刻弹面板。锁输入 → sim 走滑停曲线 → 停稳+hold 后才 showResult()
function beginOutro() {
  state = 'outro';
  pendingResult = sim.result || sim.results();
  input.enabled = false; input.releaseAll();
  hud.hideTip();
  hud.clearPops();                   // 冲线那一刻把残留的得分飘字清掉
  sim.wrongWay = false;
  world.flashGate();                 // 门架灯光爆闪
  audio.oneShot('finish');
}

function showResult(r) {
  state = 'result';
  hud.hideTip();
  hudEl.classList.remove('playing');
  const best = getNum(LS.best), bestStunt = getNum(LS.bestStunt);
  const newBest = r.final > best;
  if (newBest) localStorage.setItem(LS.best, r.final);
  if (r.stunt > bestStunt) localStorage.setItem(LS.bestStunt, r.stunt);
  const R = TEXT.result, f = n => Number(n).toLocaleString('en-US');
  $('#r-final').textContent = f(r.final);
  $('#r-newbest').textContent = newBest ? R.newBest : '';
  const rows = [
    [R.time, `${r.time.toFixed(1)} s`], [R.par, `${r.par.toFixed(1)} s`],
    [R.stunt, f(r.stunt)], [R.timeBonus, f(r.timeBonus)],
    [R.earned, `${r.earned}`, 'hl'], [R.earnedScore, f(Math.round(r.earned * CFG.score.earnedMul))],
    [R.rolls, r.rolls], [R.hurdles, r.hurdles], [R.perfect, r.perfect], [R.crashes, r.crashes],
  ];
  // 逐行出现：每行错开 75 ms（延迟写在 CSS 变量里，见 style.css 的 #result.anim）
  $('#r-table').innerHTML = rows
    .map(([a, b, c], i) => `<tr class="${c || ''}" style="--i:${i}"><td>${a}</td><td>${b}</td></tr>`).join('');
  showBest();
  const panel = $('#result');
  panel.classList.remove('show', 'anim');
  void panel.offsetWidth;            // 强制回流，让动画每次都能重放
  panel.classList.add('show', 'anim');
  countUp($('#r-final'), r.final);
}

// 大分数从 0 滚到最终分（面板一出现就起跳，0.45 s 跑完 → 2 s 内分数已经落地）
function countUp(el, target) {
  const dur = 450, delay = 80, t0 = performance.now();
  const step = (now) => {
    const k = Math.max(0, Math.min(1, (now - t0 - delay) / dur));
    el.textContent = Number(Math.round(target * (1 - Math.pow(1 - k, 3)))).toLocaleString('en-US');
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------- 事件分发 ----------------
let capTipShown = false;
function handleEvents() {
  for (const e of sim.events) {
    stunt.on(e);
    switch (e.type) {
      case 'earn':
        if (e.units > 0) { hud.floatGas(`+${Math.round(e.units)}`); audio.oneShot('nitro_earn'); }
        else if (e.wasted > 0) {
          hud.floatGas(`+${Math.round(e.wasted)}`, true);    // 罐满/额度满：灰色飘字表示作废
          if (e.capped && !capTipShown) { capTipShown = true; hud.tip(TEXT.tips.earnCapped, 2); }
        }
        break;
      case 'score': {
        const cls = e.label.startsWith('横滚') ? 'gold' : e.label === TEXT.pop.perfect ? 'blue' : '';
        hud.pop(`${e.label} +${Math.round(e.pts)}`, cls); audio.oneShot('score_pop');
        break;
      }
      case 'trickLost': hud.pop(TEXT.pop.lost, 'red small'); break;
      case 'land': {
        audio.oneShot('landing', { k: Math.min(1, Math.abs(e.vy) / 20) });
        if (e.banked > 0) hud.pop(`+${Math.round(e.banked)}`, 'gold small');
        // 姿态干净但不够高 → 明说为什么没给完美落地分（否则玩家以为是 bug）
        if (e.clean && !e.perfect) hud.pop(TEXT.pop.lowLand, 'dim small');
        break;
      }
      case 'flip': hud.pop(TEXT.pop.flip, 'red'); audio.oneShot('impact'); break;
      case 'crash':
        audio.oneShot('impact'); fx.sparks(e.x, e.y, -e.z); fx.crashSmoke(e.x, e.y, -e.z);
        if (e.kind === 'headon') hud.pop(TEXT.pop.headon, 'red small');
        // v2.1 车顶落地：货车=拍脑袋砍半，轿车=你主责清零
        if (e.kind === 'roofTruck') hud.pop(TEXT.pop.headBonk, 'gold small');
        if (e.kind === 'roofCar') hud.pop(TEXT.pop.carFault, 'red small');
        break;
      case 'guardrail': audio.oneShot('guard'); fx.sparks(e.x, e.y, -e.z, -e.side, 20); break;
      case 'gasEmpty': audio.oneShot('valve_empty'); hud.tip(TEXT.tips.gasEmpty, 2.5); break;
      case 'draftLock': audio.oneShot('draft_lock'); break;
      case 'launch': audio.oneShot('launch'); break;
      case 'apex': apexDip = true; break;
      case 'tutorialTruck': tutorialStep = Math.max(tutorialStep, 2); hud.tip(TEXT.tips.draft, 4); break;
      case 'oncomingStart': hud.tip(TEXT.tips.wrong, 4); break;
      case 'finishRunIn': world.flashGate(); audio.oneShot('score_pop'); break;   // 70 m 外就先点亮门架
      case 'finish': beginOutro(); flashScreen(); break;
      default: break;
    }
  }
  sim.events.length = 0;
}

// ---------------- 相机（v1.3） ----------------
// 思路：机位"骑"在车的上后方，离地越高 → 机位越高、越往后拉、视线越往下俯，
// 让"车 + 车正下方的路面（影子/落点环）"始终同框，玩家能读出离地距离。
// 速度越快 → 稍微拉远、看得更远、FOV 微增。所有量都走临界阻尼弹簧：连续、无过冲、与帧率无关。
const _v = new THREE.Vector3();
const D2R = Math.PI / 180;
function spring(st, target, w, dt) {
  // 临界阻尼二阶弹簧，按 1/120 s 子步积分，保证低帧率下也稳定
  let t = dt;
  while (t > 1e-6) {
    const h = Math.min(t, 1 / 120); t -= h;
    st.v += (w * w * (target - st.x) - 2 * w * st.v) * h;
    st.x += st.v * h;
  }
  return st.x;
}
function resetCam(x) {
  cam.x = x; cam.h = { x: 0, v: 0 }; cam.sp = { x: 0, v: 0 }; cam.fov = CFG.cam.fov; cam.guard = 0; cam.outro = 0;
}
function updateCamera(dt, s) {
  const C = CFG.cam;
  cam.x += (s.x - cam.x) * (1 - Math.exp(-dt / C.latTau));        // 横向：指数平滑，有变道拉扯感
  const vs = spring(cam.sp, Math.min(1, s.vz / CFG.lon.vmax), C.aheadW, dt);   // 速度系数 0..1
  const h = Math.max(0, spring(cam.h, s.y, C.springW, dt));         // 平滑后的离地高度

  // 冲线收尾运镜：0.35 s 内后拉 + 抬高（快一点，别让车卡在画面最下方被摇杆挡住）
  const ok = state === 'outro' || state === 'result' ? 1 : 0;
  cam.outro = (cam.outro ?? 0) + (ok - (cam.outro ?? 0)) * (1 - Math.exp(-dt / 0.35));

  const back = C.back + C.backSpeed * vs + C.airBack * h + stunt.cam.back + CFG.outro.camBack * cam.outro;
  const camY = C.height + C.heightSpeed * vs + C.airRise * h + stunt.cam.dip + stunt.cam.rise + CFG.outro.camRise * cam.outro;
  // 前视点同步收近：注视点越近，车在画面里越靠上（收尾时把车从画面底部抬到中段）
  const ahead = (C.ahead + C.aheadSpeed * vs) * (1 - 0.62 * cam.outro);
  const camZ = -s.z + back;

  // 注视点：车前 ahead 米处、高度 airLook·h（低于车）→ 车飞起来时视线自然下俯，路面不出画
  const lookY = C.airLook * h;
  let lookAng = Math.atan2(lookY - camY, back + ahead);
  // 安全护栏：车不能出画面上缘 / 车正下方的路面不能出画面下缘（留 7° 边距）
  const half = (cam.fov / 2) * D2R;
  const carAng = Math.atan2(s.y + 0.65 - camY, back);
  const groundAng = Math.atan2(-camY, back);
  const minLook = carAng - half + 7 * D2R;     // 视线再低，车就顶出上缘
  const maxLook = groundAng + half - 7 * D2R;  // 视线再高，车下的路面就掉出下缘
  const want = minLook > maxLook ? (minLook + maxLook) / 2 : Math.min(maxLook, Math.max(minLook, lookAng));
  cam.guard += (want - lookAng - cam.guard) * (1 - Math.exp(-dt / 0.15));   // 护栏修正也平滑，避免跳变
  lookAng += cam.guard;

  // FOV：高速微增（速度感），平滑
  const fovT = C.fov + C.fovSpeed * vs;
  if (Math.abs(fovT - cam.fov) > 0.01) { cam.fov = fovT; camera.fov = fovT; camera.updateProjectionMatrix(); }

  // 抖动（px → 米，按 1920 逻辑高、在车所在距离处换算）
  const mpp = 2 * Math.tan(half) * back / 1920;
  const sh = stunt.shakePx * mpp;
  camera.position.set(cam.x + (Math.random() - 0.5) * 2 * sh, camY + (Math.random() - 0.5) * 2 * sh, camZ);
  camera.up.set(0, 1, 0);                      // 地平线始终水平，不跟车滚
  const dist = back + ahead;
  camera.lookAt(cam.x, camY + Math.tan(lookAng) * dist, camZ - dist);
}

// ---------------- 离地距离提示：车正下方的影子 + 落点环（纯图形，无文字） ----------------
function blobTex(draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  map: blobTex(g => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,0.9)'); r.addColorStop(0.55, 'rgba(0,0,0,0.6)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); }),
  transparent: true, depthWrite: false, toneMapped: false,
}));
shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 5;
const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  map: blobTex(g => { g.strokeStyle = 'rgba(160,215,255,1)'; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke(); g.lineWidth = 3; g.globalAlpha = 0.5; g.beginPath(); g.arc(64, 64, 36, 0, Math.PI * 2); g.stroke(); }),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
}));
ring.rotation.x = -Math.PI / 2; ring.renderOrder = 6;
world.scene.add(shadow, ring);
function updateGroundMarkers(s) {
  const h = Math.max(0, s.y);
  // 影子：越高越大越淡（贴地时就是车身大小的接触阴影）
  const k = Math.min(1, h / 18);
  shadow.position.set(s.x, 0.035, -s.z);
  shadow.scale.set(2.6 + 2.2 * k, 5.4 + 2.0 * k, 1);
  shadow.material.opacity = 0.75 * (1 - 0.6 * k);
  // 落点环：离地 > 0.8 m 才出现；越接近地面越小越亮，读得出"还有多高、多快落地"
  const show = s.air && h > 0.8;
  ring.visible = show;
  if (show) {
    const r = 1.6 + 0.35 * h;
    ring.position.set(s.x, 0.04, -s.z);
    ring.scale.set(r * 2, r * 2, 1);
    ring.material.opacity = Math.max(0.25, 1 - h / 22) * (s.vy < 0 ? 1 : 0.6);
  }
}

// ---------------- 主循环 ----------------
let last = performance.now(), apexDip = false, audioErrLogged = false;
const fpsLog = [];
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  fpsLog.push(dt); if (fpsLog.length > 120) fpsLog.shift();
  const inp = input.read();

  if (state === 'countdown') {
    const before = Math.ceil(countdown);
    countdown -= dt;
    const n = Math.ceil(countdown);
    $('#countdown').textContent = countdown > 0 ? String(n) : 'GO';
    if (n !== before) audio.oneShot('score_pop');
    if (countdown <= -0.5) { state = 'race'; $('#countdown').textContent = ''; }
    else if (countdown <= 0 && state === 'countdown') { /* GO 显示 0.5s，同时已开跑 */ }
  }
  const running = state === 'race' || state === 'outro' || (state === 'countdown' && countdown <= 0);
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= CFG.dt) {
      acc -= CFG.dt;
      prevCar = { ...sim.c };
      prevTruckZ.clear(); for (const t of sim.trucks) prevTruckZ.set(t.id, t.z);
      sim.step(inp);                                 // 冲线后 sim 自己走滑停曲线，不再冻结
      if (++n > 24) { acc = 0; break; }              // 掉帧保护：最多补 0.2 s 仿真，别再拖慢收尾时序
    }
    handleEvents();
    if (state === 'outro') {
      if (sim.outroDone) showResult(pendingResult || sim.result);   // 停稳 + hold 才出面板
    } else {
      if (tutorialStep === 0 && sim.t > 3) { tutorialStep = 1; hud.tip(TEXT.tips.stickR, 3.5); }
      if (sim.wrongWay) { wrongFloatAcc += dt; if (wrongFloatAcc >= 1) { wrongFloatAcc -= 1; if (sim.earnBudget > 0) hud.floatGas('+10'); } }
      else wrongFloatAcc = 0;
    }
  }

  // 插值后的渲染状态
  const a = running && prevCar ? acc / CFG.dt : 1;
  const c = sim.c, p = prevCar || c;
  const L = (k) => p[k] + (c[k] - p[k]) * a;
  const s = {
    // 落地那一步 roll 已清零，不能插值（否则会出现一帧倒转回正的残影）
    x: L('x'), y: L('y'), z: L('z'), roll: c.air ? L('roll') : c.roll, vy: c.vy, vz: c.vz, w: c.w,
    air: c.air, thrusting: c.thrusting, rolling: c.rolling, retro: c.retro, levelDir: c.levelDir,
    braking: c.braking,
    finished: sim.finished, stopped: sim.stopped, driftSide: sim.driftSide, outroT: sim.outroT,
  };
  stunt.frame(dt, s);
  world.update(s.z, s.x, dt);
  world.syncTrucks(sim.trucks, s.z, a, prevTruckZ);
  fx.update(dt);
  updateCamera(dt, s);
  updateGroundMarkers(s);

  // 尾随进度环投影到前车尾部
  let ringPos = null;
  if (sim.draft.id !== null) {
    const t = sim.trucks.find(q => q.id === sim.draft.id);
    if (t) {
      _v.set(t.x, 2.2, -(t.z - t.len / 2)).project(camera);
      const d = Math.max(4, t.z - t.len / 2 - s.z + CFG.cam.back);
      ringPos = [(_v.x + 1) / 2 * layout.W, (1 - _v.y) / 2 * layout.H, Math.min(1.6, Math.max(0.5, 14 / d))];
    }
  }
  // 速度线：滑停段让它随车速自然淡出（vz 现在真的会降到 0），结算面板出现后强制归零
  hud.update(dt, sim, { ringPos, speedFx: state === 'result' ? 0 : 1 });

  // 音频
  let danger = 0;
  if (sim.wrongWay) for (const t of sim.trucks) if (t.dir < 0 && Math.abs(t.x - c.x) < 2.6) { const d = t.z - c.z; if (d > 0 && d < 200) danger = Math.max(danger, 1 - d / 200); }
  const pulsePh = ((performance.now() / 1000) % CFG.stunt.pulse) / CFG.stunt.pulse;
  // 音频出错绝不能拖垮渲染：报一次错后继续画面
  try {
    audio.frame({ speed: c.vz, running: state === 'race' || state === 'outro', throttle: state === 'race' ? inp.throttle : 0, thrust: c.thrusting, pulse: pulsePh < CFG.stunt.duty ? 1 : 0, roll: c.rolling, wrongWay: sim.wrongWay, danger, apexDip });
  } catch (err) {
    if (!audioErrLogged) { audioErrLogged = true; console.error('[audio]', err); }
  }
  apexDip = false;

  if (DEBUG_POSE) applyDebugPose(s);
  renderer.render(world.scene, camera);
}

// ---------------- 调试机位：?pose=side|front|rear|top|under|chase&z=米 ----------------
// 只用于截图核对车型/景物，正常游玩不带参数时完全不生效
const QS = new URLSearchParams(location.search);
const DEBUG_POSE = QS.get('pose');
function applyDebugPose(s) {
  const cx = s.x, cy = 0.65, cz = -s.z;
  const P = {
    side: [cx + 7.5, 1.1, cz, 0], front: [cx + 4.2, 1.6, cz - 6.2, 0], rear: [cx - 4.0, 1.9, cz + 6.0, 0],
    top: [cx + 0.01, 9, cz, 0], under: [cx + 5.5, 4.2, cz, Math.PI],
  }[DEBUG_POSE];
  if (!P) return;   // chase：保持正常相机
  car.rollPivot.rotation.z = P[3];
  car.root.position.y = P[3] ? 2.6 : 0;
  camera.fov = 40; camera.updateProjectionMatrix();
  camera.position.set(P[0], P[1] + (P[3] ? 2.6 : 0), P[2]);
  camera.lookAt(cx, cy + (P[3] ? 2.6 : 0), cz);
}
if (DEBUG_POSE) {
  $('#menu').classList.remove('show');
  sim.c.z = Number(QS.get('z') || 0);
  sim.spawnOwnAt = Infinity;
  if (DEBUG_POSE === 'chase') { state = 'race'; hudEl.classList.add('playing'); }
}

// 调试/验收接口（控制台可读：帧率、仿真状态、车辆/特技/场景/相机对象）
window.__carfly = { get sim() { return sim; }, CFG, OPEN, PAR_TIME, fps: () => fpsLog.length / fpsLog.reduce((x, y) => x + y, 0), renderer, camera, world, car, stunt, fx, audio, get state() { return state; } };

// Loading 收尾：进度条补满 → 淡出 → 移除（停掉文案轮播定时器）
$('#load-fill').classList.add('done');
setTimeout(() => {
  const loadingEl = $('#loading');
  loadingEl.classList.add('hide');
  if (window.stopLoadTips) window.stopLoadTips();
  setTimeout(() => { loadingEl.style.display = 'none'; }, 420);
}, 200);
requestAnimationFrame(t => { last = t; frame(t); });
