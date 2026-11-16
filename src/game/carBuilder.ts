import * as THREE from 'three';
import type { CarSpec } from './types';

export interface BuiltCarMesh {
  root: THREE.Group;
  frontWheelPivots: THREE.Group[];
  wheels: THREE.Group[];
  brakeLightMat: THREE.MeshStandardMaterial;
  nitroFlames: THREE.Mesh[];
  headlightBeam: THREE.SpotLight | null;
}

function createExtrudedSideBody(style: CarSpec['bodyStyle']): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  // Side profile in X (length along Z after rotation) and Y (height)
  // Front is +X here, Rear is -X; after rotateY(-PI/2), Front will be -Z (forward)
  if (style === 'prototype') {
    shape.moveTo(-2.15, 0.24);
    shape.lineTo(2.15, 0.22);
    shape.lineTo(2.22, 0.36);
    shape.lineTo(1.72, 0.56);
    shape.lineTo(0.88, 0.64);
    shape.lineTo(0.24, 1.02);
    shape.lineTo(-0.78, 1.02);
    shape.lineTo(-1.56, 0.72);
    shape.lineTo(-2.16, 0.68);
    shape.lineTo(-2.22, 0.38);
    shape.closePath();
  } else if (style === 'muscle') {
    shape.moveTo(-2.22, 0.26);
    shape.lineTo(2.2, 0.26);
    shape.lineTo(2.24, 0.58);
    shape.lineTo(1.88, 0.72);
    shape.lineTo(0.75, 0.76);
    shape.lineTo(0.25, 1.18);
    shape.lineTo(-0.92, 1.18);
    shape.lineTo(-1.72, 0.84);
    shape.lineTo(-2.24, 0.78);
    shape.closePath();
  } else {
    // Sleek GT Coupe
    shape.moveTo(-2.15, 0.24);
    shape.lineTo(2.15, 0.24);
    shape.lineTo(2.22, 0.44);
    shape.lineTo(1.74, 0.64);
    shape.lineTo(0.78, 0.72);
    shape.lineTo(0.18, 1.12);
    shape.lineTo(-0.85, 1.12);
    shape.lineTo(-1.72, 0.76);
    shape.lineTo(-2.18, 0.72);
    shape.closePath();
  }

  const width = style === 'muscle' ? 1.88 : 1.82;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 3,
    curveSegments: 8,
  });

  // Center along Z then rotate so length runs along Z (front = -Z) and width along X
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function buildWheel(
  tireMat: THREE.Material,
  rimMat: THREE.Material,
  caliperMat: THREE.Material
): THREE.Group {
  const wheelGroup = new THREE.Group();

  // Outer rubber tire
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 22);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  wheelGroup.add(tire);

  // Metallic alloy wheel barrel
  const rimGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.295, 16);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  wheelGroup.add(rim);

  // Five spoke bars for unmistakable wheel spin cue
  const spokeGeo = new THREE.BoxGeometry(0.31, 0.42, 0.045);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.rotation.x = (i * Math.PI) / 3;
    wheelGroup.add(spoke);
  }

  // Brake caliper accent inside wheel
  const caliperGeo = new THREE.BoxGeometry(0.14, 0.16, 0.12);
  const caliper = new THREE.Mesh(caliperGeo, caliperMat);
  caliper.position.set(0, 0.08, 0.12);
  wheelGroup.add(caliper);

  return wheelGroup;
}

