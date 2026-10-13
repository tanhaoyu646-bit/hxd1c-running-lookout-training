import { ROUTE_TRAINING_PROFILE } from './routeTrainingProfile.js';
import { selectCandidateNames, visibleSignalCount } from './curvePuzzleLogic.js';

const ASSET_ROOT = './assets/curve-puzzle/';
const ASSETS = Object.freeze([
  '01_2603-2328.png','02_2328-2316.png','03_2316-2302.png','04_2302-2288.png','05_2288-2274.png','06_2274-2256.png',
  '07_2256-2248.png','07b_2256-2248_dashed.png','08_2248-2234.png','08b_2248-2234_dashed.png',
  '09_2234-2222.png','09b_2234-2222_dashed.png','10_2222-2214.png','10b_2222-2214_dashed.png',
  '11_2214-2198.png','11b_2214-2198_dashed.png',
]);

const STAGES = Object.freeze([
  {label:'K222+603出站信号机 → 2328通过信号机',start:213,end:398,green:'01_2603-2328.png',path:'M213 788 C221 776 221 651 254 616 C284 593 295 661 327 637 C356 607 369 541 398 507'},
  {label:'2328 → 2316',start:398,end:514,green:'02_2328-2316.png',path:'M398 507 C420 465 449 442 480 428 S503 421 514 421'},
  {label:'2316 → 2302',start:514,end:647,green:'03_2316-2302.png',path:'M514 421 C556 408 596 400 647 402'},
  {label:'2302 → 2288',start:647,end:780,green:'04_2302-2288.png',path:'M647 402 C690 400 734 402 780 405'},
  {label:'2288 → 2274',start:780,end:916,green:'05_2288-2274.png',path:'M780 405 C826 408 858 407 916 406'},
  {label:'2274 → K226+091进站信号机',start:916,end:1064,green:'06_2274-2256.png',path:'M916 406 C950 406 990 403 1011 427 S1046 485 1064 496'},
  {label:'K226+091进站信号机 → 2248',start:1064,end:1193,green:'07_2256-2248.png',yellow:'07b_2256-2248_dashed.png',path:'M1064 496 C1108 498 1135 457 1193 445',pathY:'M1064 496 C1102 491 1150 518 1193 538'},
  {label:'2248 → 2234',start:1193,end:1318,green:'08_2248-2234.png',yellow:'08b_2248-2234_dashed.png',path:'M1193 445 C1246 429 1282 398 1318 410',pathY:'M1193 538 C1241 549 1275 548 1318 557'},
  {label:'2234 → 2222',start:1318,end:1450,green:'09_2234-2222.png',yellow:'09b_2234-2222_dashed.png',path:'M1318 410 C1360 427 1400 420 1450 408',pathY:'M1318 557 C1354 564 1388 587 1450 602'},
  {label:'2222 → 2214',start:1450,end:1530,green:'10_2222-2214.png',yellow:'10b_2222-2214_dashed.png',path:'M1450 408 C1478 394 1512 384 1530 376',pathY:'M1450 602 C1480 608 1507 614 1530 618'},
  {label:'2214 → 敬业站',start:1530,end:1654,green:'11_2214-2198.png',yellow:'11b_2214-2198_dashed.png',path:'M1530 376 C1575 360 1618 341 1654 325',pathY:'M1530 618 C1571 624 1598 631 1654 639'},
]);

// 坐标均落在信号机标识圆圈内。两端站标不进入该表，因此不会显示灯色。
const SIGNALS = Object.freeze([
  {id:'X',label:'K222+603出站信号机',x:266,y:676,head:'single'},
  {id:'2328',label:'2328通过信号机',x:398,y:676,head:'single'},
  {id:'2316',label:'2316通过信号机',x:514,y:676,head:'single'},
  {id:'2302',label:'2302通过信号机',x:647,y:676,head:'single'},
  {id:'2288',label:'2288通过信号机',x:780,y:676,head:'single'},
  {id:'2274',label:'2274通过信号机',x:916,y:676,head:'single'},
  {id:'K226+091',label:'K226+091进站信号机',x:1076,y:650,head:'double'},
  {id:'2248',label:'2248信号机',x:1193,y:676,head:'single'},
  {id:'2234',label:'2234信号机',x:1318,y:676,head:'single'},
  {id:'2222',label:'2222信号机',x:1450,y:643,head:'double'},
  {id:'2214',label:'2214信号机',x:1605,y:676,head:'single'},
]);

const COLORS = Object.freeze({green:'#10c957',yellow:'#f4ca31',red:'#df3b3b',dark:'#19231d'});
const NS = 'http://www.w3.org/2000/svg';
const svg = document.querySelector('#svg');
const $ = (id) => document.getElementById(id);
let active=0, route='green', selected=null, wrong=0, done=false, startTime=Date.now(), cardOptions=[], recentOptionHistory=[];

