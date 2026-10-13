import assert from 'node:assert/strict';
import { SmoothStartSimulation } from '../scripts/smoothStartSimulation.js';
import { PROCEDURE, procedureState, scoreRun } from '../scripts/smoothStartProcedure.js';

function tick(simulation, seconds, view = 'front') {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) simulation.tick(0.1, view);
}

const normal = new SmoothStartSimulation();
normal.observeGroundSignal();
normal.observeLocomotiveSignal();
normal.observePressure();
assert.equal(normal.setDirection('F'), true);
assert.equal(normal.setAutoBrake(0), true);
assert.equal(normal.setIndependentBrake(0), true);
tick(normal, 10);
normal.soundHorn();
assert.equal(normal.setTraction(2), true);
for (let elapsed = 0; elapsed < 45 && !normal.state.completed; elapsed += 0.1) {
  const view = elapsed > 7 ? 'rearLeft' : 'front';
  normal.tick(0.1, view);
  if (normal.state.speed > 0.2 && !normal.state.lkjStarted) normal.pressLkjStart();
  if (normal.state.wholeTrainStarted && normal.state.traction < 3) normal.setTraction(3);
}
assert.equal(normal.state.completed, true, '规范操作应能够完成训练');
assert.equal(procedureState(normal.state).done, true, '14项流程应全部完成');
assert.equal(scoreRun(normal.state).score, 100, '规范操作应得100分');
assert.equal(PROCEDURE.length, 14);
assert.ok(normal.state.rearLookSeconds >= 2.5);

const assessment = new SmoothStartSimulation();
assessment.setMode('assessment');
assert.equal(assessment.setDirection('F'), true, '考评模式一般顺序错误不应阻断');
assessment.setAutoBrake(0);
assessment.setIndependentBrake(0);
assessment.setTraction(2);
assert.ok(assessment.state.scoreDeductions.length > 0, '考评模式应记录顺序错误扣分');

const redSignal = new SmoothStartSimulation();
redSignal.state.signalAspect = 'red';
assert.equal(redSignal.observeGroundSignal(), false);
assert.equal(redSignal.state.failed, true, '停车信号属于安全红线');
assert.equal(redSignal.state.traction, 0);
assert.equal(redSignal.state.autoBrake, 3);

console.log(JSON.stringify({
  normalScore: scoreRun(normal.state).score,
  completedSteps: procedureState(normal.state).complete.filter(Boolean).length,
  finalSpeed: Number(normal.state.speed.toFixed(2)),
  assessmentDeductions: assessment.state.scoreDeductions,
  safetyStop: redSignal.state.failed,
}, null, 2));
