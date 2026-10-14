import assert from 'node:assert/strict';
import { LookoutAssessment, createLookoutAttempt, scoreLookoutEvent } from '../scripts/lookoutAssessment.js';
import { LOOKOUT_TRAINING_CONFIG } from '../scripts/lookoutTrainingConfig.js';
import { scoreRun } from '../scripts/procedure.js';

const makeState = () => ({ distance: 0, speed: 60, completed: false, lookout: createLookoutAttempt() });
const eventConfig = (id) => LOOKOUT_TRAINING_CONFIG.events.find((item) => item.id === id);
const resolvePrevious = (state, id) => {
  for (const config of LOOKOUT_TRAINING_CONFIG.events) {
    if (config.id === id) break;
    state.lookout.events[config.id].status = 'complete';
  }
};

assert(LOOKOUT_TRAINING_CONFIG.continuityEndDistance < eventConfig('normal-crossing').revealDistance);
assert(eventConfig('normal-crossing').hazardDistance <= 2500, '首个道口必须在正常运行数分钟内出现');
assert(
  eventConfig('tunnel-hazard').tunnelStartDistance - eventConfig('normal-crossing').hazardDistance <= 1100,
  '正常道口后约1 km应进入隧道',
);
assert(
  eventConfig('tunnel-hazard').hazardDistance > eventConfig('tunnel-hazard').tunnelEndDistance,
  '塌方必须位于隧道出口外，不得放在洞内',
);
assert.equal(
  eventConfig('rail-glint-break').hazardDistance - eventConfig('rail-glint-break').revealDistance,
  500,
  '钢轨反光中断应从500 m外进入观察范围',
);
assert(
  eventConfig('rail-glint-break').hazardDistance - eventConfig('tunnel-hazard').hazardDistance >= 1000,
  '隧道停车点到钢轨异常点至少应留出1 km恢复运行距离',
);
assert.equal(
  eventConfig('rail-glint-break').glintBreakEndDistance - eventConfig('rail-glint-break').hazardDistance,
  180,
  '钢轨暗哑段应向危险点后延伸180 m',
);
assert.equal(LOOKOUT_TRAINING_CONFIG.throughSignals.length,5,'压缩线路应保留5架通过信号机');
assert(LOOKOUT_TRAINING_CONFIG.finishDistance <= 6500, '课堂考核线路不应保留原30 km空驶长度');
assert.equal(LOOKOUT_TRAINING_CONFIG.events.reduce((sum, event) => sum + event.weight, 0), 80, '途中场景分值应合计80分');

{
  const state = makeState();
  const assessment = new LookoutAssessment(state);
  const config = eventConfig('normal-crossing');
  state.distance = config.revealDistance;
  assessment.update(state);
  assessment.recordCommand('horn-start', undefined, state);
  state.distance = config.passDistance;
  assessment.update(state);
  assert.equal(scoreLookoutEvent(config, state.lookout.events[config.id]), 10);
}

for (const id of ['tunnel-hazard', 'rail-glint-break', 'intrusion-crossing']) {
  const state = makeState();
  const assessment = new LookoutAssessment(state);
  const config = eventConfig(id);
  resolvePrevious(state, id);
  state.distance = config.revealDistance;
  assessment.update(state);
  assessment.recordCommand('horn-start', undefined, state);
  assessment.recordCommand('auto', 5, state);
  assessment.recordCommand('traction', 0, state);
  if (config.requiredHornCount === 2) assessment.recordCommand('horn-start', undefined, state);
  state.distance = config.hazardDistance - 30;
  state.speed = 0;
  state.autoBrake = 5;
  state.independentBrake = 5;
  assessment.update(state);
  assessment.recordCommand('independent', 5, state);
  assessment.recordCommand('tail-query', undefined, state);
  state.independentBrake = 0;
  assessment.recordCommand('independent', 0, state);
  assessment.recordCommand('traction', 1, state);
  state.autoBrake = 0;
  assessment.recordCommand('auto', 0, state);
  assessment.recordCommand('tail-query', undefined, state);
  state.speed = 6;
  assessment.update(state);
  assert.equal(scoreLookoutEvent(config, state.lookout.events[id]), config.weight, `${id} should earn full score`);
}

