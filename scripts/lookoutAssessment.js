import { LOOKOUT_TRAINING_CONFIG } from './lookoutTrainingConfig.js';

const STOP_SPEED_KMH = 0.5;
const FULL_SERVICE_POSITION = 5;

function createEventState(config) {
  return {
    id: config.id,
    status: 'pending',
    activated: false,
    hornCount: 0,
    hornCorrect: false,
    firstHornBeforeEmergency: false,
    secondHornAfterTractionZero: false,
    unnecessaryEmergency: false,
    emergencyAttempted: false,
    emergencyCorrectOrder: false,
    tractionZeroAttempted: false,
    tractionZeroCorrectOrder: false,
    stoppedBeforeHazard: false,
    stopDistance: null,
    independentFullAttempted: false,
    independentFullAfterStop: false,
    restartTailBaselineQueried: false,
    restartIndependentReleased: false,
    restartTractionOneApplied: false,
    restartAutoReleased: false,
    restartTailReleaseQueried: false,
    restartSequenceCorrect: false,
    cleared: false,
    failedReason: '',
  };
}

export function createLookoutAttempt() {
  return {
    currentEventId: null,
    finished: false,
    events: Object.fromEntries(
      LOOKOUT_TRAINING_CONFIG.events.map((config) => [config.id, createEventState(config)]),
    ),
  };
}

export function scoreLookoutEvent(config, event) {
  if (!config || !event) return 0;
  if (config.kind === 'normal-crossing') {
    return event.hornCount >= 1 ? Number(config.points?.horn || config.weight || 0) : 0;
  }
  // 用户已确认：没有在危险点前停车，整个异常场景不得分。
  if (!event.stoppedBeforeHazard) return 0;
  const points = config.points || {};
  const checks = [
    ['firstHorn', event.firstHornBeforeEmergency],
    ['secondHorn', config.requiredHornCount < 2 || event.secondHornAfterTractionZero],
    ['emergency', event.emergencyCorrectOrder],
    ['tractionZero', event.tractionZeroCorrectOrder],
    ['stop', event.stoppedBeforeHazard],
    ['independentFull', event.independentFullAfterStop],
    ['restartTailBaseline', event.restartTailBaselineQueried],
    ['restartIndependent', event.restartIndependentReleased],
    ['restartTractionOne', event.restartTractionOneApplied],
    ['restartAutoRelease', event.restartAutoReleased],
    ['restartTailRelease', event.restartTailReleaseQueried],
  ];
  return Math.min(config.weight, checks.reduce((sum, [key, passed]) => (
    sum + (passed ? Number(points[key] || 0) : 0)
  ), 0));
}

export function lookoutSceneScore(state) {
  const attempt = state?.lookout;
  if (!attempt) return 0;
  return LOOKOUT_TRAINING_CONFIG.events.reduce((total, config) => (
    total + scoreLookoutEvent(config, attempt.events[config.id])
  ), 0);
}

export class LookoutAssessment {
  constructor(state) {
    if (!state.lookout) state.lookout = createLookoutAttempt();
  }

  current(state) {
    const id = state.lookout?.currentEventId;
    const config = LOOKOUT_TRAINING_CONFIG.events.find((item) => item.id === id) || null;
    return config ? { config, event: state.lookout.events[config.id] } : null;
  }

  activateNext(state) {
    if (!state.lookout || state.lookout.finished) return '';
    for (const config of LOOKOUT_TRAINING_CONFIG.events) {
      const event = state.lookout.events[config.id];
      if (event.status !== 'pending' || state.distance < config.revealDistance) continue;
      event.status = 'active';
      event.activated = true;
      state.lookout.currentEventId = config.id;
      return config.kind === 'normal-crossing'
        ? '前方接近道口，请加强瞭望并按规定鸣笛。'
        : `前方进入${config.label}观察区，请根据线路状态及时处置。`;
    }
    return '';
  }

