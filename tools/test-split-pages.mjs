import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TrainSimulation } from '../scripts/dynamics.js';
import { SMOOTH_START_TERRAINS } from '../scripts/scenario.js';
import { getProcedure, scoreRun } from '../scripts/procedure.js';

const curveHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const continuityHtml = await readFile(new URL('../continuity-test/index.html', import.meta.url), 'utf8');
const smoothHtml = await readFile(new URL('../smooth-start/index.html', import.meta.url), 'utf8');
assert.match(curveHtml, /铁路运行曲线拼接训练/);
assert.match(curveHtml, /爱国站—敬业站/);
assert.match(curveHtml, /进入贯通试验/);
assert.match(continuityHtml, /data-training-app="continuity"/);
assert.match(continuityHtml, /<base href="\.\.\/">/);
assert.match(continuityHtml, /平稳起车20分＋贯通试验80分/);
assert.match(smoothHtml, /data-training-app="smooth"/);
assert.match(smoothHtml, /<base href="\.\.\/">/);
assert.deepEqual(Object.keys(SMOOTH_START_TERRAINS), ['level', 'uphill']);

const full = new TrainSimulation();
assert.equal(getProcedure(full.state).length, 19);

const level = new TrainSimulation();
assert.equal(level.command('terrain-select', 'level'), true);
assert.equal(level.state.trainingScope, 'smooth-only');
assert.equal(level.state.independentBrake, 2);
assert.equal(level.command('parking-release'), true);
assert.equal(level.command('tail-query', level.state.tailPipe), true);
assert.equal(level.command('auto-brake', 0), true);
for (let i = 0; i < 120; i += 1) level.tick(.05);
assert.equal(level.command('tail-query', level.state.tailPipe), true);
assert.equal(level.command('independent-brake', 0), true);
assert.equal(level.command('traction', 1), true);
assert.equal(level.state.lowNotchApplied, true);
assert.equal(level.state.singleValveNotchSynchronized, true);
assert.equal(getProcedure(level.state).length, 8);

const uphill = new TrainSimulation();
assert.equal(uphill.command('terrain-select', 'uphill'), true);
assert.equal(uphill.state.independentBrake, 2);
assert.equal(uphill.command('parking-release'), true);
assert.equal(uphill.command('tail-query', uphill.state.tailPipe), true);
assert.equal(uphill.command('independent-brake', 0), true);
assert.equal(uphill.command('traction', 1), true, '上坡道应允许自阀保持时以1.0级建立牵引');
for (let i = 0; i < 64; i += 1) uphill.tick(.05);
assert.equal(uphill.state.tractionCurrentRising, true);
assert.equal(uphill.command('auto-brake', 0), true);
assert.equal(uphill.state.notchOneHoldSeconds > 2, true, '上坡道1.0级停留超过2秒的回归场景应成立');
assert.equal(uphill.state.notchOneHoldCorrect, true);
assert.equal(uphill.state.rollbackRisk, false);

const unsafeUphill = new TrainSimulation();
unsafeUphill.command('terrain-select', 'uphill');
unsafeUphill.command('parking-release');
unsafeUphill.command('tail-query', unsafeUphill.state.tailPipe);
unsafeUphill.command('independent-brake', 0);
unsafeUphill.command('auto-brake', 0);
unsafeUphill.tick(.1);
assert.equal(unsafeUphill.state.rollbackRisk, true, '未建立牵引即解除上坡保持应记录后溜风险');

const perfectScore = new TrainSimulation();
perfectScore.command('terrain-select', 'level');
Object.assign(perfectScore.state, {
  parkingBrake: false,
  tailBaselineQueryAttempted: true, tailBaselinePressure: 500,
  autoBrakeReleaseAttempted: true, tailReleaseQueryAttempted: true, tailPressureRiseCorrect: true,
  notchOneAppliedAt: 1, singleValveNotchSynchronized: true, notchOneHoldCorrect: true, tractionCurrentRising: true,
  notchTwoApplied: true, wholeTrainStarted: true, rearLookCompleted: true,
  notchThreeAfterStart: true, notchFourApplied: true, progressiveToFourCorrect: true, smoothStartQualified: true,
  lkjStartAttempted: true, lkjStartCorrect: true,
});
assert.equal(scoreRun(perfectScore.state).score, 100, '平稳起动专项规范操作应获得100分');

const independentScoring = structuredClone(perfectScore.state);
independentScoring.notchOneAppliedAt = null;
independentScoring.singleValveNotchSynchronized = false;
independentScoring.notchOneHoldCorrect = false;
independentScoring.tractionCurrentRising = false;
const independentResult = scoreRun(independentScoring);
assert.equal(independentResult.itemScores[4].earned, 0, '1.0级操纵错误应只影响对应项目');
assert.equal(independentResult.itemScores[5].earned, 20, '已完成的2.0级、全列起动与后部瞭望不得连锁清零');

const assessmentLocks = new TrainSimulation();
assessmentLocks.command('training-mode', 'assessment');
assessmentLocks.command('terrain-select', 'level');
assessmentLocks.command('parking-release');
assessmentLocks.command('auto-brake', 0);
assert.equal(assessmentLocks.command('traction', 1), true);
assert.deepEqual(assessmentLocks.state.assessmentScoreLocks, [2, 3], '专项首次牵引只能锁定缺失的基准尾压与平道缓解确认');

console.log('Split pages valid: curve puzzle is the default page, continuity assessment is isolated under /continuity-test/, and the existing smooth-start page remains independently testable.');
