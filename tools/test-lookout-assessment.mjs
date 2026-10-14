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
  400,
  '钢轨反光中断应从400 m外进入观察范围',
);
assert.equal(
  eventConfig('rail-glint-break').glintBreakEndDistance - eventConfig('rail-glint-break').hazardDistance,
  180,
  '钢轨暗哑段应向危险点后延伸180 m',
);
assert.equal(LOOKOUT_TRAINING_CONFIG.throughSignals.length,5,'压缩线路应保留5架通过信号机');
assert(LOOKOUT_TRAINING_CONFIG.finishDistance <= 6500, '课堂考核线路不应保留原30 km空驶长度');

{
  const state = makeState();
  const assessment = new LookoutAssessment(state);
  const config = eventConfig('normal-crossing');
  state.distance = config.revealDistance;
  assessment.update(state);
  assessment.recordCommand('horn-start', undefined, state);
  state.distance = config.passDistance;
  assessment.update(state);
  assert.equal(scoreLookoutEvent(config, state.lookout.events[config.id]), 5);
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
  assessment.update(state);
  assessment.recordCommand('independent', 5, state);
  state.speed = 5;
  assessment.update(state);
  assert.equal(scoreLookoutEvent(config, state.lookout.events[id]), 25, `${id} should earn full score`);
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
  assert.equal(scoreLookoutEvent(config, state.lookout.events[config.id]), 22, '第二次鸣笛早于牵引退零应失去对应3分');
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
    });
  }
  assert.equal(scoreRun(state).score, 100, '途中瞭望总分应严格由4+16+5+25+25+25组成，不重复叠加通用扣分');
}

console.log('Lookout assessment valid: fixed order, horn/brake/traction sequence, stop-before-hazard gate, single-valve securement, and continue-after-failure.');
