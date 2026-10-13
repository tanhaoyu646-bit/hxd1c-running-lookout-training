import assert from 'node:assert/strict';
import { TrainSimulation } from '../scripts/dynamics.js';
import { LKJ_FIELD_DEFINITIONS, LKJ_TRAINING_PARAMETERS, TRAIN_DYNAMICS } from '../scripts/scenario.js';
import { ROUTE_CONTEXT, getScenario } from '../scripts/credentialScenario.js';
import { PROCEDURE, procedureState, scoreRun } from '../scripts/procedure.js';

const INITIAL_KEYS = ['traction', 'direction', 'autoBrake', 'independentBrake', 'parkingBrake', 'panto', 'mainBreaker', 'compressor'];

function tickFor(sim, seconds, view = 'front') {
  for (let elapsed = 0; elapsed < seconds; elapsed += .05) sim.tick(.05, view);
}

function prepare(id, mode = 'teaching') {
  const sim = new TrainSimulation();
  if (mode === 'assessment') assert.equal(sim.command('training-mode', mode), true);
  assert.equal(sim.command('scenario-select', id), true);
  for (const key of INITIAL_KEYS) assert.equal(sim.command('initial-inspect', key), true);
  assert.equal(sim.command('initial-confirm'), true);
  assert.equal(sim.command('lkj-confirm', LKJ_TRAINING_PARAMETERS), true);
  assert.equal(sim.command('panto', true), true);
  tickFor(sim, 15);
  assert.equal(sim.command('main-breaker', true), true);
  assert.equal(sim.command('compressor', true), true);
  assert.equal(sim.command('auto-brake', 1), true);
  tickFor(sim, 5);
  assert.equal(sim.command('auto-brake', 0), true);
  tickFor(sim, 12);
  assert.equal(sim.state.tractionDelayExceeded, false, '简略试验缓解不应触发起车10秒计时');
  return sim;
}

function authorize(sim, id) {
  if (id === 'normal') {
    assert.equal(sim.command('station-contact'), true);
    assert.equal(sim.command('signal-answer', 'green'), true);
    assert.equal(sim.command('locomotive-signal-answer', 'green'), true);
    assert.equal(sim.command('departure-notice', true), true);
  } else if (id === 'weather') {
    assert.equal(sim.command('order-sign'), true);
    assert.equal(sim.command('locomotive-signal-answer', 'green'), true);
    assert.equal(sim.command('weather-report'), true);
  } else {
    if (id === 'greenPermit') assert.equal(sim.command('station-contact'), true);
    else assert.equal(sim.command('order-sign'), true);
    assert.equal(sim.command('credential-open'), true);
    assert.equal(sim.command('credential-submit', true), true);
    const scenario = getScenario(id);
    assert.equal(sim.command('lkj-special-method', scenario.lkjUnlockMethod), true);
    assert.equal(sim.command('lkj-special-input', Object.fromEntries(scenario.lkjUnlockFields.map(([key, , value]) => [key, value]))), true);
    assert.equal(sim.command('lkj-special-unlock', true), true);
    assert.equal(sim.state.lkjUnlockLimit, id === 'greenPermit' ? 60 : 45);
    assert.equal(sim.command('departure-notice'), true);
    assert.equal(sim.command('signal-answer', 'red'), true);
    assert.equal(sim.command('locomotive-signal-answer', 'red'), true);
  }
  assert.equal(sim.command('hand-signal-confirm'), true);
  assert.equal(sim.command('headlight'), true);
  assert.equal(sim.command('horn'), true);
  assert.equal(sim.command('direction', 'F'), true);
  assert.equal(sim.command('parking-release'), true);
}

function establishBaseline(sim) {
  assert.equal(sim.command('tail-link', '123456'), true);
  assert.equal(sim.command('auto-brake', 1), true);
  assert.equal(sim.command('independent-brake', 2), true);
  tickFor(sim, 7);
  assert.equal(sim.command('tail-query', sim.state.tailPipe), true);
  assert.equal(sim.state.tailBaselineQueryAttempted, true);
  assert(sim.state.tailBaselinePressure >= 400 && sim.state.tailBaselinePressure <= 580);
}

