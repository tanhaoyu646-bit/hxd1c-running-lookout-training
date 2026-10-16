import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('assets/lkj/original-resources/manifest.json', 'utf8'));
assert.equal(manifest.source, 'LKJ2000.exe');
assert.equal(manifest.resources.length, 49, 'LKJ2000 embedded PNG resource count changed');

for (const resource of manifest.resources) {
  await access(`assets/lkj/original-resources/${resource.name}`);
}

const interfaceSource = await readFile('scripts/archive-2d-cabview-real-route.js', 'utf8');
const sceneSource = await readFile('scripts/mstsRouteScene.js', 'utf8');
const styles = await readFile('styles/smooth-start.css', 'utf8');
const continuityStyles = await readFile('styles/continuity-test.css', 'utf8');

const nativeStates = [
  'main-blank.png',
  'query-menu.png',
  'current-reveal.png',
  'nonnormal-menu.png',
  'green-permit-input.png',
  'green-permit-unlock.png',
  'green-permit-active.png',
  'green-permit-running.png',
  'route-ticket-input.png',
  'route-ticket-unlock.png',
  'route-ticket-running.png',
  'parameter-setup.png',
];
for (const state of nativeStates) {
  await access(`assets/lkj/native-states/${state}`);
}

assert.match(interfaceSource, /native-states\/main-blank\.png/);
assert.match(interfaceSource, /lkj-native-equipment/);
assert.match(interfaceSource, /lkjControlLimit/);
assert.match(interfaceSource, /const LKJ_POSITION_X=191/);
assert.match(interfaceSource, /lkjChartX\(distance,currentDistance\)/);
assert.doesNotMatch(interfaceSource, /const positionX=191\+/);
assert.match(interfaceSource, /lkj-parameter-form/);
assert.doesNotMatch(interfaceSource, /设备自检正常/);
assert.doesNotMatch(interfaceSource, /button\.style\.backgroundImage/);
assert.match(interfaceSource, /rear-lookout-active/);
assert.match(interfaceSource, /K2026次出站信号好了/);
assert.match(interfaceSource, /K2026次3道发车/);
assert.match(interfaceSource, /normal-signal-ready/);
assert.match(interfaceSource, /normal-departure/);
assert.match(interfaceSource, /deltaX>=threshold/);
assert.match(interfaceSource, /command\('side-release-hold',true\)/);
assert.doesNotMatch(interfaceSource, /makePhysicalButton\('side-release-hold'/);
assert.match(styles, /\.stage\.rear-lookout-active \.cab-layer\{display:none\}/);
assert.match(styles, /\.lkj-native-base/);
assert.match(styles, /\[data-dwarf-lamp="green"\]\.lit/);
assert.match(styles, /\[data-dwarf-lamp="greenLower"\]\.lit/);
assert.match(styles, /\[data-dwarf-lamp="yellow"\]\.lit/);
assert.match(styles, /\[data-dwarf-lamp="red"\]\.lit/);
assert.match(styles, /\.signal-modal\.weather-unreadable \.dwarf-signal-preview/);
assert.match(continuityStyles, /\.independent-brake\.side-release-active/);
assert.match(sceneSource, /longitudinalSlack/);
assert.match(sceneSource, /buildRailAlignedPath/);
assert.match(sceneSource, /mesh\.frustumCulled = false/);
assert.match(sceneSource, /lateralSway/);
assert.match(sceneSource, /rearLeft: THREE\.MathUtils\.degToRad\(165\)/);
assert.match(sceneSource, /rearRight: THREE\.MathUtils\.degToRad\(-165\)/);
assert.doesNotMatch(sceneSource, /Math\.random\(\).*Sway/);

console.log('Interface assets valid: native LKJ states, transparent physical-key hotspots, pure 3D rear views, and deterministic damped start motion.');

