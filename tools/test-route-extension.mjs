import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRailAlignedPath, cumulativePathDistances } from '../scripts/railAlignedPath.js';

const scene = JSON.parse(await readFile('assets/msts-neiyi-corridor/neiyi-neijiang-neijiangnan-scene.json', 'utf8'));
const path = JSON.parse(await readFile('assets/msts-neiyi/neiyi-5635-trackdb-path.json', 'utf8'));
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
