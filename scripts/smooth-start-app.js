import { SmoothStartSimulation } from './smoothStartSimulation.js';
import { PROCEDURE, procedureState, scoreRun } from './smoothStartProcedure.js';
import { TRAINING_CONFIG } from './smoothStartConfig.js';
import { MstsRouteScene } from './mstsRouteScene.js';

const $ = selector => document.querySelector(selector);
const pct = (value, total) => `${(value / total) * 100}%`;
const sim = new SmoothStartSimulation();
const overlay = $('#overlay');
const stage = $('#stage');
const cabLayer = $('#cab-layer');
const routeCanvas = $('#route-scene');
const routeScene = new MstsRouteScene(routeCanvas);
const hornAudio = new Audio('./assets/audio/HXD1C-horn.wav');
const lkjAudio = new Audio('./assets/audio/lkj-start.wav');
hornAudio.preload = 'auto';
lkjAudio.preload = 'auto';
if (new URLSearchParams(location.search).get('scene') === '1') document.body.classList.add('scene-debug');

let selectedView = 'front';
let activeDrag = null;
let resultShown = false;
let lastFrame = performance.now();
const elements = {};

function frame(element, index, columns, rows) {
  const col = index % columns;
  const row = Math.floor(index / columns);
  element.style.backgroundPosition = `${columns === 1 ? 0 : (col / (columns - 1)) * 100}% ${rows === 1 ? 0 : (row / (rows - 1)) * 100}%`;
}

function makeSprite(id, image, x, y, width, height, columns, rows, label) {
  const element = document.createElement('div');
  element.className = `sprite front-only ${id}`;
  element.dataset.control = id;
  element.title = label;
  Object.assign(element.style, {
    left: pct(x, 640), top: pct(y, 480), width: pct(width, 640), height: pct(height, 480),
    backgroundImage: `url("./assets/archive-cabview/${image}")`, backgroundSize: `${columns * 100}% ${rows * 100}%`,
  });
  overlay.append(element);
  return element;
}

function makeHotspot(id, label, x, y, width, height, handler) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `cab-hotspot front-only ${id}`;
  element.setAttribute('aria-label', label);
  Object.assign(element.style, { left: pct(x, 640), top: pct(y, 480), width: pct(width, 640), height: pct(height, 480) });
  element.addEventListener('click', handler);
  overlay.append(element);
  return element;
}

function makeBadge(id, label, x, y, width) {
  const element = document.createElement('div');
  element.className = 'position-badge front-only';
  element.dataset.badge = id;
  element.innerHTML = `<b>${label}</b><span>—</span>`;
  Object.assign(element.style, { left: pct(x, 640), top: pct(y, 480), width: pct(width, 640) });
  overlay.append(element);
  return element;
}

function makeNeedle(id, image, x, y, width, height, pivot, start, end) {
  const element = document.createElement('img');
  element.className = 'needle front-only';
  element.src = `./assets/archive-cabview/${image}`;
  element.alt = '';
  element.dataset.start = start;
  element.dataset.end = end;
  Object.assign(element.style, {
    left: pct(x, 640), top: pct(y, 480), width: pct(width, 640), height: pct(height, 480),
    transformOrigin: `50% ${(pivot / height) * 100}%`,
  });
  overlay.append(element);
  elements[id] = element;
  return element;
}

function setNeedle(element, value, max) {
  const ratio = Math.max(0, Math.min(1, value / max));
  const start = Number(element.dataset.start);
  const end = Number(element.dataset.end);
  element.style.transform = `rotate(${start + (end - start) * ratio}deg)`;
}

function tractionFrame(value) {
  return value > 0 ? Math.max(0, 7 - Math.min(7, value)) : 7;
}

function beginDrag(id, element, event) {
  event.preventDefault();
  const stateKey = id === 'auto' ? 'autoBrake' : id === 'independent' ? 'independentBrake' : 'traction';
  const range = id === 'traction' ? 8 : id === 'auto' ? 3 : 2;
  activeDrag = { id, pointerId: event.pointerId, startY: event.clientY, start: sim.state[stateKey], pixelsPerStep: Math.max(9, element.getBoundingClientRect().height / range) };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* window listener is sufficient */ }
}

