import * as THREE from '../lib/three/three.module.js';
import { ROUTE_CONTEXT } from './smoothStartConfig.js';
import { buildRailAlignedPath, cumulativePathDistances } from './railAlignedPath.js';

// fetch() 的相对地址以页面而非当前模块为基准；GitHub Pages 位于仓库子目录，
// 因此所有三维资源必须相对 import.meta.url 解析，不能使用普通 ../assets 字符串。
const SOURCE_PATH = new URL('../assets/msts-neiyi-corridor/neiyi-neijiang-neijiangnan-scene.json', import.meta.url).href;
const ROUTE_PATH = new URL('../assets/msts-neiyi/neiyi-5635-trackdb-path.json', import.meta.url).href;
const TEXTURE_PATH = new URL('../assets/msts-neiyi-corridor/textures/', import.meta.url).href;
// GitHub Pages 区分大小写；原游戏导出中的三处引用大小写与发布文件名不同。
const TEXTURE_FILE_ALIASES = Object.freeze({
  'acleanttrack1.png': 'ACleanTrack1.png',
  'acleanttrack2.png': 'ACleanTrack2.png',
  'acleantrack1.png': 'ACleanTrack1.png',
  'acleantrack2.png': 'ACleanTrack2.png',
  'sign.png': 'Sign.png',
});
const NEXT_STATION_DISTANCE = ROUTE_CONTEXT.departureSignalDistance;
// 真实路线模型优先。程序化轨道仅保留作回退实验，默认不得覆盖游戏来源的轨道与站台。
const ROUTE_RENDER_OPTIONS = Object.freeze({
  proceduralTrack: false,
  railHighlights: false,
  sourceDepartureSignal: true,
});

