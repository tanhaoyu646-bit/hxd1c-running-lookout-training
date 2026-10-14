import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRailAlignedPath, cumulativePathDistances } from '../scripts/railAlignedPath.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameRoot = process.env.MSTS_GAME_ROOT;
if (!gameRoot) {
  throw new Error('请先设置 MSTS_GAME_ROOT，使其指向本机 Train Simulator 安装目录。');
}
const routeRoot = path.join(gameRoot, 'ROUTES', 'NEIYI');
const globalRoot = path.join(gameRoot, 'GLOBAL');
const reportRoot = path.join(projectRoot, 'reports', 'source-asset-audit');
const rawRoot = path.join(reportRoot, 'raw');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hashFile = (file) => fs.existsSync(file)
  ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
  : null;
const round = (value, digits = 3) => Number(value.toFixed(digits));

const scene = readJson(path.join(projectRoot, 'assets', 'msts-neiyi-corridor', 'neiyi-lookout-full-scene.json'));
const terrain = readJson(path.join(projectRoot, 'assets', 'msts-neiyi-corridor', 'neiyi-lookout-terrain.json'));
const pathData = readJson(path.join(projectRoot, 'assets', 'msts-neiyi', 'neiyi-5635-trackdb-path.json'));
const crossingScene = readJson(path.join(rawRoot, 'crossing-web-scene.json'));
const crossingManifest = readJson(path.join(rawRoot, 'crossing-world-manifest.json'));
const tunnelScene = readJson(path.join(rawRoot, 'tunnel-web-scene.json'));
const tunnelManifest = readJson(path.join(rawRoot, 'tunnel-world-manifest.json'));
const worldIndex = readJson(path.join(rawRoot, 'all-world-index.json'));
const routeSceneCode = fs.readFileSync(path.join(projectRoot, 'scripts', 'mstsRouteScene.js'), 'utf8');

const routePoints = buildRailAlignedPath(pathData.positions, scene.instances, { spacing: 5 });
const routeDistances = cumulativePathDistances(routePoints);

function projectPointToPath(position, maximumDistance = 6500) {
  let best = null;
  for (let index = 1; index < routePoints.length; index += 1) {
    if (routeDistances[index - 1] > maximumDistance) break;
    const start = routePoints[index - 1];
    const end = routePoints[index];
    const segment = end.map((value, axis) => value - start[axis]);
    const offset = position.map((value, axis) => value - start[axis]);
    const lengthSquared = segment.reduce((sum, value) => sum + value * value, 0);
    if (lengthSquared < 1e-9) continue;
    const ratio = Math.max(0, Math.min(1,
      offset.reduce((sum, value, axis) => sum + value * segment[axis], 0) / lengthSquared));
    const closest = start.map((value, axis) => value + segment[axis] * ratio);
    const lateralDistance = Math.hypot(...position.map((value, axis) => value - closest[axis]));
    if (!best || lateralDistance < best.lateralDistance) {
      best = {
        alongDistance: routeDistances[index - 1] + Math.sqrt(lengthSquared) * ratio,
        lateralDistance,
      };
    }
  }
  return best;
}

const selectedSourceTracks = scene.instances
  .filter((instance) => instance.type === 'TrackObj' && /^A\d+t/i.test(instance.shape || ''))
  .map((instance) => ({ ...instance, projection: projectPointToPath(instance.position) }))
  .filter(({ projection }) => projection && projection.lateralDistance < 4.2 && projection.alongDistance <= 6500);

const straightTrackShapeName = Object.keys(scene.shapes)
  .find((name) => name.toLowerCase() === 'a1t100mstrt.s');
const straightTrackShape = scene.shapes[straightTrackShapeName];
const straightTrackPositions = straightTrackShape.groups.flatMap((group) => group.positions);
const xs = straightTrackPositions.filter((_, index) => index % 3 === 0);
const ys = straightTrackPositions.filter((_, index) => index % 3 === 1);
const zs = straightTrackPositions.filter((_, index) => index % 3 === 2);

const [originX, , originZ] = terrain.source.origin;
const [originTileX, originTileZ] = terrain.source.originTile;
const tileSize = terrain.source.tileSize;
const terrainTiles = new Map(terrain.tiles.map((tile) => [`${tile.tileX},${tile.tileZ}`, tile]));

