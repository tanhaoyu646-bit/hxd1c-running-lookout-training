export const ROUTE_TRAINING_PROFILE = Object.freeze({
  diagramTitle: '爱国站—敬业站',
  lkjStationName: '株洲站',
  departureSignal: Object.freeze({
    id: 'X',
    label: '出站信号机',
    diagramKilometer: 'K222+603',
  }),
  firstBlock: Object.freeze({
    from: 'K222+603 出站信号机',
    to: 'K231+738 2328通过信号机',
    lengthMeters: 9135,
    endSignalId: '2328',
    endSignalKilometer: 'K231+738',
  }),
  // 操纵示意图红线在第一个闭塞分区内为水平限速段。后续折点只在
  // 曲线拼接页展示，本次贯通试验不驶入后续闭塞分区。
  firstBlockSpeedLimitKmh: 120,
  continuity: Object.freeze({
    targetSpeedKmh: 60,
    speedToleranceKmh: 2,
    // 本教学仿真把6.0级的持续运行速度约束在60～64 km/h区间：
    // 60 km/h起逐步削减牵引，64 km/h为硬上限。这是项目教学标定，
    // 不把真实机车牵引级位解释为速度定速器。
    notchSixTaperStartKmh: 60,
    notchSixHardLimitKmh: 64,
    tailPressureKpa: 600,
    simultaneousWindowSeconds: 2,
    speedDropEvidenceKmh: 0.5,
  }),
});

export function firstBlockEndDistance(departureSignalDistance) {
  return Number(departureSignalDistance) + ROUTE_TRAINING_PROFILE.firstBlock.lengthMeters;
}

export function firstBlockLimitAtDistance() {
  return ROUTE_TRAINING_PROFILE.firstBlockSpeedLimitKmh;
}

