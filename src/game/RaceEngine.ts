import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SoundEngine } from './audio';
import { buildProceduralCar, type BuiltCarMesh } from './carBuilder';
import { CAR_CATALOG, RIVAL_PROFILES, TRACK_CATALOG } from './catalog';
import { createContactShadowTexture } from './textures';
import { buildTrack, type BuiltTrack } from './trackBuilder';
import type {
  CameraMode,
  CarSpec,
  GameMode,
  GamePhase,
  InputState,
  MinimapCar,
  RaceStanding,
  TelemetrySnapshot,
  TrackSpec,
} from './types';

interface VehicleActor {
  id: string;
  name: string;
  carSpec: CarSpec;
  mesh: BuiltCarMesh;
  isPlayer: boolean;
  x: number;
  z: number;
  heading: number; // world yaw where forward = (sin(heading), 0, cos(heading))
  speed: number; // m/s
  steerAngle: number;
  slipAngle: number; // visual drift yaw offset
  wheelSpin: number;
  arcProgress: number;
  lastArcProgress: number;
  nearestIdx: number;
  lap: number;
  checkpointHalf: boolean;
  finished: boolean;
  finishTimeMs: number | null;
  progressScore: number;
  // AI params
  aiBasePace: number;
  aiLaneOffset: number;
  aiLaneTimer: number;
}

interface SmokeParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  scale: number;
  isNitro: boolean;
}

