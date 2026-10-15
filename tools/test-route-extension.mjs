import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRailAlignedPath, cumulativePathDistances } from '../scripts/railAlignedPath.js';

const scene = JSON.parse(await readFile('assets/msts-neiyi-corridor/neiyi-neijiang-neijiangnan-scene.json', 'utf8'));
const path = JSON.parse(await readFile('assets/msts-neiyi/neiyi-5635-trackdb-path.json', 'utf8'));
const terrain = JSON.parse(await readFile('assets/msts-neiyi-corridor/neiyi-lookout-terrain.json', 'utf8'));
const nativeTerrain = JSON.parse(await readFile('assets/msts-neiyi-corridor/neiyi-lookout-terrain-native.json', 'utf8'));
const sourcePrefabs = JSON.parse(await readFile('assets/msts-neiyi-corridor/lookout-source-prefabs.json', 'utf8'));
const routeSceneSource = await readFile('scripts/mstsRouteScene.js', 'utf8');
const points = Array.from(
  { length: Math.floor(path.positions.length / 3) },
  (_, index) => path.positions.slice(index * 3, index * 3 + 3),
);

const cumulative = [0];
for (let index = 1; index < points.length; index += 1) {
  const [ax, , az] = points[index - 1];
  const [bx, , bz] = points[index];
  cumulative.push(cumulative[index - 1] + Math.hypot(bx - ax, bz - az));
}

assert.ok(cumulative.at(-1) > 10_000, 'route must extend beyond the complete first block');
assert.equal(terrain.summary.tileCount, 8, '近程考核走廊必须加载8个原线路地形瓦片');
assert.equal(terrain.summary.resolution, 65);
assert(terrain.tiles.every((tile) => tile.heights.length === 65 * 65));
assert(terrain.tiles.some((tile) => Math.max(...tile.heights) - Math.min(...tile.heights) > 50), '地形高程不能退化为平面');
assert.equal(nativeTerrain.summary.tileCount, 8, '瞭望基线必须保留8个原线路地形瓦片');
assert.equal(nativeTerrain.summary.resolution, 257, '瞭望基线必须使用8 m原生高程采样');
assert(nativeTerrain.tiles.every((tile) => tile.heights.length === 257 * 257));
assert.equal(sourcePrefabs.crossing.instances.length, 7, '原线路道口预制体应保留道口、道口柱和相接道路');
assert.equal(sourcePrefabs.source.worldTile, 'w-005723+014705.w');
assert.match(routeSceneSource, /MSTS_SOURCE_TERRAIN/);
assert.match(routeSceneSource, /A1t100mStrtTun\.s/);
assert.match(routeSceneSource, /limitTerrainAtRailway/);
assert.match(routeSceneSource, /LOOKOUT_ROUTE_RENDER_OPTIONS/);
assert.match(
  routeSceneSource,
  /renderedRouteDistance = this\.isLookout[\s\S]*?\? this\.pathLength/,
  '瞭望项目的连续本务主线不得在6 km考核终点附近截断',
);
assert.match(routeSceneSource, /LOOKOUT_MAINLINE_RAIL_VISIBILITY_LOD/, '缺少主线远景钢轨可见LOD');
assert.match(routeSceneSource, /onePixelDistance[\s\S]*?0\.15 \* viewportHeight/, '远景LOD未按原0.15 m轨顶的屏幕投影动态接管');
assert.match(routeSceneSource, /onePixelRailDistance[\s\S]*?0\.15 \* height/, '窗口缩放后未重新计算钢轨投影阈值');
assert.match(routeSceneSource, /this\.camera\.far = Math\.max\(50_000, Math\.ceil\(this\.pathLength \+ 1_000\)\)/, '相机远裁剪面未覆盖完整本务线路');
assert.doesNotMatch(routeSceneSource, /uniform float fogFar/, '远景钢轨不得再按场景雾距淡出');
assert.match(routeSceneSource, /polishedMaterial\.color\.set\('#8b969a'\)/, '近景轨顶未使用原线路中灰钢色');
assert.match(routeSceneSource, /id:\s*'SIDE',[\s\S]*?halfWidthPixels:\s*1\.15[\s\S]*?color:\s*'#394246'/, '远景轨腰轮廓未按原游戏明暗结构建立');
assert.match(routeSceneSource, /id:\s*'TOP',[\s\S]*?halfWidthPixels:\s*0\.62[\s\S]*?color:\s*'#8b969a'/, '远景轨顶未保持稳定的灰钢色最小宽度');
assert.match(routeSceneSource, /name:\s*'RailSide'[\s\S]*?texture:\s*'ACleanTrack2\.png'/, '连续轨腰未复用原游戏纹理');
assert.match(routeSceneSource, /name:\s*'RailTops'[\s\S]*?texture:\s*'ACleanTrack2\.png'/, '连续轨顶未复用原游戏纹理');
assert.match(routeSceneSource, /halfWidth:\s*0\.075[\s\S]*?baseHeight:\s*0\.2[\s\S]*?railHeight:\s*0\.125/, '连续钢轨截面未恢复原游戏0.15 m轨宽和0.125 m轨腰高度');
assert.match(routeSceneSource, /repeatLength:\s*5/, '道床纹理未恢复原游戏5 m重复周期');
assert.match(routeSceneSource, /polishedMaterial\.emissive\.set\('#000000'\)[\s\S]*?emissiveIntensity\s*=\s*0/, '实体轨头不得使用白色或蓝色自发光');

const alignedPoints = buildRailAlignedPath(path.positions, scene.instances, { spacing: 5 });
const alignedDistances = cumulativePathDistances(alignedPoints);
assert.ok(alignedPoints.length > points.length * 10, 'camera path must be densely sampled between track control points');
assert.ok(alignedDistances.at(-1) > 10_000, 'rail-aligned camera path must cover the complete first block');
assert.ok(
  Math.abs(alignedDistances.at(-1) - cumulative.at(-1)) / cumulative.at(-1) < .01,
  'rail-aligned smoothing must preserve operational distance within one percent',
);

function projectToPath([x, , z]) {
  let best = { lateral: Infinity, along: 0 };
  for (let index = 1; index < points.length; index += 1) {
    const [ax, , az] = points[index - 1];
    const [bx, , bz] = points[index];
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const lateral = Math.hypot(x - px, z - pz);
    if (lateral < best.lateral) {
      best = {
        lateral,
        along: cumulative[index - 1] + Math.sqrt(lengthSquared) * t,
      };
    }
  }
  return best;
}

const laterFirstBlockAssets = scene.instances.filter((instance) => {
  const projection = projectToPath(instance.position);
  return projection.lateral <= 80 && projection.along >= 8_000 && projection.along <= 10_000;
});

assert.ok(
  laterFirstBlockAssets.length >= 100,
  `later first-block scenery is unexpectedly sparse (${laterFirstBlockAssets.length} nearby instances)`,
);

console.log(`Route extension tests passed (${Math.round(alignedDistances.at(-1))} m rail-aligned path, ${laterFirstBlockAssets.length} later-block assets).`);