export class MstsRouteScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.15 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#a7bdca');
    this.scene.fog = new THREE.Fog('#a7b9c2', 500, 1600);
    this.camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.15, 2200);
    this.routeRoot = new THREE.Group();
    this.routeRoot.name = 'MSTS_ROUTE_ROOT';
    this.scene.add(this.routeRoot);
    this.view = 'front';
    this.distance = 0;
    this.startOffset = 0;
    this.eyeHeight = 3.82;
    this.ready = false;
    this.error = null;
    this.routePoints = [];
    this.routeDistances = [];
    this.pathLength = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.baseYaw = Math.atan2(-this.forward.x, -this.forward.z);
    this.signalAspect = 'green';
    this.scenarioId = 'normal';
    this.signalLampVisibility = 1;
    this.startMotionAt = null;
    this.lastStartFraction = 0;
    this.departureSignal = null;
    this.neighborSignal = null;
    this.throughSignal = null;
    this.passengerCars = [];
    this.signalRaycaster = new THREE.Raycaster();
    this.signalPointer = new THREE.Vector2();
    this.materialCache = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.addEnvironment();
    this.applyCamera();
    this.loadPromise = this.load();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();
  }

  addEnvironment() {
    this.scene.add(new THREE.HemisphereLight('#eaf6ff', '#687264', 2.0));
    const sun = new THREE.DirectionalLight('#fff2d8', 2.4);
    sun.position.set(-120, 150, 80);
    this.scene.add(sun);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(5200, 5200),
      new THREE.MeshStandardMaterial({ color: '#71806e', roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.18;
    this.ground.frustumCulled = false;
    this.ground.material.depthWrite = false;
    this.ground.renderOrder = -10;
    this.scene.add(this.ground);
  }

  async load() {
    try {
      const [sceneResponse, pathResponse] = await Promise.all([
        fetch(SOURCE_PATH, { cache: 'no-store' }),
        fetch(ROUTE_PATH, { cache: 'no-store' }),
      ]);
      if (!sceneResponse.ok) throw new Error(`路线场景加载失败：HTTP ${sceneResponse.status}`);
      if (!pathResponse.ok) throw new Error(`轨道中心线加载失败：HTTP ${pathResponse.status}`);
      const [sceneData, pathData] = await Promise.all([
        sceneResponse.json(),
        pathResponse.json(),
      ]);
      this.buildRoutePath(pathData, sceneData);
      this.buildRoute(sceneData);
      this.buildPassengerConsist(12);
      if (ROUTE_RENDER_OPTIONS.proceduralTrack) this.buildSelectedRouteTrack(NEXT_STATION_DISTANCE + 350);
      if (ROUTE_RENDER_OPTIONS.railHighlights) this.buildRailHighlights(NEXT_STATION_DISTANCE + 350);
      if (ROUTE_RENDER_OPTIONS.sourceDepartureSignal) this.buildSourceDepartureSignal(sceneData);
      this.buildTeachingThroughSignal();
      this.ready = true;
      this.applyCamera();
      this.canvas.dispatchEvent(new CustomEvent('route-ready', {
        detail: { ...sceneData.summary, ...pathData.summary, pathLength: this.pathLength },
      }));
    } catch (error) {
      this.error = error;
      this.canvas.dispatchEvent(new CustomEvent('route-error', { detail: error }));
      throw error;
    }
  }

  getMaterial(definition) {
    const textureName = definition?.texture || '';
    const fileName = TEXTURE_FILE_ALIASES[textureName.toLowerCase()] || textureName;
    const key = `${fileName}|${definition?.alphaTestMode || 0}`;
    if (this.materialCache.has(key)) return this.materialCache.get(key);
    let texture = null;
    if (textureName) {
      texture = this.textureLoader.load(`${TEXTURE_PATH}${encodeURIComponent(fileName)}`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    }
    const isTrackMaterial = /track/i.test(textureName);
    const material = new THREE.MeshStandardMaterial({
      color: texture ? 0xffffff : 0xadb5b3,
      map: texture,
      roughness: isTrackMaterial ? 0.48 : 0.88,
      metalness: isTrackMaterial ? 0.24 : 0.03,
      side: THREE.DoubleSide,
      alphaTest: texture ? 0.08 : 0,
    });
    material.name = definition?.name || textureName || 'MSTS_MATERIAL';
    this.materialCache.set(key, material);
    return material;
  }

  buildRoute(data) {
    const instancesByShape = new Map();
    const dedicatedSignalUids = new Set([
      ROUTE_CONTEXT.departureSignalSourceUid,
      ROUTE_CONTEXT.neighborSignalSourceUid,
    ]);
    data.instances.forEach((instance) => {
      // 这两架信号机由独立的、带原始 Sign 贴图和可控灯态的模型渲染，避免重复叠加。
      if (instance.type === 'SignalObj' && dedicatedSignalUids.has(instance.uid)) return;
      if (!instancesByShape.has(instance.shape)) instancesByShape.set(instance.shape, []);
      instancesByShape.get(instance.shape).push(instance);
    });

    Object.values(data.shapes).forEach((shape) => {
      const instances = instancesByShape.get(shape.fileName) || [];
      if (!instances.length) return;
      shape.groups.forEach((group, groupIndex) => {
        if (!group.positions?.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(group.positions, 3));
        if (group.uvs?.length === (group.positions.length / 3) * 2) {
          geometry.setAttribute('uv', new THREE.Float32BufferAttribute(group.uvs, 2));
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const material = this.getMaterial(shape.materials[group.materialIndex]);
        const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
        mesh.name = `${shape.fileName}:${groupIndex}`;
        // 场景实例跨越十余公里。若只使用单个源几何体的包围球进行裁剪，
        // 列车驶离车站后远端实例会被误判为不可见，表现为线路后段突然缺失。
        // 当前导出场景仅约2.5万三角形，关闭该组级裁剪的性能代价可控。
        mesh.frustumCulled = false;
        mesh.userData.sourceShape = shape.fileName;
        const object = new THREE.Object3D();
        instances.forEach((instance, index) => {
          object.position.fromArray(instance.position);
          object.quaternion.fromArray(instance.quaternion).normalize();
          object.scale.setScalar(1);
          object.updateMatrix();
          mesh.setMatrixAt(index, object.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.routeRoot.add(mesh);
      });
    });
  }

  buildRoutePath(data, sceneData) {
    // 原中心线只包含轨道构件连接点。直接线性插值会在曲线连接处走弦线，
    // 驾驶视点离开站场后看起来会切出钢轨。使用相邻真实 TrackObj 的朝向
    // 构造 Hermite 中心线，并以约5 m间距重采样，使位置和朝向连续贴合线路。
    const alignedPoints = buildRailAlignedPath(data.positions, sceneData?.instances, { spacing: 5 });
    this.routePoints = alignedPoints.map((point) => new THREE.Vector3(...point));
    this.routeDistances = cumulativePathDistances(alignedPoints);
    this.pathLength = this.routeDistances[this.routeDistances.length - 1];
  }

  buildPassengerConsist(count = 12) {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#d9ddda', roughness: 0.68, metalness: 0.22 });
    const bandMaterial = new THREE.MeshStandardMaterial({ color: '#21628c', roughness: 0.72, metalness: 0.12 });
    const windowMaterial = new THREE.MeshStandardMaterial({ color: '#142a39', roughness: 0.22, metalness: 0.15, emissive: '#102b3a', emissiveIntensity: 0.32 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: '#8e999e', roughness: 0.82, metalness: 0.18 });
    const underframeMaterial = new THREE.MeshStandardMaterial({ color: '#20282b', roughness: 0.88, metalness: 0.35 });
    const doorMaterial = new THREE.MeshStandardMaterial({ color: '#c8cdca', roughness: 0.7, metalness: 0.18 });
    const bodyGeometry = new THREE.BoxGeometry(3.1, 3.55, 24.5);
    const bandGeometry = new THREE.BoxGeometry(3.15, 0.48, 24.55);
    const windowGeometry = new THREE.BoxGeometry(0.055, 0.72, 1.38);
    const roofGeometry = new THREE.BoxGeometry(3.0, 0.28, 24.1);
    const underframeGeometry = new THREE.BoxGeometry(2.7, 0.52, 22.5);
    const doorGeometry = new THREE.BoxGeometry(0.06, 2.35, 1.55);
    const doorWindowGeometry = new THREE.BoxGeometry(0.065, 0.62, 0.74);
    const bogieGeometry = new THREE.BoxGeometry(2.72, 0.55, 3.0);
    for (let index = 0; index < count; index += 1) {
      const car = new THREE.Group();
      car.name = `PASSENGER_CAR_${String(index + 1).padStart(2, '0')}`;
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = 2.45;
      car.add(body);
      const band = new THREE.Mesh(bandGeometry, bandMaterial);
      band.position.y = 1.65;
      car.add(band);
      for (const side of [-1, 1]) {
        for (let windowIndex = 0; windowIndex < 10; windowIndex += 1) {
          const window = new THREE.Mesh(windowGeometry, windowMaterial);
          window.position.set(side * 1.57, 2.85, -9.2 + windowIndex * 2.05);
          car.add(window);
        }
        for (const doorZ of [-11.25, 11.25]) {
          const door = new THREE.Mesh(doorGeometry, doorMaterial);
          door.position.set(side * 1.575, 2.12, doorZ);
          car.add(door);
          const doorWindow = new THREE.Mesh(doorWindowGeometry, windowMaterial);
          doorWindow.position.set(side * 1.61, 2.76, doorZ);
          car.add(doorWindow);
        }
      }
      const roof = new THREE.Mesh(roofGeometry, roofMaterial);
      roof.position.y = 4.34;
      car.add(roof);
      const underframe = new THREE.Mesh(underframeGeometry, underframeMaterial);
      underframe.position.y = 0.55;
      car.add(underframe);
      for (const bogieZ of [-7.7, 7.7]) {
        const bogie = new THREE.Mesh(bogieGeometry, underframeMaterial);
        bogie.position.set(0, 0.22, bogieZ);
        car.add(bogie);
      }
      // 以司机视点为列车前端参考。HXD1C 车体与连挂间距计入首辆客车中心距，
      // 避免后部瞭望镜头落入第一辆客车端面。
      car.userData.trainOffset = 33 + index * 25.8;
      car.userData.consistIndex = index;
      car.userData.consistCount = count;
      this.routeRoot.add(car);
      this.passengerCars.push(car);
    }
    this.updatePassengerConsist();
  }

  getExtendedPathPosition(distance, target = new THREE.Vector3()) {
    if (distance >= 0) return this.getPathPosition(distance, target);
    if (this.routePoints.length < 2) return target.set(0, 0, -distance);
    const origin = this.routePoints[0];
    const tangent = new THREE.Vector3().subVectors(this.routePoints[1], origin).normalize();
    return target.copy(origin).addScaledVector(tangent, distance);
  }

  getExtendedPathTangent(distance, target = new THREE.Vector3()) {
    const before = this.getExtendedPathPosition(distance - 1.5, new THREE.Vector3());
    const after = this.getExtendedPathPosition(distance + 1.5, new THREE.Vector3());
    target.subVectors(after, before);
    target.y = 0;
    if (target.lengthSq() < 0.000001) target.set(0, 0, -1);
    return target.normalize();
  }

  updatePassengerConsist(startFraction = this.wholeTrainStartFraction ?? 1) {
    if (!this.passengerCars.length) return;
    const now = performance.now() / 1000;
    const point = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const lateral = new THREE.Vector3();
    this.passengerCars.forEach((car) => {
      // 起动初段按车钩力由前向后传播。每辆车达到自己的传播阈值后才开始
      // 跟随机车移动；全列起动后所有车辆恢复正常等距跟随。
      const count = Math.max(1, car.userData.consistCount || this.passengerCars.length);
      const index = car.userData.consistIndex || 0;
      const movementRatio = THREE.MathUtils.clamp(startFraction * count - index, 0, 1);
      const previousRatio = car.userData.lastMovementRatio || 0;
      if (movementRatio > 0.025 && previousRatio <= 0.025) car.userData.startPulseAt = now;
      if (movementRatio <= 0.001 && previousRatio > 0.001) car.userData.startPulseAt = null;
      car.userData.lastMovementRatio = movementRatio;
      const pulseAge = car.userData.startPulseAt == null ? 99 : Math.max(0, now - car.userData.startPulseAt);
      const pulse = Math.exp(-2.45 * pulseAge);
      // 车钩间隙被拉紧后产生一次很轻的纵向顿动，并伴随客车车体的微小横摇。
      // 使用确定性的阻尼正弦，不使用随机抖动，避免课堂画面像渲染故障。
      const longitudinalSlack = Math.sin(pulseAge * 10.5 + index * 0.18) * 0.045 * pulse;
      const lateralSway = Math.sin(pulseAge * 6.4 + index * 0.52) * 0.022 * pulse;
      const routeDistance = this.startOffset + this.distance * movementRatio;
      const carDistance = routeDistance - car.userData.trainOffset + longitudinalSlack;
      this.getExtendedPathPosition(carDistance, point);
      this.getExtendedPathTangent(carDistance, tangent);
      car.position.copy(point);
      lateral.set(tangent.z, 0, -tangent.x);
      car.position.addScaledVector(lateral, lateralSway);
      car.rotation.set(
        Math.sin(pulseAge * 7.2 + index * 0.28) * 0.0024 * pulse,
        Math.atan2(tangent.x, tangent.z),
        Math.sin(pulseAge * 6.4 + index * 0.52) * 0.0042 * pulse,
      );
    });
  }

  projectPointToPath(position) {
    const target = new THREE.Vector3().fromArray(position);
    const closest = new THREE.Vector3();
    const segment = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    let best = null;
    for (let index = 1; index < this.routePoints.length; index += 1) {
      const start = this.routePoints[index - 1];
      const end = this.routePoints[index];
      segment.subVectors(end, start);
      const lengthSq = segment.lengthSq();
      if (lengthSq < 0.000001) continue;
      const ratio = THREE.MathUtils.clamp(offset.subVectors(target, start).dot(segment) / lengthSq, 0, 1);
      closest.copy(start).addScaledVector(segment, ratio);
      const distance = closest.distanceTo(target);
      if (!best || distance < best.lateralDistance) {
        tangent.copy(segment);
        tangent.y = 0;
        if (tangent.lengthSq() < 0.000001) continue;
        tangent.normalize();
        const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
        const relative = new THREE.Vector3().subVectors(target, closest);
        best = {
          alongDistance: this.routeDistances[index - 1] + Math.sqrt(lengthSq) * ratio,
          lateralDistance: distance,
          signedLateral: relative.dot(right),
          point: closest.clone(),
          tangent: tangent.clone(),
        };
      }
    }
    return best;
  }

  buildRailHighlights(maxDistance) {
    const count = this.routePoints.findIndex((_, index) => this.routeDistances[index] > maxDistance);
    const pointCount = count === -1 ? this.routePoints.length : Math.max(2, count + 1);
    const material = new THREE.MeshPhysicalMaterial({
      color: '#bfc8cd',
      metalness: 0.7,
      roughness: 0.22,
      clearcoat: 0.82,
      clearcoatRoughness: 0.1,
      emissive: '#242b2f',
      emissiveIntensity: 0.24,
      side: THREE.DoubleSide,
    });
    const glintMaterial = new THREE.MeshBasicMaterial({
      color: '#eef6fa',
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const gaugeHalf = 0.7175;
    const railHalfWidth = 0.036;
    for (const railOffset of [-gaugeHalf, gaugeHalf]) {
      const positions = [];
      const normals = [];
      const indices = [];
      for (let index = 0; index < pointCount; index += 1) {
        const point = this.routePoints[index];
        const previous = this.routePoints[Math.max(0, index - 1)];
        const next = this.routePoints[Math.min(pointCount - 1, index + 1)];
        const tangent = new THREE.Vector3().subVectors(next, previous);
        tangent.y = 0;
        if (tangent.lengthSq() < 0.000001) tangent.copy(this.forward);
        tangent.normalize();
        const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
        const center = point.clone().addScaledVector(right, railOffset);
        center.y += 0.008;
        const edgeA = center.clone().addScaledVector(right, -railHalfWidth);
        const edgeB = center.clone().addScaledVector(right, railHalfWidth);
        positions.push(edgeA.x, edgeA.y, edgeA.z, edgeB.x, edgeB.y, edgeB.z);
        normals.push(0, 1, 0, 0, 1, 0);
        if (index < pointCount - 1) {
          const base = index * 2;
          indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setIndex(indices);
      geometry.computeBoundingSphere();
      const rail = new THREE.Mesh(geometry, material);
      rail.name = railOffset < 0 ? 'SELECTED_ROUTE_RAIL_LEFT' : 'SELECTED_ROUTE_RAIL_RIGHT';
      this.routeRoot.add(rail);

      const glintPositions = [];
      const glintIndices = [];
      const glintHalfWidth = 0.006;
      for (let index = 0; index < pointCount; index += 1) {
        const point = this.routePoints[index];
        const previous = this.routePoints[Math.max(0, index - 1)];
        const next = this.routePoints[Math.min(pointCount - 1, index + 1)];
        const tangent = new THREE.Vector3().subVectors(next, previous);
        tangent.y = 0;
        if (tangent.lengthSq() < 0.000001) tangent.copy(this.forward);
        tangent.normalize();
        const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
        const innerEdge = railOffset - Math.sign(railOffset) * 0.016;
        const center = point.clone().addScaledVector(right, innerEdge);
        center.y += 0.011;
        const edgeA = center.clone().addScaledVector(right, -glintHalfWidth);
        const edgeB = center.clone().addScaledVector(right, glintHalfWidth);
        glintPositions.push(edgeA.x, edgeA.y, edgeA.z, edgeB.x, edgeB.y, edgeB.z);
        if (index < pointCount - 1) {
          const base = index * 2;
          glintIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      }
      const glintGeometry = new THREE.BufferGeometry();
      glintGeometry.setAttribute('position', new THREE.Float32BufferAttribute(glintPositions, 3));
      glintGeometry.setIndex(glintIndices);
      glintGeometry.computeBoundingSphere();
      const glint = new THREE.Mesh(glintGeometry, glintMaterial);
      glint.name = railOffset < 0 ? 'SELECTED_ROUTE_GLINT_LEFT' : 'SELECTED_ROUTE_GLINT_RIGHT';
      glint.renderOrder = 3;
      this.routeRoot.add(glint);
    }
  }

  buildSelectedRouteTrack(maxDistance) {
    const count = this.routePoints.findIndex((_, index) => this.routeDistances[index] > maxDistance);
    const pointCount = count === -1 ? this.routePoints.length : Math.max(2, count + 1);
    const ribbon = (halfWidth, yOffset, material, name) => {
      const positions = [];
      const normals = [];
      const indices = [];
      for (let index = 0; index < pointCount; index += 1) {
        const point = this.routePoints[index];
        const previous = this.routePoints[Math.max(0, index - 1)];
        const next = this.routePoints[Math.min(pointCount - 1, index + 1)];
        const tangent = new THREE.Vector3().subVectors(next, previous);
        tangent.y = 0;
        if (tangent.lengthSq() < 0.000001) tangent.copy(this.forward);
        tangent.normalize();
        const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
        const center = point.clone();
        center.y += yOffset;
        const left = center.clone().addScaledVector(right, -halfWidth);
        const rightEdge = center.clone().addScaledVector(right, halfWidth);
        positions.push(left.x, left.y, left.z, rightEdge.x, rightEdge.y, rightEdge.z);
        normals.push(0, 1, 0, 0, 1, 0);
        if (index < pointCount - 1) {
          const base = index * 2;
          indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setIndex(indices);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      this.routeRoot.add(mesh);
    };

    ribbon(1.55, -0.15, new THREE.MeshStandardMaterial({
      color: '#706b62', roughness: 0.98, metalness: 0.01, side: THREE.DoubleSide,
    }), 'SELECTED_ROUTE_BALLAST');

    const sleeperSpacing = 0.82;
    const sleeperCount = Math.floor(Math.min(maxDistance, this.pathLength) / sleeperSpacing) + 1;
    const sleeperGeometry = new THREE.BoxGeometry(2.45, 0.1, 0.2);
    const sleeperMaterial = new THREE.MeshStandardMaterial({
      color: '#625b50', roughness: 0.92, metalness: 0.02,
    });
    const sleepers = new THREE.InstancedMesh(sleeperGeometry, sleeperMaterial, sleeperCount);
    sleepers.name = 'SELECTED_ROUTE_SLEEPERS';
    sleepers.frustumCulled = false;
    const object = new THREE.Object3D();
    const point = new THREE.Vector3();
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    for (let index = 0; index < sleeperCount; index += 1) {
      const distance = index * sleeperSpacing;
      this.getPathPosition(distance, point);
      this.getPathPosition(Math.max(0, distance - 1), before);
      this.getPathPosition(Math.min(this.pathLength, distance + 1), after);
      tangent.subVectors(after, before);
      tangent.y = 0;
      if (tangent.lengthSq() < 0.000001) tangent.copy(this.forward);
      tangent.normalize();
      object.position.copy(point);
      object.position.y -= 0.085;
      object.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
      object.scale.set(1, 1, 1);
      object.updateMatrix();
      sleepers.setMatrixAt(index, object.matrix);
    }
    sleepers.instanceMatrix.needsUpdate = true;
    this.routeRoot.add(sleepers);
  }

  buildSourceDepartureSignal(data) {
    // 使用当前课堂线路中的两架矮型出站信号机，统一作为株洲站1道发车场景。
    const selectSignal = (uid, expectedDistance) => {
      const candidates = data.instances
        .filter((item) => item.uid === uid && item.type === 'SignalObj' && item.shape === 'chuzhan-halfauto-zhuci.s')
        .map((instance) => ({ instance, projection: this.projectPointToPath(instance.position) }))
        .filter(({ projection }) => projection)
        .sort((a, b) => Math.abs(a.projection.alongDistance - expectedDistance) - Math.abs(b.projection.alongDistance - expectedDistance));
      return candidates[0] || null;
    };
    const departure = selectSignal(ROUTE_CONTEXT.departureSignalSourceUid, ROUTE_CONTEXT.departureSignalExpectedDistance);
    const neighbor = selectSignal(ROUTE_CONTEXT.neighborSignalSourceUid, ROUTE_CONTEXT.neighborSignalExpectedDistance);
    if (!departure || !neighbor) {
      this.error = new Error('未找到原发车作业场景中配置的两架矮型出站信号机。');
      return;
    }

    const signalShape = data.shapes['chuzhan-halfauto-zhuci.s'];
    if (!signalShape || !Array.isArray(signalShape.groups) || !Array.isArray(signalShape.materials)) {
      this.error = new Error('原发车作业场景出站信号机模型数据无效。');
      return;
    }

    const signalAsset = {
      source: { fileName: signalShape.fileName, sha256: signalShape.sha256 || '' },
      materials: signalShape.materials,
      groups: signalShape.groups,
    };
    // 信号机本体和位置来自原场景，灯态由网页课堂层控制。
    this.departureSignal = this.createSourceSignal(departure, signalAsset, 'SOURCE_DWARF_DEPARTURE_SIGNAL', true);
    this.neighborSignal = this.createSourceSignal(neighbor, signalAsset, 'SOURCE_DWARF_NEIGHBOR_SIGNAL', false);
    this.setDepartureSignalAspect(this.signalAspect);
  }

  createSignalGlowTexture() {
    if (this.signalGlowTexture) return this.signalGlowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.23, 'rgba(255,255,255,.95)');
    gradient.addColorStop(0.52, 'rgba(255,255,255,.42)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    this.signalGlowTexture = new THREE.CanvasTexture(canvas);
    this.signalGlowTexture.colorSpace = THREE.SRGBColorSpace;
    return this.signalGlowTexture;
  }

  createSourceSignal(selected, signalAsset, name, isDepartureSignal) {
    const root = new THREE.Group();
    root.name = name;
    root.position.fromArray(selected.instance.position);
    root.quaternion.fromArray(selected.instance.quaternion).normalize();
    root.userData.isDepartureSignal = isDepartureSignal;
    root.userData.sourceUid = selected.instance.uid;
    root.userData.sourceShape = selected.instance.shape;
    root.userData.alongDistance = selected.projection.alongDistance;
    root.userData.signedLateral = selected.projection.signedLateral;

    const visual = new THREE.Group();
    visual.name = `${name}_VISUAL`;
    root.add(visual);
    const body = new THREE.Group();
    body.name = `${name}_BODY`;
    signalAsset.groups.forEach((group, groupIndex) => {
      if (!group.positions?.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(group.positions, 3));
      if (group.uvs?.length === (group.positions.length / 3) * 2) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(group.uvs, 2));
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.getMaterial(signalAsset.materials[group.materialIndex]));
      mesh.name = `${name}_BODY_${groupIndex}`;
      mesh.userData.sourceShape = signalAsset.source.fileName;
      mesh.userData.sourceSha256 = signalAsset.source.sha256;
      body.add(mesh);
    });
    visual.add(body);

    const lampGeometry = new THREE.SphereGeometry(0.095, 14, 10);
    const lampDefinitions = {
      red: [-0.243, 0.49, 0.025],
      greenLower: [0.01, 0.49, 0.025],
      yellow: [0.01, 0.698, 0.025],
      green: [0.01, 0.911, 0.035],
    };
    const lamps = {};
    const lampMeshes = [];
    const glowSprites = [];
    for (const [lampName, position] of Object.entries(lampDefinitions)) {
      const lensMaterial = new THREE.MeshBasicMaterial({ color: '#121617', transparent: true, opacity: 0.72, toneMapped: false });
      const lamp = new THREE.Mesh(lampGeometry, lensMaterial);
      lamp.name = `SOURCE_SIGNAL_${lampName.toUpperCase()}`;
      lamp.position.fromArray(position);
      visual.add(lamp);
      const glowMaterial = new THREE.SpriteMaterial({
        map: this.createSignalGlowTexture(),
        color: '#121617',
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      const glow = new THREE.Sprite(glowMaterial);
      glow.name = `${lamp.name}_GLOW`;
      glow.position.copy(lamp.position);
      glow.userData.basePosition = lamp.position.clone();
      glow.renderOrder = 8;
      root.add(glow);
      lamps[lampName] = { lensMaterial, glowMaterial };
      lampMeshes.push(lamp);
      glowSprites.push(glow);
    }
    this.routeRoot.add(root);
    return { root, visual, body, lamps, lampMeshes, glowSprites, projection: selected.projection };
  }

  setDepartureSignalAspect(aspect) {
    this.signalAspect = aspect || 'green';
    this.applySignalAspect(this.departureSignal, this.signalAspect);
    // 邻线信号机固定显示红灯，明确其不属于本列车运行进路。
    this.applySignalAspect(this.neighborSignal, 'red');
  }

  buildTeachingThroughSignal() {
    const distance = Number(ROUTE_CONTEXT.firstBlockEndDistance || 0);
    if (!distance || distance >= this.pathLength) return;
    const point = this.getPathPosition(distance);
    const before = this.getPathPosition(Math.max(0, distance - 4));
    const after = this.getPathPosition(Math.min(this.pathLength, distance + 4));
    const tangent = after.sub(before).setY(0).normalize();
    const right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    const root = new THREE.Group();
    root.name = 'TEACHING_2328_THROUGH_SIGNAL';
    root.position.copy(point).addScaledVector(right, 3.6);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: '#363d42', roughness: .78, metalness: .5 });
    const headMaterial = new THREE.MeshStandardMaterial({ color: '#101416', roughness: .7, metalness: .25 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 4.2, 10), poleMaterial);
    pole.position.y = 2.1;
    const head = new THREE.Mesh(new THREE.BoxGeometry(.62, 1.55, .28), headMaterial);
    head.position.y = 4.35;
    root.add(pole, head);
    const lampGeometry = new THREE.SphereGeometry(.13, 16, 12);
    const lamps = {};
    for (const [name, y] of [['green',4.78],['greenLower',4.44],['yellow',4.10],['red',3.76]]) {
      const material = new THREE.MeshBasicMaterial({ color: name === 'green' ? '#28e878' : '#131819', toneMapped: false });
      const lamp = new THREE.Mesh(lampGeometry, material);
      lamp.position.set(0, y, -.17);
      root.add(lamp);
      lamps[name] = { lensMaterial: material, glowMaterial: new THREE.SpriteMaterial({ transparent: true, opacity: 0 }) };
    }
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256; labelCanvas.height = 96;
    const context = labelCanvas.getContext('2d');
    context.fillStyle = 'rgba(4,18,28,.88)'; context.fillRect(0,0,256,96);
    context.strokeStyle = '#91dbf6'; context.lineWidth = 4; context.strokeRect(2,2,252,92);
    context.fillStyle = '#fff'; context.textAlign = 'center'; context.font = '700 34px Microsoft YaHei'; context.fillText('2328',128,39);
    context.font = '600 22px Microsoft YaHei'; context.fillText('K231+738',128,75);
    const labelTexture = new THREE.CanvasTexture(labelCanvas); labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false }));
    label.position.set(0,5.75,0); label.scale.set(3.2,1.2,1); root.add(label);
    this.routeRoot.add(root);
    this.throughSignal = { root, visual: root, lamps, lampMeshes: [], glowSprites: [], projection: { alongDistance: distance } };
  }

  applySignalAspect(signal, aspect) {
    if (!signal) return;
    const active = {
      green: ['green'],
      greenYellow: ['greenLower', 'yellow'],
      yellow: ['yellow'],
      red: ['red'],
    }[aspect] || [];
    const colors = { green: '#28e878', greenLower: '#28e878', yellow: '#f6c744', red: '#e54a46' };
    for (const [name, materials] of Object.entries(signal.lamps)) {
      const on = active.includes(name);
      materials.lensMaterial.color.set(on ? colors[name] : '#121617');
      materials.lensMaterial.opacity = on ? this.signalLampVisibility : Math.min(0.72, this.signalLampVisibility * 0.72);
      materials.glowMaterial.color.set(on ? colors[name] : '#121617');
      materials.glowMaterial.opacity = on ? this.signalLampVisibility * 0.94 : 0;
    }
  }

  updateSignalTeachingVisibility() {
    for (const signal of [this.departureSignal, this.neighborSignal, this.throughSignal]) {
      if (!signal) continue;
      const head = signal.root.localToWorld(new THREE.Vector3(0, 0.70, 0));
      const distance = this.camera.position.distanceTo(head);
      // 120 m 内恢复游戏原比例；远距采用教学 LOD，使 1.37 m 矮型信号机仍可辨认。
      const teachingScale = THREE.MathUtils.clamp(distance / 105, 1, 5.2);
      signal.visual.scale.setScalar(signal===this.throughSignal?THREE.MathUtils.clamp(distance/170,1,2.3):teachingScale);
      const glowSize = THREE.MathUtils.clamp(distance * 0.0075, 0.16, 4.3);
      signal.glowSprites.forEach((glow) => {
        glow.position.copy(glow.userData.basePosition).multiplyScalar(teachingScale);
        glow.scale.setScalar(glowSize);
      });
    }
  }

  setTrainingScenario(scenarioId) {
    this.scenarioId = scenarioId || 'normal';
    this.updateAtmosphere();
  }

  updateAtmosphere() {
    const weather = this.scenarioId === 'weather';
    const remaining = Math.max(0, ROUTE_CONTEXT.departureSignalDistance - this.distance);
    let near = 500;
    let far = 1600;
    let lampVisibility = 1;
    if (weather) {
      if (remaining > ROUTE_CONTEXT.weatherSignalApproachDistance) {
        near = 18; far = 110; lampVisibility = 0.08;
      } else if (remaining > ROUTE_CONTEXT.weatherSignalClearDistance) {
        near = 24; far = 185; lampVisibility = 0.34;
      } else {
        near = 85; far = 620; lampVisibility = 1;
      }
    }
    this.scene.background.set(weather ? '#83929a' : '#a7bdca');
    this.scene.fog.near = near;
    this.scene.fog.far = far;
    if (Math.abs(this.signalLampVisibility - lampVisibility) > 0.01) {
      this.signalLampVisibility = lampVisibility;
      this.setDepartureSignalAspect(this.signalAspect);
    }
  }

  hitTestDepartureSignal(clientX, clientY) {
    if (!this.departureSignal || !this.ready) return false;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    this.camera.updateMatrixWorld(true);
    const head = this.departureSignal.root.localToWorld(new THREE.Vector3(0, 0.70, 0));
    head.project(this.camera);
    if (head.z < -1 || head.z > 1) return false;
    const screenX = rect.left + (head.x * 0.5 + 0.5) * rect.width;
    const screenY = rect.top + (-head.y * 0.5 + 0.5) * rect.height;
    // 真实信号机保持其路线尺度；课堂触控将命中范围扩展到 70 CSS 像素。
    return Math.hypot(clientX - screenX, clientY - screenY) <= 70;
  }

  getDepartureSignalScreenPosition() {
    if (!this.departureSignal || !this.ready) return null;
    this.camera.updateMatrixWorld(true);
    const head = this.departureSignal.root.localToWorld(new THREE.Vector3(0, 0.70, 0));
    head.project(this.camera);
    const visible = head.z >= -1 && head.z <= 1 && Math.abs(head.x) <= 1.08 && Math.abs(head.y) <= 1.08;
    return {
      visible,
      x: (head.x * 0.5 + 0.5) * 100,
      y: (-head.y * 0.5 + 0.5) * 100,
      remaining: ROUTE_CONTEXT.departureSignalDistance - this.distance,
    };
  }

  getPathPosition(distance, target = new THREE.Vector3()) {
    if (this.routePoints.length < 2 || this.pathLength <= 0) {
      return target.copy(this.forward).multiplyScalar(distance);
    }
    const clamped = THREE.MathUtils.clamp(distance, 0, this.pathLength);
    let low = 0;
    let high = this.routeDistances.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (this.routeDistances[middle] <= clamped) low = middle;
      else high = middle;
    }
    const startDistance = this.routeDistances[low];
    const segmentLength = this.routeDistances[high] - startDistance;
    const ratio = segmentLength > 0 ? (clamped - startDistance) / segmentLength : 0;
    return target.lerpVectors(this.routePoints[low], this.routePoints[high], ratio);
  }

  setView(view) {
    this.view = view;
    this.applyCamera();
  }

  update(distance, speed, view = this.view, signalVisible = false, wholeTrainStartFraction = 1) {
    this.distance = Math.max(0, Number(distance) || 0);
    this.speed = Math.max(0, Number(speed) || 0);
    this.wholeTrainStartFraction = THREE.MathUtils.clamp(Number(wholeTrainStartFraction) || 0, 0, 1);
    if (this.wholeTrainStartFraction > 0.018 && this.lastStartFraction <= 0.018) this.startMotionAt = performance.now() / 1000;
    if (this.wholeTrainStartFraction <= 0.001 && this.lastStartFraction > 0.001) this.startMotionAt = null;
    this.lastStartFraction = this.wholeTrainStartFraction;
    this.view = view;
    this.canvas.classList.toggle('live', this.ready && (this.distance > 0.2 || view !== 'front' || signalVisible));
    this.updateAtmosphere();
    this.updatePassengerConsist(this.wholeTrainStartFraction);
    this.applyCamera();
    this.updateSignalTeachingVisibility();
  }

  applyCamera() {
    const routeDistance = this.startOffset + this.distance;
    const position = this.getPathPosition(routeDistance);
    const tangentStart = this.getPathPosition(Math.max(0, routeDistance - 3));
    const tangentEnd = this.getPathPosition(Math.min(this.pathLength || routeDistance + 6, routeDistance + 6));
    const tangent = tangentEnd.sub(tangentStart);
    tangent.y = 0;
    if (tangent.lengthSq() > 0.000001) this.forward.copy(tangent.normalize());
    const baseYaw = Math.atan2(-this.forward.x, -this.forward.z);
    const yawOffsets = {
      front: 0,
      left: THREE.MathUtils.degToRad(65),
      right: THREE.MathUtils.degToRad(-65),
      rearLeft: THREE.MathUtils.degToRad(165),
      rearRight: THREE.MathUtils.degToRad(-165),
    };
    const pitchOffsets = { front: -0.22, left: -0.035, right: -0.035, rearLeft: -0.04, rearRight: -0.04 };
    const lateralOffsets = { front: 0, left: -0.7, right: 0.7, rearLeft: -3.2, rearRight: 3.2 };
    const longitudinalOffsets = { front: 0, left: 0, right: 0, rearLeft: -1.8, rearRight: -1.8 };
    const right = new THREE.Vector3(this.forward.z, 0, -this.forward.x);
    this.camera.position.copy(position);
    this.camera.position.addScaledVector(right, lateralOffsets[this.view] || 0);
    this.camera.position.addScaledVector(this.forward, longitudinalOffsets[this.view] || 0);
    this.camera.position.y += this.eyeHeight;
    const pulseAge = this.startMotionAt == null ? 99 : Math.max(0, performance.now() / 1000 - this.startMotionAt);
    const lowSpeedFactor = 1 - THREE.MathUtils.clamp(this.speed / 15, 0, 1);
    const cabPulse = Math.exp(-2.15 * pulseAge) * lowSpeedFactor;
    this.camera.position.addScaledVector(this.forward, Math.sin(pulseAge * 9.2) * 0.024 * cabPulse);
    this.camera.position.y += Math.sin(pulseAge * 7.1 + 0.4) * 0.012 * cabPulse;
    if (this.ground) this.ground.position.set(position.x, position.y - 0.18, position.z);
    this.camera.rotation.order = 'YXZ';
    const pitchSway = Math.sin(pulseAge * 7.1) * 0.0028 * cabPulse;
    const rollSway = Math.sin(pulseAge * 5.8 + 0.7) * 0.0022 * cabPulse;
    this.camera.rotation.set((pitchOffsets[this.view] ?? pitchOffsets.front) + pitchSway, baseYaw + (yawOffsets[this.view] || 0), rollSway);
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
