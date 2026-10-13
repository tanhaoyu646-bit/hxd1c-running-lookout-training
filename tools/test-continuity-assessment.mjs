import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { TrainSimulation } from '../scripts/dynamics.js';
import { CONTINUITY_PROCEDURE, getProcedure, scoreRun } from '../scripts/procedure.js';
import { ROUTE_CONTEXT } from '../scripts/credentialScenario.js';
import { ROUTE_TRAINING_PROFILE } from '../scripts/routeTrainingProfile.js';
import { selectCandidateNames, visibleSignalCount } from '../scripts/curvePuzzleLogic.js';

const tickFor = (sim, seconds) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += .05) sim.tick(.05);
};

const curveHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const curveSource = await readFile(new URL('../scripts/curve-puzzle.js', import.meta.url), 'utf8');
const continuityHtml = await readFile(new URL('../continuity-test/index.html', import.meta.url), 'utf8');

assert.match(curveHtml, /爱国站—敬业站/);
assert.match(curveHtml, /speed_limit_red\.png/);
assert.match(curveSource, /K222\+603出站信号机/);
for (const signal of ['2328', '2316', '2302', '2288', '2274', 'K226+091']) assert.match(curveSource, new RegExp(signal.replace('+', '\\+')));
assert.doesNotMatch(curveSource, /id:'爱国站'/);
assert.doesNotMatch(curveSource, /id:'敬业站'/);
assert.match(continuityHtml, /默认平道 · 考评模式/);
assert.match(continuityHtml, /侧缓单缓/);
for (const asset of ['route-board.png', 'speed_limit_red.png', '01_2603-2328.png']) await access(new URL(`../assets/curve-puzzle/${asset}`, import.meta.url));

assert.equal(ROUTE_TRAINING_PROFILE.lkjStationName, '株洲站');
assert.equal(ROUTE_TRAINING_PROFILE.firstBlock.lengthMeters, 9135);
assert.equal(ROUTE_CONTEXT.firstBlockEndDistance - ROUTE_CONTEXT.departureSignalDistance, 9135);
assert.equal(CONTINUITY_PROCEDURE.length, 15);
assert.equal(CONTINUITY_PROCEDURE.slice(0, 8).reduce((sum, item) => sum + item[2], 0), 20);
assert.equal(CONTINUITY_PROCEDURE.slice(8).reduce((sum, item) => sum + item[2], 0), 80);
assert.equal(visibleSignalCount(0, false, 11), 1, '开局只能生成第一架信号机灯色');
assert.equal(visibleSignalCount(4, false, 11), 5, '灯色必须随区段逐架生成');
assert.equal(visibleSignalCount(11, true, 11), 11);
const optionAssets = Array.from({ length: 12 }, (_, index) => `curve-${index}.png`);
const firstOptions = selectCandidateNames({ correct: optionAssets[0], assets: optionAssets, random: () => .37 });
const nextCorrect = optionAssets.find((name) => !firstOptions.includes(name));
const secondOptions = selectCandidateNames({ correct: nextCorrect, assets: optionAssets, recentOptions: [firstOptions], random: () => .63 });
assert.equal(new Set(firstOptions).size, 3, '同一题三张曲线不得重复');
assert.equal(new Set(secondOptions).size, 3, '下一题三张曲线不得重复');
assert.equal(secondOptions.filter((name) => firstOptions.includes(name)).length, 0, '相邻题目应避免复用刚出现的曲线');

const sim = new TrainSimulation();
Object.assign(sim.state, {
  trainingMode: 'assessment', trainingScope: 'continuity', scenarioSelected: true,
  terrainMode: 'level', terrainSelected: true,
});
sim.applySmoothStartPreset();
Object.assign(sim.state, {
  parkingBrake: false,
  autoBrake: 0,
  independentBrake: 0,
  brakeCyl: 0,
  trainPipe: 600,
  tailPipe: 600,
  releasePropagation: 1,
  tailBaselineQueryAttempted: true,
  tailBaselinePressure: 520,
  autoBrakeReleaseAttempted: true,
  tailReleaseQueryAttempted: true,
  tailReleasePressure: 600,
  tailPressureRise: 80,
  tailPressureRiseCorrect: true,
  notchOneAppliedAt: 1,
  singleValveNotchSynchronized: true,
  notchOneHoldAttempted: true,
  notchOneHoldCorrect: true,
  tractionCurrentRising: true,
  notchTwoApplied: true,
  notchTwoSequenceCorrect: true,
  wholeTrainStartFraction: 1,
  wholeTrainStarted: true,
  rearLookCompleted: true,
  notchThreeAfterStart: true,
  notchFourApplied: true,
  progressiveToFourCorrect: true,
  smoothStartQualified: true,
  lkjStartAttempted: true,
  lkjStartCorrect: true,
  traction: 6,
  actualTraction: 6,
  speed: 60,
});

assert.equal(sim.command('tail-query', 571), true);
assert.equal(sim.state.tailPressureValue, 600, '贯通试验前尾压应固定确认为600 kPa');
assert.equal(sim.command('auto-brake', 1), true);
assert.equal(sim.state.continuityBrakeAppliedCorrectly, true);
assert.equal(sim.command('side-release-hold', true), true);
tickFor(sim, 8);
assert.equal(sim.state.continuitySpeedDeclining, true, '排风后必须形成可识别的速度下降');
assert.equal(sim.state.continuitySideReleaseCorrect, true, '侧缓单缓应保持至速度下降');
assert.equal(sim.command('traction', 5), true);
assert.equal(sim.command('continuity-lkj-open'), true);
assert.equal(sim.state.continuityLkjObserved, true);
assert.equal(sim.command('side-release-hold', false), true);
assert.equal(sim.command('auto-brake', 0), true);
assert.equal(sim.state.continuityAutoBrakeReleasedCorrectly, true);
tickFor(sim, 10);
assert.equal(sim.command('traction', 6), true);
assert.equal(sim.state.continuityTractionRestoredCorrectly, true);
assert.equal(sim.state.completed, true);
assert.equal(getProcedure(sim.state).length, 15);
assert.equal(scoreRun(sim.state).score, 100, '规范完成平稳起车和贯通试验应得100分');

