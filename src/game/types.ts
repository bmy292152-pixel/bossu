export type GamePhase = 'GARAGE' | 'COUNTDOWN' | 'RACING' | 'PAUSED' | 'FINISHED';

export type GameMode = 'RACE' | 'TIME_TRIAL';

export type CameraMode = 'CHASE' | 'CLOSE' | 'HOOD';

export type CarBodyStyle = 'coupe' | 'prototype' | 'muscle';

export interface CarSpec {
  id: string;
  name: string;
  category: string;
  bodyStyle: CarBodyStyle;
  colorHex: string;
  accentHex: string;
  topSpeedKmh: number;
  acceleration: number; // world units / s^2
  handling: number; // rad/s base turn rate
  driftGrip: number;
  nitroPower: number;
  stats: {
    speed: number; // 0-100
    accel: number; // 0-100
    handling: number; // 0-100
  };
}

export type TrackTheme = 'alpine' | 'canyon' | 'midnight';

export interface TrackSpec {
  id: string;
  name: string;
  location: string;
  surfaceNote: string;
  theme: TrackTheme;
  laps: number;
  roadWidth: number;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  groundColor: string;
  groundAccent: string;
  kerbPrimary: string;
  kerbSecondary: string;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  controlPoints: [number, number, number][];
}

export interface MinimapCar {
  x: number;
  z: number;
  yaw: number;
  isPlayer: boolean;
  color: string;
}

export interface RaceStanding {
  id: string;
  name: string;
  carName: string;
  isPlayer: boolean;
  finishTimeMs: number | null;
  progressScore: number;
  color: string;
}

export interface TelemetrySnapshot {
  phase: GamePhase;
  speedKmh: number;
  rpmNormalized: number;
  gear: number;
  nitro: number; // 0 - 100
  isNitroActive: boolean;
  isDrifting: boolean;
  driftPoints: number;
  lap: number;
  totalLaps: number;
  position: number;
  totalCars: number;
  currentLapMs: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  totalRaceMs: number;
  countdownSeconds: number;
  wrongWay: boolean;
  minimapCars: MinimapCar[];
  standings: RaceStanding[];
}

export interface InputState {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  nitro: boolean;
}
