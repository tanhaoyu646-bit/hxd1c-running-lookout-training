import { TRAINING_CONFIG } from './smoothStartConfig.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, rate, dt) => value + clamp(target - value, -rate * dt, rate * dt);

export class SmoothStartSimulation extends EventTarget {
  constructor() {
    super();
    this.reset();
  }

  reset(mode = this.state?.trainingMode || 'teaching') {
    this.state = {
      trainingMode: mode,
      elapsed: 0,
      signalAspect: 'green',
      signalObserved: false,
      locomotiveSignalObserved: false,
      pressureObserved: false,
      horn: false,
      direction: 'N',
      autoBrake: 2,
      independentBrake: 2,
      traction: 0,
      actualTraction: 0,
      parkingBrake: false,
      pantograph: true,
      mainBreaker: true,
      controlPower: true,
      compressor: true,
      mainReservoir: 850,
      trainPipe: 500,
      brakeCylinder: 240,
      releasePropagation: 0,
      couplerForce: 0,
      wholeTrainStartFraction: 0,
      wholeTrainStarted: false,
      lowNotchApplied: false,
      lowNotchHeld: false,
      lkjStarted: false,
      rearLookSeconds: 0,
      rearLookCompleted: false,
      speed: 0,
      distance: 0,
      acceleration: 0,
      jerk: 0,
      maxAcceleration: 0,
      maxJerk: 0,
      slip: false,
      rollback: false,
      stableSeconds: 0,
      completed: false,
      failed: false,
      scoreDeductions: [],
      deductionKeys: [],
      events: [],
      lastMessage: '请先确认地面出站信号、机车信号和风压状态。',
    };
    this.emit('训练已复位。');
  }

  isAssessment() {
    return this.state.trainingMode === 'assessment';
  }

  setMode(mode) {
    if (!['teaching', 'assessment'].includes(mode)) return false;
    this.reset(mode);
    this.emit(mode === 'teaching' ? '已进入教学模式。' : '已进入考评模式：一般错误只扣分，安全红线仍会强制停车。');
    return true;
  }

  emit(message) {
    this.state.lastMessage = message;
    this.state.events.push({ time: this.state.elapsed, message });
    if (this.state.events.length > 40) this.state.events.shift();
    this.dispatchEvent(new CustomEvent('change', { detail: { message, state: this.state } }));
  }

  deduct(key, points, reason) {
    if (this.state.deductionKeys.includes(key)) return;
    this.state.deductionKeys.push(key);
    this.state.scoreDeductions.push({ key, points, reason });
    this.emit(`扣 ${points} 分：${reason}`);
  }

  reject(message, key = '') {
    if (this.isAssessment()) {
      if (key) this.deduct(key, 3, message);
      else this.emit(message);
      return true;
    }
    this.emit(`当前不能这样操作：${message}`);
    return false;
  }

  observeGroundSignal() {
    if (this.state.signalAspect !== 'green') {
      this.safetyStop('地面信号为停车信号，禁止起动。');
      return false;
    }
    this.state.signalObserved = true;
    this.emit('已确认地面出站信号开放。');
    return true;
  }

  observeLocomotiveSignal() {
    this.state.locomotiveSignalObserved = true;
    this.emit('已确认机车信号显示与地面信号一致。');
    return true;
  }

  observePressure() {
    this.state.pressureObserved = true;
    this.emit(`已查看风压：总风 ${Math.round(this.state.mainReservoir)} kPa，列车管 ${Math.round(this.state.trainPipe)} kPa。`);
    return true;
  }

  setDirection(direction) {
    if (!['R', 'N', 'F'].includes(direction)) return false;
    if (this.state.speed > 0.5 && direction !== 'F') return this.reject('列车移动中不得改变方向。', 'direction-moving');
    if (direction === 'F' && !this.isAssessment() && (!this.state.signalObserved || !this.state.locomotiveSignalObserved)) {
      return this.reject('应先确认地面信号和机车信号。');
    }
    if (direction === 'F' && (!this.state.signalObserved || !this.state.locomotiveSignalObserved)) {
      this.deduct('direction-before-signal', 5, '未完成信号确认即将方向手柄置前进。');
    }
    this.state.direction = direction;
    this.emit(`方向手柄：${direction === 'F' ? '前进位' : direction === 'R' ? '后退位' : '中立位'}。`);
    return true;
  }

