import { TRAIN_DYNAMICS } from './scenario.js?rev=start-scoring-v25';
import { LOOKOUT_TRAINING_CONFIG } from './lookoutTrainingConfig.js';
import { scoreLookoutEvent } from './lookoutAssessment.js';

const scenarioSignalReady = (s) => s.scenarioId === 'weather'
  ? s.locomotiveSignalObserved
  : s.signalObserved && s.locomotiveSignalObserved;

const parkingBrakeReleased = (s) => !s.parkingBrake;
const assessmentOr = (s, attempted, correct) => s.trainingMode === 'assessment' ? attempted : correct;
const baselineCorrect = (s) => s.tailBaselinePressure != null;
const baselineReady = (s) => assessmentOr(s, s.tailBaselineQueryAttempted, baselineCorrect(s));
const releaseRiseCorrect = (s) => s.autoBrakeReleaseAttempted
  && s.tailReleaseQueryAttempted
  && s.tailPressureRiseCorrect;
const releaseRiseReady = (s) => assessmentOr(s, s.autoBrakeReleaseAttempted && s.tailReleaseQueryAttempted, releaseRiseCorrect(s));
const notchOneCorrect = (s) => s.singleValveNotchSynchronized
  && s.notchOneHoldCorrect
  && s.tractionCurrentRising;
const notchOneReady = (s) => assessmentOr(s, s.notchOneHoldAttempted, notchOneCorrect(s));
const notchTwoRearCorrect = (s) => s.notchTwoApplied && s.wholeTrainStarted && s.rearLookCompleted;
const notchTwoRearReady = (s) => assessmentOr(s, s.notchTwoApplied && s.rearLookCompleted, notchTwoRearCorrect(s));
const progressiveCorrect = (s) => s.progressiveToFourCorrect && s.smoothStartQualified;
const progressiveReady = (s) => assessmentOr(s, s.notchFourApplied, progressiveCorrect(s));
const lkjStartReady = (s) => assessmentOr(s, s.lkjStartAttempted, s.lkjStartCorrect);

// 复合操纵项按独立动作给分，避免一次触控漏识别把后续已正确完成的
// 全列起动、后部瞭望等项目一起清零。最后一项吸收不能整除的余分。
const splitEarned = (checks, weight) => {
  const unit = Math.floor(weight / checks.length);
  const remainder = weight - unit * checks.length;
  return checks.reduce((sum, passed, index) => sum + (passed ? unit + (index === checks.length - 1 ? remainder : 0) : 0), 0);
};
const notchOneEarned = (s, weight) => splitEarned([
  s.notchOneAppliedAt != null,
  s.singleValveNotchSynchronized,
  s.notchOneHoldCorrect && s.tractionCurrentRising,
], weight);
const notchTwoRearEarned = (s, weight) => splitEarned([
  s.notchTwoApplied,
  s.wholeTrainStarted,
  s.rearLookCompleted,
], weight);
const progressiveEarned = (s, weight) => splitEarned([
  s.notchThreeAfterStart,
  s.notchThreeAfterStart && s.notchFourApplied,
  s.progressiveToFourCorrect && s.smoothStartQualified,
], weight);

const preDepartureCommunicationReady = (s) => {
  if (s.scenarioId === 'normal') return s.radioContacted;
  if (s.scenarioId === 'weather') return s.orderSigned;
  const firstContactReady = s.scenarioId === 'greenPermit' ? s.radioContacted : s.orderSigned;
  const unlockReady = !s.lkjUnlockRequired || s.lkjUnlockCorrect || (s.trainingMode === 'assessment' && s.lkjUnlockAttempted);
  return firstContactReady && s.credentialAttempted && unlockReady;
};

const departureAuthorizationReady = (s) => s.departureNoticeReceived
  && (!s.handSignalRequired || s.handSignalConfirmed)
  && (s.trainingMode === 'assessment' || s.scenarioId === 'weather' || s.departureResponseCorrect);

