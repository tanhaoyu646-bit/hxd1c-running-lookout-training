import { TRAINING_CONFIG } from './smoothStartConfig.js';

export const PROCEDURE = Object.freeze([
  ['确认地面出站信号', s => s.signalObserved, 7],
  ['确认机车信号与地面信号一致', s => s.locomotiveSignalObserved, 7],
  ['查看总风、列车管及制动缸压力', s => s.pressureObserved, 6],
  ['方向手柄置前进位', s => s.direction === 'F', 6],
  ['自动制动阀置运转位', s => s.autoBrake === 0, 6],
  ['单独制动阀缓解', s => s.independentBrake === 0, 6],
  ['鸣笛发车', s => s.horn, 5],
  ['低级位加载牵引', s => s.lowNotchApplied, 10],
  ['保持低级位，牵引力连续建立', s => s.lowNotchHeld, 8],
  ['确认全列车辆依次起动', s => s.wholeTrainStarted, 10],
  ['按压 LKJ 开车键', s => s.lkjStarted, 7],
  ['后部瞭望确认全列移动', s => s.rearLookCompleted, 8],
  ['全列起动后逐级增加牵引', s => s.wholeTrainStarted && s.traction >= 3, 7],
  [`达到 ${TRAINING_CONFIG.targetSpeed}–${TRAINING_CONFIG.maxFinishSpeed} km/h 并稳定运行`, s => s.completed, 7],
]);

export function procedureState(state) {
  const complete = PROCEDURE.map(([, test]) => Boolean(test(state)));
  const next = complete.findIndex(value => !value);
  return { complete, current: next < 0 ? complete.length - 1 : next, done: complete.every(Boolean) };
}

export function scoreRun(state) {
  const itemScores = PROCEDURE.map(([label, test, weight]) => ({
    label,
    weight,
    complete: Boolean(test(state)),
    earned: test(state) ? weight : 0,
  }));
  const base = itemScores.reduce((sum, item) => sum + item.earned, 0);
  const deductions = state.scoreDeductions.reduce((sum, item) => sum + item.points, 0);
  return {
    score: Math.max(0, Math.min(100, base - deductions)),
    base,
    deductions,
    itemScores,
  };
}

