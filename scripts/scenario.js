export const SIGNAL_ASPECTS = {
  green: {
    label: '绿灯', frame: 7,
    meaning: '准许列车按规定速度运行，表示运行前方至少有三个闭塞分区空闲。',
  },
  greenYellow: {
    label: '绿黄色灯', frame: 6,
    meaning: '准许列车按规定速度注意运行，表示运行前方至少有两个闭塞分区空闲。',
  },
  yellow: {
    label: '黄灯', frame: 5,
    meaning: '准许列车按规定速度注意运行，表示运行前方有一个闭塞分区空闲。',
  },
  red: {
    label: '红灯', frame: 0,
    meaning: '禁止越过该信号机。',
  },
};

export const ASSESSMENT_ASPECTS = ['green', 'greenYellow', 'yellow'];

// 课堂训练固定数据：仅用于本网页的操作核对，不作为实际行车参数或运行揭示。
export const LKJ_TRAINING_PARAMETERS = {
  driverId: '0001',
  assistantId: '0002',
  section: '101',
  station: '203',
  trainNo: '2026',
  trainType: '1',
  weight: '850',
  cars: '12',
  length: '330',
  locomotiveCount: '1',
  speedLevel: '120',
  stationYard: '1',
  track: '1',
  runDirection: '2',
  endStation: '204',
  runPath: '1',
};

export const LKJ_FIELD_DEFINITIONS = [
  ['driverId', '司机号', '0001'],
  ['assistantId', '副司机号', '0002'],
  ['section', '区段号', '101'],
  ['station', '车站号', '203（株洲）'],
  ['trainNo', '车次', '2026（显示 K2026）'],
  ['trainType', '列车种类代码', '1＝旅客列车（教学）'],
  ['weight', '总重（t）', '850（教学值）'],
  ['cars', '辆数', '12'],
  ['length', '列车长度（m）', '330（教学值）'],
  ['locomotiveCount', '机车台数', '1'],
  ['speedLevel', '速度等级（km/h）', '120'],
  ['stationYard', '站场号', '1'],
  ['track', '股道号', '1'],
  ['runDirection', '运行方向代码', '2＝七斗冲方向（教学）'],
  ['endStation', '终到站代码', '204（教学）'],
  ['runPath', '运行径路号', '1（教学）'],
];

// HXD1C＋12辆旅客列车的课堂动力标定。机车整备质量和最大起动牵引力
// 采用公开车型数据；客车质量、阻力和舒适性阈值为本实训的教学等效值。
export const TRAIN_DYNAMICS = {
  locomotiveMassKg: 138000,
  coachCount: 12,
  coachAverageMassKg: 59300,
  totalMassKg: 850000,
  maxStartingTractiveEffortN: 520000,
  tractionNotches: 7,
  tractionForcePerNotchN: 74000,
  baseResistanceN: 13000,
  linearResistancePerKmh: 34,
  quadraticResistancePerKmh2: 1.2,
  consistPropagationSeconds: 6,
  comfort: {
    preferredAcceleration: 0.28,
    warningAcceleration: 0.42,
    severeAcceleration: 0.55,
    preferredJerk: 0.22,
    warningJerk: 0.48,
    severeJerk: 0.75,
  },
};

// 平稳起动专项只比较线路纵断面，不混入天气或行车凭证场景。
// 坡度与阈值均为课堂等效标定，用来体现操纵差异，不作为线路实测数据。
export const SMOOTH_START_TERRAINS = Object.freeze({
  level: Object.freeze({
    id: 'level',
    label: '平道起动',
    shortLabel: '平道',
    gradePermille: 0,
    requiredStartNotch: 1,
    initialIndependentBrake: 2,
    note: '制动保压时先查询尾部风压；缓解自阀并复查风压上升后，缓解单阀并在2秒内投入1.0级牵引。',
  }),
  uphill: Object.freeze({
    id: 'uphill',
    label: '上坡道起动',
    shortLabel: '上坡道',
    gradePermille: 4,
    requiredStartNotch: 1,
    initialIndependentBrake: 2,
    note: '制动保压时先查询尾部风压；单阀缓解后2秒内投入不高于1.0级牵引，确认牵引电流上升后再缓解自阀。',
  }),
});

export function getSmoothStartTerrain(id) {
  return SMOOTH_START_TERRAINS[id] || SMOOTH_START_TERRAINS.level;
}

export const RUNNING_NOTICES = [
  '株洲站 1 道出发，运行方向：七斗冲方向。',
  '本次为 K2026 次教学编组，采用 HXD1C 驾驶台功能载体。',
  '行车凭证按当前教学场景确认；揭示仅供课堂训练使用。',
];

export function isLkjParameterMatch(input = {}) {
  return getLkjMismatchFields(input).length === 0;
}

// 评分和流程推进必须使用同一组训练参数。返回字段名而不是只返回 true/false，
// 这样考评模式可以记录错误、扣分并继续，而不会因为一次错误输入把整个流程锁死。
export function getLkjMismatchFields(input = {}) {
  return Object.entries(LKJ_TRAINING_PARAMETERS)
    .filter(([key, value]) => String(input[key] ?? '').trim() !== value)
    .map(([key]) => key);
}