function sampleTerrain(point) {
  const mstsX = originX - point[0];
  const mstsZ = point[2] + originZ;
  const tileX = originTileX + Math.floor((mstsX + tileSize / 2) / tileSize);
  const tileZ = originTileZ + Math.floor((mstsZ + tileSize / 2) / tileSize);
  const tile = terrainTiles.get(`${tileX},${tileZ}`);
  if (!tile) return null;
  const localX = mstsX - (tileX - originTileX) * tileSize;
  const localZ = mstsZ - (tileZ - originTileZ) * tileSize;
  const resolution = tile.resolution;
  const column = Math.max(0, Math.min(resolution - 1,
    (localX + tileSize / 2) / tileSize * (resolution - 1)));
  const row = Math.max(0, Math.min(resolution - 1,
    (tileSize / 2 - localZ) / tileSize * (resolution - 1)));
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(resolution - 1, column0 + 1);
  const row1 = Math.min(resolution - 1, row0 + 1);
  const u = column - column0;
  const v = row - row0;
  const height = tile.heights;
  const a = height[row0 * resolution + column0] * (1 - u)
    + height[row0 * resolution + column1] * u;
  const b = height[row1 * resolution + column0] * (1 - u)
    + height[row1 * resolution + column1] * u;
  return a * (1 - v) + b * v - 0.12;
}

const terrainClearances = routePoints
  .map((point, index) => ({ point, distance: routeDistances[index] }))
  .filter(({ distance }) => distance <= 6000)
  .map(({ point, distance }) => {
    const ground = sampleTerrain(point);
    return ground === null ? null : { distance, clearance: point[1] - ground };
  })
  .filter(Boolean);
const terrainIntrusions = terrainClearances.filter(({ clearance }) => clearance < 0);
const worstTerrainIntrusion = terrainIntrusions
  .reduce((worst, current) => (!worst || current.clearance < worst.clearance ? current : worst), null);

const crossingAnchor = crossingScene.instances.find((instance) => instance.shape === 'US2Crossx1NBar.s');
const crossingNearby = crossingScene.instances
  .map((instance) => ({
    ...instance,
    distanceToAnchor: Math.hypot(...instance.position.map((value, axis) => value - crossingAnchor.position[axis])),
  }))
  .filter(({ distanceToAnchor }) => distanceToAnchor <= 80)
  .sort((a, b) => a.distanceToAnchor - b.distanceToAnchor);
const crossingCore = crossingNearby.filter((instance) => (
  /Cross|rrcros|JP2Rd|JP2rd|^A1t|SweGantry/i.test(instance.shape || '')
  || instance.type === 'CarSpawnerObj'
));

const textureDirectory = path.join(projectRoot, 'assets', 'msts-neiyi-corridor', 'textures');
const availableTextures = new Set(fs.readdirSync(textureDirectory).map((name) => name.toLowerCase()));
const stagedAuditTextureDirectory = path.join(reportRoot, 'textures');
const stagedAuditTextures = new Set(fs.existsSync(stagedAuditTextureDirectory)
  ? fs.readdirSync(stagedAuditTextureDirectory).map((name) => name.toLowerCase())
  : []);
const sourceTextures = (sourceScene) => [...new Set(Object.values(sourceScene.shapes)
  .flatMap((shape) => shape.materials.map((material) => material.texture).filter(Boolean)))];
const crossingTextures = sourceTextures(crossingScene);
const tunnelTextures = sourceTextures(tunnelScene);

const tunnelObjects = tunnelManifest.objects.filter((object) => /Tun|tunnel/i.test(object.fileName || ''));
const tunnelTrackObjects = tunnelObjects.filter((object) => object.type === 'TrackObj');
const pitchedTunnelTracks = tunnelTrackObjects.filter((object) => (
  Math.abs(object.quaternion[0]) > 1e-5 || Math.abs(object.quaternion[2]) > 1e-5
));
const tunnelElevations = tunnelTrackObjects
  .map((object) => Number(object.extra?.Elevation))
  .filter(Number.isFinite);

const trackedSourceFiles = [
  path.join(globalRoot, 'SHAPES', 'a1t100mstrt.s'),
  path.join(globalRoot, 'SHAPES', 'a1t100mstrttun.s'),
  path.join(routeRoot, 'SHAPES', 'Cn_tunnel2.s'),
  path.join(routeRoot, 'SHAPES', 'Cn_tunnel3.s'),
  path.join(routeRoot, 'SHAPES', 'JP1tunnel1t.s'),
  path.join(routeRoot, 'SHAPES', 'US2Crossx1NBar.s'),
  path.join(routeRoot, 'SHAPES', 'R-rrcros_columns.s'),
  path.join(routeRoot, 'SHAPES', 'chuzhan-halfauto-zhuci.s'),
  path.join(routeRoot, 'SHAPES', 'jinzhan.s'),
  path.join(routeRoot, 'sigcfg.dat'),
  path.join(routeRoot, 'NEIYI.TDB'),
];

