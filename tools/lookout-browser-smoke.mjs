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
const page = pages.find((entry) => entry.type === 'page' && /\/lookout-training\//.test(entry.url))
  || pages.find((entry) => entry.type === 'page');
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
  const names=[];const materialNames=[];const continuousRailMaterials=new Set();let polishedRailColor='';let polishedRailEmissive='';let polishedRailEmissiveIntensity=-1;let sourceTrackMeshes=0;let reflectiveRailMaterials=0;let maximumSignalScale=0;
  window.__routeScene.routeRoot.traverse((object)=>{
    if(object.name)names.push(object.name);
    if(object.material?.name)materialNames.push(object.material.name);
    if(/^A\\d+t.*\\.s:/i.test(object.name||''))sourceTrackMeshes+=1;
    if(/rail[_ ]?tops?/i.test(object.material?.name||''))reflectiveRailMaterials+=1;
    if(/SOURCE_.*SIGNAL.*_VISUAL/.test(object.name||''))maximumSignalScale=Math.max(maximumSignalScale,object.scale.x);
    if(/^LOOKOUT_RAIL_/.test(object.name||'')&&object.material)continuousRailMaterials.add(object.material);
    if(object.material?.name==='LOOKOUT_POLISHED_RAIL_STEEL'){
      polishedRailColor=object.material.color.getHexString();
      polishedRailEmissive=object.material.emissive.getHexString();
      polishedRailEmissiveIntensity=object.material.emissiveIntensity;
    }
  });
  return {
    title:document.title,
    app:document.body.dataset.trainingApp,
    procedureItems:document.querySelectorAll('#procedure li').length,
    routeLive:document.querySelector('#route-scene').classList.contains('live'),
    pathLength:Math.round(window.__routeScene.pathLength),
    cameraFar:window.__routeScene.camera.far,
    fullRouteFarPlane:Boolean(window.__routeScene.camera.userData.fullRouteFarPlane),
    trainingScope:window.__trainingSim.state.trainingScope,
    trainingMode:window.__trainingSim.state.trainingMode,
    controlsText:document.querySelector('#training-controls').innerText,
    sceneNames:names.filter((name)=>name.startsWith('LOOKOUT_')),
    terrainTiles:window.__routeScene.routeRoot.getObjectByName('MSTS_SOURCE_TERRAIN')?.children.length||0,
    terrainResolution:window.__routeScene.routeRoot.getObjectByName('MSTS_SOURCE_TERRAIN')?.userData.sourceResolution||0,
    terrainCorridorLimited:Boolean(window.__routeScene.routeRoot.getObjectByName('MSTS_SOURCE_TERRAIN')?.userData.railwayCorridorLimited),
    selectedTrackBeds:names.filter((name)=>name==='SELECTED_ROUTE_TEXTURED_TRACK').length,
    selectedTrackEnd:window.__routeScene.routeRoot.getObjectByName('SELECTED_ROUTE_TEXTURED_TRACK')?.userData.endDistance||0,
    continuousRails:names.filter((name)=>name.startsWith('LOOKOUT_RAIL_')).length,
    continuousRailEnd:window.__routeScene.routeRoot.getObjectByName('LOOKOUT_CONTINUOUS_SOURCE_STYLE_RAILS')?.userData.endDistance||0,
    railVisibilityLodSegments:names.filter((name)=>name.startsWith('MAINLINE_RAIL_VISIBILITY_')).length,
    railVisibilityLodEnd:window.__routeScene.routeRoot.getObjectByName('LOOKOUT_MAINLINE_RAIL_VISIBILITY_LOD')?.userData.endDistance||0,
    railVisibilityLodRanges:(window.__routeScene.routeRoot.getObjectByName('LOOKOUT_MAINLINE_RAIL_VISIBILITY_LOD')?.children||[]).map((item)=>[item.userData.startDistance,item.userData.endDistance]),
    railVisibilityDistanceLimited:Boolean(window.__routeScene.routeRoot.getObjectByName('LOOKOUT_MAINLINE_RAIL_VISIBILITY_LOD')?.userData.distanceLimited),
    railVisibilityUsesFog:window.__routeScene.railVisibilityMaterials.some((material)=>Object.hasOwn(material.uniforms,'fogFar')),
    continuousRailFogEnabled:[...continuousRailMaterials].some((material)=>material.fog!==false),
    polishedRailColor,
    polishedRailEmissive,
    polishedRailEmissiveIntensity,
    distantRailColor:window.__routeScene.railVisibilityMaterials[0]?.uniforms.railColor.value.getHexString()||'',
    continuousSleepers:names.filter((name)=>name==='LOOKOUT_CONTINUOUS_SLEEPERS').length,
    catenaryRepairs:window.__routeScene.routeRoot.getObjectByName('LOOKOUT_REALIGNED_CATENARY_MASTS')?.children.length||0,
    throughSignalPresent:Boolean(window.__routeScene.routeRoot.getObjectByName('TEACHING_2328_THROUGH_SIGNAL')),
    throughSignalCount:names.filter((name)=>/^TEACHING_.*_THROUGH_SIGNAL$/.test(name)).length,
    polishedRailMaterials:materialNames.filter((name)=>name==='LOOKOUT_POLISHED_RAIL_STEEL').length,
    dullRailMaterials:materialNames.filter((name)=>name==='LOOKOUT_DULL_RAIL_STEEL').length,
    sourceTrackMeshes,
    reflectiveRailMaterials,
    maximumSignalScale,
    rendererTriangles:window.__routeScene.renderer.info.render.triangles,
    rendererCalls:window.__routeScene.renderer.info.render.calls,
    scoreWeights:[...document.querySelectorAll('#procedure li')].map((item)=>item.innerText),
    overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
    stage:[Math.round(document.querySelector('#stage').getBoundingClientRect().width),Math.round(document.querySelector('#stage').getBoundingClientRect().height)],
    mobileControls:document.body.classList.contains('mobile-controls-enabled'),
    metricsToggleVisible:getComputedStyle(document.querySelector('#metrics-toggle')).display!=='none',
  };
})()`);
console.log(JSON.stringify({ preflight: summary }, null, 2));
assert.equal(summary.app,'lookout');
assert.equal(summary.procedureItems,6);
assert.equal(summary.routeLive,true);
assert.equal(summary.trainingScope,'lookout');
assert.equal(summary.trainingMode,'assessment');
assert(summary.pathLength>LOOKOUT_TRAINING_CONFIG.finishDistance,'线路长度不足以覆盖结算点');
assert(summary.cameraFar>=summary.pathLength+999,'相机远裁剪面未覆盖完整3D线路');
assert.equal(summary.fullRouteFarPlane,true,'未启用完整线路相机视距');
assert(summary.selectedTrackEnd>=summary.pathLength-1,'本务线道床未延伸到完整TrackDB路径终点');
assert(summary.continuousRailEnd>=summary.pathLength-1,'连续实体钢轨未延伸到完整TrackDB路径终点');
assert(summary.railVisibilityLodEnd>=summary.pathLength-1,'主线远景钢轨可视LOD未延伸到完整TrackDB路径终点');
assert.equal(summary.railVisibilityDistanceLimited,false,'远景钢轨仍存在人为距离限制');
assert.equal(summary.railVisibilityUsesFog,false,'远景钢轨仍按场景雾距淡出');
assert.equal(summary.continuousRailFogEnabled,false,'连续实体钢轨仍受场景雾效隐藏');
assert.equal(summary.polishedRailColor,'8b969a','近景轨头未使用原线路加载画面的中灰钢色');
assert.equal(summary.distantRailColor,summary.polishedRailColor,'远景轨头颜色与近景钢材不一致');
assert.equal(summary.polishedRailEmissive,'000000','正常轨头仍带有白色或蓝色自发光');
assert.equal(summary.polishedRailEmissiveIntensity,0,'正常轨头自发光强度未关闭');
for(const name of ['LOOKOUT_NORMAL_CROSSING','LOOKOUT_TUNNEL','LOOKOUT_TUNNEL_EXIT_BACKLIGHT','LOOKOUT_TUNNEL_EXIT_GLARE','LOOKOUT_TUNNEL_EXIT_COLLAPSE','LOOKOUT_TUNNEL_EXIT_ROCK_1','LOOKOUT_INTRUSION_CROSSING','LOOKOUT_INTRUSION_ACTORS','LOOKOUT_SOURCE_SEDAN','LOOKOUT_CROSSING_APPROACH_ROAD','LOOKOUT_RAIL_LEFT_GLINT_BREAK'])assert(summary.sceneNames.includes(name),`缺少三维对象 ${name}`);
assert(summary.sceneNames.includes('LOOKOUT_SOURCE_SEDAN'),'侵限道口未使用原游戏轿车模型');
assert.equal(summary.throughSignalPresent,true,'未生成原游戏通过信号机');
assert.equal(summary.throughSignalCount,5,'途中通过信号机数量应为5架');
assert.equal(summary.terrainTiles,8,'原线路地形瓦片未完整加载');
assert.equal(summary.terrainResolution,257,'瞭望基线未加载8 m原生地形');
assert.equal(summary.terrainCorridorLimited,true,'未建立本线路基限高');
assert.equal(summary.selectedTrackBeds,1,'未生成连续的原游戏纹理道床');
assert.equal(summary.continuousRails,8,'贯通钢轨本体及反光中断前、异常段和恢复段的左右轨头未完整生成');
assert.equal(summary.sceneNames.filter((name)=>name.endsWith('_BODY')).length,2,'左右钢轨本体必须连续贯通全线');
assert.equal(summary.railVisibilityLodSegments,4,'左右钢轨的远景可见LOD应在反光中断前后分别建立');
assert(summary.railVisibilityLodRanges.every(([start,end])=>end<=LOOKOUT_TRAINING_CONFIG.events.find((event)=>event.id==='rail-glint-break').hazardDistance||start>=LOOKOUT_TRAINING_CONFIG.events.find((event)=>event.id==='rail-glint-break').glintBreakEndDistance),'远景LOD不得覆盖反光中断故障段');
assert.equal(summary.continuousSleepers,0,'不得叠加方盒轨枕层');
assert(summary.catenaryRepairs>=1,'未重建侵入净空的接触网杆');
assert.equal(summary.polishedRailMaterials,4,'正常钢轨顶面金属材质未完整应用');
assert.equal(summary.dullRailMaterials,2,'钢轨反光中断段未使用粗糙材质');
assert(summary.sourceTrackMeshes>=3,'原线路立体轨道网格未加载');
assert(summary.reflectiveRailMaterials>=1,'原线路轨头材质未启用金属反光');
assert(summary.maximumSignalScale<=1.001,'信号机灯位被非真实放大');
assert(summary.rendererTriangles<1_500_000,'简化走廊渲染三角面过高');
// 完整线路远裁剪面会让少量原线路远端对象进入视锥；400次以内仍作为移动端回归上限。
assert(summary.rendererCalls<400,'完整线路视距下的走廊绘制调用过高');
assert(summary.sceneNames.filter((name)=>name.startsWith('LOOKOUT_SOURCE_TUNNEL_SEGMENT_')).length===3,'简化300 m原线路隧道段未完整加载');
assert.match(summary.controlsText,/平稳发车4分、贯通试验16分、正常道口10分/);
assert.match(summary.controlsText,/隧道异常20分、钢轨反光中断20分、侵限道口30分/);
assert.equal(summary.overflowX,false);
if(mobile){assert.deepEqual(summary.stage,[viewportWidth,viewportHeight],'移动端舞台应填满横屏视口');assert.equal(summary.mobileControls,true,'移动端控制模式未启用');assert.equal(summary.metricsToggleVisible,true,'移动端运行数据按钮不可见');}
const tunnelConfig=LOOKOUT_TRAINING_CONFIG.events.find((event)=>event.id==='tunnel-hazard');
const tunnelLighting=await evaluate(`(()=>{const state=window.__trainingSim.state;state.distance=${tunnelConfig.tunnelEndDistance-80};state.speed=60;window.__routeScene.update(state.distance,state.speed,'front',true,1);window.__routeScene.updateLookoutTraining(state.lookout,state.distance);const backlight=window.__routeScene.lookoutVisuals.tunnelExitBacklight;return {opacity:backlight.material.opacity,visible:backlight.visible,exposure:window.__routeScene.renderer.toneMappingExposure};})()`);
assert(tunnelLighting.visible&&tunnelLighting.opacity>.9,'洞内远看出口时高亮背光未保持过曝');
assert(tunnelLighting.exposure<.6,'洞内曝光过高，无法形成洞内外反差');
const tunnelAfter=await evaluate(`(()=>{const state=window.__trainingSim.state;state.distance=${tunnelConfig.tunnelEndDistance+45};window.__routeScene.update(state.distance,60,'front',true,1);window.__routeScene.updateLookoutTraining(state.lookout,state.distance);const backlight=window.__routeScene.lookoutVisuals.tunnelExitBacklight;return {opacity:backlight.material.opacity,visible:backlight.visible};})()`);
assert(!tunnelAfter.visible&&tunnelAfter.opacity<.02,'出洞后过曝层未正常消失');
const intrusionConfig=LOOKOUT_TRAINING_CONFIG.events.find((event)=>event.id==='intrusion-crossing');
const carStart=await evaluate(`(()=>{const state=window.__trainingSim.state;state.distance=${intrusionConfig.hazardDistance-80};state.speed=0;window.__routeScene.update(state.distance,state.speed,'front',true,1);window.__routeScene.updateLookoutTraining(state.lookout,state.distance);const vehicle=window.__routeScene.lookoutVisuals.intrusionVehicle;return {x:vehicle.position.x,yaw:vehicle.rotation.y};})()`);
await new Promise((resolve)=>setTimeout(resolve,420));
const carEnd=await evaluate(`window.__routeScene.lookoutVisuals.intrusionVehicle.position.x`);
assert(carEnd-carStart.x>1,'列车停车时侵限轿车未继续从左向右运动');
assert(Math.abs(carStart.yaw+Math.PI/2)<0.001,'侵限轿车车头朝向必须与从左向右运动方向一致');
assert.deepEqual(errors,[]);
assert.deepEqual(networkErrors,[]);
const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
await writeFile(screenshotPath,Buffer.from(shot.data,'base64'));
const sceneShots = {};
const events = Object.fromEntries(LOOKOUT_TRAINING_CONFIG.events.map((event) => [event.id, event]));
for (const [label, distance] of (mobile ? [] : [
  ['station', 0],
  ['normal-crossing', events['normal-crossing'].hazardDistance - 45],
  ['through-signal', LOOKOUT_TRAINING_CONFIG.throughSignalDistance - 45],
  ['tunnel-entry', events['tunnel-hazard'].tunnelStartDistance - 70],
  ['tunnel', events['tunnel-hazard'].tunnelEndDistance - 120],
  ['tunnel-exit', events['tunnel-hazard'].tunnelEndDistance - 45],
  ['tunnel-after', events['tunnel-hazard'].tunnelEndDistance + 45],
  ['rail-approach', events['rail-glint-break'].hazardDistance - 360],
  ['rail-transition', events['rail-glint-break'].hazardDistance - 220],
  ['rail-break', events['rail-glint-break'].hazardDistance - 60],
  ['intrusion', events['intrusion-crossing'].hazardDistance - 55],
  ['post-finish', LOOKOUT_TRAINING_CONFIG.finishDistance + 500],
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
