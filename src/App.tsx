import { useCallback, useEffect, useRef, useState } from 'react';
import { GarageOverlay } from './components/GarageOverlay';
import { RaceHud } from './components/RaceHud';
import { CAR_CATALOG, TRACK_CATALOG } from './game/catalog';
import { RaceEngine } from './game/RaceEngine';
import type {
  CameraMode,
  CarSpec,
  GameMode,
  InputState,
  TelemetrySnapshot,
  TrackSpec,
} from './game/types';

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  phase: 'GARAGE',
  speedKmh: 0,
  rpmNormalized: 0.15,
  gear: 1,
  nitro: 100,
  isNitroActive: false,
  isDrifting: false,
  driftPoints: 0,
  lap: 1,
  totalLaps: 3,
  position: 4,
  totalCars: 4,
  currentLapMs: 0,
  bestLapMs: null,
  lastLapMs: null,
  totalRaceMs: 0,
  countdownSeconds: 3,
  wrongWay: false,
  minimapCars: [],
  standings: [],
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RaceEngine | null>(null);

  const [selectedCar, setSelectedCar] = useState<CarSpec>(CAR_CATALOG[0]);
  const [selectedTrack, setSelectedTrack] = useState<TrackSpec>(TRACK_CATALOG[0]);
  const [mode, setMode] = useState<GameMode>('RACE');
  const [cameraMode, setCameraMode] = useState<CameraMode>('CHASE');
  const [muted, setMuted] = useState(false);
  const [webglLost, setWebglLost] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(INITIAL_TELEMETRY);
  const [minimapPath, setMinimapPath] = useState<{ x: number; z: number }[]>([]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new RaceEngine(
      container,
      (snap) => {
        setTelemetry(snap);
      },
      (lost) => {
        setWebglLost(lost);
      }
    );
    engineRef.current = engine;
    setMinimapPath(engine.getTrackMinimapPath());

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Sync camera badge if player presses 'C'
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyC') {
        setCameraMode((prev) => {
          const order: CameraMode[] = ['CHASE', 'CLOSE', 'HOOD'];
          return order[(order.indexOf(prev) + 1) % order.length];
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSelectCar = useCallback((car: CarSpec) => {
    setSelectedCar(car);
    engineRef.current?.setCar(car);
  }, []);

  const handleSelectTrack = useCallback((track: TrackSpec) => {
    setSelectedTrack(track);
    if (engineRef.current) {
      engineRef.current.setTrack(track);
      setMinimapPath(engineRef.current.getTrackMinimapPath());
    }
  }, []);

  const handleSelectMode = useCallback((nextMode: GameMode) => {
    setMode(nextMode);
    engineRef.current?.setMode(nextMode);
  }, []);

  const handleSelectCamera = useCallback((cam: CameraMode) => {
    setCameraMode(cam);
    engineRef.current?.setCameraMode(cam);
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      engineRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const handleStartRace = useCallback(() => {
    engineRef.current?.startRace();
  }, []);

  const handleTogglePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleResetCar = useCallback(() => {
    engineRef.current?.resetCarToTrack();
  }, []);

  const handleReturnGarage = useCallback(() => {
    engineRef.current?.returnToGarage();
  }, []);

  const handleTouchInput = useCallback((partial: Partial<InputState>) => {
    engineRef.current?.setTouchInput(partial);
  }, []);

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#0B0F17]">
      {/* Dedicated Isolated WebGL Container */}
      <div
        ref={mountRef}
        className="w-full h-full"
        aria-label="3D racing track viewport"
      />

      {/* Graceful WebGL Context Loss Fallback */}
      {webglLost && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#0B0F17] p-6 text-center">
          <div className="max-w-sm border border-white/15 bg-[#121824] rounded-xl p-6 space-y-2">
            <h2
              className="text-lg font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Graphics Context Interrupted
            </h2>
            <p className="text-sm text-slate-300">
              Your browser temporarily suspended WebGL rendering. Waiting for recovery or reload the page to resume racing.
            </p>
          </div>
        </div>
      )}

      {telemetry.phase === 'GARAGE' ? (
        <GarageOverlay
          selectedCar={selectedCar}
          selectedTrack={selectedTrack}
          mode={mode}
          muted={muted}
          onSelectCar={handleSelectCar}
          onSelectTrack={handleSelectTrack}
          onSelectMode={handleSelectMode}
          onToggleMute={handleToggleMute}
          onStartRace={handleStartRace}
        />
      ) : (
        <RaceHud
          telemetry={telemetry}
          mode={mode}
          trackName={selectedTrack.name}
          minimapPath={minimapPath}
          cameraMode={cameraMode}
          muted={muted}
          onSelectCamera={handleSelectCamera}
          onToggleMute={handleToggleMute}
          onTogglePause={handleTogglePause}
          onResetCar={handleResetCar}
          onRestartRace={handleStartRace}
          onReturnGarage={handleReturnGarage}
          onTouchInput={handleTouchInput}
        />
      )}
    </main>
  );
}