function el(name,attrs={}){const node=document.createElementNS(NS,name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;}
function filenameFor(index){const stage=STAGES[index];return index>=6&&route==='yellow'?stage.yellow:stage.green;}
function signalStatus(){if(active===6)return route==='green'?'绿灯（正线进路）':'双黄灯（侧线进路）';return '绿灯';}

function addMapCorrections(){
  const items=[
    ['rect',{x:164,y:5,width:104,height:55,class:'map-mask'}],
    ['text',{x:216,y:45,'text-anchor':'middle',class:'map-station'},'爱国站'],
    ['rect',{x:745,y:4,width:345,height:68,class:'map-mask'}],
    ['text',{x:918,y:50,'text-anchor':'middle',class:'map-title'},ROUTE_TRAINING_PROFILE.diagramTitle],
    ['rect',{x:1485,y:4,width:154,height:58,class:'map-mask'}],
    ['text',{x:1562,y:45,'text-anchor':'middle',class:'map-station'},'敬业站'],
    ['rect',{x:232,y:687,width:27,height:90,class:'map-mask'}],
    ['text',{x:253,y:770,transform:'rotate(-90 253 770)','text-anchor':'start',class:'map-mileage'},'222+603'],
  ];
  for(const [name,attrs,text] of items){const node=el(name,attrs);if(text)node.textContent=text;svg.append(node);}
}

function automaticAspect(index){
  if(index===active&&index===6)return route==='green'?'green':'doubleYellow';
  const behind=active-index;
  if(behind===1)return 'red';
  if(behind===2)return 'yellow';
  if(behind===3)return 'greenYellow';
  return 'green';
}

let lampGradientSequence=0;
function addDot(group,x,y,color,r=10.2){group.append(el('circle',{cx:x,cy:y,r,fill:color,stroke:'none',class:'lamp-glow',style:`color:${color}`}));}
function addSplitDot(group,x,y,first,second,r=10.2){
  const id=`lamp-split-${lampGradientSequence+=1}`;const defs=el('defs');const gradient=el('linearGradient',{id,x1:'0%',y1:'0%',x2:'100%',y2:'0%'});
  gradient.append(el('stop',{offset:'0%', 'stop-color':first}),el('stop',{offset:'49.9%', 'stop-color':first}),el('stop',{offset:'50%', 'stop-color':second}),el('stop',{offset:'100%', 'stop-color':second}));defs.append(gradient);group.append(defs,el('circle',{cx:x,cy:y,r,fill:`url(#${id})`,stroke:'none',class:'lamp-glow'}));
}
function addLamp(signal,aspect,focus=false){
  const group=el('g',{'aria-label':`${signal.label}：${aspect}`});const radius=focus?10.5:10.1;
  if(aspect==='greenYellow'){
    addSplitDot(group,signal.x,signal.y,COLORS.green,COLORS.yellow,radius);
  }else if(aspect==='doubleYellow'){
    addDot(group,signal.x,signal.y,COLORS.yellow,radius);addDot(group,signal.x,signal.y+27,COLORS.yellow,radius);
  }else{
    const y=signal.head==='double'&&aspect==='yellow'?signal.y+27:signal.y;addDot(group,signal.x,y,COLORS[aspect]||COLORS.dark,radius);
  }
  svg.append(group);
}

function redraw(){
  svg.replaceChildren();addMapCorrections();
  for(let index=0;index<active;index++){const stage=STAGES[index];const yellow=route==='yellow'&&index>=6;svg.append(el('path',{d:yellow?stage.pathY:stage.path,class:`placed${yellow?' yellow':''}`}));}
  // 只显示当前已到达信号及其后方信号灯色；后续信号保持底图空圈，
  // 随曲线逐段拼接再依次生成，避免开局一次性泄露整条线路灯色。
  const lampCount=visibleSignalCount(active,done,SIGNALS.length);
  for(let index=0;index<lampCount;index++)addLamp(SIGNALS[index],automaticAspect(index),!done&&index===active);
  if(done)return;
  const stage=STAGES[active];const target=el('rect',{x:Math.max(210,stage.start),y:310,width:Math.max(36,stage.end-stage.start),height:470,class:'target',rx:9,tabindex:0,role:'button','aria-label':'将已选择的运行线拼接到当前区间'});svg.append(target);
  const label=el('text',{x:(stage.start+stage.end)/2,y:345,'text-anchor':'middle',class:'node-label'});label.textContent=`第${active+1}段`;svg.append(label);
  target.addEventListener('click',()=>selected?submitChoice(selected):feedback('先选择一张曲线卡片，再点击蓝色区段。'));
  target.addEventListener('keydown',(event)=>{if((event.key==='Enter'||event.key===' ')&&selected){event.preventDefault();submitChoice(selected);}});
}

function renderCards(){
  const list=$('choices');list.replaceChildren();
  if(done){const text=document.createElement('div');text.style.gridColumn='1/-1';text.style.padding='18px';text.style.color='#087b56';text.textContent='全部曲线已正确拼接。';list.append(text);return;}
  const stage=STAGES[active];const alternate=active>=6?(route==='green'?stage.yellow:stage.green):'';
  cardOptions=selectCandidateNames({correct:filenameFor(active),alternate,assets:ASSETS,recentOptions:recentOptionHistory});
  recentOptionHistory.push(cardOptions);if(recentOptionHistory.length>2)recentOptionHistory.shift();
  cardOptions.forEach((name,index)=>{const button=document.createElement('button');button.type='button';button.className='choice';button.dataset.filename=name;button.innerHTML=`<span class="optHead"><strong>曲线 ${'ABC'[index]}</strong><span>点击选择</span></span><span class="thumb"><img alt="待选运行线 ${'ABC'[index]}" src="${ASSET_ROOT}${name}"></span><span class="hint">观察线形、虚实和速度变化</span>`;button.addEventListener('click',()=>select(name));list.append(button);});
}

function select(name){selected=name;document.querySelectorAll('.choice').forEach(button=>button.classList.toggle('chosen',button.dataset.filename===name));$('submitBtn').disabled=false;$('chooseHelp').textContent=`已选择曲线 ${'ABC'[cardOptions.indexOf(name)]}`;}
function feedback(message,status=''){const box=$('feedback');box.className=`message${status?` ${status}`:''}`;box.textContent=message;}

function submitChoice(choice){
  if(done||!choice)return;const correct=filenameFor(active);
  if(choice!==correct){wrong+=1;$('wrongNum').textContent=`${wrong}次`;$('score').textContent=Math.max(0,100-wrong*5);feedback(active>=6?'所选曲线与当前进站信号显示不符，请重新判断路径和线形。':'所选运行线与当前区段不符，请重新观察速度变化。','bad');return;}
  const previous=active;active+=1;selected=null;$('correctNum').textContent=`${active}段`;$('progressText').textContent=`${active} / ${STAGES.length}`;$('meterFill').style.width=`${active/STAGES.length*100}%`;$('submitBtn').disabled=true;$('chooseHelp').textContent='尚未选择曲线';
  if(active>=STAGES.length){done=true;redraw();renderCards();$('gameStatus').textContent='完成';$('stageName').textContent='全部区段';$('signalText').textContent='拼接完成';$('taskText').textContent='拼接完成';$('question').textContent='全部曲线已连接完成。';$('result').classList.add('active');$('resultText').textContent=`完成${STAGES.length}段运行线，错误${wrong}次，最终得分${Math.max(0,100-wrong*5)}分。`;feedback('全部运行线拼接完成。','ok');return;}
  renderStage();feedback(`第${previous+1}段拼接正确。后方信号已按四显示自动闭塞逻辑变化。`,'ok');
}

function renderStage(){const stage=STAGES[active];$('stageName').textContent=stage.label;$('signalText').textContent=signalStatus();$('branchChip').textContent=active<6?'到达K226+091后揭示进站工况':route==='green'?'K226+091：绿灯，正线进路':'K226+091：双黄灯，侧线进路';$('taskText').textContent=stage.label;$('question').textContent=active<6?'观察当前点亮的信号，选择相应运行线。':`K226+091本局显示${route==='green'?'绿灯':'双黄灯'}，选择对应进路曲线。`;$('submitBtn').disabled=true;$('chooseHelp').textContent='尚未选择曲线';redraw();renderCards();}
function reset(){route=Math.random()<.5?'green':'yellow';active=0;selected=null;wrong=0;done=false;recentOptionHistory=[];startTime=Date.now();$('score').textContent='100';$('correctNum').textContent='0段';$('wrongNum').textContent='0次';$('meterFill').style.width='0%';$('progressText').textContent=`0 / ${STAGES.length}`;$('gameStatus').textContent='训练中';$('result').classList.remove('active');renderStage();feedback('新一局已开始。爱国站为站标，当前点亮的是K222+603出站信号机。');}
function clearSelection(){selected=null;document.querySelectorAll('.choice').forEach(button=>button.classList.remove('chosen'));$('submitBtn').disabled=true;$('chooseHelp').textContent='尚未选择曲线';}

$('submitBtn').addEventListener('click',()=>submitChoice(selected));$('clearBtn').addEventListener('click',clearSelection);$('resetBtn').addEventListener('click',reset);$('playAgain').addEventListener('click',()=>{reset();scrollTo({top:0,behavior:'smooth'});});
setInterval(()=>{const seconds=Math.max(0,Math.floor((Date.now()-startTime)/1000));$('elapsed').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;},1000);
const mobileLike=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);if(mobileLike)$('landscape-gate').hidden=false;
$('enter-landscape').addEventListener('click',async()=>{try{await document.documentElement.requestFullscreen?.({navigationUI:'hide'});}catch{}try{await screen.orientation?.lock?.('landscape');}catch{}$('landscape-gate').hidden=true;setTimeout(()=>scrollTo(0,1),100);});
reset();