export function buildProceduralCar(
  spec: CarSpec,
  contactShadowTex: THREE.Texture,
  enableHeadlightSpot = false
): BuiltCarMesh {
  const root = new THREE.Group();

  // Calibrated PBR materials with clear roughness/metalness contrast
  const bodyPaintMat = new THREE.MeshPhysicalMaterial({
    color: spec.colorHex,
    metalness: 0.65,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });

  const carbonTrimMat = new THREE.MeshStandardMaterial({
    color: '#161A22',
    metalness: 0.18,
    roughness: 0.78,
  });

  const accentStripeMat = new THREE.MeshStandardMaterial({
    color: spec.accentHex,
    metalness: 0.35,
    roughness: 0.36,
  });

  const canopyGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#0A1220',
    metalness: 0.15,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: '#14161A',
    metalness: 0.05,
    roughness: 0.88,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: '#D4DCE8',
    metalness: 0.92,
    roughness: 0.18,
  });

  const caliperMat = new THREE.MeshStandardMaterial({
    color: spec.colorHex,
    metalness: 0.4,
    roughness: 0.4,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: '#FFFBEB',
    emissive: '#FEF3C7',
    emissiveIntensity: 2.2,
    roughness: 0.15,
  });

  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: '#DC2626',
    emissive: '#EF4444',
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: '#E2E8F0',
    metalness: 0.96,
    roughness: 0.12,
  });

  // 1. Soft radial contact shadow grounded at y = 0.03
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 5.4),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.035;
  root.add(shadowPlane);

  // 2. Sculpted main extruded chassis shell (front is -Z)
  const bodyGeo = createExtrudedSideBody(spec.bodyStyle);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyPaintMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  root.add(bodyMesh);

  // 3. Lower carbon aerodynamic splitter, side skirts & rear diffuser
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.1, 4.55), carbonTrimMat);
  splitter.position.set(0, 0.22, -0.02);
  splitter.castShadow = true;
  root.add(splitter);

  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.18, 0.32), carbonTrimMat);
  diffuser.position.set(0, 0.28, 2.18);
  root.add(diffuser);

  // 4. Center racing stripe / hood accent
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 3.6), accentStripeMat);
  stripe.position.set(0, 0.69, -0.18);
  root.add(stripe);

  // 5. Tinted windshield & cabin greenhouse
  const canopyGeo = new THREE.BoxGeometry(1.48, 0.38, 1.82);
  const canopy = new THREE.Mesh(canopyGeo, canopyGlassMat);
  canopy.position.set(0, 0.91, 0.18);
  canopy.scale.set(0.98, 1, 1);
  root.add(canopy);

  // Sloped windshield visor
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.08, 0.85), canopyGlassMat);
  windshield.position.set(0, 0.86, -0.78);
  windshield.rotation.x = 0.44;
  root.add(windshield);

  // 6. Side mirrors
  const mirrorGeo = new THREE.BoxGeometry(0.22, 0.09, 0.14);
  const mirrorL = new THREE.Mesh(mirrorGeo, bodyPaintMat);
  mirrorL.position.set(-1.02, 0.78, -0.45);
  const mirrorR = new THREE.Mesh(mirrorGeo, bodyPaintMat);
  mirrorR.position.set(1.02, 0.78, -0.45);
  root.add(mirrorL, mirrorR);

  // 7. Rear GT Wing & Pylons
  const wingWidth = spec.bodyStyle === 'prototype' ? 2.02 : 1.92;
  const wingHeight = spec.bodyStyle === 'prototype' ? 1.1 : 1.02;
  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(wingWidth, 0.06, 0.34), carbonTrimMat);
  wingBlade.position.set(0, wingHeight, 2.02);
  wingBlade.rotation.x = 0.12;
  wingBlade.castShadow = true;
  root.add(wingBlade);

  const pylonGeo = new THREE.BoxGeometry(0.06, 0.32, 0.22);
  const pylonL = new THREE.Mesh(pylonGeo, carbonTrimMat);
  pylonL.position.set(-0.54, wingHeight - 0.16, 2.02);
  const pylonR = new THREE.Mesh(pylonGeo, carbonTrimMat);
  pylonR.position.set(0.54, wingHeight - 0.16, 2.02);
  root.add(pylonL, pylonR);

  // Wing endplates
  const endplateGeo = new THREE.BoxGeometry(0.04, 0.2, 0.42);
  const endL = new THREE.Mesh(endplateGeo, bodyPaintMat);
  endL.position.set(-wingWidth / 2, wingHeight, 2.02);
  const endR = new THREE.Mesh(endplateGeo, bodyPaintMat);
  endR.position.set(wingWidth / 2, wingHeight, 2.02);
  root.add(endL, endR);

  // 8. Twin LED Headlights & Tail Light Bar
  const headGeo = new THREE.BoxGeometry(0.36, 0.1, 0.1);
  const headL = new THREE.Mesh(headGeo, headlightMat);
  headL.position.set(-0.62, 0.48, -2.18);
  const headR = new THREE.Mesh(headGeo, headlightMat);
  headR.position.set(0.62, 0.48, -2.18);
  root.add(headL, headR);

  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.1, 0.08), brakeLightMat);
  tailBar.position.set(0, 0.56, 2.22);
  root.add(tailBar);

  // 9. Twin Exhaust Pipes & Nitro Flame Cones
  const exhaustGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.2, 12);
  exhaustGeo.rotateX(Math.PI / 2);
  const exL = new THREE.Mesh(exhaustGeo, chromeMat);
  exL.position.set(-0.46, 0.28, 2.24);
  const exR = new THREE.Mesh(exhaustGeo, chromeMat);
  exR.position.set(0.46, 0.28, 2.24);
  root.add(exL, exR);

  const flameMat = new THREE.MeshBasicMaterial({
    color: '#38BDF8',
    transparent: true,
    opacity: 0.9,
  });
  const flameGeo = new THREE.ConeGeometry(0.09, 0.72, 10);
  flameGeo.rotateX(Math.PI / 2);
  const flameL = new THREE.Mesh(flameGeo, flameMat);
  flameL.position.set(-0.46, 0.28, 2.66);
  flameL.visible = false;
  const flameR = new THREE.Mesh(flameGeo, flameMat);
  flameR.position.set(0.46, 0.28, 2.66);
  flameR.visible = false;
  root.add(flameL, flameR);

  // 10. 4 Articulated Wheel Assemblies (grounded at tire radius y = 0.36)
  const wheelOffsets: [number, number, number, boolean][] = [
    [-0.96, 0.36, -1.36, true],
    [0.96, 0.36, -1.36, true],
    [-0.98, 0.36, 1.38, false],
    [0.98, 0.36, 1.38, false],
  ];

  const frontWheelPivots: THREE.Group[] = [];
  const wheels: THREE.Group[] = [];

  for (const [wx, wy, wz, isFront] of wheelOffsets) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    const wheel = buildWheel(tireMat, rimMat, caliperMat);
    pivot.add(wheel);
    root.add(pivot);
    wheels.push(wheel);
    if (isFront) {
      frontWheelPivots.push(pivot);
    }
  }

  // Optional real headlight SpotLight (for night track)
  let headlightBeam: THREE.SpotLight | null = null;
  if (enableHeadlightSpot) {
    headlightBeam = new THREE.SpotLight('#FFF8E7', 45, 75, Math.PI / 4.5, 0.55, 1.5);
    headlightBeam.position.set(0, 0.7, -2.0);
    headlightBeam.target.position.set(0, 0.1, -24);
    root.add(headlightBeam);
    root.add(headlightBeam.target);
  }

  return {
    root,
    frontWheelPivots,
    wheels,
    brakeLightMat,
    nitroFlames: [flameL, flameR],
    headlightBeam,
  };
}
