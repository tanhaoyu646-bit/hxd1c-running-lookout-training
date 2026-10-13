import assert from 'node:assert/strict';

const port = Number(process.env.CDP_PORT || 9224);
const url = process.env.TRAINING_URL || 'http://127.0.0.1:4175/?rev=lkj-mobile-smoke&debug=1';
const width = Number(process.env.VIEWPORT_WIDTH || 667);
const height = Number(process.env.VIEWPORT_HEIGHT || 375);
const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const page = pages.find((entry) => entry.type === 'page');
assert(page, '没有可用的浏览器页面');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const handler = pending.get(message.id); pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message)); else handler.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});
function send(method, params = {}) {
  const id = ++nextId; socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
async function touchKey(id) {
  const point = await evaluate(`(() => {
    const button=document.querySelector('[data-lkj-key="${id}"]');
    if(!button)return null;
    const r=button.getBoundingClientRect();const x=r.left+r.width/2;const y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return {x,y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hit:hit?.dataset?.lkjKey||''};
  })()`);
  assert(point, `找不到 LKJ ${id} 键`);
  assert.equal(point.hit, id, `${id} 键中心被其他热区遮挡`);
  assert(point.left >= 0 && point.top >= 0 && point.right <= width && point.bottom <= height, `${id} 键超出手机可视区`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise((resolve) => setTimeout(resolve, 45));
}

await Promise.all([send('Page.enable'), send('Runtime.enable')]);
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url });
await evaluate(`new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(document.querySelector('.route-scene.live')&&document.querySelector('.lkj-trigger')){clearInterval(timer);resolve(true);}else if(Date.now()-started>30000){clearInterval(timer);reject(new Error('页面初始化超时'));}},100);})`, true);
await evaluate(`document.querySelector('#enter-training').click();document.querySelector('[data-mode="assessment"]').click();document.querySelector('[data-training="initial"]').click();document.querySelector('.lkj-trigger').click();true`);
await new Promise((resolve) => setTimeout(resolve, 200));

const fit = await evaluate(`(() => {
  const modal=document.querySelector('.lkj-modal').getBoundingClientRect();
  const device=document.querySelector('.lkj-device').getBoundingClientRect();
  const keys=[...document.querySelectorAll('[data-lkj-key]')].map((key)=>{const r=key.getBoundingClientRect();return {id:key.dataset.lkjKey,left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
  return {modal:{left:modal.left,right:modal.right,top:modal.top,bottom:modal.bottom},device:{left:device.left,right:device.right,top:device.top,bottom:device.bottom},keys};
})()`);
assert(fit.device.left >= 0 && fit.device.top >= 0 && fit.device.right <= width && fit.device.bottom <= height, 'LKJ 本体未完整显示');
assert(fit.keys.every((key) => key.left >= 0 && key.top >= 0 && key.right <= width && key.bottom <= height), 'LKJ 实体键未完整显示');

// 查询选择：验证方向键能改变选择，缓解键能返回主界面。
await touchKey('query');
assert(await evaluate(`Boolean(document.querySelector('.lkj-query-grid'))`), '未进入查询选择界面');
const queryBefore = await evaluate(`document.querySelector('.lkj-query-grid .selected')?.textContent`);
await touchKey('down');
const queryAfter = await evaluate(`document.querySelector('.lkj-query-grid .selected')?.textContent`);
assert.notEqual(queryAfter, queryBefore, '查询界面方向键未移动选择');
await touchKey('relief');
assert.equal(await evaluate(`Boolean(document.querySelector('.lkj-query-grid'))`), false, '查询界面未能返回');

// 参数设定：默认课堂参数逐项确认，进入参数核对和揭示核对。
await touchKey('setting');
assert(await evaluate(`Boolean(document.querySelector('.lkj-parameter-form'))`), '未进入参数设定界面');
for (let index = 0; index < 16; index += 1) await touchKey('confirm');
assert(await evaluate(`document.querySelector('.lkj-parameter-form footer')?.innerText.includes('参数核对')`), '未进入参数核对界面');
await touchKey('confirm');
assert(await evaluate(`Boolean(document.querySelector('.lkj-reveal-table'))`), '未进入揭示核对界面');
const revealCount = await evaluate(`document.querySelectorAll('.lkj-reveal-table tbody tr').length`);
for (let index = 0; index < revealCount; index += 1) await touchKey('confirm');
assert.equal(await evaluate(`document.querySelectorAll('#procedure li.done').length >= 2`), true, 'LKJ 参数与揭示确认未通过');
assert.equal(await evaluate(`Boolean(document.querySelector('.lkj-native-chart'))`), true, '完成核对后未进入 LKJ 监控主界面');
const positionBefore = await evaluate(`Number(document.querySelector('.lkj-position-line').getAttribute('x1'))`);
await evaluate(`(() => {window.__trainingSim.state.distance=120;window.__trainingSim.state.speed=20;window.__trainingSim.emit();return true;})()`);
await new Promise((resolve) => setTimeout(resolve, 240));
const movingChart = await evaluate(`(() => {
  const line=document.querySelector('.lkj-position-line');
  const points=(document.querySelector('.lkj-speed-line')?.getAttribute('points')||'').trim().split(/\\s+/).filter(Boolean).map((point)=>Number(point.split(',')[0]));
  return {position:Number(line.getAttribute('x1')),traceX:points};
})()`);
assert.equal(movingChart.position, positionBefore, 'LKJ当前位置基准线不应随里程平移');
assert(movingChart.traceX.length >= 2, 'LKJ实速轨迹未形成滚动样本');
assert(movingChart.traceX.at(-1) >= positionBefore - 1 && movingChart.traceX.at(-1) <= positionBefore + 1, 'LKJ最新实速点应位于固定基准线');
assert(movingChart.traceX[0] < movingChart.traceX.at(-1), 'LKJ历史实速轨迹应向基准线左侧滚动');
assert.deepEqual(errors, []);

socket.close();
console.log(JSON.stringify({ width, height, device: fit.device, allKeysVisible: true, queryNavigation: true, parameterReview: true, revealReview: true, lkjConfirmed: true, fixedPositionLine: movingChart.position, scrollingTrace: movingChart.traceX }, null, 2));
