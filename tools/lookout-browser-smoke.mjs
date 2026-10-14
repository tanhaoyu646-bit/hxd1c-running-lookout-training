import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { LOOKOUT_TRAINING_CONFIG } from '../scripts/lookoutTrainingConfig.js';

const port = Number(process.env.CDP_PORT || 9227);
const url = process.env.TRAINING_URL || 'http://127.0.0.1:4177/lookout-training/?debug=1';
const screenshotPath = process.env.SCREENSHOT_PATH || `${process.env.TEMP || '.'}/lookout-browser-smoke.png`;
const mobile = process.env.MOBILE === '1';
const viewportWidth = Number(process.env.VIEWPORT_WIDTH || (mobile ? 1056 : 1440));
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT || (mobile ? 480 : 900));
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
const networkErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const handler = pending.get(message.id);pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));else handler.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
  else if (message.method === 'Network.loadingFailed' && !message.params.canceled && message.params.errorText !== 'net::ERR_ABORTED') networkErrors.push(message.params.errorText);
});
function send(method, params = {}) {
  const id = ++nextId;socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
await Promise.all([send('Page.enable'),send('Runtime.enable'),send('Network.enable')]);
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:viewportWidth,height:viewportHeight,deviceScaleFactor:1,mobile,screenWidth:viewportWidth,screenHeight:viewportHeight});
await send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:mobile?5:1});
await send('Page.navigate',{url});
await evaluate(`new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(window.__routeScene?.ready&&document.querySelector('.route-scene.live')&&document.querySelectorAll('#procedure li').length===6){clearInterval(timer);resolve(true);}else if(Date.now()-started>30000){clearInterval(timer);reject(new Error('途中瞭望页面初始化超时'));}},100);})`,true);
if(mobile){await evaluate(`document.querySelector('#enter-training').click();true`);await new Promise((resolve)=>setTimeout(resolve,240));}
const summary = await evaluate(`(()=>{
  const names=[];window.__routeScene.routeRoot.traverse((object)=>{if(object.name)names.push(object.name);});
  return {
    title:document.title,
    app:document.body.dataset.trainingApp,
    procedureItems:document.querySelectorAll('#procedure li').length,
    routeLive:document.querySelector('#route-scene').classList.contains('live'),
    pathLength:Math.round(window.__routeScene.pathLength),
    trainingScope:window.__trainingSim.state.trainingScope,
    trainingMode:window.__trainingSim.state.trainingMode,
    controlsText:document.querySelector('#training-controls').innerText,
    sceneNames:names.filter((name)=>name.startsWith('LOOKOUT_')),
    scoreWeights:[...document.querySelectorAll('#procedure li')].map((item)=>item.innerText),
    overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
    stage:[Math.round(document.querySelector('#stage').getBoundingClientRect().width),Math.round(document.querySelector('#stage').getBoundingClientRect().height)],
    mobileControls:document.body.classList.contains('mobile-controls-enabled'),
    metricsToggleVisible:getComputedStyle(document.querySelector('#metrics-toggle')).display!=='none',
  };
})()`);
assert.equal(summary.app,'lookout');
assert.equal(summary.procedureItems,6);
assert.equal(summary.routeLive,true);
assert.equal(summary.trainingScope,'lookout');
assert.equal(summary.trainingMode,'assessment');
assert(summary.pathLength>LOOKOUT_TRAINING_CONFIG.finishDistance,'线路长度不足以覆盖结算点');
for(const name of ['LOOKOUT_NORMAL_CROSSING','LOOKOUT_TUNNEL','LOOKOUT_TUNNEL_CLEARANCE_ANOMALY','LOOKOUT_RAIL_GLINT','LOOKOUT_INTRUSION_CROSSING','LOOKOUT_INTRUSION_ACTORS'])assert(summary.sceneNames.includes(name),`缺少三维对象 ${name}`);
assert.match(summary.controlsText,/平稳发车4分、贯通试验16分/);
assert.equal(summary.overflowX,false);
if(mobile){assert.deepEqual(summary.stage,[viewportWidth,viewportHeight],'移动端舞台应填满横屏视口');assert.equal(summary.mobileControls,true,'移动端控制模式未启用');assert.equal(summary.metricsToggleVisible,true,'移动端运行数据按钮不可见');}
assert.deepEqual(errors,[]);
assert.deepEqual(networkErrors,[]);
const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
await writeFile(screenshotPath,Buffer.from(shot.data,'base64'));
const sceneShots = {};
const events = Object.fromEntries(LOOKOUT_TRAINING_CONFIG.events.map((event) => [event.id, event]));
for (const [label, distance] of (mobile ? [] : [
  ['normal-crossing', events['normal-crossing'].hazardDistance - 120],
  ['tunnel', events['tunnel-hazard'].hazardDistance - 140],
  ['rail', events['rail-glint-break'].hazardDistance - 120],
  ['intrusion', events['intrusion-crossing'].hazardDistance - 120],
])) {
  await evaluate(`(()=>{const state=window.__trainingSim.state;state.distance=${distance};state.speed=60;window.__routeScene.update(state.distance,state.speed,'front',true,1);window.__routeScene.updateLookoutTraining(state.lookout,state.distance);return true;})()`);
  await new Promise((resolve)=>setTimeout(resolve,180));
  const sceneShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const scenePath=screenshotPath.replace(/\.png$/i,`-${label}.png`);
  await writeFile(scenePath,Buffer.from(sceneShot.data,'base64'));
  sceneShots[label]=scenePath;
}
socket.close();
console.log(JSON.stringify({summary,errors,networkErrors,screenshotPath,sceneShots},null,2));
