import { Volume2, VolumeX, Play } from 'lucide-react';
import { CAR_CATALOG, TRACK_CATALOG } from '../game/catalog';
import type { CarSpec, GameMode, TrackSpec } from '../game/types';

interface GarageOverlayProps {
  selectedCar: CarSpec;
  selectedTrack: TrackSpec;
  mode: GameMode;
  muted: boolean;
  onSelectCar: (car: CarSpec) => void;
  onSelectTrack: (track: TrackSpec) => void;
  onSelectMode: (mode: GameMode) => void;
  onToggleMute: () => void;
  onStartRace: () => void;
}

export function GarageOverlay({
  selectedCar,
  selectedTrack,
  mode,
  muted,
  onSelectCar,
  onSelectTrack,
  onSelectMode,
  onToggleMute,
  onStartRace,
}: GarageOverlayProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 md:p-6">
      {/* Top Bar: Clean 3-Zone Contract */}
      <header className="pointer-events-auto flex items-center justify-between gap-4 bg-[#0B0F17]/88 border border-white/10 rounded-xl px-5 py-3">
        <div className="flex items-center gap-6 min-w-0">
          <h1
            className="text-xl md:text-2xl font-bold tracking-tight text-white whitespace-nowrap shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Veloce GT
          </h1>
          <span className="hidden sm:inline text-xs text-slate-400 whitespace-nowrap truncate">
            {selectedTrack.name} · {selectedTrack.location}
          </span>
        </div>

        {/* Mode Segmented Toggle */}
        <div
          className="flex items-center gap-1 bg-[#141A26] p-1 rounded-lg border border-white/10 shrink-0"
          role="group"
          aria-label="Race mode"
        >
          <button
            type="button"
            onClick={() => onSelectMode('RACE')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'RACE'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Grand Prix
          </button>
          <button
            type="button"
            onClick={() => onSelectMode('TIME_TRIAL')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'TIME_TRIAL'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Time Trial
          </button>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#141A26] border border-white/10 text-slate-200 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onStartRace}
            className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            Start Race
          </button>
        </div>
      </header>

      {/* Bottom Consolidated Garage Dock (Center Viewport Remains 100% Open) */}
      <section
        aria-label="Car and circuit selection"
        className="pointer-events-auto mx-auto w-full max-w-[960px] bg-[#0B0F17]/90 border border-white/10 rounded-xl p-4 md:p-5"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-end">
          {/* Vehicle Selector */}
          <div className="lg:col-span-6 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-400">Select Vehicle</span>
              <span className="text-xs text-slate-300 tabular-nums">
                {selectedCar.category} · {selectedCar.topSpeedKmh} km/h
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {CAR_CATALOG.map((car) => {
                const active = car.id === selectedCar.id;
                return (
                  <button
                    key={car.id}
                    type="button"
                    onClick={() => onSelectCar(car)}
                    className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#172030] border-amber-500/80 text-white'
                        : 'bg-[#121824] border-white/10 text-slate-300 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-3 h-3 rounded-xs shrink-0"
                        style={{ backgroundColor: car.colorHex }}
                        aria-hidden="true"
                      />
                      <span
                        className="text-xs font-bold truncate"
                        style={{ fontFamily: 'var(--font-display)' }}
                      >
                        {car.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {car.category}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Clean Spec Bars */}
            <div className="grid grid-cols-3 gap-3 pt-1">
              {[
                { label: 'Top Speed', val: selectedCar.stats.speed },
                { label: 'Accel', val: selectedCar.stats.accel },
                { label: 'Handling', val: selectedCar.stats.handling },
              ].map((stat) => (
                <div key={stat.label} className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                    <span>{stat.label}</span>
                    <span className="text-slate-200 font-mono">{stat.val}</span>
                  </div>
                  <div className="h-1.5 w-full bg-[#1C2434] rounded-xs overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-200"
                      style={{ width: `${stat.val}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Circuit Selector */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-400">Select Circuit</span>
              <span className="text-xs text-slate-300">{selectedTrack.surfaceNote}</span>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {TRACK_CATALOG.map((track) => {
                const active = track.id === selectedTrack.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => onSelectTrack(track)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#172030] border-amber-500/80 text-white'
                        : 'bg-[#121824] border-white/10 text-slate-300 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    <span
                      className="text-xs font-bold whitespace-nowrap"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {track.name}
                    </span>
                    <span className="text-[11px] text-slate-400 whitespace-nowrap ml-2">
                      {track.location}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary Launch Action & Controls Summary */}
          <div className="lg:col-span-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={onStartRace}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Race
            </button>
            <p className="text-[11px] text-slate-400 text-center leading-snug">
              WASD / Arrows · Space Drift · Shift Nitro
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