function performLevelStart(sim) {
  establishBaseline(sim);
  assert.equal(sim.command('auto-brake', 0), true);
  tickFor(sim, 6);
  assert.equal(sim.command('tail-query', sim.state.tailPipe), true);
  assert(sim.state.tailPressureRise > 20);
  assert.equal(sim.command('independent-brake', 0), true);
  tickFor(sim, .25);
  assert.equal(sim.command('traction', 1), true);
  tickFor(sim, 1.2);
  assert.equal(sim.command('traction', 2), true);
  assert.equal(sim.state.singleValveNotchSynchronized, true);
  assert.equal(sim.state.notchOneHoldCorrect, true);
  assert.equal(sim.state.notchTwoSequenceCorrect, true);
}

function finishTrainStart(sim) {
  for (let i = 0; i < 12000 && !sim.state.wholeTrainStarted; i += 1) sim.tick(.05);
  assert.equal(sim.state.wholeTrainStarted, true);
  tickFor(sim, 2.7, 'rearLeft');
  assert.equal(sim.state.rearLookCompleted, true);
  assert.equal(sim.command('traction', 3), true);
  tickFor(sim, .2);
  assert.equal(sim.command('traction', 4), true);
  assert.equal(sim.state.progressiveToFourCorrect, true);
}

const earlyNormalCall = new TrainSimulation();
assert.equal(earlyNormalCall.command('scenario-select', 'normal'), true);
assert.equal(earlyNormalCall.command('station-contact', true), false, '简略试验完成前不应接通车站首次来电');

const earlyDepartureCall = prepare('normal');
assert.equal(earlyDepartureCall.command('station-contact', true), true);
assert.equal(earlyDepartureCall.command('departure-notice', true), false, '地面和机车信号确认前不应办理第二次发车联控');

function runScenario(id) {
  const sim = prepare(id);
  authorize(sim, id);
  performLevelStart(sim);
  finishTrainStart(sim);
  let lkjStartPressed = false;
  let weatherSignalConfirmed = false;
  for (let index = 0; index < 200000 && !sim.state.completed; index += 1) {
    sim.tick(.05);
    if (id === 'weather' && !weatherSignalConfirmed && sim.state.credentialStage === 'confirm-ground-signal') {
      assert.equal(sim.command('signal-answer', 'green'), true);
      weatherSignalConfirmed = true;
    }
    if (!lkjStartPressed && sim.state.speed >= 1 && Math.abs(sim.state.distance - ROUTE_CONTEXT.departureSignalDistance) < 5) {
      assert.equal(sim.command('lkj-start'), true);
      lkjStartPressed = true;
    }
  }
  assert.equal(sim.state.completed, true, `${id}未完成训练终点`);
  assert.equal(sim.state.lkjStartCorrect, true, `${id}未完成LKJ开车对标`);
  const procedure = procedureState(sim.state);
  const result = scoreRun(sim.state);
  assert.equal(procedure.done, true, `${id}仍有未完成评分项`);
  assert.deepEqual(procedure.complete, Array(PROCEDURE.length).fill(true), `${id}评分项完成状态异常`);
  assert.equal(result.deductions, 0, `${id}规范流程不应产生操作扣分`);
  assert.equal(result.score, 100, `${id}规范流程未获得100分`);
  return sim;
}

for (const id of ['normal', 'weather', 'greenPermit', 'routeTicket']) runScenario(id);

for (const [id, limit] of [['greenPermit', 60], ['routeTicket', 45]]) {
  const limited = prepare(id);
  authorize(limited, id);
  assert.equal(limited.state.lkjUnlockLimit, limit);
  limited.state.speed = 100;
  limited.tick(.05);
  assert(limited.state.speed <= limit, `${id}解锁后的LKJ限速应为${limit}km/h`);
}

const assessedWrong = prepare('greenPermit', 'assessment');
assert.equal(assessedWrong.command('station-contact'), true);
assert.equal(assessedWrong.command('credential-open'), true);
assert.equal(assessedWrong.command('credential-submit', false), true);
assert.equal(assessedWrong.command('lkj-special-method', 'routeTicket'), true);
assert.equal(assessedWrong.command('lkj-special-input', { permitNumber: '000000' }), true);
assert.equal(assessedWrong.command('lkj-special-unlock', false), true);
assert.equal(assessedWrong.command('departure-notice'), true);
assert.equal(assessedWrong.command('hand-signal-confirm'), true);
assert.equal(procedureState(assessedWrong.state).complete[6], true, '考评模式错误操作应记录后继续流程');
assert.equal(scoreRun(assessedWrong.state).itemScores[6].earned, 0, '凭证和LKJ解锁错误后，发车前联控项不得分');