function createCabControls() {
  elements.signalTarget = makeHotspot('signal-target', '确认地面出站信号', 0, 0, 1, 1, event => {
    event.stopPropagation();
    sim.observeGroundSignal();
  });
  elements.auto = makeSprite('auto-brake', 'HXD1C_DZ.png', 35, 341, 45, 60, 4, 3, '拖动自动制动阀');
  elements.independent = makeSprite('independent-brake', 'HXD1C_XZ.png', 138, 341, 35, 60, 4, 3, '拖动单独制动阀');
  elements.traction = makeSprite('traction', 'HXD1C_GL.png', 464, 345, 46, 81, 2, 8, '拖动牵引手柄');
  elements.direction = makeSprite('direction', 'HXD1C_HX.png', 530, 366, 60, 40, 3, 1, '点击切换方向手柄');
  elements.direction.classList.add('direction');
  elements.direction.addEventListener('click', () => {
    const next = sim.state.direction === 'N' ? 'F' : sim.state.direction === 'F' ? 'R' : 'N';
    sim.setDirection(next);
  });
  elements.auto.addEventListener('pointerdown', event => beginDrag('auto', elements.auto, event));
  elements.independent.addEventListener('pointerdown', event => beginDrag('independent', elements.independent, event));
  elements.traction.addEventListener('pointerdown', event => beginDrag('traction', elements.traction, event));
  elements.traction.addEventListener('dblclick', () => sim.setTraction(0));
  elements.locomotiveSignal = makeHotspot('locomotive-signal', '确认机车信号显示', 540, 0, 100, 162, () => sim.observeLocomotiveSignal());
  elements.pressure = makeHotspot('pressure-gauges', '查看总风、列车管和制动缸压力', 10, 238, 180, 98, () => sim.observePressure());
  elements.lkj = makeHotspot('lkj-trigger', '打开 LKJ 监控主界面', 210, 226, 101, 94, openLkj);
  elements.horn = makeHotspot('horn-trigger', '按压风笛', 577, 408, 37, 39, () => {
    sim.soundHorn();
    hornAudio.currentTime = 0;
    hornAudio.play().catch(() => {});
    setTimeout(() => hornAudio.pause(), 850);
  });
  elements.autoBadge = makeBadge('auto', '自阀', 20, 321, 80);
  elements.independentBadge = makeBadge('independent', '单阀', 118, 321, 76);
  elements.tractionBadge = makeBadge('traction', '牵引手柄', 438, 323, 86);
  elements.directionBadge = makeBadge('direction', '换向手柄', 521, 342, 88);
  makeNeedle('speedNeedle', 'HXD1C_SDZ.png', 493, 277, 3, 18, 16, 68, 300);
  makeNeedle('mainNeedle', 'HXD1C_red.png', 154, 253, 7, 21, 14, 230, 100);
  makeNeedle('pipeNeedle', 'HXD1C_black.png', 154, 253, 7, 21, 14, 230, 130);
  makeNeedle('cylinderNeedle', 'HXD1C_red.png', 162, 295, 7, 21, 14, 230, 130);
  const coachIndicator = document.createElement('div');
  coachIndicator.className = 'coach-indicator';
  coachIndicator.innerHTML = `教学编组：${TRAINING_CONFIG.consistCars}辆　全列起动 <b>0%</b>`;
  overlay.append(coachIndicator);
  elements.coachIndicator = coachIndicator;
}

addEventListener('pointermove', event => {
  if (!activeDrag || (activeDrag.pointerId !== undefined && event.pointerId !== activeDrag.pointerId)) return;
  event.preventDefault();
  const delta = Math.round((activeDrag.startY - event.clientY) / activeDrag.pixelsPerStep);
  if (activeDrag.id === 'traction') sim.setTraction(Math.max(0, Math.min(8, activeDrag.start + delta)));
  else if (activeDrag.id === 'auto') sim.setAutoBrake(Math.max(0, Math.min(3, activeDrag.start + delta)));
  else sim.setIndependentBrake(Math.max(0, Math.min(2, activeDrag.start + delta)));
}, { passive: false });
addEventListener('pointerup', event => { if (!activeDrag || activeDrag.pointerId === event.pointerId) activeDrag = null; });
addEventListener('pointercancel', () => { activeDrag = null; });

