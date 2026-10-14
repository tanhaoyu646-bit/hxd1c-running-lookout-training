export const LOOKOUT_EVENT_IDS = Object.freeze({
  NORMAL_CROSSING: 'normal-crossing',
  TUNNEL_HAZARD: 'tunnel-hazard',
  RAIL_GLINT_BREAK: 'rail-glint-break',
  INTRUSION_CROSSING: 'intrusion-crossing',
});

export const LOOKOUT_TRAINING_CONFIG = Object.freeze({
  title: 'K2026次途中瞭望技巧综合考评',
  subtitle: '平稳起车与贯通试验20分 · 途中瞭望80分',
  // 终点位于大山铺进站信号机（约 28.98 km）之前，不驶入 B 站。
  finishDistance: 28880,
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
      revealDistance: 15400,
      hazardDistance: 16000,
      passDistance: 16050,
      requiredHornCount: 1,
      weight: 5,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.TUNNEL_HAZARD,
      label: '隧道出口轮廓异常',
      kind: 'emergency',
      visualKind: 'tunnel',
      // 对齐原 NEIYI 线路的真实隧道，而非教学层虚构坐标。
      tunnelStartDistance: 17870,
      tunnelEndDistance: 18800,
      revealDistance: 17950,
      hazardDistance: 18480,
      passDistance: 18530,
      requiredHornCount: 1,
      weight: 25,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.RAIL_GLINT_BREAK,
      label: '钢轨光带中断',
      kind: 'emergency',
      visualKind: 'rail',
      glintStartDistance: 24800,
      revealDistance: 25400,
      hazardDistance: 26000,
      passDistance: 26050,
      glintEndDistance: 26400,
      requiredHornCount: 1,
      weight: 25,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.INTRUSION_CROSSING,
      label: '道口人员或车辆侵线',
      kind: 'emergency',
      visualKind: 'intrusion-crossing',
      revealDistance: 28000,
      hazardDistance: 28600,
      passDistance: 28650,
      requiredHornCount: 2,
      weight: 25,
    }),
  ]),
});

export function getLookoutEventConfig(id) {
  return LOOKOUT_TRAINING_CONFIG.events.find((event) => event.id === id) || null;
}