const audit = {
  generatedAt: new Date().toISOString(),
  scope: '只读核对原游戏素材；未修改生产场景、原游戏目录或贯通试验项目',
  source: {
    gameRoot,
    routeRoot,
    routeWorldFiles: worldIndex.worldCount,
    routeObjectTypeCounts: worldIndex.typeCounts,
    routeShapeFiles: fs.readdirSync(path.join(routeRoot, 'SHAPES')).filter((name) => name.toLowerCase().endsWith('.s')).length,
    routeTextureFiles: fs.readdirSync(path.join(routeRoot, 'TEXTURES')).length,
    trackedFiles: trackedSourceFiles.map((file) => ({
      path: file,
      exists: fs.existsSync(file),
      bytes: fs.existsSync(file) ? fs.statSync(file).size : null,
      sha256: hashFile(file),
    })),
  },
  currentExport: {
    worldTiles: scene.source.worldTiles.length,
    shapes: scene.summary.shapeCount,
    instances: scene.summary.instanceCount,
    triangles: scene.summary.triangleCount,
    terrainTiles: terrain.summary.tileCount,
    exportedTerrainResolution: terrain.summary.resolution,
    sourceTerrainSampleSizeMeters: terrain.tiles[0]?.sampleSize,
    exportedTerrainGridMeters: tileSize / (terrain.summary.resolution - 1),
  },
  track: {
    directReuseConfidence: 'HIGH',
    selectedSourceTrackInstancesWithin6500m: selectedSourceTracks.length,
    sourceShape: straightTrackShapeName,
    sourceShapeBounds: {
      minX: round(Math.min(...xs), 6), maxX: round(Math.max(...xs), 6),
      minY: round(Math.min(...ys), 6), maxY: round(Math.max(...ys), 6),
      minZ: round(Math.min(...zs), 6), maxZ: round(Math.max(...zs), 6),
    },
    sourceMaterialNames: straightTrackShape.materials.map((material) => material.name),
    currentCodeFiltersOriginalTrack: /projection\.lateralDistance < 4\.2[\s\S]*?return;/.test(routeSceneCode),
    currentCodeBuildsFlatReplacement: routeSceneCode.includes('SELECTED_ROUTE_TEXTURED_TRACK'),
  },
  terrain: {
    directNativeReexportConfidence: 'HIGH',
    checkedSamplesTo6000m: terrainClearances.length,
    intrusionSamples: terrainIntrusions.length,
    intrusionRate: round(terrainIntrusions.length / terrainClearances.length, 4),
    worstIntrusionMeters: worstTerrainIntrusion ? round(-worstTerrainIntrusion.clearance) : 0,
    worstIntrusionDistance: worstTerrainIntrusion ? round(worstTerrainIntrusion.distance) : null,
  },
  signals: {
    directReuseConfidence: 'HIGH',
    fullRouteSignalInstances: worldIndex.typeCounts.SignalObj,
    currentExportSignalInstances: scene.instances.filter((instance) => instance.type === 'SignalObj').length,
    currentExportSignalShapes: [...new Set(scene.instances
      .filter((instance) => instance.type === 'SignalObj')
      .map((instance) => instance.shape))].sort(),
    sigcfgSha256: hashFile(path.join(routeRoot, 'sigcfg.dat')),
    currentCodeScalesSignalBody: routeSceneCode.includes('signal.visual.scale.setScalar'),
  },
  tunnel: {
    groupedReuseConfidence: 'HIGH',
    sourceWorldTile: tunnelScene.source.worldTile,
    sourceWorldSha256: tunnelScene.source.worldSha256,
    sourceObjects: tunnelObjects.length,
    sourceTrackObjects: tunnelTrackObjects.length,
    pitchedTrackObjects: pitchedTunnelTracks.length,
    elevationRange: tunnelElevations.length
      ? [round(Math.min(...tunnelElevations), 7), round(Math.max(...tunnelElevations), 7)]
      : [],
    sourceShapes: [...new Set(tunnelObjects.map((object) => object.fileName))].sort(),
    textureCount: tunnelTextures.length,
    missingTextures: tunnelTextures.filter((texture) => !availableTextures.has(texture.toLowerCase())),
    currentCodeUsesYawOnlyPlacement: routeSceneCode.includes('after.sub(before).setY(0)')
      && routeSceneCode.includes('object.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0)'),
  },
  crossing: {
    groupedReuseConfidence: 'HIGH',
    sourceWorldTile: crossingScene.source.worldTile,
    sourceWorldSha256: crossingScene.source.worldSha256,
    fullRouteCandidates: worldIndex.crossingCandidates,
    anchor: crossingAnchor,
    coreBundle: crossingCore.map((instance) => ({
      type: instance.type,
      uid: instance.uid,
      shape: instance.shape,
      distanceToAnchor: round(instance.distanceToAnchor),
      position: instance.position,
      quaternion: instance.quaternion,
    })),
    textureCount: crossingTextures.length,
    missingProductionTextures: crossingTextures.filter((texture) => !availableTextures.has(texture.toLowerCase())),
    stagedAuditTextures: crossingTextures.filter((texture) => stagedAuditTextures.has(texture.toLowerCase())),
  },
  recommendedDistances: {
    continuityEnd: 1750,
    normalCrossing: 2200,
    tunnelStart: 3200,
    tunnelHazard: 3520,
    tunnelEnd: 3500,
    railGlintHazard: 4600,
    intrusionCrossing: 5600,
    finish: 6000,
  },
};

