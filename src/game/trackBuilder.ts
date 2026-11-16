import * as THREE from 'three';
import {
  createAsphaltTexture,
  createCheckeredTexture,
  createGroundTexture,
  createKerbTexture,
} from './textures';
import type { TrackSpec } from './types';

export interface TrackProjection {
  arcProgress: number; // 0 .. 1 around track
  signedOffset: number; // lateral distance (+ right, - left)
  absOffset: number;
  closestX: number;
  closestZ: number;
  tangentX: number;
  tangentZ: number;
  nearestIdx: number;
}

export interface BuiltTrack {
  group: THREE.Group;
  spec: TrackSpec;
  points: THREE.Vector3[];
  tangents: THREE.Vector3[];
  normals: THREE.Vector3[];
  totalLength: number;
  segmentCount: number;
  minimapPath: { x: number; z: number }[];
  startLightMats: THREE.MeshStandardMaterial[];
  dispose: () => void;
  projectPoint: (x: number, z: number, hintIdx?: number) => TrackProjection;
  sampleAtProgress: (t: number, lateralOffset?: number) => { x: number; z: number; yaw: number };
}

function buildClosedRibbonGeometry(
  points: THREE.Vector3[],
  normals: THREE.Vector3[],
  innerOffset: number,
  outerOffset: number,
  yHeight: number,
  uvRepeatLength: number,
  totalLength: number
): THREE.BufferGeometry {
  const n = points.length - 1; // last equals first
  const vertexCount = (n + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  const vTotal = Math.max(1, Math.round(totalLength / uvRepeatLength));

  for (let i = 0; i <= n; i++) {
    const p = points[i];
    const norm = normals[i];
    const v = (i / n) * vTotal;

    const ix = i * 2;
    positions[ix * 3] = p.x + norm.x * innerOffset;
    positions[ix * 3 + 1] = yHeight;
    positions[ix * 3 + 2] = p.z + norm.z * innerOffset;
    uvs[ix * 2] = 0;
    uvs[ix * 2 + 1] = v;

    const ox = i * 2 + 1;
    positions[ox * 3] = p.x + norm.x * outerOffset;
    positions[ox * 3 + 1] = yHeight;
    positions[ox * 3 + 2] = p.z + norm.z * outerOffset;
    uvs[ox * 2] = 1;
    uvs[ox * 2 + 1] = v;

    if (i < n) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildBarrierWallGeometry(
  points: THREE.Vector3[],
  normals: THREE.Vector3[],
  offset: number,
  height: number,
  thickness: number
): THREE.BufferGeometry {
  const n = points.length - 1;
  // 4 vertices per ring (inner-bottom, inner-top, outer-top, outer-bottom)
  const positions = new Float32Array((n + 1) * 4 * 3);
  const indices: number[] = [];
  const halfT = thickness * 0.5;
  const sign = offset >= 0 ? 1 : -1;

  for (let i = 0; i <= n; i++) {
    const p = points[i];
    const norm = normals[i];
    const innerOff = offset - sign * halfT;
    const outerOff = offset + sign * halfT;

    const base = i * 4;
    // 0: inner bottom
    positions[base * 3] = p.x + norm.x * innerOff;
    positions[base * 3 + 1] = 0;
    positions[base * 3 + 2] = p.z + norm.z * innerOff;
    // 1: inner top
    positions[(base + 1) * 3] = p.x + norm.x * innerOff;
    positions[(base + 1) * 3 + 1] = height;
    positions[(base + 1) * 3 + 2] = p.z + norm.z * innerOff;
    // 2: outer top
    positions[(base + 2) * 3] = p.x + norm.x * outerOff;
    positions[(base + 2) * 3 + 1] = height;
    positions[(base + 2) * 3 + 2] = p.z + norm.z * outerOff;
    // 3: outer bottom
    positions[(base + 3) * 3] = p.x + norm.x * outerOff;
    positions[(base + 3) * 3 + 1] = 0;
    positions[(base + 3) * 3 + 2] = p.z + norm.z * outerOff;

    if (i < n) {
      const a = i * 4;
      const b = (i + 1) * 4;
      // Inner face, top face, outer face
      indices.push(
        a + 0, a + 1, b + 0, a + 1, b + 1, b + 0,
        a + 1, a + 2, b + 1, a + 2, b + 2, b + 1,
        a + 2, a + 3, b + 2, a + 3, b + 3, b + 2
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildTrack(spec: TrackSpec, maxAnisotropy: number): BuiltTrack {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];

  const curvePts = spec.controlPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(curvePts, true, 'catmullrom', 0.5);
  const totalLength = curve.getLength();
  const segmentCount = 360;
  const points = curve.getSpacedPoints(segmentCount);

  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];

  for (let i = 0; i <= segmentCount; i++) {
    const prev = points[(i - 1 + segmentCount) % segmentCount];
    const next = points[(i + 1) % segmentCount];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const tangent = new THREE.Vector3(tx / len, 0, tz / len);
    // Right-hand normal on XZ plane
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    tangents.push(tangent);
    normals.push(normal);
  }

  const halfW = spec.roadWidth * 0.5;
  const kerbW = 1.4;
  const barrierOff = halfW + 3.1;

  // 1. Extended Terrain Floor
  const groundTex = createGroundTexture(
    spec.groundColor,
    spec.groundAccent,
    spec.theme === 'midnight',
    maxAnisotropy
  );
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.94,
    metalness: 0.04,
  });
  const groundGeo = new THREE.PlaneGeometry(1400, 1400);
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = 0;
  groundMesh.receiveShadow = true;
  group.add(groundMesh);
  disposables.push(groundTex, groundMat, groundGeo);

  // 2. Main Asphalt Road Ribbon
  const asphaltTex = createAsphaltTexture(maxAnisotropy);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.78,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const roadGeo = buildClosedRibbonGeometry(
    points,
    normals,
    -halfW,
    halfW,
    0.025,
    14,
    totalLength
  );
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  disposables.push(asphaltTex, roadMat, roadGeo);

  // 3. Left & Right FIA Rumble Kerbs
  const kerbTex = createKerbTexture(spec.kerbPrimary, spec.kerbSecondary, maxAnisotropy);
  const kerbMat = new THREE.MeshStandardMaterial({
    map: kerbTex,
    roughness: 0.68,
    metalness: 0.06,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const leftKerbGeo = buildClosedRibbonGeometry(
    points,
    normals,
    -halfW - kerbW,
    -halfW,
    0.032,
    4.5,
    totalLength
  );
  const rightKerbGeo = buildClosedRibbonGeometry(
    points,
    normals,
    halfW,
    halfW + kerbW,
    0.032,
    4.5,
    totalLength
  );
  const leftKerb = new THREE.Mesh(leftKerbGeo, kerbMat);
  const rightKerb = new THREE.Mesh(rightKerbGeo, kerbMat);
  leftKerb.receiveShadow = true;
  rightKerb.receiveShadow = true;
  group.add(leftKerb, rightKerb);
  disposables.push(kerbTex, kerbMat, leftKerbGeo, rightKerbGeo);

  // 4. Outer Safety Barriers (Armco rails)
  const barrierMat = new THREE.MeshStandardMaterial({
    color: spec.theme === 'midnight' ? '#1E293B' : '#CBD5E1',
    metalness: 0.55,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });
  const leftBarrierGeo = buildBarrierWallGeometry(points, normals, -barrierOff, 0.85, 0.45);
  const rightBarrierGeo = buildBarrierWallGeometry(points, normals, barrierOff, 0.85, 0.45);
  const leftBarrier = new THREE.Mesh(leftBarrierGeo, barrierMat);
  const rightBarrier = new THREE.Mesh(rightBarrierGeo, barrierMat);
  leftBarrier.castShadow = true;
  rightBarrier.castShadow = true;
  group.add(leftBarrier, rightBarrier);
  disposables.push(barrierMat, leftBarrierGeo, rightBarrierGeo);

  // 5. Checkered Start/Finish Line + Gantry Arch at Index 0
  const startPos = points[0];
  const startTan = tangents[0];
  const startYaw = Math.atan2(startTan.x, startTan.z);

  const gantry = new THREE.Group();
  gantry.position.set(startPos.x, 0, startPos.z);
  gantry.rotation.y = startYaw;

  const checkerTex = createCheckeredTexture(maxAnisotropy);
  const checkerMat = new THREE.MeshStandardMaterial({
    map: checkerTex,
    roughness: 0.65,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const checkerGeo = new THREE.PlaneGeometry(spec.roadWidth, 3.2);
  const checkerMesh = new THREE.Mesh(checkerGeo, checkerMat);
  checkerMesh.rotation.x = -Math.PI / 2;
  checkerMesh.position.set(0, 0.04, 0);
  checkerMesh.receiveShadow = true;
  gantry.add(checkerMesh);
  disposables.push(checkerTex, checkerMat, checkerGeo);

  const steelMat = new THREE.MeshStandardMaterial({
    color: '#1E293B',
    metalness: 0.72,
    roughness: 0.35,
  });
  const bannerMat = new THREE.MeshStandardMaterial({
    color: '#0F172A',
    metalness: 0.3,
    roughness: 0.5,
  });
  const trimAccentMat = new THREE.MeshStandardMaterial({
    color: spec.kerbPrimary,
    emissive: spec.kerbPrimary,
    emissiveIntensity: spec.theme === 'midnight' ? 1.4 : 0.35,
    roughness: 0.35,
  });

  const spanW = spec.roadWidth + 4.4;
  const pillarGeo = new THREE.BoxGeometry(0.65, 6.4, 0.65);
  const pillarL = new THREE.Mesh(pillarGeo, steelMat);
  pillarL.position.set(-spanW * 0.5, 3.2, 0);
  pillarL.castShadow = true;
  const pillarR = new THREE.Mesh(pillarGeo, steelMat);
  pillarR.position.set(spanW * 0.5, 3.2, 0);
  pillarR.castShadow = true;

  const beamGeo = new THREE.BoxGeometry(spanW + 0.8, 1.45, 0.9);
  const beam = new THREE.Mesh(beamGeo, bannerMat);
  beam.position.set(0, 6.2, 0);
  beam.castShadow = true;

  const stripGeo = new THREE.BoxGeometry(spanW + 0.84, 0.16, 0.94);
  const strip = new THREE.Mesh(stripGeo, trimAccentMat);
  strip.position.set(0, 6.9, 0);
  gantry.add(pillarL, pillarR, beam, strip);

  // 3 Countdown Light Pods on Gantry
  const startLightMats: THREE.MeshStandardMaterial[] = [];
  const podGeo = new THREE.SphereGeometry(0.24, 16, 16);
  for (let i = -1; i <= 1; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: '#334155',
      emissive: '#000000',
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    const pod = new THREE.Mesh(podGeo, mat);
    pod.position.set(i * 1.1, 5.75, 0.48);
    const podBack = new THREE.Mesh(podGeo, mat);
    podBack.position.set(i * 1.1, 5.75, -0.48);
    gantry.add(pod, podBack);
    startLightMats.push(mat);
    disposables.push(mat);
  }
  group.add(gantry);
  disposables.push(steelMat, bannerMat, trimAccentMat, pillarGeo, beamGeo, stripGeo, podGeo);

  // 6. Helper to verify safe distance from track centerline
  const minDistFromTrack = (px: number, pz: number): number => {
    let minSq = Infinity;
    for (let i = 0; i < segmentCount; i += 3) {
      const dx = px - points[i].x;
      const dz = pz - points[i].z;
      const sq = dx * dx + dz * dz;
      if (sq < minSq) minSq = sq;
    }
    return Math.sqrt(minSq);
  };

  // Deterministic pseudo-random generator for reproducible scenery
  let seed = spec.id.split('').reduce((acc, c) => acc + c.charCodeAt(0) * 31, 1337);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const dummy = new THREE.Object3D();
  const safeClearance = barrierOff + 6.5;

  if (spec.theme === 'alpine') {
    // Instanced Pine Trees (trunk + double foliage cones)
    const treeCount = 220;
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.48, 2.6, 8);
    trunkGeo.translate(0, 1.3, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4A3222', roughness: 0.92 });
    const foliageGeo = new THREE.ConeGeometry(2.1, 6.2, 8);
    foliageGeo.translate(0, 5.0, 0);
    const foliageMat = new THREE.MeshStandardMaterial({ color: '#2F6B43', roughness: 0.85 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
    trunks.castShadow = true;
    foliage.castShadow = true;

    let placed = 0;
    let attempts = 0;
    const tintColor = new THREE.Color();
    while (placed < treeCount && attempts < 2400) {
      attempts++;
      const rx = (rand() - 0.5) * 440;
      const rz = (rand() - 0.5) * 380;
      if (minDistFromTrack(rx, rz) < safeClearance) continue;

      const s = 0.82 + rand() * 0.52;
      dummy.position.set(rx, 0, rz);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      foliage.setMatrixAt(placed, dummy.matrix);

      tintColor.setHSL(0.36 + (rand() - 0.5) * 0.04, 0.38, 0.25 + rand() * 0.12);
      foliage.setColorAt(placed, tintColor);
      placed++;
    }
    trunks.count = placed;
    foliage.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    foliage.computeBoundingSphere();
    group.add(trunks, foliage);
    disposables.push(trunkGeo, trunkMat, foliageGeo, foliageMat);

    // Distant Alpine Peaks Ring
    const peakCount = 28;
    const peakGeo = new THREE.ConeGeometry(42, 68, 6);
    peakGeo.translate(0, 34, 0);
    const peakMat = new THREE.MeshStandardMaterial({ color: '#4B5B6B', roughness: 0.9 });
    const peaks = new THREE.InstancedMesh(peakGeo, peakMat, peakCount);
    for (let i = 0; i < peakCount; i++) {
      const a = (i / peakCount) * Math.PI * 2;
      const r = 275 + rand() * 55;
      dummy.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(1 + rand() * 0.6, 0.8 + rand() * 0.8, 1 + rand() * 0.6);
      dummy.updateMatrix();
      peaks.setMatrixAt(i, dummy.matrix);
    }
    peaks.instanceMatrix.needsUpdate = true;
    peaks.computeBoundingSphere();
    group.add(peaks);
    disposables.push(peakGeo, peakMat);
  } else if (spec.theme === 'canyon') {
    // Sandstone Mesas & Desert Boulders
    const mesaCount = 95;
    const mesaGeo = new THREE.CylinderGeometry(5.5, 9.5, 16, 7);
    mesaGeo.translate(0, 8, 0);
    const mesaMat = new THREE.MeshStandardMaterial({ color: '#9E4C2F', roughness: 0.92 });
    const mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, mesaCount);
    mesas.castShadow = true;

    let placed = 0;
    let attempts = 0;
    const tint = new THREE.Color();
    while (placed < mesaCount && attempts < 1800) {
      attempts++;
      const rx = (rand() - 0.5) * 480;
      const rz = (rand() - 0.5) * 400;
      if (minDistFromTrack(rx, rz) < safeClearance + 4) continue;

      const s = 0.65 + rand() * 1.1;
      dummy.position.set(rx, -0.5, rz);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(s, 0.7 + rand() * 1.2, s);
      dummy.updateMatrix();
      mesas.setMatrixAt(placed, dummy.matrix);
      tint.setHSL(0.05 + (rand() - 0.5) * 0.02, 0.52, 0.36 + rand() * 0.12);
      mesas.setColorAt(placed, tint);
      placed++;
    }
    mesas.count = placed;
    mesas.instanceMatrix.needsUpdate = true;
    if (mesas.instanceColor) mesas.instanceColor.needsUpdate = true;
    mesas.computeBoundingSphere();
    group.add(mesas);
    disposables.push(mesaGeo, mesaMat);

    // Low Canyon Boulders
    const rockCount = 110;
    const rockGeo = new THREE.DodecahedronGeometry(1.8, 0);
    rockGeo.translate(0, 1.0, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#783B24', roughness: 0.95 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    let rPlaced = 0;
    let rAtt = 0;
    while (rPlaced < rockCount && rAtt < 1500) {
      rAtt++;
      const rx = (rand() - 0.5) * 420;
      const rz = (rand() - 0.5) * 340;
      if (minDistFromTrack(rx, rz) < safeClearance) continue;
      const s = 0.7 + rand() * 0.9;
      dummy.position.set(rx, 0, rz);
      dummy.rotation.set(rand(), rand(), rand());
      dummy.scale.set(s * 1.2, s * 0.75, s);
      dummy.updateMatrix();
      rocks.setMatrixAt(rPlaced, dummy.matrix);
      rPlaced++;
    }
    rocks.count = rPlaced;
    rocks.instanceMatrix.needsUpdate = true;
    rocks.computeBoundingSphere();
    group.add(rocks);
    disposables.push(rockGeo, rockMat);
  } else {
    // Midnight Metro: Trackside Floodlight Poles + City Skyline Towers
    const lampCount = 48;
    const poleGeo = new THREE.BoxGeometry(0.32, 7.2, 0.32);
    poleGeo.translate(0, 3.6, 0);
    const poleMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      metalness: 0.7,
      roughness: 0.35,
    });
    const bulbGeo = new THREE.BoxGeometry(1.4, 0.22, 0.5);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: '#E0F2FE',
      emissive: '#38BDF8',
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampCount);
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampCount);

    for (let i = 0; i < lampCount; i++) {
      const idx = Math.floor((i / lampCount) * segmentCount);
      const p = points[idx];
      const norm = normals[idx];
      const tan = tangents[idx];
      const side = i % 2 === 0 ? 1 : -1;
      const dist = barrierOff + 1.1;

      dummy.position.set(p.x + norm.x * dist * side, 0, p.z + norm.z * dist * side);
      dummy.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);

      dummy.position.set(
        p.x + norm.x * (dist - 0.5 * side) * side,
        7.1,
        p.z + norm.z * (dist - 0.5 * side) * side
      );
      dummy.updateMatrix();
      bulbs.setMatrixAt(i, dummy.matrix);
    }
    poles.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    poles.computeBoundingSphere();
    bulbs.computeBoundingSphere();
    group.add(poles, bulbs);
    disposables.push(poleGeo, poleMat, bulbGeo, bulbMat);

    // City Skyline Towers
    const towerCount = 130;
    const towerGeo = new THREE.BoxGeometry(10, 1, 10);
    towerGeo.translate(0, 0.5, 0);
    const towerMat = new THREE.MeshStandardMaterial({
      color: '#182235',
      roughness: 0.55,
      metalness: 0.4,
    });
    const towers = new THREE.InstancedMesh(towerGeo, towerMat, towerCount);
    let tPlaced = 0;
    let tAtt = 0;
    const tColor = new THREE.Color();
    while (tPlaced < towerCount && tAtt < 2000) {
      tAtt++;
      const rx = (rand() - 0.5) * 460;
      const rz = (rand() - 0.5) * 400;
      if (minDistFromTrack(rx, rz) < safeClearance + 8) continue;

      const w = 0.8 + rand() * 1.4;
      const h = 14 + rand() * 44;
      dummy.position.set(rx, 0, rz);
      dummy.rotation.set(0, Math.floor(rand() * 4) * (Math.PI / 2), 0);
      dummy.scale.set(w, h, w);
      dummy.updateMatrix();
      towers.setMatrixAt(tPlaced, dummy.matrix);
      tColor.setHSL(0.6 + (rand() - 0.5) * 0.04, 0.28, 0.14 + rand() * 0.1);
      towers.setColorAt(tPlaced, tColor);
      tPlaced++;
    }
    towers.count = tPlaced;
    towers.instanceMatrix.needsUpdate = true;
    if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
    towers.computeBoundingSphere();
    group.add(towers);
    disposables.push(towerGeo, towerMat);
  }

  // Minimap path (decimated 90 points)
  const minimapPath: { x: number; z: number }[] = [];
  for (let i = 0; i < segmentCount; i += 4) {
    minimapPath.push({ x: points[i].x, z: points[i].z });
  }

  const projectPoint = (x: number, z: number, hintIdx?: number): TrackProjection => {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIdx !== undefined) {
      const windowSize = 26;
      for (let offset = -windowSize; offset <= windowSize; offset++) {
        const idx = (hintIdx + offset + segmentCount) % segmentCount;
        const dx = x - points[idx].x;
        const dz = z - points[idx].z;
        const sq = dx * dx + dz * dz;
        if (sq < bestDistSq) {
          bestDistSq = sq;
          bestIdx = idx;
        }
      }
      // Fallback full scan if vehicle teleported / went very far
      if (bestDistSq > 900) {
        bestDistSq = Infinity;
        for (let idx = 0; idx < segmentCount; idx++) {
          const dx = x - points[idx].x;
          const dz = z - points[idx].z;
          const sq = dx * dx + dz * dz;
          if (sq < bestDistSq) {
            bestDistSq = sq;
            bestIdx = idx;
          }
        }
      }
    } else {
      for (let idx = 0; idx < segmentCount; idx++) {
        const dx = x - points[idx].x;
        const dz = z - points[idx].z;
        const sq = dx * dx + dz * dz;
        if (sq < bestDistSq) {
          bestDistSq = sq;
          bestIdx = idx;
        }
      }
    }

    const p = points[bestIdx];
    const tan = tangents[bestIdx];
    const norm = normals[bestIdx];

    const dx = x - p.x;
    const dz = z - p.z;
    // Project along tangent for fractional progress
    const along = dx * tan.x + dz * tan.z;
    const segLen = totalLength / segmentCount;
    const fracT = ((bestIdx + along / segLen + segmentCount) % segmentCount) / segmentCount;

    const signedOffset = dx * norm.x + dz * norm.z;
    const closestX = p.x + tan.x * along;
    const closestZ = p.z + tan.z * along;

    return {
      arcProgress: fracT,
      signedOffset,
      absOffset: Math.abs(signedOffset),
      closestX,
      closestZ,
      tangentX: tan.x,
      tangentZ: tan.z,
      nearestIdx: bestIdx,
    };
  };

  const sampleAtProgress = (t: number, lateralOffset = 0) => {
    const wrapped = ((t % 1) + 1) % 1;
    const exactIdx = wrapped * segmentCount;
    const i0 = Math.floor(exactIdx) % segmentCount;
    const i1 = (i0 + 1) % segmentCount;
    const alpha = exactIdx - Math.floor(exactIdx);

    const p0 = points[i0];
    const p1 = points[i1];
    const n0 = normals[i0];
    const n1 = normals[i1];
    const t0 = tangents[i0];
    const t1 = tangents[i1];

    const px = p0.x + (p1.x - p0.x) * alpha;
    const pz = p0.z + (p1.z - p0.z) * alpha;
    const nx = n0.x + (n1.x - n0.x) * alpha;
    const nz = n0.z + (n1.z - n0.z) * alpha;
    const tx = t0.x + (t1.x - t0.x) * alpha;
    const tz = t0.z + (t1.z - t0.z) * alpha;

    return {
      x: px + nx * lateralOffset,
      z: pz + nz * lateralOffset,
      yaw: Math.atan2(tx, tz),
    };
  };

  return {
    group,
    spec,
    points,
    tangents,
    normals,
    totalLength,
    segmentCount,
    minimapPath,
    startLightMats,
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
    projectPoint,
    sampleAtProgress,
  };
}
