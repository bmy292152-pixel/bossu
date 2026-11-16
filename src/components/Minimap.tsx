import { useMemo } from 'react';
import type { MinimapCar } from '../game/types';

interface MinimapProps {
  path: { x: number; z: number }[];
  cars: MinimapCar[];
}

export function Minimap({ path, cars }: MinimapProps) {
  const { pointsAttr, bounds } = useMemo(() => {
    if (path.length === 0) {
      return {
        pointsAttr: '',
        bounds: { minX: -150, maxX: 150, minZ: -120, maxZ: 120 },
      };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const pt of path) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }

    const pad = 22;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;

    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = 112 / Math.max(spanX, spanZ);
    const offX = (128 - spanX * scale) * 0.5;
    const offZ = (128 - spanZ * scale) * 0.5;

    const pts = path
      .map((pt) => {
        const sx = offX + (pt.x - minX) * scale;
        const sy = offZ + (pt.z - minZ) * scale;
        return `${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(' ');

    return {
      pointsAttr: pts,
      bounds: { minX, maxX, minZ, maxZ, scale, offX, offZ },
    };
  }, [path]);

  const toMapCoord = (x: number, z: number) => {
    const b = bounds as {
      minX: number;
      minZ: number;
      scale?: number;
      offX?: number;
      offZ?: number;
    };
    const s = b.scale ?? 0.35;
    const ox = b.offX ?? 8;
    const oz = b.offZ ?? 8;
    return {
      mx: ox + (x - b.minX) * s,
      my: oz + (z - b.minZ) * s,
    };
  };

  return (
    <div className="bg-[#0B0F17]/88 border border-white/10 rounded-lg p-2">
      <svg
        width="128"
        height="128"
        viewBox="0 0 128 128"
        aria-label="Circuit minimap"
        className="block"
      >
        {pointsAttr && (
          <>
            <polygon
              points={pointsAttr}
              fill="none"
              stroke="rgba(148, 163, 184, 0.25)"
              strokeWidth="6"
              strokeLinejoin="round"
            />
            <polygon
              points={pointsAttr}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </>
        )}

        {cars
          .filter((c) => !c.isPlayer)
          .map((car, idx) => {
            const { mx, my } = toMapCoord(car.x, car.z);
            return (
              <circle
                key={idx}
                cx={mx}
                cy={my}
                r="3.6"
                fill={car.color}
                stroke="#0B0F17"
                strokeWidth="1.2"
              />
            );
          })}

        {cars
          .filter((c) => c.isPlayer)
          .map((player, idx) => {
            const { mx, my } = toMapCoord(player.x, player.z);
            return (
              <g key={`p-${idx}`} transform={`translate(${mx}, ${my})`}>
                <circle r="5" fill="#F59E0B" stroke="#0B0F17" strokeWidth="1.6" />
              </g>
            );
          })}
      </svg>
    </div>
  );
}
