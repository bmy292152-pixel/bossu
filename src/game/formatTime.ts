export function formatLapTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return '--:--.--';
  }
  const totalCentis = Math.floor(ms / 10);
  const centis = totalCentis % 100;
  const totalSecs = Math.floor(totalCentis / 100);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60);

  const mStr = String(mins).padStart(2, '0');
  const sStr = String(secs).padStart(2, '0');
  const cStr = String(centis).padStart(2, '0');
  return `${mStr}:${sStr}.${cStr}`;
}