  recordCommand(id, value, state) {
    const active = this.current(state);
    if (!active || active.event.status !== 'active') return '';
    const { config, event } = active;
    const stoppedForRestart = config.kind === 'emergency'
      && event.stoppedBeforeHazard
      && state.speed <= STOP_SPEED_KMH;
    if (id === 'tail-query' && stoppedForRestart) {
      if (!event.restartTailBaselineQueried) {
        event.restartTailBaselineQueried = Number(state.autoBrake) >= 5
          && Number(state.independentBrake) >= FULL_SERVICE_POSITION;
        return event.restartTailBaselineQueried
          ? '停车制动状态首次查询尾部风压已记录。'
          : '尾部风压查询已记录，但首次查询时自阀紧急位或单阀全制位条件不完整。';
      }
      event.restartTailReleaseQueried ||= event.restartAutoReleased && Number(state.autoBrake) === 0;
      event.restartSequenceCorrect = event.restartTailBaselineQueried
        && event.restartIndependentReleased
        && event.restartTractionOneApplied
        && event.restartAutoReleased
        && event.restartTailReleaseQueried;
      return event.restartTailReleaseQueried
        ? '自阀缓解后的第二次尾部风压查询已记录。'
        : '第二次尾部风压查询时自阀尚未缓解，顺序错误已记录。';
    }
    if (id === 'horn-start') {
      event.hornCount += 1;
      if (event.hornCount === 1) event.firstHornBeforeEmergency = !event.emergencyAttempted;
      if (event.hornCount === 2) event.secondHornAfterTractionZero = event.tractionZeroCorrectOrder;
      event.hornCorrect = event.hornCount >= config.requiredHornCount;
      return `已记录${config.label}第${event.hornCount}次鸣笛。`;
    }
    if (id === 'auto' && Number(value) >= 5) {
      event.emergencyAttempted = true;
      if (config.kind === 'normal-crossing') {
        event.unnecessaryEmergency = true;
        return '正常道口出现无必要紧急制动，已记录。';
      }
      event.emergencyCorrectOrder ||= event.firstHornBeforeEmergency;
      return event.emergencyCorrectOrder
        ? '自阀紧急制动已记录。'
        : '自阀紧急制动早于第一次鸣笛，顺序错误已记录。';
    }
    if (id === 'auto' && Number(value) === 0 && config.kind === 'emergency' && event.stoppedBeforeHazard) {
      event.restartAutoReleased ||= event.restartTractionOneApplied;
      return event.restartAutoReleased
        ? '牵引1.0级建立后缓解自阀已记录，请再次查询尾部风压。'
        : '自阀缓解早于牵引1.0级，坡道起车顺序错误已记录。';
    }
    if (id === 'traction' && Number(value) === 0 && config.kind === 'emergency') {
      event.tractionZeroAttempted = true;
      event.tractionZeroCorrectOrder ||= event.emergencyCorrectOrder;
      return event.tractionZeroCorrectOrder
        ? '牵引主手柄退零已记录。'
        : '牵引主手柄退零早于自阀紧急制动，顺序错误已记录。';
    }
    if (id === 'traction' && Number(value) === 1 && config.kind === 'emergency' && event.stoppedBeforeHazard) {
      event.restartTractionOneApplied ||= event.restartIndependentReleased && Number(state.autoBrake) >= 5;
      return event.restartTractionOneApplied
        ? '单阀缓解后牵引主手柄1.0级已记录。'
        : '牵引1.0级操作已记录，但未满足先查询尾压、再缓解单阀的顺序。';
    }
    if (id === 'independent' && Number(value) >= FULL_SERVICE_POSITION && config.kind === 'emergency') {
      event.independentFullAttempted = true;
      event.independentFullAfterStop ||= event.stoppedBeforeHazard && state.speed <= STOP_SPEED_KMH;
      return event.independentFullAfterStop
        ? '停车后单阀全制防溜已记录。'
        : '单阀全制操作已记录，但未满足停车后操作条件。';
    }
    if (id === 'independent' && Number(value) === 0 && config.kind === 'emergency' && event.stoppedBeforeHazard) {
      event.restartIndependentReleased ||= event.restartTailBaselineQueried;
      return event.restartIndependentReleased
        ? '首次尾压查询后缓解单阀已记录。'
        : '单阀缓解早于停车状态尾压查询，坡道起车顺序错误已记录。';
    }
    return '';
  }

  update(state) {
    if (!state.lookout || state.lookout.finished) return '';
    const activationMessage = this.activateNext(state);
    if (activationMessage) return activationMessage;
    const active = this.current(state);
    if (active) {
      const { config, event } = active;
      if (config.kind === 'emergency'
        && !event.stoppedBeforeHazard
        && state.speed <= STOP_SPEED_KMH
        && state.distance < config.hazardDistance) {
        event.stoppedBeforeHazard = true;
        event.stopDistance = state.distance;
        event.cleared = true;
        return `${config.label}前停车成功，请将单阀移至全制位防溜。`;
      }
      if (config.kind === 'normal-crossing' && state.distance >= config.passDistance) {
        event.status = 'complete';
        event.cleared = true;
        state.lookout.currentEventId = null;
        return event.hornCount >= 1 ? '正常道口已安全通过。' : '正常道口未鸣笛，已记录失分。';
      }
      if (config.kind === 'emergency' && event.stoppedBeforeHazard
        && (state.speed > 5 || state.distance >= Number(event.stopDistance || 0) + 40)) {
        event.status = 'complete';
        event.cleared = true;
        state.lookout.currentEventId = null;
        if (!event.independentFullAfterStop) return `${config.label}恢复运行前未完成单阀全制，已记录失分。`;
        return event.restartSequenceCorrect
          ? `${config.label}处置及坡道起车完成，继续运行。`
          : `${config.label}已恢复运行，但坡道起车规定顺序未完整完成，已记录失分。`;
      }
      if (config.kind === 'emergency' && state.distance >= config.passDistance && !event.stoppedBeforeHazard) {
        event.status = 'failed';
        event.cleared = true;
        event.failedReason = '未在危险点前停车';
        state.lookout.currentEventId = null;
        return `${config.label}未在危险点前停车，本场景记0分，考核继续。`;
      }
    }
    const allResolved = LOOKOUT_TRAINING_CONFIG.events.every((config) => {
      const status = state.lookout.events[config.id].status;
      return status === 'complete' || status === 'failed';
    });
    if (allResolved && state.distance >= LOOKOUT_TRAINING_CONFIG.finishDistance) {
      state.lookout.finished = true;
      state.completed = true;
      return '全部途中瞭望场景已完成，正在生成成绩单。';
    }
    return '';
  }
}