const earlySideRelease = new TrainSimulation();
Object.assign(earlySideRelease.state, {
  trainingMode: 'assessment', trainingScope: 'continuity', scenarioSelected: true,
  terrainMode: 'level', terrainSelected: true,
});
earlySideRelease.applySmoothStartPreset();
Object.assign(earlySideRelease.state, {
  parkingBrake: false, autoBrake: 0, independentBrake: 0, brakeCyl: 0,
  trainPipe: 600, tailPipe: 600, releasePropagation: 1, wholeTrainStarted: true,
  continuityTailPressureCorrect: true, speed: 60, traction: 6, actualTraction: 6,
});
assert.equal(earlySideRelease.command('side-release-hold', true), true);
assert.equal(earlySideRelease.state.continuitySideReleaseAttempted, false, '自阀初制动前操作侧缓不得点亮评分项');
assert.equal(earlySideRelease.command('auto-brake', 1), true);
tickFor(earlySideRelease, 8);
assert.equal(earlySideRelease.state.continuitySideReleaseSynchronized, false, '提前按住后等待自阀制动不得倒序取得同步证据');
assert.equal(earlySideRelease.state.continuitySideReleaseCorrect, false, '倒序侧缓操作不得得分');
assert.equal(scoreRun(earlySideRelease.state).itemScores[10].earned, 0, '倒序侧缓评分项必须为0分');
assert(earlySideRelease.state.continuityDeductions.some((item) => item.key === 'side-release-before-initial-brake'));
earlySideRelease.command('side-release-hold', false);

const wrongBrakeThenSide = new TrainSimulation();
Object.assign(wrongBrakeThenSide.state, {
  trainingMode: 'assessment', trainingScope: 'continuity', scenarioSelected: true,
  terrainMode: 'level', terrainSelected: true,
});
wrongBrakeThenSide.applySmoothStartPreset();
Object.assign(wrongBrakeThenSide.state, {
  parkingBrake: false, autoBrake: 0, independentBrake: 0, brakeCyl: 0,
  trainPipe: 600, tailPipe: 600, releasePropagation: 1, wholeTrainStarted: true,
  continuityTailPressureCorrect: true, speed: 52, traction: 6, actualTraction: 6,
});
wrongBrakeThenSide.command('auto-brake', 1);
wrongBrakeThenSide.command('side-release-hold', true);
assert.equal(wrongBrakeThenSide.state.continuityBrakeAppliedCorrectly, false);
assert.equal(wrongBrakeThenSide.state.continuitySideReleaseAttempted, false, '前一评分项错误时侧缓不得进入可评分状态');
assert.equal(scoreRun(wrongBrakeThenSide.state).itemScores[10].earned, 0);

const speedCue = new TrainSimulation();
Object.assign(speedCue.state, {
  trainingMode: 'assessment', trainingScope: 'continuity', scenarioSelected: true,
  terrainMode: 'level', terrainSelected: true,
});
speedCue.applySmoothStartPreset();
Object.assign(speedCue.state, {
  parkingBrake: false, autoBrake: 0, independentBrake: 0, brakeCyl: 0,
  trainPipe: 600, tailPipe: 600, releasePropagation: 1, wholeTrainStarted: true,
  continuityTailPressureCorrect: true, speed: 58.2, traction: 6, actualTraction: 6,
});
speedCue.tick(.05);
assert.equal(speedCue.state.continuitySpeedWindowEntered, true, '进入58～62 km/h时应产生操作窗口提示');
speedCue.state.speed = 62.2;
speedCue.tick(.05);
assert.equal(speedCue.state.continuitySpeedWindowMissed, true, '持续6.0级超过62 km/h应记录错过窗口');
assert(speedCue.state.continuityDeductions.some((item) => item.key === 'missed-speed-window'));
speedCue.state.speed = 63.9;
tickFor(speedCue, 20);
assert(speedCue.state.speed <= ROUTE_TRAINING_PROFILE.continuity.notchSixHardLimitKmh, '6.0级不得超过64 km/h教学上限');

const wrong = new TrainSimulation();
Object.assign(wrong.state, { trainingMode: 'assessment', trainingScope: 'continuity', terrainMode: 'level', terrainSelected: true });
wrong.applySmoothStartPreset();
Object.assign(wrong.state, { wholeTrainStarted: true, speed: 52, traction: 4, autoBrake: 0, parkingBrake: false });
assert.equal(wrong.command('auto-brake', 1), true, '考评模式错误操作不能被流程拦截');
assert.equal(wrong.state.continuityBrakeAttempted, true);
assert(wrong.state.continuityDeductions.length > 0, '错误操作必须形成扣分记录');

console.log('Continuity assessment valid: 20/80 scoring, 600 kPa query, 58–62 km/h initial brake, post-brake right-slide hold, 6.0-notch 64 km/h cap, 6→5 reduction, LKJ observation, release, and ≥6 restoration.');