{
  const state = makeState();
  const assessment = new LookoutAssessment(state);
  const config = eventConfig('tunnel-hazard');
  resolvePrevious(state, config.id);
  state.distance = config.revealDistance;
  assessment.update(state);
  assessment.recordCommand('horn-start', undefined, state);
  assessment.recordCommand('auto', 5, state);
  assessment.recordCommand('traction', 0, state);
  state.distance = config.hazardDistance - 25;
  state.speed = 0;
  state.autoBrake = 5;
  state.independentBrake = 5;
  assessment.update(state);
  assessment.recordCommand('independent', 5, state);
  assessment.recordCommand('tail-query', undefined, state);
  state.independentBrake = 0;
  assessment.recordCommand('independent', 0, state);
  assessment.recordCommand('traction', 1, state);
  state.autoBrake = 0;
  assessment.recordCommand('auto', 0, state);
  assessment.recordCommand('tail-query', undefined, state);
  assert.equal(state.lookout.events[config.id].restartSequenceCorrect, true, '停车后坡道起车顺序应完整记录');
}

{
  const state = makeState();
  const assessment = new LookoutAssessment(state);
  const config = eventConfig('rail-glint-break');
  resolvePrevious(state, config.id);
  state.distance = config.revealDistance;
  assessment.update(state);
  assessment.recordCommand('horn-start', undefined, state);
  assessment.recordCommand('auto', 5, state);
  assessment.recordCommand('traction', 0, state);
  state.distance = config.passDistance;
  assessment.update(state);
  assert.equal(state.lookout.events[config.id].status, 'failed');
  assert.equal(scoreLookoutEvent(config, state.lookout.events[config.id]), 0, 'no stop must zero the whole event');
}

{
  const state = makeState();
  const assessment = new LookoutAssessment(state);
  const config = eventConfig('intrusion-crossing');
  resolvePrevious(state, config.id);
  state.distance = config.revealDistance;
  assessment.update(state);
  assessment.recordCommand('horn-start', undefined, state);
  assessment.recordCommand('horn-start', undefined, state);
  assessment.recordCommand('auto', 5, state);
  assessment.recordCommand('traction', 0, state);
  state.distance = config.hazardDistance - 20;
  state.speed = 0;
  assessment.update(state);
  assessment.recordCommand('independent', 5, state);
  assert.equal(scoreLookoutEvent(config, state.lookout.events[config.id]), 18, '第二次鸣笛早于牵引退零且未完成坡道起车时应按动作计分');
}

{
  const state = makeState();
  Object.assign(state, {
    trainingScope: 'lookout', trainingMode: 'assessment', terrainSelected: true, terrainMode: 'level', parkingBrake: false,
    wholeTrainStarted: true, tailBaselinePressure: 500, autoBrakeReleaseAttempted: true, tailReleaseQueryAttempted: true, tailPressureRiseCorrect: true,
    notchOneAppliedAt: 1, singleValveNotchSynchronized: true, notchOneHoldCorrect: true, tractionCurrentRising: true,
    notchTwoApplied: true, rearLookCompleted: true, progressiveToFourCorrect: true, smoothStartQualified: true, lkjStartCorrect: true,
    continuityStageCompleted: true, continuityTailPressureCorrect: true, continuityBrakeAppliedCorrectly: true, continuitySideReleaseCorrect: true,
    continuityTractionReducedCorrectly: true, continuityLkjObserved: true, continuityAutoBrakeReleasedCorrectly: true, continuityTractionRestoredCorrectly: true,
    rejected: 99, abrupt: 99,
  });
  for (const config of LOOKOUT_TRAINING_CONFIG.events) {
    const event = state.lookout.events[config.id];
    Object.assign(event, {
      status: 'complete', hornCount: config.requiredHornCount, firstHornBeforeEmergency: true,
      secondHornAfterTractionZero: config.requiredHornCount === 2, emergencyCorrectOrder: config.kind === 'emergency',
      tractionZeroCorrectOrder: config.kind === 'emergency', stoppedBeforeHazard: config.kind === 'emergency',
      independentFullAfterStop: config.kind === 'emergency', unnecessaryEmergency: false,
      restartTailBaselineQueried: config.kind === 'emergency', restartIndependentReleased: config.kind === 'emergency',
      restartTractionOneApplied: config.kind === 'emergency', restartAutoReleased: config.kind === 'emergency',
      restartTailReleaseQueried: config.kind === 'emergency', restartSequenceCorrect: config.kind === 'emergency',
    });
  }
  assert.equal(scoreRun(state).score, 100, '途中瞭望总分应严格由4+16+10+20+20+30组成，不重复叠加通用扣分');
}

console.log('Lookout assessment valid: 20/10/20/20/30 scoring, emergency handling, restart sequence, stop-before-hazard gate, and continue-after-failure.');