export const PROCEDURE = [
  ['选择K2026次训练场景', s => s.scenarioSelected, 2],
  ['确认驾驶台设备初始位置', s => s.initialConfirmed || (s.trainingMode === 'assessment' && s.initialAttempted), 4, s => s.initialConfirmed],
  ['输入并核对LKJ参数和运行揭示', s => s.lkjConfirmed || (s.trainingMode === 'assessment' && s.lkjAttempted), 6, s => s.lkjConfirmed],
  ['升受电弓、闭合主断并建立总风', s => s.panto && s.netVoltage >= 22.5 && s.mainBreaker && s.compressor && s.mainRes >= 750, 5],
  ['简略制动机试验：减压并确认制动', s => s.brakeTested, 4],
  ['大闸回运转位并确认列车缓解', s => s.releaseObserved, 4],
  ['完成发车前联控、凭证及LKJ非正常确认', preDepartureCommunicationReady, 6],
  ['按场景确认地面信号和机车信号', scenarioSignalReady, 4],
  ['接听发车联控并确认发车手信号', departureAuthorizationReady, 4],
  ['开启前照灯并鸣笛', s => s.headlight && s.horn, 3],
  ['方向手柄置前进位', s => s.direction === 'F', 3],
  ['缓解停放制动', parkingBrakeReleased, 5],
  ['制动保压状态首次查询并确认尾部风压', baselineReady, 5, baselineCorrect],
  ['缓解自阀，再次查询确认尾部风压上升高于20 kPa', releaseRiseReady, 9, releaseRiseCorrect],
  ['单阀缓解后2秒内置1.0级，并确认牵引电流上升', notchOneReady, 9, s => notchOneEarned(s, 9)],
  ['置2.0级，待全列起动并完成后部瞭望', notchTwoRearReady, 10, s => notchTwoRearEarned(s, 10)],
  ['全列起动后按2.0→3.0→4.0级平稳加速', progressiveReady, 7, s => progressiveEarned(s, 7)],
  ['到出站信号机位置按压LKJ开车／7键', lkjStartReady, 5, s => s.lkjStartCorrect],
  ['越过出站信号机后稳定运行300 m', s => s.completed, 5],
];

export const SMOOTH_LEVEL_PROCEDURE = [
  ['选择平道或上坡道起动场景', s => s.terrainSelected, 5],
  ['缓解停放制动', parkingBrakeReleased, 5],
  ['制动保压状态首次查询并确认尾部风压', baselineReady, 10, baselineCorrect],
  ['缓解自阀，再次查询确认尾部风压上升高于20 kPa', releaseRiseReady, 20, releaseRiseCorrect],
  ['单阀缓解后2秒内置1.0级，并确认牵引电流上升', notchOneReady, 15, s => notchOneEarned(s, 15)],
  ['置2.0级，待全列起动并完成后部瞭望', notchTwoRearReady, 20, s => notchTwoRearEarned(s, 20)],
  ['全列起动后按2.0→3.0→4.0级平稳加速', progressiveReady, 15, s => progressiveEarned(s, 15)],
  ['到出站信号机位置按压LKJ开车／7键', lkjStartReady, 10, s => s.lkjStartCorrect],
];

export const SMOOTH_UPHILL_PROCEDURE = [
  ['选择平道或上坡道起动场景', s => s.terrainSelected, 5],
  ['缓解停放制动', parkingBrakeReleased, 5],
  ['制动保压状态首次查询并确认尾部风压', baselineReady, 10, baselineCorrect],
  ['单阀缓解后2秒内置不高于1.0级，并确认牵引电流上升', notchOneReady, 15, s => notchOneEarned(s, 15)],
  ['缓解自阀，再次查询确认尾部风压上升高于20 kPa', releaseRiseReady, 20, releaseRiseCorrect],
  ['置2.0级，待全列起动并完成后部瞭望', notchTwoRearReady, 20, s => notchTwoRearEarned(s, 20)],
  ['全列起动后按2.0→3.0→4.0级平稳加速', progressiveReady, 15, s => progressiveEarned(s, 15)],
  ['到出站信号机位置按压LKJ开车／7键', lkjStartReady, 10, s => s.lkjStartCorrect],
];

export const SMOOTH_PROCEDURE = SMOOTH_LEVEL_PROCEDURE;