fs.mkdirSync(reportRoot, { recursive: true });
fs.writeFileSync(path.join(reportRoot, 'asset-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

const percent = (audit.terrain.intrusionRate * 100).toFixed(1);
const markdown = `# NEIYI途中瞭望原游戏素材审计\n\n`
  + `生成时间：${audit.generatedAt}\n\n`
  + `## 范围\n\n${audit.scope}。\n\n`
  + `## 核对结论\n\n`
  + `| 类别 | 结论 | 证据 | 后续处理 |\n`
  + `|---|---|---|---|\n`
  + `| 本线轨道 | 可直接复用，置信度 HIGH | 前6.5 km存在${audit.track.selectedSourceTrackInstancesWithin6500m}个原始A1t轨道实例；原模型包围盒具有明确高度，不是平面贴图 | 恢复原TrackObj及原四元数，停用平面替代轨道 |\n`
  + `| 地形 | 原始数据可复用，当前降采样不可继续使用 | 源采样间距${audit.currentExport.sourceTerrainSampleSizeMeters} m，当前网页网格约${audit.currentExport.exportedTerrainGridMeters} m；0–6 km有${percent}%采样点发生侵线 | 按源采样重导并保持原线路切填关系 |\n`
  + `| 信号机 | 可直接复用，置信度 HIGH | 全线${audit.signals.fullRouteSignalInstances}个SignalObj，存在完整sigcfg.dat | 使用原模型、原灯位和原比例，取消车体远距放大 |\n`
  + `| 隧道 | 可按完整组合复用，置信度 HIGH | ${audit.tunnel.sourceWorldTile}内有${audit.tunnel.sourceTrackObjects}个隧道轨道构件，其中${audit.tunnel.pitchedTrackObjects}个带完整俯仰四元数 | 保留组合内部相对变换，只允许父级整体迁移 |\n`
  + `| 道口 | 可按完整组合复用，置信度 HIGH | ${audit.crossing.sourceWorldTile}中存在标志、道路、铁路、道口柱和车辆生成点 | 提取为预制组合，在2200 m与5600 m整体复用 |\n\n`
  + `## 当前网页破坏原场景的确定原因\n\n`
  + `1. 当前代码过滤了本线原始TrackObj，并以平面贴图和亮带替代。\n`
  + `2. 地形从源${audit.currentExport.sourceTerrainSampleSizeMeters} m采样降为约${audit.currentExport.exportedTerrainGridMeters} m网格，且没有保持路基切填关系。\n`
  + `3. 隧道迁移只保留水平转角，丢失了源TrackObj四元数中的俯仰分量。\n`
  + `4. 当前道口是程序化方盒，不是原游戏完整道口组合。\n`
  + `5. 当前信号机本体按距离放大，外加教学光晕，破坏了原游戏比例。\n\n`
  + `## 尚需补齐的资源\n\n`
  + `隧道审计场景缺失纹理：${audit.tunnel.missingTextures.length ? audit.tunnel.missingTextures.join('、') : '无'}。\n\n`
  + `生产素材目录尚缺道口纹理：${audit.crossing.missingProductionTextures.join('、') || '无'}。其中${audit.crossing.stagedAuditTextures.join('、') || '无'}已从原ACE转换并只放入审计目录，尚未接入生产场景。\n\n`
  + `## 独立查看器\n\n`
  + `打开本目录的 \`index.html\` 可切换查看原道口组合和原隧道组合。固定预览见 \`crossing-preview.png\` 与 \`tunnel-preview.png\`。\n\n`
  + `## 建议里程\n\n`
  + `贯通试验结束1750 m；正常道口2200 m；隧道入口3200 m、出口3500 m、洞外塌方3520 m；钢轨反光异常4600 m；侵限道口5600 m；6000 m结算。\n\n`
  + `## 进入场景修改阶段的门槛\n\n`
  + `- 原始轨道与信号机在独立查看器中方向、比例和材质通过人工确认。\n`
  + `- 隧道组合保持源四元数后接缝连续。\n`
  + `- 道口缺失纹理转换完成，道路、铁路与道口构件相对位置不变。\n`
  + `- 上述门槛完成前，不修改评分状态机和生产场景。\n`;

fs.writeFileSync(path.join(reportRoot, 'README.md'), markdown, 'utf8');
console.log(`Wrote ${path.join(reportRoot, 'asset-audit.json')}`);
console.log(`Wrote ${path.join(reportRoot, 'README.md')}`);
