import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenePath = path.join(projectRoot, 'assets', 'msts-neiyi-corridor', 'neiyi-lookout-full-scene.json');
const routePath = path.join(projectRoot, 'assets', 'msts-neiyi', 'neiyi-5635-trackdb-path.json');
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));

const points = [];
const distances = [0];
for (let index = 0; index < route.positions.length; index += 3) {
  const point = {
    x: route.positions[index],
    y: route.positions[index + 1],
    z: route.positions[index + 2],
  };
  points.push(point);
  if (points.length > 1) {
    const previous = points.at(-2);
    distances.push(distances.at(-1) + Math.hypot(
      point.x - previous.x,
      point.y - previous.y,
      point.z - previous.z,
    ));
  }
}

function project(position) {
  let best = { lateral: Number.POSITIVE_INFINITY, distance: 0, segment: 0 };
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const apx = position[0] - a.x;
    const apy = position[1] - a.y;
    const apz = position[2] - a.z;
    const lengthSquared = abx ** 2 + aby ** 2 + abz ** 2;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lengthSquared))
      : 0;
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    const z = a.z + abz * t;
    const lateral = Math.hypot(position[0] - x, position[1] - y, position[2] - z);
    if (lateral < best.lateral) {
      best = {
        lateral,
        distance: distances[index] + Math.sqrt(lengthSquared) * t,
        segment: index,
      };
    }
  }
  return best;
}

const patterns = /(tun|signal|chuzhan|jinzhan|yugao|rd|road|bridge|station|ping|dao|cross|sp-|platform)/i;
const rows = scene.instances
  .filter((instance) => patterns.test(`${instance.type} ${instance.shape}`))
  .map((instance) => ({
    uid: instance.uid,
    type: instance.type,
    shape: instance.shape,
    ...project(instance.position),
  }))
  .filter((item) => item.distance <= 31_200 && item.lateral <= 80)
  .sort((a, b) => a.distance - b.distance || a.lateral - b.lateral);

console.log(JSON.stringify({
  summary: {
    pathLength: distances.at(-1),
    sceneInstances: scene.instances.length,
    sceneShapes: Object.keys(scene.shapes).length,
    relevantObjectCount: rows.length,
  },
  objects: rows.map((item) => ({
    ...item,
    distance: Number(item.distance.toFixed(1)),
    lateral: Number(item.lateral.toFixed(1)),
  })),
}, null, 2));
