import { useEffect, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatLapTime } from '../game/formatTime';
import type {
  CameraMode,
  GameMode,
  InputState,
  TelemetrySnapshot,
} from '../game/types';
import { Minimap } from './Minimap';

interface RaceHudProps {
  telemetry: TelemetrySnapshot;
  mode: GameMode;
  trackName: string;
  minimapPath: { x: number; z: number }[];
  cameraMode: CameraMode;
  muted: boolean;
  onSelectCamera: (cam: CameraMode) => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onResetCar: () => void;
  onRestartRace: () => void;
  onReturnGarage: () => void;
  onTouchInput: (partial: Partial<InputState>) => void;
}

export function RaceHud({
  telemetry,
  mode,
  trackName,
  minimapPath,
  cameraMode,
  muted,
  onSelectCamera,
  onToggleMute,
  onTogglePause,
  onResetCar,
  onRestartRace,
  onReturnGarage,
  onTouchInput,
}: RaceHudProps) {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [touchVisible, setTouchVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const {
    phase,
    speedKmh,
    rpmNormalized,
    gear,
    nitro,
    isNitroActive,
    isDrifting,
    driftPoints,
    lap,
    totalLaps,
    position,
    totalCars,
    currentLapMs,
    bestLapMs,
    countdownSeconds,
    wrongWay,
    minimapCars,
    standings,
  } = telemetry;

  const isOverlayModal = phase === 'PAUSED' || phase === 'FINISHED';

  const makeTouchHandlers = (field: keyof InputState) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      onTouchInput({ [field]: true });
    },
    onPointerUp: () => onTouchInput({ [field]: false }),
    onPointerLeave: () => onTouchInput({ [field]: false }),
    onPointerCancel: () => onTouchInput({ [field]: false }),
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-3 md:p-5">
      {/* Top Row: Left Telemetry Strip + Right Minimap & Controls */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left Telemetry Card */}
        <div className="pointer-events-auto bg-[#0B0F17]/88 border border-white/10 rounded-xl px-4 py-3 min-w-[230px]">
          <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-2 mb-2">
            <div>
              <div className="text-[11px] font-medium text-slate-400">
                {mode === 'RACE' ? 'Position' : 'Session'}
              </div>
              <div
                className="text-2xl font-bold text-white tabular-nums leading-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {mode === 'RACE' ? `${position} / ${totalCars}` : 'Time Trial'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-medium text-slate-400">Lap</div>
              <div
                className="text-2xl font-bold text-amber-400 tabular-nums leading-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {lap} / {totalLaps}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
            <div>
              <div className="text-slate-400 text-[11px]">Current</div>
              <div className="font-mono font-semibold text-white">
                {formatLapTime(currentLapMs)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-slate-400 text-[11px]">Best Lap</div>
              <div className="font-mono font-semibold text-cyan-400">
                {formatLapTime(bestLapMs)}
              </div>
            </div>
          </div>

          <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
            <span>{trackName}</span>
            <span className="tabular-nums font-mono text-slate-300">
              Drift {driftPoints} pts
            </span>
          </div>
        </div>

        {/* Top-Right Minimap & Action Buttons */}
        <div className="pointer-events-auto flex items-start gap-2.5">
          <div className="hidden sm:block">
            <Minimap path={minimapPath} cars={minimapCars} />
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onTogglePause}
              aria-label="Pause race"
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#0B0F17]/88 border border-white/10 text-slate-200 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#0B0F17]/88 border border-white/10 text-slate-200 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Center Alerts: Countdown / Wrong Way / Pause / Finish */}
      <div className="flex-1 flex items-center justify-center pointer-events-none">
        {phase === 'COUNTDOWN' && (
          <div className="bg-[#0B0F17]/90 border border-white/15 rounded-2xl px-10 py-6 text-center">
            <div className="text-xs font-medium text-slate-400 mb-1">
              Get Ready
            </div>
            <div
              className="text-6xl md:text-7xl font-extrabold text-amber-400 tabular-nums"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {countdownSeconds > 0 ? countdownSeconds : 'GO'}
            </div>
          </div>
        )}

        {phase === 'RACING' && wrongWay && (
          <div className="bg-red-950/92 border border-red-500/60 rounded-xl px-6 py-3 text-center">
            <div
              className="text-lg font-bold text-red-200 tracking-wide"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Wrong Way · Turn Around
            </div>
          </div>
        )}

        {phase === 'PAUSED' && (
          <div className="pointer-events-auto w-full max-w-sm bg-[#0B0F17]/95 border border-white/15 rounded-2xl p-6 text-center space-y-5">
            <div>
              <h2
                className="text-2xl font-bold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Race Paused
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {trackName} · Lap {lap} of {totalLaps}
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onTogglePause}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Resume
              </button>
              <button
                type="button"
                onClick={onRestartRace}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#172030] hover:bg-[#1E293B] border border-white/10 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Restart Race
              </button>
              <button
                type="button"
                onClick={onReturnGarage}
                className="w-full px-4 py-2.5 rounded-lg bg-transparent hover:bg-white/5 border border-white/10 text-slate-300 text-sm font-medium transition-colors cursor-pointer"
              >
                Back to Garage
              </button>
            </div>
          </div>
        )}

        {phase === 'FINISHED' && (
          <div className="pointer-events-auto w-full max-w-md bg-[#0B0F17]/95 border border-white/15 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <div className="text-xs font-medium text-amber-400">
                  Checkered Flag
                </div>
                <h2
                  className="text-2xl font-bold text-white mt-0.5"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {mode === 'RACE' ? `Finished P${position}` : 'Session Complete'}
                </h2>
              </div>
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400">
                <Trophy className="w-5 h-5" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-[#121824] border border-white/10 rounded-lg p-3 text-xs tabular-nums">
              <div>
                <div className="text-slate-400">Total Time</div>
                <div className="font-mono font-bold text-white text-sm mt-0.5">
                  {formatLapTime(telemetry.totalRaceMs)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Best Lap</div>
                <div className="font-mono font-bold text-cyan-400 text-sm mt-0.5">
                  {formatLapTime(bestLapMs)}
                </div>
              </div>
            </div>

            {mode === 'RACE' && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-400">
                  Race Standings
                </div>
                <div className="divide-y divide-white/10 border border-white/10 rounded-lg overflow-hidden">
                  {standings.map((row, idx) => (
                    <div
                      key={row.id}
                      className={`flex items-center justify-between px-3 py-2 text-xs ${
                        row.isPlayer ? 'bg-amber-500/12 text-white' : 'bg-[#121824] text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono font-bold text-slate-400 w-4 tabular-nums">
                          {idx + 1}.
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: row.color }}
                          aria-hidden="true"
                        />
                        <span className="font-semibold truncate">
                          {row.name}
                        </span>
                        <span className="text-slate-400 truncate hidden sm:inline">
                          · {row.carName}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-200 ml-2 shrink-0">
                        {row.finishTimeMs !== null
                          ? formatLapTime(row.finishTimeMs)
                          : 'Running'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onRestartRace}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Race Again
              </button>
              <button
                type="button"
                onClick={onReturnGarage}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#172030] hover:bg-[#1E293B] border border-white/10 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                Back to Garage
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Touch Driving Controls (Optional / Mobile) */}
      {touchVisible && !isOverlayModal && (
        <div className="pointer-events-none flex items-end justify-between gap-4 pb-2">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              {...makeTouchHandlers('left')}
              className="w-16 h-14 rounded-xl bg-[#0B0F17]/88 border border-white/15 active:bg-amber-500 active:text-slate-950 text-white font-bold text-sm"
            >
              Left
            </button>
            <button
              type="button"
              {...makeTouchHandlers('right')}
              className="w-16 h-14 rounded-xl bg-[#0B0F17]/88 border border-white/15 active:bg-amber-500 active:text-slate-950 text-white font-bold text-sm"
            >
              Right
            </button>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              {...makeTouchHandlers('drift')}
              className="px-3.5 h-14 rounded-xl bg-[#0B0F17]/88 border border-white/15 active:bg-slate-200 active:text-slate-950 text-slate-200 font-semibold text-xs"
            >
              Drift
            </button>
            <button
              type="button"
              {...makeTouchHandlers('nitro')}
              className="px-3.5 h-14 rounded-xl bg-cyan-950/90 border border-cyan-500/50 active:bg-cyan-400 active:text-slate-950 text-cyan-200 font-bold text-xs"
            >
              Nitro
            </button>
            <button
              type="button"
              {...makeTouchHandlers('brake')}
              className="w-16 h-14 rounded-xl bg-red-950/90 border border-red-500/40 active:bg-red-500 text-red-100 font-bold text-xs"
            >
              Brake
            </button>
            <button
              type="button"
              {...makeTouchHandlers('throttle')}
              className="w-16 h-14 rounded-xl bg-amber-500 active:bg-amber-400 text-slate-950 font-bold text-sm"
            >
              Gas
            </button>
          </div>
        </div>
      )}

      {/* Bottom Row: Collapsible Control Dock + Speedometer */}
      <div className="flex items-end justify-between gap-4">
        {/* Left Spacer on desktop so dock centers cleanly */}
        <div className="hidden lg:block w-[220px]" />

        {/* Collapsible Bottom Control Dock */}
        <div className="pointer-events-auto flex flex-col items-center mx-auto">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-t-lg bg-[#0B0F17]/88 border border-b-0 border-white/10 text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                Show Controls
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                Hide Controls
              </>
            )}
          </button>

          {!dockCollapsed && (
            <div className="flex flex-wrap items-center justify-center gap-2 bg-[#0B0F17]/88 border border-white/10 rounded-xl px-3.5 py-2">
              <div className="flex items-center gap-1 bg-[#141A26] p-1 rounded-lg border border-white/10">
                <Camera className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1" />
                {(['CHASE', 'CLOSE', 'HOOD'] as CameraMode[]).map((cam) => (
                  <button
                    key={cam}
                    type="button"
                    onClick={() => onSelectCamera(cam)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      cameraMode === cam
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {cam === 'CHASE' ? 'Chase' : cam === 'CLOSE' ? 'Close' : 'Hood'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onResetCar}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141A26] border border-white/10 text-[11px] font-semibold text-slate-200 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Car
              </button>

              <button
                type="button"
                onClick={() => setTouchVisible((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  touchVisible
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-[#141A26] border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <Gamepad2 className="w-3.5 h-3.5" />
                Touch Pad
              </button>

              <span className="hidden md:inline text-[11px] text-slate-400 pl-1 whitespace-nowrap">
                WASD / Arrows · Space Drift · Shift Nitro · C Cam
              </span>
            </div>
          )}
        </div>

        {/* Bottom-Right Speedometer & Nitro HUD */}
        <div className="pointer-events-auto bg-[#0B0F17]/88 border border-white/10 rounded-xl px-4 py-3 min-w-[200px] md:min-w-[220px]">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-4xl font-extrabold text-white tabular-nums leading-none"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {speedKmh}
              </span>
              <span className="text-xs font-semibold text-slate-400">km/h</span>
            </div>

            <div className="text-right">
              <span className="text-[11px] text-slate-400 mr-1">Gear</span>
              <span
                className="text-xl font-bold text-amber-400 tabular-nums"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {gear}
              </span>
            </div>
          </div>

          {/* RPM Bar */}
          <div className="mt-2.5 space-y-1.5">
            <div className="h-1.5 w-full bg-[#182030] rounded-xs overflow-hidden">
              <div
                className={`h-full transition-all duration-75 ${
                  rpmNormalized > 0.86 ? 'bg-red-500' : 'bg-amber-400'
                }`}
                style={{ width: `${Math.round(rpmNormalized * 100)}%` }}
              />
            </div>

            {/* Nitro Boost Bar */}
            <div className="flex items-center justify-between text-[11px] tabular-nums">
              <span className={isNitroActive ? 'text-cyan-300 font-semibold' : 'text-slate-400'}>
                {isNitroActive ? 'Nitro Active' : isDrifting ? 'Drifting · +Nitro' : 'Nitro'}
              </span>
              <span className="font-mono text-cyan-300">{nitro}%</span>
            </div>
            <div className="h-1.5 w-full bg-[#182030] rounded-xs overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-75"
                style={{ width: `${nitro}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