// 综合考评仍保留原平道起车的8项内容，仅把原100分按20%折算。
// 后7项严格对应用户确认的贯通试验80分。
export const CONTINUITY_PROCEDURE = [
  ['默认平道起车条件已建立', s => s.terrainSelected && s.terrainMode === 'level', 1],
  ['缓解停放制动', parkingBrakeReleased, 1],
  ['制动保压状态首次查询并确认尾部风压', baselineReady, 2, baselineCorrect],
  ['缓解自阀，再次查询确认尾部风压上升高于20 kPa', releaseRiseReady, 4, releaseRiseCorrect],
  ['单阀缓解后2秒内置1.0级，并确认牵引电流上升', notchOneReady, 3, s => notchOneEarned(s, 3)],
  ['置2.0级，待全列起动并完成后部瞭望', notchTwoRearReady, 4, s => notchTwoRearEarned(s, 4)],
  ['全列起动后按2.0→3.0→4.0级平稳加速', progressiveReady, 3, s => progressiveEarned(s, 3)],
  ['到出站信号机位置按压LKJ开车／7键', lkjStartReady, 2, s => s.lkjStartCorrect],
  ['贯通试验前查询并确认尾部风压600 kPa', s => s.continuityTailQueryAttempted, 10, s => s.continuityTailPressureCorrect],
  ['58～62 km/h时自阀移至初制动位', s => s.continuityBrakeAttempted, 15, s => s.continuityBrakeAppliedCorrectly],
  ['自阀到初制动位后，单阀向右侧滑并保持至速度下降', s => s.continuitySideReleaseAttempted, 15, s => s.continuityBrakeAppliedCorrectly && s.continuitySideReleaseCorrect],
  ['速度下降后牵引主手柄由6.0级退至5.0级', s => s.continuityTractionReductionAttempted, 15, s => s.continuityTractionReducedCorrectly],
  ['速度下降阶段打开LKJ监控画面', s => s.continuityLkjOpenAttempted, 5, s => s.continuityLkjObserved],
  ['完成观察后缓解自阀', s => s.continuityReleaseAttempted, 10, s => s.continuityAutoBrakeReleasedCorrectly],
  ['缓解后牵引主手柄恢复至6.0级及以上', s => s.continuityTractionRestoreAttempted, 10, s => s.continuityTractionRestoredCorrectly],
];

const lookoutSmoothScore = (s) => [
  s.terrainSelected && s.terrainMode === 'level' && !s.parkingBrake,
  baselineCorrect(s) && releaseRiseCorrect(s),
  notchOneCorrect(s) && notchTwoRearCorrect(s),
  progressiveCorrect(s) && s.lkjStartCorrect,
].filter(Boolean).length;

const lookoutContinuityScore = (s) => [
  [s.continuityTailPressureCorrect, 2],
  [s.continuityBrakeAppliedCorrectly, 3],
  [s.continuityBrakeAppliedCorrectly && s.continuitySideReleaseCorrect, 3],
  [s.continuityTractionReducedCorrectly, 3],
  [s.continuityLkjObserved, 1],
  [s.continuityAutoBrakeReleasedCorrectly, 2],
  [s.continuityTractionRestoredCorrectly, 2],
].reduce((sum, [passed, weight]) => sum + (passed ? weight : 0), 0);

const lookoutEventResolved = (s, id) => ['complete', 'failed'].includes(s.lookout?.events?.[id]?.status);
const lookoutEventScore = (s, id) => {
  const config = LOOKOUT_TRAINING_CONFIG.events.find((item) => item.id === id);
  return scoreLookoutEvent(config, s.lookout?.events?.[id]);
};

// 途中瞭望考核总分100：站内平稳发车4、贯通试验16、正常道口10，
// 隧道轮廓异常20、钢轨反光中断20、侵限道口30。场景顺序固定。
export const LOOKOUT_PROCEDURE = [
  ['站内平稳发车', s => s.wholeTrainStarted || s.continuityExpired, 4, lookoutSmoothScore],
  ['第一闭塞分区贯通试验', s => s.continuityStageCompleted || s.continuityExpired, 16, lookoutContinuityScore],
  ['正常道口鸣笛通过', s => lookoutEventResolved(s, 'normal-crossing'), 10, s => lookoutEventScore(s, 'normal-crossing')],
  ['隧道轮廓异常处置及坡道起车', s => lookoutEventResolved(s, 'tunnel-hazard'), 20, s => lookoutEventScore(s, 'tunnel-hazard')],
  ['钢轨反光中断处置及坡道起车', s => lookoutEventResolved(s, 'rail-glint-break'), 20, s => lookoutEventScore(s, 'rail-glint-break')],
  ['侵限道口处置及坡道起车', s => lookoutEventResolved(s, 'intrusion-crossing'), 30, s => lookoutEventScore(s, 'intrusion-crossing')],
];

export function getProcedure(state) {
  if (state?.trainingScope === 'lookout') return LOOKOUT_PROCEDURE;
  if (state?.trainingScope === 'continuity') return CONTINUITY_PROCEDURE;
  if (state?.trainingScope !== 'smooth-only') return PROCEDURE;
  return state.terrainMode === 'uphill' ? SMOOTH_UPHILL_PROCEDURE : SMOOTH_LEVEL_PROCEDURE;
}