  setAutoBrake(position) {
    const next = clamp(Math.round(position), 0, 3);
    if (next === 0 && !this.state.pressureObserved) {
      if (!this.reject('缓解前应查看风压状态。', 'release-before-pressure')) return false;
    }
    this.state.autoBrake = next;
    this.emit(`自动制动阀：${['运转位', '初制位', '常用制动位', '全制动位'][next]}。`);
    return true;
  }

  setIndependentBrake(position) {
    const next = clamp(Math.round(position), 0, 2);
    this.state.independentBrake = next;
    this.emit(`单独制动阀：${['缓解位', '制动区', '全制动位'][next]}。`);
    return true;
  }

  soundHorn() {
    this.state.horn = true;
    if (this.state.direction !== 'F') this.deduct('horn-before-direction', 2, '方向手柄置前进前鸣笛，操作顺序不规范。');
    this.emit('已鸣笛，发车警示完成。');
    return true;
  }

  canApplyTraction() {
    const s = this.state;
    return s.pantograph && s.mainBreaker && s.controlPower && !s.parkingBrake && s.direction === 'F';
  }

  setTraction(notch) {
    const next = clamp(Math.round(notch), 0, 8);
    const s = this.state;
    if (next > 0 && !this.canApplyTraction()) return this.reject('牵引条件未建立：检查方向、受电弓、主断和停放制动。', 'traction-condition');
    if (next > 0 && !this.isAssessment()) {
      if (!s.signalObserved || !s.locomotiveSignalObserved || !s.pressureObserved || !s.horn) {
        return this.reject('应先完成信号、风压确认和鸣笛。');
      }
      if (s.autoBrake !== 0 || s.independentBrake !== 0 || s.trainPipe < 570 || s.brakeCylinder > 45) {
        return this.reject('制动尚未充分缓解。');
      }
    }
    if (next > 0 && (s.autoBrake !== 0 || s.independentBrake !== 0 || s.brakeCylinder > 70)) {
      this.deduct('traction-against-brake', 8, '制动未缓解即加载牵引。');
    }
    if (Math.abs(next - s.traction) > 2) this.deduct(`abrupt-notch-${s.traction}-${next}`, 5, '牵引手柄跨越多个级位，冲动风险增大。');
    if (!s.wholeTrainStarted && next > 2) this.deduct('high-notch-before-whole-train', 10, '全列尚未起动即提高到高牵引级位。');
    s.traction = next;
    this.emit(`牵引手柄：${next === 0 ? '零位' : `${next}级`}。`);
    return true;
  }

  pressLkjStart() {
    if (this.state.speed < 0.15) {
      if (!this.reject('列车尚未起动，开车键按压时机过早。', 'lkj-early')) return false;
    }
    if (this.state.lkjStarted) return true;
    this.state.lkjStarted = true;
    this.emit('LKJ 开车键已按压，进入运行监控。');
    return true;
  }

  updateRearLook(dt, view) {
    if (!['rearLeft', 'rearRight'].includes(view)) return;
    if (this.state.speed < 0.2) return;
    this.state.rearLookSeconds += dt;
    if (!this.state.rearLookCompleted && this.state.rearLookSeconds >= TRAINING_CONFIG.rearLookSeconds) {
      this.state.rearLookCompleted = true;
      this.emit('后部瞭望完成：确认车辆依次起动且全列移动。');
    }
  }

  safetyStop(reason) {
    this.state.traction = 0;
    this.state.actualTraction = 0;
    this.state.autoBrake = 3;
    this.state.independentBrake = 2;
    this.state.failed = true;
    this.deduct('safety-stop', 30, reason);
  }

