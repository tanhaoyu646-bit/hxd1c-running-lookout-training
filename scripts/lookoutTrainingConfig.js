export const LOOKOUT_EVENT_IDS = Object.freeze({
  NORMAL_CROSSING: 'normal-crossing',
  TUNNEL_HAZARD: 'tunnel-hazard',
  RAIL_GLINT_BREAK: 'rail-glint-break',
  INTRUSION_CROSSING: 'intrusion-crossing',
});

export const LOOKOUT_TRAINING_CONFIG = Object.freeze({
  title: 'K2026次途中瞭望技巧综合考评',
  subtitle: '平稳起车与贯通试验20分 · 途中瞭望80分',
  // 课堂考核压缩站间运行距离：贯通试验完成后约 0.5 km 出现首个道口，
  // 正常运行约 3 分钟即可接近隧道，避免长时间空驶。
  continuityEndDistance: 1750,
  finishDistance: 6000,
  eventOrder: Object.freeze([
    LOOKOUT_EVENT_IDS.NORMAL_CROSSING,
    LOOKOUT_EVENT_IDS.TUNNEL_HAZARD,
    LOOKOUT_EVENT_IDS.RAIL_GLINT_BREAK,
    LOOKOUT_EVENT_IDS.INTRUSION_CROSSING,
  ]),
  events: Object.freeze([
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.NORMAL_CROSSING,
      label: '正常道口瞭望',
      kind: 'normal-crossing',
      revealDistance: 1900,
      hazardDistance: 2200,
      passDistance: 2250,
      requiredHornCount: 1,
      weight: 5,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.TUNNEL_HAZARD,
      label: '隧道出口轮廓异常',
      kind: 'emergency',
      visualKind: 'tunnel',
      // 使用原 NEIYI 隧道构件移植到近程直线段，保留原模型但缩短课堂等待时间。
      tunnelStartDistance: 2800,
      tunnelEndDistance: 3400,
      revealDistance: 2700,
      hazardDistance: 3330,
      passDistance: 3380,
      requiredHornCount: 1,
      weight: 25,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.RAIL_GLINT_BREAK,
      label: '钢轨光带中断',
      kind: 'emergency',
      visualKind: 'rail',
      glintStartDistance: 3900,
      revealDistance: 4100,
      hazardDistance: 4500,
      passDistance: 4550,
      glintEndDistance: 4800,
      requiredHornCount: 1,
      weight: 25,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.INTRUSION_CROSSING,
      label: '道口人员或车辆侵线',
      kind: 'emergency',
      visualKind: 'intrusion-crossing',
      revealDistance: 5200,
      hazardDistance: 5600,
      passDistance: 5650,
      requiredHornCount: 2,
      weight: 25,
    }),
  ]),
});

export function getLookoutEventConfig(id) {
  return LOOKOUT_TRAINING_CONFIG.events.find((event) => event.id === id) || null;
}