export function procedureState(state) {
  const procedure = getProcedure(state);
  const complete = procedure.map(([, test]) => Boolean(test(state)));
  const current = complete.findIndex((done) => !done);
  return { complete, current: current < 0 ? procedure.length - 1 : current, done: complete.every(Boolean) };
}
function preDepartureStepEarned(state) {
  const locked = new Set(state.assessmentCredentialLocks || []);
  if (state.scenarioId === 'normal') return state.radioResponseCorrect && !locked.has('credential') && !locked.has('signalReadyCall') ? 6 : 0;
  if (state.scenarioId === 'weather') return state.orderSigned && !locked.has('credential') ? 6 : 0;
  const firstContactCorrect = state.scenarioId === 'greenPermit' ? state.radioResponseCorrect : state.orderSigned;
  const unlockCorrect = !state.lkjUnlockRequired || (
    state.lkjUnlockMethodCorrect && !state.lkjUnlockMethodErrorRecorded && !locked.has('method')
    && state.lkjUnlockFieldsCorrect && !state.lkjUnlockFieldsErrorRecorded && !locked.has('fields')
    && state.lkjUnlockCombinationCorrect && !state.lkjUnlockCombinationErrorRecorded && !locked.has('combination')
  );
  return (firstContactCorrect && state.credentialCorrect && !locked.has('credential') ? 3 : 0)
    + (unlockCorrect ? 3 : 0);
}

function departureAuthorizationStepEarned(state) {
  const locked = new Set(state.assessmentCredentialLocks || []);
  const responseCorrect = state.scenarioId === 'weather' ? state.weatherReportSent : state.departureResponseCorrect;
  return (state.departureNoticeReceived && responseCorrect && !locked.has('notice') && !locked.has('departureCall') ? 2 : 0)
    + ((!state.handSignalRequired || state.handSignalConfirmed) && !locked.has('handSignal') ? 2 : 0);
}

export function scoreRun(state) {
  const p = procedureState(state);
  const procedure = getProcedure(state);
  const scoreLocks = new Set(state.assessmentScoreLocks || []);
  const itemScores = procedure.map(([label, workflowTest, weight, scoreTest = workflowTest], index) => {
    const rawEarned = state.trainingScope === 'complete' && index === 6
      ? preDepartureStepEarned(state)
      : state.trainingScope === 'complete' && index === 8
        ? departureAuthorizationStepEarned(state)
        : (() => {
          const scored = scoreTest(state);
          return typeof scored === 'number' ? Math.max(0, Math.min(weight, scored)) : scored ? weight : 0;
        })();
    const locked = state.trainingScope !== 'lookout' && scoreLocks.has(index);
    const earned = locked ? 0 : rawEarned;
    return {
      label,
      weight,
      complete: Boolean(workflowTest(state)),
      correct: earned === weight,
      earned,
      locked,
    };
  });
  const base = itemScores.reduce((sum, item) => sum + item.earned, 0);
  const operationalDeductions = Math.min(24,
    state.rejected * 2
    + state.abrupt * 2
    + (state.prematureAcceleration ? 6 : 0)
    + (state.rollbackRisk ? 8 : 0)
    + (state.tractionDelayExceeded ? 5 : 0)
    + (state.maxAcceleration > TRAIN_DYNAMICS.comfort.severeAcceleration ? 4 : 0)
    + (state.maxJerk > TRAIN_DYNAMICS.comfort.severeJerk ? 4 : 0));
  // 贯通试验中的规定减压会主动产生减速度与冲动，不能再套用起车阶段的
  // 舒适性瞬态扣分；平稳起车是否合格已经在前20分中独立评分。
  const continuityOperationalDeductions = Math.min(24,
    state.rejected * 2
    + state.abrupt * 2
    + (state.prematureAcceleration ? 6 : 0)
    + (state.rollbackRisk ? 8 : 0)
    + (state.tractionDelayExceeded ? 5 : 0));
  const continuityDeductions = (state.continuityDeductions || []).reduce((sum, item) => sum + Number(item.points || 0), 0);
  const deductions = state.trainingScope === 'lookout'
    ? 0
    : state.trainingScope === 'continuity'
    ? Math.min(30, Math.round(continuityOperationalDeductions * .2) + continuityDeductions)
    : operationalDeductions;
  return { score: Math.max(0, Math.min(100, base - deductions)), completed: p.complete.filter(Boolean).length, deductions, itemScores };
}

