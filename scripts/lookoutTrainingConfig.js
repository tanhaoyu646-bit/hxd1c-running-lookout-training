export const LOOKOUT_EVENT_IDS = Object.freeze({
  NORMAL_CROSSING: 'normal-crossing',
  TUNNEL_HAZARD: 'tunnel-hazard',
  RAIL_GLINT_BREAK: 'rail-glint-break',
  INTRUSION_CROSSING: 'intrusion-crossing',
});

export const LOOKOUT_TRAINING_CONFIG = Object.freeze({
  title: 'K2026次途中瞭望技巧综合考评',
  subtitle: '平稳起车与贯通试验20分 · 途中瞭望80分',
  finishDistance: 30700,
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
      revealDistance: 10600,
      hazardDistance: 11200,
      passDistance: 11250,
      requiredHornCount: 1,
      weight: 5,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.TUNNEL_HAZARD,
      label: '隧道出口轮廓异常',
      kind: 'emergency',
      visualKind: 'tunnel',
      tunnelStartDistance: 16400,
      tunnelEndDistance: 17350,
      revealDistance: 16900,
      hazardDistance: 17240,
      passDistance: 17290,
      requiredHornCount: 1,
      weight: 25,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.RAIL_GLINT_BREAK,
      label: '钢轨光带中断',
      kind: 'emergency',
      visualKind: 'rail',
      glintStartDistance: 22000,
      revealDistance: 22600,
      hazardDistance: 23200,
      passDistance: 23250,
      glintEndDistance: 23650,
      requiredHornCount: 1,
      weight: 25,
    }),
    Object.freeze({
      id: LOOKOUT_EVENT_IDS.INTRUSION_CROSSING,
      label: '道口人员或车辆侵线',
      kind: 'emergency',
      visualKind: 'intrusion-crossing',
      revealDistance: 29600,
      hazardDistance: 30200,
      passDistance: 30250,
      requiredHornCount: 2,
      weight: 25,
    }),
  ]),
});

export function getLookoutEventConfig(id) {
  return LOOKOUT_TRAINING_CONFIG.events.find((event) => event.id === id) || null;
}