function selectView(view) {
  selectedView = view;
  const image = view === 'front' ? 'HXD1C_front.png' : view === 'rearLeft' ? 'HXD1C_left.png' : 'HXD1C_right.png';
  cabLayer.src = `./assets/archive-cabview/${image}`;
  overlay.classList.toggle('rear-view', view !== 'front');
  routeCanvas.classList.toggle('rear-left', view === 'rearLeft');
  routeCanvas.classList.toggle('rear-right', view === 'rearRight');
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  routeScene.setView(view);
  render(sim.state);
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
stage.addEventListener('click', event => {
  if (selectedView !== 'front' || event.target.closest('button,.sprite')) return;
  if (routeScene.hitTestDepartureSignal(event.clientX, event.clientY)) sim.observeGroundSignal();
});

function openLkj() {
  $('#lkj-modal').classList.add('open');
  $('#lkj-modal').setAttribute('aria-hidden', 'false');
  syncLkj();
}
function closeLkj() {
  $('#lkj-modal').classList.remove('open');
  $('#lkj-modal').setAttribute('aria-hidden', 'true');
}
$('#lkj-modal .device-close').addEventListener('click', closeLkj);
$('#lkj-modal').addEventListener('click', event => { if (event.target.id === 'lkj-modal') closeLkj(); });
$('#lkj-start').addEventListener('click', () => {
  if (sim.pressLkjStart()) {
    lkjAudio.currentTime = 0;
    lkjAudio.play().catch(() => {});
    syncLkj();
  }
});
function syncLkj() {
  const state = sim.state;
  $('#lkj-speed').textContent = Math.round(state.speed);
  $('#lkj-distance').textContent = Math.max(0, Math.round(TRAINING_CONFIG.route.departureSignalDistance - state.distance));
  $('#lkj-state').textContent = state.lkjStarted ? '开车运行监控' : '停车监控';
  $('#lkj-start').classList.toggle('done', state.lkjStarted);
  $('#lkj-start').textContent = state.lkjStarted ? '已按压开车 / 7' : '开车 / 7';
}

function openDrawer(id) {
  closeDrawers();
  $(`#${id}`).classList.add('open');
  $('#drawer-backdrop').classList.add('open');
}
function closeDrawers() {
  document.querySelectorAll('.drawer').forEach(item => item.classList.remove('open'));
  $('#drawer-backdrop').classList.remove('open');
}
$('#workflow-toggle').addEventListener('click', () => openDrawer('workflow-drawer'));
$('#training-toggle').addEventListener('click', () => openDrawer('training-drawer'));
$('#drawer-backdrop').addEventListener('click', closeDrawers);
document.querySelectorAll('.drawer-close').forEach(button => button.addEventListener('click', closeDrawers));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  sim.setMode(button.dataset.mode);
  resultShown = false;
  selectView('front');
  closeDrawers();
}));
$('#reset-training').addEventListener('click', () => {
  sim.reset(sim.state.trainingMode);
  resultShown = false;
  selectView('front');
});

function showResult() {
  const result = scoreRun(sim.state);
  $('#result-score').textContent = result.score;
  $('#result-summary').textContent = `完成 ${result.itemScores.filter(item => item.complete).length}/${result.itemScores.length} 个评分项；过程扣分 ${result.deductions} 分。`;
  $('#result-deductions').innerHTML = sim.state.scoreDeductions.length
    ? `<ul class="deduction-list">${sim.state.scoreDeductions.map(item => `<li>-${item.points}：${item.reason}</li>`).join('')}</ul>`
    : '<p>未记录操作扣分。</p>';
  $('#result-modal').classList.add('open');
  $('#result-modal').setAttribute('aria-hidden', 'false');
}
$('#result-close').addEventListener('click', () => {
  $('#result-modal').classList.remove('open');
  $('#result-modal').setAttribute('aria-hidden', 'true');
});

function renderProcedure(state) {
  const progress = procedureState(state);
  const list = $('#procedure');
  if (list.children.length !== PROCEDURE.length) list.innerHTML = PROCEDURE.map(([label]) => `<li>${label}</li>`).join('');
  [...list.children].forEach((item, index) => {
    item.classList.toggle('done', progress.complete[index]);
    item.classList.toggle('active', index === progress.current);
  });
  $('#step-counter').textContent = `${progress.complete.filter(Boolean).length}/${PROCEDURE.length}`;
}

