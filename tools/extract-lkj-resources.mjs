import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const source = process.argv[2];
const output = process.argv[3];

if (!source || !output) {
  throw new Error('Usage: node tools/extract-lkj-resources.mjs <LKJ2000.exe> <output-directory>');
}

const bytes = await readFile(source);
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const iend = Buffer.from([0x49, 0x45, 0x4e, 0x44]);
const resources = [];

for (let offset = 0; offset <= bytes.length - signature.length; offset += 1) {
  if (!bytes.subarray(offset, offset + signature.length).equals(signature)) continue;
  const endMarker = bytes.indexOf(iend, offset + 24);
  if (endMarker < 0 || endMarker + 8 > bytes.length) continue;
  const end = endMarker + 8;
  const png = bytes.subarray(offset, end);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  resources.push({ offset, width, height, png });
  offset = end - 1;
}

await mkdir(output, { recursive: true });
const manifest = [];
for (const [index, resource] of resources.entries()) {
  const number = String(index + 1).padStart(2, '0');
  const name = `lkj-resource-${number}-${resource.width}x${resource.height}.png`;
  await writeFile(join(output, name), resource.png);
  manifest.push({
    index: index + 1,
    name,
    width: resource.width,
    height: resource.height,
    sourceOffset: resource.offset,
  });
}

await writeFile(
  join(output, 'manifest.json'),
  `${JSON.stringify({ source: basename(source), resources: manifest }, null, 2)}\n`,
  'utf8',
);

console.log(`Extracted ${resources.length} embedded PNG resources from ${basename(source)}.`);
