import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9224);
const url = process.env.TRAINING_URL || 'http://127.0.0.1:4175/smooth-start/?debug=1';
const screenshotPath = process.env.SCREENSHOT_PATH || `${process.env.TEMP || '.'}/smooth-start-mobile-controls.png`;
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

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable')]);
await send('Emulation.setDeviceMetricsOverride', { width: 1056, height: 480, deviceScaleFactor: 1, mobile: true, screenWidth: 1056, screenHeight: 480 });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url });
await evaluate(`new Promise((resolve, reject) => {
  const started=Date.now();const timer=setInterval(()=>{
    if(document.querySelector('.route-scene.live')&&document.querySelectorAll('#procedure li').length===8){clearInterval(timer);resolve(true);}
    else if(Date.now()-started>30000){clearInterval(timer);reject(new Error('专项页面初始化超时'));}
  },100);
})`, true);
await evaluate(`document.querySelector('#enter-training').click();document.querySelector('[data-terrain="uphill"]').click();true`);
await new Promise((resolve) => setTimeout(resolve, 350));

const result = await evaluate(`(() => {
  const panel=document.querySelector('#smooth-training-panel');const toggle=document.querySelector('#metrics-toggle');
  const closedInitially=!panel.classList.contains('mobile-open')&&getComputedStyle(panel).visibility==='hidden';
  const toggleVisible=getComputedStyle(toggle).display!=='none';
  toggle.click();const opened=panel.classList.contains('mobile-open')&&toggle.getAttribute('aria-expanded')==='true'&&getComputedStyle(panel).visibility==='visible';
  toggle.click();const closedAgain=!panel.classList.contains('mobile-open')&&toggle.getAttribute('aria-expanded')==='false';
  const rect=(element)=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  const independent=[...document.querySelectorAll('[data-drag-target="independent"]')].map(rect);
  const parking=[rect(document.querySelector('.parking-apply')),rect(document.querySelector('.parking-release'))];
  const noHotspotOverlap=independent.length===2&&independent.every((zone)=>parking.every((button)=>!overlap(zone,button)));
  const badge=document.querySelector('[data-position-id="independent"]');const br=rect(badge);const badgeRect=badge.getBoundingClientRect();
  const badgeAvoidsParking=parking.every((button)=>!overlap(br,button));
  const badgeOwnsHitArea=badge.contains(document.elementFromPoint(badgeRect.left+badgeRect.width/2,badgeRect.top+badgeRect.height*.85));
  badge.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:17,clientX:badgeRect.left+badgeRect.width/2,clientY:badgeRect.top+badgeRect.height*.7}));
  window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:17,clientX:badgeRect.left+badgeRect.width/2,clientY:badgeRect.top-18}));
  window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:17,clientX:badgeRect.left+badgeRect.width/2,clientY:badgeRect.top-18}));
  const independentDragChanged=!document.querySelector('[data-position-id="independent"] span').textContent.includes('制动Ⅱ');
  const parkingStillApplied=document.querySelector('#status').innerText.includes('停放制动 施加');
  document.querySelector('.parking-release').click();
  const tractionBadge=document.querySelector('[data-position-id="traction"]');const tractionRect=tractionBadge.getBoundingClientRect();
  const tractionBadgeOwnsHitArea=tractionBadge.contains(document.elementFromPoint(tractionRect.left+tractionRect.width/2,tractionRect.top+tractionRect.height/2));
  tractionBadge.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:18,clientX:tractionRect.left+tractionRect.width/2,clientY:tractionRect.top+tractionRect.height*.7}));
  window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:18,clientX:tractionRect.left+tractionRect.width/2,clientY:tractionRect.top+tractionRect.height*.7-22}));
  window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:18,clientX:tractionRect.left+tractionRect.width/2,clientY:tractionRect.top+tractionRect.height*.7-22}));
  const tractionDragChanged=document.querySelector('[data-position-id="traction"] span').textContent.includes('牵引 1.0 级');
  const parkingReleased=document.querySelector('#status').innerText.includes('停放制动 缓解');
  const tractionReturnRect=tractionBadge.getBoundingClientRect();
  tractionBadge.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:19,clientX:tractionReturnRect.left+tractionReturnRect.width/2,clientY:tractionReturnRect.top+tractionReturnRect.height*.4}));
  window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:19,clientX:tractionReturnRect.left+tractionReturnRect.width/2,clientY:tractionReturnRect.top+tractionReturnRect.height*.4+22}));
  window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:19,clientX:tractionReturnRect.left+tractionReturnRect.width/2,clientY:tractionReturnRect.top+tractionReturnRect.height*.4+22}));
  const directionBadge=document.querySelector('[data-position-id="direction"]');const directionRect=directionBadge.getBoundingClientRect();
  const directionBadgeOwnsHitArea=directionBadge.contains(document.elementFromPoint(directionRect.left+directionRect.width/2,directionRect.top+directionRect.height/2));
  directionBadge.click();const directionNeutral=directionBadge.querySelector('span').textContent==='中立位';
  directionBadge.click();const directionForward=directionBadge.querySelector('span').textContent==='前进位';
  const viewToggle=document.querySelector('#view-toggle');const viewPanel=document.querySelector('#mobile-view-tabs');
  const viewToggleVisible=getComputedStyle(viewToggle).display!=='none';
  viewToggle.click();const viewPanelOpened=viewPanel.classList.contains('mobile-open')&&getComputedStyle(viewPanel).display==='flex';
  viewPanel.querySelector('[data-view="rearLeft"]').click();
  const rearViewSelectable=viewPanel.querySelector('[data-view="rearLeft"]').classList.contains('active')&&!viewPanel.classList.contains('mobile-open');
  viewToggle.click();viewPanel.querySelector('[data-view="front"]').click();
  const toolbar=rect(document.querySelector('.stage-toolbar'));const exitButton=rect(document.querySelector('#exit-immersive'));
  const toolbarAvoidsExit=!overlap(toolbar,exitButton);
  const stage=document.querySelector('#stage').getBoundingClientRect();
  return {closedInitially,toggleVisible,opened,closedAgain,noHotspotOverlap,badgeAvoidsParking,badgeOwnsHitArea,independentDragChanged,parkingStillApplied,tractionBadgeOwnsHitArea,tractionDragChanged,parkingReleased,directionBadgeOwnsHitArea,directionNeutral,directionForward,viewToggleVisible,viewPanelOpened,rearViewSelectable,toolbarAvoidsExit,stage:[Math.round(stage.width),Math.round(stage.height)],errors:${JSON.stringify(errors)}};
})()`);
for (const key of ['closedInitially','toggleVisible','opened','closedAgain','noHotspotOverlap','badgeAvoidsParking','badgeOwnsHitArea','independentDragChanged','parkingStillApplied','tractionBadgeOwnsHitArea','tractionDragChanged','parkingReleased','directionBadgeOwnsHitArea','directionNeutral','directionForward','viewToggleVisible','viewPanelOpened','rearViewSelectable','toolbarAvoidsExit']) assert.equal(result[key], true, `${key} 验证失败`);
assert.deepEqual(result.stage, [1056, 480]);
assert.deepEqual(errors, []);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
socket.close();
console.log(JSON.stringify({ result, screenshotPath }, null, 2));
