import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.env.CDP_PORT || 9227);
const url = process.env.TRAINING_URL || 'http://127.0.0.1:4177/lookout-training/?debug=1';
const outputDirectory = process.env.OUTPUT_DIRECTORY || path.join(process.env.TEMP || '.', 'lookout-route-captures');
const requested = (process.env.DISTANCES || 'route-0=0')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [label, value] = entry.split('=');
    return [label.replace(/[^a-zA-Z0-9_-]/g, '-'), Number(value)];
  });
assert(requested.every(([, value]) => Number.isFinite(value)), 'DISTANCES 格式应为 label=meters,label=meters');

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
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const handler = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

await Promise.all([send('Page.enable'), send('Runtime.enable')]);
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1440,
  screenHeight: 900,
});
await send('Page.navigate', { url });
await evaluate(`new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(window.__routeScene?.ready){clearInterval(timer);resolve(true);}else if(Date.now()-started>30000){clearInterval(timer);reject(new Error('路线场景加载超时'));}},100);})`, true);
await mkdir(outputDirectory, { recursive: true });
const files = [];
for (const [label, distance] of requested) {
  await evaluate(`(()=>{const state=window.__trainingSim.state;state.distance=${distance};state.speed=60;window.__routeScene.update(state.distance,state.speed,'front',true,1);window.__routeScene.updateLookoutTraining(state.lookout,state.distance);return true;})()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outputDirectory, `${label}-${Math.round(distance)}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  files.push(file);
}
socket.close();
console.log(JSON.stringify({ files }, null, 2));