const pressureBoundary = new TrainSimulation();
pressureBoundary.command('terrain-select', 'level');
pressureBoundary.command('tail-query', pressureBoundary.state.tailPipe);
pressureBoundary.command('auto-brake', 0);
pressureBoundary.state.tailPipe = pressureBoundary.state.tailBaselinePressure + 20;
assert.equal(pressureBoundary.command('tail-query', pressureBoundary.state.tailPipe), false);
assert.equal(pressureBoundary.state.tailPressureRiseCorrect, false, '尾压上升等于20 kPa不得分');

const brakeFirst = new TrainSimulation();
brakeFirst.command('terrain-select', 'level');
brakeFirst.command('parking-release');
brakeFirst.command('tail-query', brakeFirst.state.tailPipe);
brakeFirst.command('auto-brake', 0);
tickFor(brakeFirst, 6);
brakeFirst.command('tail-query', brakeFirst.state.tailPipe);
brakeFirst.command('independent-brake', 0);
tickFor(brakeFirst, 1.9);
brakeFirst.command('traction', 1);
assert.equal(brakeFirst.state.singleValveNotchSynchronized, true, '单阀缓解后2秒内投入1.0级应合格');
tickFor(brakeFirst, 3.2);
assert.equal(brakeFirst.state.tractionCurrentRising, true);
brakeFirst.command('traction', 2);
assert.equal(brakeFirst.state.notchOneHoldSeconds > 2, true, '回归场景应让1.0级停留超过2秒');
assert.equal(brakeFirst.state.notchOneHoldCorrect, true, '1.0级停留超过2秒不应失分');

const tractionFirst = new TrainSimulation();
tractionFirst.command('terrain-select', 'level');
tractionFirst.command('parking-release');
tractionFirst.command('tail-query', tractionFirst.state.tailPipe);
tractionFirst.command('auto-brake', 0);
tickFor(tractionFirst, 6);
tractionFirst.command('tail-query', tractionFirst.state.tailPipe);
tractionFirst.command('traction', 1);
tickFor(tractionFirst, 1.9);
tractionFirst.command('independent-brake', 0);
assert.equal(tractionFirst.state.singleValveNotchSynchronized, false, '牵引先于单阀缓解不应满足规定顺序');

const delayed = new TrainSimulation();
delayed.command('terrain-select', 'level');
delayed.command('parking-release');
delayed.command('tail-query', delayed.state.tailPipe);
delayed.command('auto-brake', 0);
tickFor(delayed, 10.1);
assert.equal(delayed.state.tractionDelayExceeded, true, '自阀缓解后10秒未建立实际牵引力应扣分');

const assessmentSoftGate = new TrainSimulation();
assessmentSoftGate.command('training-mode', 'assessment');
assessmentSoftGate.command('scenario-select', 'normal');
assessmentSoftGate.command('panto', true);
tickFor(assessmentSoftGate, 15);
assessmentSoftGate.command('main-breaker', true);
assessmentSoftGate.command('parking-release');
assessmentSoftGate.command('direction', 'F');
assert.equal(assessmentSoftGate.command('traction', 1), true, '考评模式满足物理条件后不应被流程门禁阻断');
tickFor(assessmentSoftGate, 15);
assert(assessmentSoftGate.state.distance > 0, '考评模式列车应实际移动');
assert(assessmentSoftGate.state.assessmentScoreLocks.includes(1), '动车时未完成的评分项应锁定失分');

assert.equal(LKJ_FIELD_DEFINITIONS.length, 16, 'LKJ参数设定应覆盖本任务所需16项字段');
assert.equal(TRAIN_DYNAMICS.totalMassKg, 850000);
assert.equal(TRAIN_DYNAMICS.tractionForcePerNotchN * TRAIN_DYNAMICS.tractionNotches >= 510000, true, '七级牵引应接近HXD1C最大起动牵引力');
assert.equal(PROCEDURE.reduce((sum, [, , weight]) => sum + weight, 0), 100);

console.log('Training scenarios valid: four workflows, strict tail-pressure rise, brake-first 2-second coordination without a dwell cap, 10-second traction timing, LKJ limits, and assessment soft gates passed.');