  tick(rawDt, view = 'front') {
    const dt = clamp(Number(rawDt) || 0, 0, 0.1);
    if (!dt) return;
    const s = this.state;
    if (s.completed) return;
    s.elapsed += dt;

    const pipeTarget = s.autoBrake === 0 ? 600 : [600, 550, 500, 420][s.autoBrake];
    s.trainPipe = approach(s.trainPipe, pipeTarget, s.autoBrake === 0 ? 42 : 70, dt);
    const independentCylinder = [0, 120, 300][s.independentBrake];
    const automaticCylinder = s.autoBrake === 0 ? 0 : [0, 80, 180, 300][s.autoBrake];
    s.brakeCylinder = approach(s.brakeCylinder, Math.max(independentCylinder, automaticCylinder), s.autoBrake === 0 && s.independentBrake === 0 ? 62 : 110, dt);

    const brakesCommandReleased = s.autoBrake === 0 && s.independentBrake === 0;
    s.releasePropagation = approach(s.releasePropagation, brakesCommandReleased ? 1 : 0, brakesCommandReleased ? 0.20 : 0.65, dt);
    s.actualTraction = approach(s.actualTraction, s.traction, 0.85, dt);

    const tractionReady = this.canApplyTraction() && s.actualTraction > 0.05;
    const brakeFactor = clamp((s.releasePropagation - 0.2) / 0.8, 0, 1) * clamp(1 - s.brakeCylinder / 160, 0, 1);
    const pull = tractionReady ? s.actualTraction * 0.105 * brakeFactor : 0;
    const brake = (s.brakeCylinder / 300) * 0.34 + (s.parkingBrake ? 0.5 : 0);
    const resistance = s.speed > 0.02 ? 0.018 + s.speed * 0.0015 : 0;
    const targetAcceleration = pull - brake - resistance;
    const previousAcceleration = s.acceleration;
    s.acceleration = approach(s.acceleration, targetAcceleration, 0.42, dt);
    s.jerk = (s.acceleration - previousAcceleration) / dt;
    s.maxAcceleration = Math.max(s.maxAcceleration, Math.abs(s.acceleration));
    s.maxJerk = Math.max(s.maxJerk, Math.abs(s.jerk));

    const previousSpeed = s.speed;
    s.speed = Math.max(0, s.speed + s.acceleration * 3.6 * dt);
    if (s.speed < 0.02 && targetAcceleration < 0) {
      s.speed = 0;
      s.acceleration = 0;
      s.jerk = 0;
    }
    s.distance += ((previousSpeed + s.speed) / 7.2) * dt;
    if (s.speed > TRAINING_CONFIG.maxFinishSpeed + 5) {
      s.traction = 0;
      s.autoBrake = Math.max(1, s.autoBrake);
      this.deduct('target-overspeed', 10, `未在目标低速范围内稳速，速度超过 ${TRAINING_CONFIG.maxFinishSpeed + 5} km/h；系统切除牵引并施加初制动。`);
    }

    const pullPropagationTarget = tractionReady && brakeFactor > 0.15
      ? clamp((s.couplerForce + dt * (0.22 + s.actualTraction * 0.025)), 0, 1)
      : 0;
    s.couplerForce = approach(s.couplerForce, pullPropagationTarget, tractionReady ? 0.32 : 0.7, dt);
    if (s.actualTraction >= 0.7 && s.actualTraction <= 2.4) s.lowNotchApplied = true;
    if (s.lowNotchApplied && s.traction <= 2 && s.couplerForce >= 0.45) s.lowNotchHeld = true;
    const movingEvidence = s.speed > 0.05 || s.couplerForce > 0.15;
    s.wholeTrainStartFraction = approach(s.wholeTrainStartFraction, movingEvidence ? s.couplerForce : 0, movingEvidence ? 0.28 : 0.5, dt);
    if (!s.wholeTrainStarted && s.wholeTrainStartFraction >= 0.98) {
      s.wholeTrainStarted = true;
      this.emit('全列车辆已依次平稳起动，可以逐级增加牵引。');
    }

    s.slip = s.actualTraction >= 6 && s.speed < 3;
    if (s.slip) this.deduct('wheel-slip', 10, '低速高牵引导致空转。');
    if (Math.abs(s.jerk) > TRAINING_CONFIG.comfort.maxJerk) this.deduct('excess-jerk', 8, '纵向冲动过大。');
    if (s.acceleration > TRAINING_CONFIG.comfort.maxAcceleration) this.deduct('excess-acceleration', 6, '起动加速度偏大。');

    this.updateRearLook(dt, view);
    const inTargetBand = s.speed >= TRAINING_CONFIG.targetSpeed && s.speed <= TRAINING_CONFIG.maxFinishSpeed;
    const smoothNow = Math.abs(s.jerk) <= TRAINING_CONFIG.comfort.preferredJerk && s.acceleration <= TRAINING_CONFIG.comfort.preferredAcceleration;
    s.stableSeconds = inTargetBand && smoothNow ? s.stableSeconds + dt : 0;
    if (!s.completed && inTargetBand && s.stableSeconds >= 2 && s.wholeTrainStarted && s.lkjStarted && s.rearLookCompleted) {
      s.completed = true;
      this.emit('训练完成：列车达到目标低速，起动过程连续、全列状态已确认。');
    }
  }
}