// Module-scope reusable math helpers (zero GC inside render loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _smokeColor = new THREE.Color();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class RaceEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private envRT: THREE.WebGLRenderTarget;
  private isSoftwareGl: boolean;
  private maxAnisotropy: number;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;

  private contactShadowTex: THREE.CanvasTexture;
  private builtTrack: BuiltTrack;
  private actors: VehicleActor[] = [];
  private playerActor!: VehicleActor;

  // Smoke & nitro particle pool
  private smokePool: SmokeParticle[] = [];
  private smokeMesh: THREE.InstancedMesh;
  private smokeCursor = 0;

  private sound = new SoundEngine();

  private phase: GamePhase = 'GARAGE';
  private mode: GameMode = 'RACE';
  private cameraMode: CameraMode = 'CHASE';
  private selectedCar: CarSpec = CAR_CATALOG[0];
  private selectedTrack: TrackSpec = TRACK_CATALOG[0];

  private input: InputState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    drift: false,
    nitro: false,
  };
  private touchInput: InputState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    drift: false,
    nitro: false,
  };

  private nitro = 100;
  private driftPoints = 0;
  private countdownTimer = 0;
  private lastCountdownBeep = -1;
  private raceElapsedMs = 0;
  private currentLapMs = 0;
  private bestLapMs: number | null = null;
  private lastLapMs: number | null = null;
  private showcaseAngle = 0.65;
  private camShake = 0;

  private frameId = 0;
  private lastTime = performance.now();
  private hudEmitAccum = 0;
  private disposed = false;
  private contextLost = false;

  private onTelemetry: (snap: TelemetrySnapshot) => void;
  private onContextIssue?: (lost: boolean) => void;

  private keyDownHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;
  private resizeHandler: () => void;
  private contextLostHandler: (e: Event) => void;
  private contextRestoredHandler: () => void;

  constructor(
    container: HTMLElement,
    onTelemetry: (snap: TelemetrySnapshot) => void,
    onContextIssue?: (lost: boolean) => void
  ) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    this.onContextIssue = onContextIssue;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 1);

    this.scene = new THREE.Scene();

    // Studio RoomEnvironment reflection for metallic clearcoat car paint
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.25, 900);

    // 3-Point + Hemisphere Outdoor Rig
    this.hemiLight = new THREE.HemisphereLight('#9FD0F5', '#3E4C3A', 0.75);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#FFF3DC', 2.1);
    this.sunLight.position.set(45, 75, 35);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 220;
    const d = 68;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight('#E0F2FE', 0.65);
    this.rimLight.position.set(-40, 28, -50);
    this.scene.add(this.rimLight);

    this.contactShadowTex = createContactShadowTexture();

    // Particle pool (96 puffs)
    const particleGeo = new THREE.SphereGeometry(0.32, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({
      color: '#CBD5E1',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const poolSize = 96;
    this.smokeMesh = new THREE.InstancedMesh(particleGeo, particleMat, poolSize);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(poolSize * 3), 3);
    for (let i = 0; i < poolSize; i++) {
      this.smokePool.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 0.5,
        scale: 0,
        isNitro: false,
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.set(0.001, 0.001, 0.001);
      _dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, _dummy.matrix);
      this.smokeMesh.setColorAt(i, _smokeColor.set('#CBD5E1'));
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.smokeMesh);

    // Initial track & cars
    this.builtTrack = buildTrack(this.selectedTrack, this.maxAnisotropy);
    this.scene.add(this.builtTrack.group);
    this.applyTrackAtmosphere(this.selectedTrack);
    this.rebuildCars();
    this.positionGarageShowcaseCamera(true);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Event bindings
    this.keyDownHandler = (e) => this.handleKey(e, true);
    this.keyUpHandler = (e) => this.handleKey(e, false);
    this.resizeHandler = () => this.handleResize();
    this.contextLostHandler = (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextIssue?.(true);
    };
    this.contextRestoredHandler = () => {
      this.contextLost = false;
      this.onContextIssue?.(false);
    };

    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    window.addEventListener('resize', this.resizeHandler);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLostHandler);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestoredHandler);

    this.emitTelemetry();
    this.lastTime = performance.now();
    this.scheduleNextTick();
  }

  public getTrackMinimapPath(): { x: number; z: number }[] {
    return this.builtTrack.minimapPath;
  }

  public setCar(spec: CarSpec): void {
    if (this.selectedCar.id === spec.id) return;
    this.selectedCar = spec;
    this.rebuildCars();
    this.emitTelemetry();
  }

  public setTrack(spec: TrackSpec): void {
    if (this.selectedTrack.id === spec.id) return;
    this.selectedTrack = spec;
    this.bestLapMs = null;
    this.lastLapMs = null;

    this.scene.remove(this.builtTrack.group);
    this.builtTrack.dispose();
    this.builtTrack = buildTrack(spec, this.maxAnisotropy);
    this.scene.add(this.builtTrack.group);
    this.applyTrackAtmosphere(spec);
    this.rebuildCars();
    if (this.phase === 'GARAGE') {
      this.positionGarageShowcaseCamera(true);
    }
    this.emitTelemetry();
  }

  public setMode(mode: GameMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.rebuildCars();
    this.emitTelemetry();
  }

  public setCameraMode(camMode: CameraMode): void {
    this.cameraMode = camMode;
  }

  public cycleCameraMode(): CameraMode {
    const order: CameraMode[] = ['CHASE', 'CLOSE', 'HOOD'];
    const idx = (order.indexOf(this.cameraMode) + 1) % order.length;
    this.cameraMode = order[idx];
    return this.cameraMode;
  }

  public setTouchInput(partial: Partial<InputState>): void {
    Object.assign(this.touchInput, partial);
  }

  public setMuted(muted: boolean): void {
    this.sound.setMuted(muted);
  }

  public isMuted(): boolean {
    return this.sound.isMuted();
  }

  public startRace(): void {
    this.sound.unlock();
    this.phase = 'COUNTDOWN';
    this.countdownTimer = 3.2;
    this.lastCountdownBeep = 4;
    this.raceElapsedMs = 0;
    this.currentLapMs = 0;
    this.nitro = 100;
    this.driftPoints = 0;
    this.placeCarsOnStartingGrid();
    this.updateGantryLights(3);
    this.emitTelemetry();
  }

  public togglePause(): void {
    if (this.phase === 'RACING') {
      this.phase = 'PAUSED';
      this.sound.updateDrive(false, 0, 0, 0, false);
      this.emitTelemetry();
    } else if (this.phase === 'PAUSED') {
      this.phase = 'RACING';
      this.lastTime = performance.now();
      this.emitTelemetry();
    }
  }

  public returnToGarage(): void {
    this.phase = 'GARAGE';
    this.sound.updateDrive(false, 0, 0, 0, false);
    this.updateGantryLights(0);
    this.placeCarsOnStartingGrid();
    this.positionGarageShowcaseCamera(true);
    this.emitTelemetry();
  }

  public resetCarToTrack(): void {
    if (this.phase !== 'RACING') return;
    const sample = this.builtTrack.sampleAtProgress(this.playerActor.arcProgress, 0);
    this.playerActor.x = sample.x;
    this.playerActor.z = sample.z;
    this.playerActor.heading = sample.yaw;
    this.playerActor.speed = 0;
    this.playerActor.slipAngle = 0;
  }

  private applyTrackAtmosphere(spec: TrackSpec): void {
    this.scene.background = new THREE.Color(spec.skyColor);
    this.scene.fog = new THREE.FogExp2(spec.fogColor, spec.fogDensity);
    this.sunLight.color.set(spec.sunColor);
    this.sunLight.intensity = spec.sunIntensity;
    this.hemiLight.color.set(spec.hemiSky);
    this.hemiLight.groundColor.set(spec.hemiGround);
    this.hemiLight.intensity = spec.hemiIntensity;
  }

  private rebuildCars(): void {
    for (const actor of this.actors) {
      this.scene.remove(actor.mesh.root);
    }
    this.actors = [];

    const isMidnight = this.selectedTrack.theme === 'midnight';
    const playerMesh = buildProceduralCar(this.selectedCar, this.contactShadowTex, isMidnight);
    this.scene.add(playerMesh.root);

    this.playerActor = {
      id: 'player',
      name: 'You',
      carSpec: this.selectedCar,
      mesh: playerMesh,
      isPlayer: true,
      x: 0,
      z: 0,
      heading: 0,
      speed: 0,
      steerAngle: 0,
      slipAngle: 0,
      wheelSpin: 0,
      arcProgress: 0.985,
      lastArcProgress: 0.985,
      nearestIdx: 0,
      lap: 1,
      checkpointHalf: false,
      finished: false,
      finishTimeMs: null,
      progressScore: -0.015,
      aiBasePace: 1,
      aiLaneOffset: 0,
      aiLaneTimer: 0,
    };
    this.actors.push(this.playerActor);

    if (this.mode === 'RACE') {
      RIVAL_PROFILES.forEach((profile, idx) => {
        // Pick distinct car spec so rivals look varied
        const rivalSpec = CAR_CATALOG[(CAR_CATALOG.findIndex((c) => c.id === this.selectedCar.id) + idx + 1) % CAR_CATALOG.length];
        const rivalMesh = buildProceduralCar(rivalSpec, this.contactShadowTex, false);
        this.scene.add(rivalMesh.root);

        this.actors.push({
          id: `rival-${idx}`,
          name: profile.name,
          carSpec: rivalSpec,
          mesh: rivalMesh,
          isPlayer: false,
          x: 0,
          z: 0,
          heading: 0,
          speed: 0,
          steerAngle: 0,
          slipAngle: 0,
          wheelSpin: 0,
          arcProgress: 0.99,
          lastArcProgress: 0.99,
          nearestIdx: 0,
          lap: 1,
          checkpointHalf: false,
          finished: false,
          finishTimeMs: null,
          progressScore: -0.01,
          aiBasePace: profile.basePace,
          aiLaneOffset: profile.laneOffset,
          aiLaneTimer: 1.5 + idx * 0.9,
        });
      });
    }

    this.placeCarsOnStartingGrid();
  }

  private placeCarsOnStartingGrid(): void {
    // Staggered 2x2 F1/GT starting grid behind start line (t = 0)
    const gridSlots: { arcBack: number; lat: number }[] = [
      { arcBack: 0.008, lat: -3.0 }, // P1
      { arcBack: 0.014, lat: 3.0 },  // P2
      { arcBack: 0.020, lat: -3.0 }, // P3
      { arcBack: 0.026, lat: 3.0 },  // P4 (Player)
    ];

    const total = this.actors.length;
    this.actors.forEach((actor, idx) => {
      // Put player in last slot (or front if Time Trial)
      const slot =
        total === 1
          ? { arcBack: 0.01, lat: 0 }
          : actor.isPlayer
          ? gridSlots[total - 1]
          : gridSlots[idx - 1];

      const t = 1 - slot.arcBack;
      const sample = this.builtTrack.sampleAtProgress(t, slot.lat);
      actor.x = sample.x;
      actor.z = sample.z;
      actor.heading = sample.yaw;
      actor.speed = 0;
      actor.steerAngle = 0;
      actor.slipAngle = 0;
      actor.arcProgress = t;
      actor.lastArcProgress = t;
      actor.nearestIdx = Math.floor(t * this.builtTrack.segmentCount);
      actor.lap = 1;
      actor.checkpointHalf = false;
      actor.finished = false;
      actor.finishTimeMs = null;
      actor.progressScore = t - 1; // slightly negative behind start line
      this.syncActorMesh(actor, 0);
    });
  }

  private updateGantryLights(countdownInt: number): void {
    const mats = this.builtTrack.startLightMats;
    if (this.phase === 'GARAGE') {
      mats.forEach((m) => {
        m.emissive.set('#000000');
        m.emissiveIntensity = 0;
      });
      return;
    }
    if (this.phase === 'COUNTDOWN') {
      // 3 -> light 0 red, 2 -> lights 0,1 red, 1 -> lights 0,1,2 red
      const litCount = Math.min(3, Math.max(0, 4 - countdownInt));
      mats.forEach((m, idx) => {
        if (idx < litCount) {
          m.emissive.set('#EF4444');
          m.emissiveIntensity = 3.2;
        } else {
          m.emissive.set('#000000');
          m.emissiveIntensity = 0;
        }
      });
      return;
    }
    // RACING -> green lights briefly then subtle emerald
    mats.forEach((m) => {
      m.emissive.set('#10B981');
      m.emissiveIntensity = this.raceElapsedMs < 2400 ? 3.2 : 0.6;
    });
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      if (this.phase === 'RACING' || this.phase === 'COUNTDOWN') {
        e.preventDefault();
      }
    }

    if (down) {
      if (code === 'Escape' || code === 'KeyP') {
        if (this.phase === 'RACING' || this.phase === 'PAUSED') {
          this.togglePause();
        }
      } else if (code === 'KeyC' && (this.phase === 'RACING' || this.phase === 'COUNTDOWN')) {
        this.cycleCameraMode();
      } else if (code === 'KeyR' && this.phase === 'RACING') {
        this.resetCarToTrack();
      }
    }

    if (code === 'KeyW' || code === 'ArrowUp') this.input.throttle = down;
    if (code === 'KeyS' || code === 'ArrowDown') this.input.brake = down;
    if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = down;
    if (code === 'KeyD' || code === 'ArrowRight') this.input.right = down;
    if (code === 'Space') this.input.drift = down;
    if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyN') this.input.nitro = down;
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => {
        if (!this.disposed) this.tick();
      });
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (!this.contextLost) {
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.scheduleNextTick();
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private update(dt: number): void {
    if (this.phase === 'GARAGE') {
      this.showcaseAngle += dt * 0.28;
      this.positionGarageShowcaseCamera(false, dt);
      this.updateParticles(dt);
      return;
    }

    if (this.phase === 'PAUSED') {
      return;
    }

    if (this.phase === 'COUNTDOWN') {
      this.countdownTimer -= dt;
      const ceilSec = Math.max(0, Math.ceil(this.countdownTimer));
      if (ceilSec !== this.lastCountdownBeep && ceilSec <= 3 && ceilSec >= 1) {
        this.lastCountdownBeep = ceilSec;
        this.sound.playCountdownTone(false);
        this.updateGantryLights(ceilSec);
      }
      if (this.countdownTimer <= 0) {
        this.phase = 'RACING';
        this.sound.playCountdownTone(true);
        this.updateGantryLights(0);
      }
      this.updateChaseCamera(dt);
      this.hudEmitAccum += dt;
      if (this.hudEmitAccum >= 0.08) {
        this.hudEmitAccum = 0;
        this.emitTelemetry();
      }
      return;
    }

    // RACING or FINISHED (AI continues cruising if finished)
    if (this.phase === 'RACING') {
      this.raceElapsedMs += dt * 1000;
      this.currentLapMs += dt * 1000;
      this.updateGantryLights(0);
    }

    this.updatePlayerPhysics(dt);
    for (const actor of this.actors) {
      if (!actor.isPlayer) {
        this.updateRivalAI(actor, dt);
      }
    }
    this.resolveCarCollisions();

    for (const actor of this.actors) {
      this.updateLapProgress(actor);
      this.syncActorMesh(actor, dt);
    }

    this.updateParticles(dt);
    this.updateChaseCamera(dt);

    // Keep sun shadow camera centered near player
    this.sunLight.position.set(this.playerActor.x + 45, 75, this.playerActor.z + 35);
    this.sunLight.target.position.set(this.playerActor.x, 0, this.playerActor.z);
    this.sunLight.target.updateMatrixWorld();

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.065) {
      this.hudEmitAccum = 0;
      this.emitTelemetry();
    }
  }

  private updatePlayerPhysics(dt: number): void {
    const p = this.playerActor;
    const spec = p.carSpec;

    const throttle = (this.input.throttle || this.touchInput.throttle) && this.phase === 'RACING';
    const brake = (this.input.brake || this.touchInput.brake) && this.phase === 'RACING';
    const left = (this.input.left || this.touchInput.left) && this.phase === 'RACING';
    const right = (this.input.right || this.touchInput.right) && this.phase === 'RACING';
    const driftHeld = (this.input.drift || this.touchInput.drift) && this.phase === 'RACING';
    const nitroHeld = (this.input.nitro || this.touchInput.nitro) && this.phase === 'RACING';

    const baseTopSpeed = spec.topSpeedKmh / 4.14; // ~57 - 65 world units/s
    const nitroActive = nitroHeld && this.nitro > 2 && p.speed > 8 && throttle;
    if (nitroActive) {
      this.nitro = Math.max(0, this.nitro - dt * 28);
    } else {
      this.nitro = Math.min(100, this.nitro + dt * 5.5);
    }

    const effectiveTopSpeed = baseTopSpeed * (nitroActive ? spec.nitroPower : 1);
    const effectiveAccel = spec.acceleration * (nitroActive ? 1.48 : 1);

    if (throttle) {
      p.speed += effectiveAccel * dt;
    } else if (brake) {
      if (p.speed > 1.5) {
        p.speed -= spec.acceleration * 1.9 * dt;
      } else {
        p.speed -= spec.acceleration * 0.72 * dt;
      }
    } else {
      // Coasting engine drag
      p.speed *= Math.exp(-0.95 * dt);
    }

    // Clamp reverse & forward speeds
    p.speed = THREE.MathUtils.clamp(p.speed, -18, effectiveTopSpeed);

    // Steering input
    const steerInput = (left ? 1 : 0) - (right ? 1 : 0);
    p.steerAngle = THREE.MathUtils.damp(p.steerAngle, steerInput * 0.42, 12, dt);

    const speedFactor = THREE.MathUtils.clamp(Math.abs(p.speed) / 20, 0, 1);
    const reverseSign = p.speed >= -0.2 ? 1 : -1;
    const isDrifting = driftHeld && Math.abs(p.speed) > 18 && Math.abs(steerInput) > 0.1;

    const turnRate = spec.handling * (isDrifting ? 1.28 : 1.0) * speedFactor * reverseSign;
    p.heading = normalizeAngle(p.heading + steerInput * turnRate * dt);

    // Visual drift slip angle & drift nitro charging
    const targetSlip = isDrifting ? steerInput * 0.34 : 0;
    p.slipAngle = THREE.MathUtils.damp(p.slipAngle, targetSlip, 9, dt);

    if (isDrifting) {
      p.speed *= Math.exp(-0.35 * dt);
      this.nitro = Math.min(100, this.nitro + dt * 16);
      this.driftPoints += Math.round(dt * 120);
      this.spawnTireSmoke(p, false);
    }

    if (nitroActive) {
      this.spawnTireSmoke(p, true);
    }

    // Move along heading
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    p.x += fx * p.speed * dt;
    p.z += fz * p.speed * dt;

    // Project onto track for kerb rumble, off-track drag, and barrier bounce
    const proj = this.builtTrack.projectPoint(p.x, p.z, p.nearestIdx);
    p.nearestIdx = proj.nearestIdx;
    p.arcProgress = proj.arcProgress;

    const halfW = this.builtTrack.spec.roadWidth * 0.5;
    const maxAllowed = halfW + 2.05;

    if (proj.absOffset > halfW && proj.absOffset <= halfW + 1.45) {
      // Riding over FIA kerb -> subtle chassis vibration
      this.camShake = Math.max(this.camShake, 0.08 * speedFactor);
    } else if (proj.absOffset > halfW + 1.45) {
      // Off-tarmac grass/gravel slowdown
      p.speed *= Math.exp(-1.8 * dt);
    }

    if (proj.absOffset > maxAllowed) {
      // Clamp cleanly inside outer barrier and realign slightly along track
      const sign = proj.signedOffset >= 0 ? 1 : -1;
      const nx = -proj.tangentZ;
      const nz = proj.tangentX;
      p.x = proj.closestX + nx * sign * maxAllowed;
      p.z = proj.closestZ + nz * sign * maxAllowed;

      if (Math.abs(p.speed) > 10) {
        this.sound.playCollision(Math.abs(p.speed) / 60);
        this.camShake = Math.max(this.camShake, 0.25);
      }
      p.speed *= 0.62;
      const trackYaw = Math.atan2(proj.tangentX, proj.tangentZ);
      const diff = normalizeAngle(trackYaw - p.heading);
      p.heading = normalizeAngle(p.heading + diff * 0.45);
    }

    // Update brake light intensity & nitro flames
    p.mesh.brakeLightMat.emissiveIntensity = brake ? 3.4 : 1.05;
    const flameVisible = nitroActive;
    p.mesh.nitroFlames.forEach((f) => {
      f.visible = flameVisible;
      if (flameVisible) {
        f.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      }
    });

    // Audio synth update
    const kmh = Math.abs(p.speed) * 4.14;
    const speedRatio = THREE.MathUtils.clamp(kmh / spec.topSpeedKmh, 0, 1.15);
    const gear = Math.min(6, Math.max(1, Math.floor(speedRatio * 5.6) + 1));
    const gearSpan = 1 / 6;
    const rpmNorm = THREE.MathUtils.clamp(
      ((speedRatio % gearSpan) / gearSpan) * 0.72 + (throttle ? 0.28 : 0.08),
      0.15,
      1.0
    );

    this.sound.updateDrive(
      this.phase === 'RACING',
      rpmNorm,
      speedRatio,
      isDrifting ? 1 : 0,
      nitroActive
    );
  }

  private updateRivalAI(actor: VehicleActor, dt: number): void {
    const spec = actor.carSpec;
    actor.aiLaneTimer -= dt;
    if (actor.aiLaneTimer <= 0) {
      actor.aiLaneTimer = 2.5 + Math.random() * 2.5;
      actor.aiLaneOffset = (Math.random() - 0.5) * (this.builtTrack.spec.roadWidth * 0.6);
    }

    // Look ahead along track spline
    const lookAheadT = (actor.arcProgress + 0.032) % 1;
    const farLookAheadT = (actor.arcProgress + 0.075) % 1;
    const target = this.builtTrack.sampleAtProgress(lookAheadT, actor.aiLaneOffset);
    const farTarget = this.builtTrack.sampleAtProgress(farLookAheadT, actor.aiLaneOffset);

    const dx = target.x - actor.x;
    const dz = target.z - actor.z;
    const desiredHeading = Math.atan2(dx, dz);
    const headingErr = normalizeAngle(desiredHeading - actor.heading);

    // Cornering slowdown factor based on upcoming angle
    const cornerDelta = Math.abs(normalizeAngle(farTarget.yaw - target.yaw));
    const cornerFactor = THREE.MathUtils.clamp(1 - cornerDelta * 0.65, 0.58, 1.0);

    // Slight rubber-banding so races stay engaging without unfair teleporting
    const gap = this.playerActor.progressScore - actor.progressScore;
    const rubberBand = THREE.MathUtils.clamp(1 + gap * 0.22, 0.88, 1.12);

    const maxSpeed = (spec.topSpeedKmh / 4.14) * actor.aiBasePace * cornerFactor * rubberBand;
    if (actor.speed < maxSpeed) {
      actor.speed += spec.acceleration * 0.88 * dt;
    } else {
      actor.speed -= spec.acceleration * 0.8 * dt;
    }
    actor.speed = THREE.MathUtils.clamp(actor.speed, 0, maxSpeed);

    const steerCmd = THREE.MathUtils.clamp(headingErr * 2.4, -1, 1);
    actor.steerAngle = THREE.MathUtils.damp(actor.steerAngle, steerCmd * 0.36, 10, dt);
    actor.heading = normalizeAngle(actor.heading + steerCmd * spec.handling * 0.95 * dt);

    actor.x += Math.sin(actor.heading) * actor.speed * dt;
    actor.z += Math.cos(actor.heading) * actor.speed * dt;

    const proj = this.builtTrack.projectPoint(actor.x, actor.z, actor.nearestIdx);
    actor.nearestIdx = proj.nearestIdx;
    actor.arcProgress = proj.arcProgress;

    const maxAllowed = this.builtTrack.spec.roadWidth * 0.5 + 1.2;
    if (proj.absOffset > maxAllowed) {
      const sign = proj.signedOffset >= 0 ? 1 : -1;
      const nx = -proj.tangentZ;
      const nz = proj.tangentX;
      actor.x = proj.closestX + nx * sign * maxAllowed;
      actor.z = proj.closestZ + nz * sign * maxAllowed;
    }
  }

  private resolveCarCollisions(): void {
    const minDist = 2.65;
    for (let i = 0; i < this.actors.length; i++) {
      for (let j = i + 1; j < this.actors.length; j++) {
        const a = this.actors[i];
        const b = this.actors[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 0.0001 && distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x -= nx * overlap;
          a.z -= nz * overlap;
          b.x += nx * overlap;
          b.z += nz * overlap;

          if (a.isPlayer || b.isPlayer) {
            const relSpeed = Math.abs(a.speed - b.speed);
            if (relSpeed > 4) {
              this.sound.playCollision(relSpeed / 40);
              this.camShake = Math.max(this.camShake, 0.16);
            }
          }
          a.speed *= 0.94;
          b.speed *= 0.94;
        }
      }
    }
  }

  private updateLapProgress(actor: VehicleActor): void {
    if (actor.finished) return;

    // Pass halfway checkpoint between 0.35 and 0.65
    if (actor.arcProgress > 0.35 && actor.arcProgress < 0.65) {
      actor.checkpointHalf = true;
    }

    // Crossing start/finish line forward (from > 0.78 to < 0.22)
    if (actor.lastArcProgress > 0.78 && actor.arcProgress < 0.22) {
      if (actor.checkpointHalf) {
        actor.checkpointHalf = false;
        if (actor.isPlayer) {
          const lapDuration = this.currentLapMs;
          this.lastLapMs = lapDuration;
          if (this.bestLapMs === null || lapDuration < this.bestLapMs) {
            this.bestLapMs = lapDuration;
          }
          this.currentLapMs = 0;
        }

        if (actor.lap >= this.builtTrack.spec.laps) {
          actor.finished = true;
          actor.finishTimeMs = this.raceElapsedMs;
          actor.progressScore = actor.lap + 1.0;
          if (actor.isPlayer && this.phase === 'RACING') {
            this.phase = 'FINISHED';
            this.sound.playLapChime(true);
            this.sound.updateDrive(false, 0, 0, 0, false);
            this.emitTelemetry();
          }
        } else {
          actor.lap += 1;
          if (actor.isPlayer) {
            this.sound.playLapChime(false);
          }
        }
      }
    }

    actor.lastArcProgress = actor.arcProgress;
    if (!actor.finished) {
      // Before crossing start line on Lap 1, arcProgress is ~0.98 so score is negative
      const adjustedArc = actor.lap === 1 && !actor.checkpointHalf && actor.arcProgress > 0.85
        ? actor.arcProgress - 1
        : actor.arcProgress;
      actor.progressScore = actor.lap - 1 + adjustedArc;
    }
  }

  private syncActorMesh(actor: VehicleActor, dt: number): void {
    actor.mesh.root.position.set(actor.x, 0, actor.z);
    actor.mesh.root.rotation.y = actor.heading + Math.PI + actor.slipAngle;

    // Spin wheels proportionally to forward distance
    actor.wheelSpin -= (actor.speed * dt) / 0.36;
    for (const pivot of actor.mesh.frontWheelPivots) {
      pivot.rotation.y = actor.steerAngle;
    }
    for (const w of actor.mesh.wheels) {
      w.rotation.x = actor.wheelSpin;
    }
  }

  private spawnTireSmoke(actor: VehicleActor, isNitro: boolean): void {
    const p = this.smokePool[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % this.smokePool.length;

    const backX = -Math.sin(actor.heading) * 1.9;
    const backZ = -Math.cos(actor.heading) * 1.9;
    const side = (Math.random() - 0.5) * 1.3;
    const rightX = Math.cos(actor.heading) * side;
    const rightZ = -Math.sin(actor.heading) * side;

    p.active = true;
    p.x = actor.x + backX + rightX;
    p.y = isNitro ? 0.34 : 0.22;
    p.z = actor.z + backZ + rightZ;
    p.vx = (Math.random() - 0.5) * 1.6;
    p.vy = isNitro ? 0.6 : 1.3 + Math.random() * 0.9;
    p.vz = (Math.random() - 0.5) * 1.6;
    p.age = 0;
    p.life = isNitro ? 0.24 : 0.48;
    p.scale = isNitro ? 0.45 : 0.65;
    p.isNitro = isNitro;
  }

  private updateParticles(dt: number): void {
    let anyDirty = false;
    for (let i = 0; i < this.smokePool.length; i++) {
      const p = this.smokePool[i];
      if (!p.active) continue;
      anyDirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.set(0.001, 0.001, 0.001);
        _dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      const s = p.scale * (1 + t * 1.8) * (1 - t * 0.65);

      _dummy.position.set(p.x, p.y, p.z);
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, _dummy.matrix);

      _smokeColor.set(p.isNitro ? '#38BDF8' : '#CBD5E1');
      this.smokeMesh.setColorAt(i, _smokeColor);
    }

    if (anyDirty) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
      if (this.smokeMesh.instanceColor) {
        this.smokeMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private positionGarageShowcaseCamera(snapImmediate: boolean, dt = 0.016): void {
    const car = this.playerActor;
    const radius = 7.4;
    const targetX = car.x + Math.sin(this.showcaseAngle) * radius;
    const targetZ = car.z + Math.cos(this.showcaseAngle) * radius;
    const targetY = 2.45;

    if (snapImmediate) {
      this.camera.position.set(targetX, targetY, targetZ);
    } else {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, targetX, 6, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, targetY, 6, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, targetZ, 6, dt);
    }
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 54, 6, dt);
    this.camera.updateProjectionMatrix();
    // Offset lookAt slightly left/down so car sits cleanly beside Garage HUD
    this.camera.lookAt(car.x, 0.72, car.z);
  }

  private updateChaseCamera(dt: number): void {
    const p = this.playerActor;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);

    let dist = 8.4;
    let height = 3.35;
    let lookAhead = 7.0;
    let baseFov = 62;

    if (this.cameraMode === 'CLOSE') {
      dist = 6.2;
      height = 2.4;
      lookAhead = 9.0;
      baseFov = 65;
    } else if (this.cameraMode === 'HOOD') {
      dist = -0.35;
      height = 1.42;
      lookAhead = 18.0;
      baseFov = 70;
    }

    this.camShake = Math.max(0, this.camShake - dt * 1.4);
    const shakeX = (Math.random() - 0.5) * this.camShake;
    const shakeY = (Math.random() - 0.5) * this.camShake * 0.6;

    _vec3A.set(p.x - fx * dist + shakeX, height + shakeY, p.z - fz * dist);
    const dampRate = this.cameraMode === 'HOOD' ? 28 : 9.5;

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _vec3A.x, dampRate, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _vec3A.y, dampRate, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _vec3A.z, dampRate, dt);

    _vec3B.set(p.x + fx * lookAhead, this.cameraMode === 'HOOD' ? 1.25 : 1.15, p.z + fz * lookAhead);
    this.camera.lookAt(_vec3B);

    // Dynamic speed FOV widening
    const speedRatio = THREE.MathUtils.clamp((Math.abs(p.speed) * 4.14) / p.carSpec.topSpeedKmh, 0, 1.3);
    const targetFov = baseFov + speedRatio * 14;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
    this.camera.updateProjectionMatrix();
  }

  private emitTelemetry(): void {
    const p = this.playerActor;
    const kmh = Math.round(Math.abs(p.speed) * 4.14);
    const speedRatio = THREE.MathUtils.clamp(kmh / p.carSpec.topSpeedKmh, 0, 1.15);
    const gear = kmh < 3 ? 1 : Math.min(6, Math.max(1, Math.floor(speedRatio * 5.6) + 1));
    const gearSpan = 1 / 6;
    const rpmNormalized = THREE.MathUtils.clamp(
      ((speedRatio % gearSpan) / gearSpan) * 0.78 + 0.16,
      0.12,
      1
    );

    const sorted = [...this.actors].sort((a, b) => {
      if (a.finished && b.finished) {
        return (a.finishTimeMs ?? 0) - (b.finishTimeMs ?? 0);
      }
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progressScore - a.progressScore;
    });

    const position = sorted.findIndex((a) => a.isPlayer) + 1;
    const proj = this.builtTrack.projectPoint(p.x, p.z, p.nearestIdx);
    const dot = Math.sin(p.heading) * proj.tangentX + Math.cos(p.heading) * proj.tangentZ;
    const wrongWay = this.phase === 'RACING' && p.speed > 6 && dot < -0.4;

    const minimapCars: MinimapCar[] = this.actors.map((a) => ({
      x: a.x,
      z: a.z,
      yaw: a.heading,
      isPlayer: a.isPlayer,
      color: a.carSpec.colorHex,
    }));

    const standings: RaceStanding[] = sorted.map((a) => ({
      id: a.id,
      name: a.name,
      carName: a.carSpec.name,
      isPlayer: a.isPlayer,
      finishTimeMs: a.finishTimeMs,
      progressScore: a.progressScore,
      color: a.carSpec.colorHex,
    }));

    const nitroHeld = this.input.nitro || this.touchInput.nitro;
    const throttle = this.input.throttle || this.touchInput.throttle;
    const isNitroActive = this.phase === 'RACING' && nitroHeld && this.nitro > 2 && p.speed > 8 && throttle;
    const isDrifting =
      this.phase === 'RACING' &&
      (this.input.drift || this.touchInput.drift) &&
      Math.abs(p.speed) > 18 &&
      (this.input.left || this.input.right || this.touchInput.left || this.touchInput.right);

    this.onTelemetry({
      phase: this.phase,
      speedKmh: kmh,
      rpmNormalized,
      gear,
      nitro: Math.round(this.nitro),
      isNitroActive,
      isDrifting,
      driftPoints: this.driftPoints,
      lap: p.lap,
      totalLaps: this.builtTrack.spec.laps,
      position,
      totalCars: this.actors.length,
      currentLapMs: this.currentLapMs,
      bestLapMs: this.bestLapMs,
      lastLapMs: this.lastLapMs,
      totalRaceMs: this.raceElapsedMs,
      countdownSeconds: Math.max(0, Math.ceil(this.countdownTimer)),
      wrongWay,
      minimapCars,
      standings,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLostHandler);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.contextRestoredHandler);

    this.sound.dispose();
    this.builtTrack.dispose();
    this.contactShadowTex.dispose();
    this.envRT.dispose();
    this.smokeMesh.geometry.dispose();
    (this.smokeMesh.material as THREE.Material).dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
