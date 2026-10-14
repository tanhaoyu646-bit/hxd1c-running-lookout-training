import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditRoot = path.join(projectRoot, 'reports', 'source-asset-audit');
const sourceScenePath = path.join(auditRoot, 'raw', 'crossing-web-scene.json');
const outputPath = path.join(projectRoot, 'assets', 'msts-neiyi-corridor', 'lookout-source-prefabs.json');
const productionTextureRoot = path.join(projectRoot, 'assets', 'msts-neiyi-corridor', 'textures');

const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const scene = JSON.parse(fs.readFileSync(sourceScenePath, 'utf8'));
const anchor = scene.instances.find((instance) => instance.shape === 'US2Crossx1NBar.s');
if (!anchor) throw new Error('The audited source crossing anchor is missing.');

// Keep the source crossing deck, four warning-column objects and the two road pieces
// which physically meet the deck. Farther road, gantry and rail objects are intentionally
// excluded: the teaching corridor supplies its own continuous source railway.
const instances = scene.instances
  .map((instance) => ({
    ...instance,
    distanceToAnchor: Math.hypot(...instance.position.map((value, axis) => value - anchor.position[axis])),
  }))
  .filter((instance) => (
    instance.distanceToAnchor <= 10
    && /^(US2Crossx1NBar|R-rrcros_columns|JP2rd2L22deg|JP2Rd50mStrt)\.s$/i.test(instance.shape || '')
  ))
  .map(({ distanceToAnchor, ...instance }) => instance);

const shapeNames = [...new Set(instances.map((instance) => instance.shape))];
const shapes = Object.fromEntries(shapeNames.map((shapeName) => [shapeName, scene.shapes[shapeName]]));
if (Object.values(shapes).some((shape) => !shape)) throw new Error('A selected crossing shape is missing.');

const requiredTextures = [...new Set(Object.values(shapes)
  .flatMap((shape) => shape.materials.map((material) => material.texture).filter(Boolean)))];
const stagedTextureRoot = path.join(auditRoot, 'textures');
for (const textureName of requiredTextures) {
  const destination = path.join(productionTextureRoot, textureName);
  if (fs.existsSync(destination)) continue;
  const source = path.join(stagedTextureRoot, textureName);
  if (!fs.existsSync(source)) throw new Error(`Required source texture is not staged: ${textureName}`);
  fs.copyFileSync(source, destination);
}

const result = {
  format: 'lookout-source-prefabs-v1',
  generatedAt: new Date().toISOString(),
  source: {
    route: scene.source.route,
    worldTile: scene.source.worldTile,
    worldSha256: scene.source.worldSha256,
    auditSceneSha256: hashFile(sourceScenePath),
    policy: 'Source transforms and geometry are preserved; the prefab is moved only by a parent transform.',
  },
  crossing: {
    anchor: {
      uid: anchor.uid,
      type: anchor.type,
      shape: anchor.shape,
      position: anchor.position,
      quaternion: anchor.quaternion,
    },
    instances,
    shapes,
    requiredTextures,
    textureSha256: Object.fromEntries(requiredTextures.map((name) => [
      name,
      hashFile(path.join(productionTextureRoot, name)),
    ])),
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`, 'utf8');
console.log(`Generated source crossing prefab with ${instances.length} objects and ${shapeNames.length} shapes.`);