function renderStatus(state) {
  const statuses = [
    ['信号确认', state.signalObserved && state.locomotiveSignalObserved],
    ['制动缓解', state.autoBrake === 0 && state.independentBrake === 0 && state.brakeCylinder < 45],
    ['低级位起动', state.actualTraction >= 0.7 && state.actualTraction <= 2.4],
    ['全列移动', state.wholeTrainStarted],
    ['LKJ开车', state.lkjStarted],
    ['后部瞭望', state.rearLookCompleted],
  ];
  $('#status-grid').innerHTML = statuses.map(([label, done]) => `<div class="status-chip ${done ? 'done' : ''}">${done ? '✓' : '○'} ${label}</div>`).join('');
}

function render(state) {
  routeScene.update(state.distance, state.speed, selectedView, true);
  routeScene.render();
  const signalPosition = routeScene.getDepartureSignalScreenPosition();
  if (signalPosition?.visible && selectedView === 'front') {
    elements.signalTarget.hidden = false;
    elements.signalTarget.style.left = `calc(${signalPosition.x}% - 35px)`;
    elements.signalTarget.style.top = `calc(${signalPosition.y}% - 35px)`;
    elements.signalTarget.style.width = '70px';
    elements.signalTarget.style.height = '70px';
  } else {
    elements.signalTarget.hidden = true;
  }
  frame(elements.auto, [0, 1, 2, 9][state.autoBrake], 4, 3);
  frame(elements.independent, [0, 1, 2][state.independentBrake], 4, 3);
  frame(elements.traction, tractionFrame(state.traction), 2, 8);
  frame(elements.direction, state.direction === 'R' ? 0 : state.direction === 'N' ? 1 : 2, 3, 1);
  elements.autoBadge.querySelector('span').textContent = ['运转位', '初制位', '常用制动位', '全制动位'][state.autoBrake];
  elements.independentBadge.querySelector('span').textContent = ['缓解位', '制动区', '全制动位'][state.independentBrake];
  elements.tractionBadge.querySelector('span').textContent = state.traction ? `牵引 ${state.traction}级` : '零位';
  elements.directionBadge.querySelector('span').textContent = state.direction === 'F' ? '前进位' : state.direction === 'R' ? '后退位' : '中立位';
  setNeedle(elements.speedNeedle, state.speed, 160);
  setNeedle(elements.mainNeedle, state.mainReservoir, 1000);
  setNeedle(elements.pipeNeedle, state.trainPipe, 1000);
  setNeedle(elements.cylinderNeedle, state.brakeCylinder, 1000);
  elements.coachIndicator.querySelector('b').textContent = `${Math.round(state.wholeTrainStartFraction * 100)}%`;
  $('#hint').textContent = state.lastMessage;
  $('#metric-speed').textContent = `${state.speed.toFixed(1)} km/h`;
  $('#metric-pipe').textContent = `${Math.round(state.trainPipe)} kPa`;
  $('#metric-cylinder').textContent = `${Math.round(state.brakeCylinder)} kPa`;
  $('#metric-release').textContent = `${Math.round(state.releasePropagation * 100)}%`;
  $('#metric-start').textContent = `${Math.round(state.wholeTrainStartFraction * 100)}%`;
  $('#metric-acceleration').textContent = `${state.acceleration.toFixed(2)} m/s²`;
  const lookProgress = $('#look-progress');
  const rearView = selectedView === 'rearLeft' || selectedView === 'rearRight';
  lookProgress.hidden = !rearView || state.rearLookCompleted;
  lookProgress.querySelector('span').style.width = `${Math.min(100, (state.rearLookSeconds / TRAINING_CONFIG.rearLookSeconds) * 100)}%`;
  renderProcedure(state);
  renderStatus(state);
  $('#score').textContent = scoreRun(state).score;
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === state.trainingMode));
  syncLkj();
  if (state.completed && !resultShown) { resultShown = true; showResult(); }
}

function loop(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  sim.tick(dt, selectedView);
  render(sim.state);
  requestAnimationFrame(loop);
}

createCabControls();
routeCanvas.addEventListener('route-ready', () => {
  sim.emit(`线路载入完成。已接入 ${TRAINING_CONFIG.consistCars} 辆教学客车编组，请开始作业。`);
  render(sim.state);
});
routeCanvas.addEventListener('route-error', event => { $('#hint').textContent = `三维线路加载失败：${event.detail?.message || '请刷新页面重试'}`; });
routeScene.loadPromise.catch(() => {});
sim.addEventListener('change', () => render(sim.state));
render(sim.state);
requestAnimationFrame(loop);
window.__smoothStart = { sim, routeScene, selectView, scoreRun, PROCEDURE };
