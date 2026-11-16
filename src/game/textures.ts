import * as THREE from 'three';

function finalizeColorTexture(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createAsphaltTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base dark tarmac
  ctx.fillStyle = '#20242C';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle racing groove wear down center-ish lanes
  const grooveGrad = ctx.createLinearGradient(0, 0, 512, 0);
  grooveGrad.addColorStop(0, 'rgba(15, 17, 22, 0.22)');
  grooveGrad.addColorStop(0.22, 'rgba(10, 12, 16, 0.05)');
  grooveGrad.addColorStop(0.5, 'rgba(15, 17, 22, 0.18)');
  grooveGrad.addColorStop(0.78, 'rgba(10, 12, 16, 0.05)');
  grooveGrad.addColorStop(1, 'rgba(15, 17, 22, 0.22)');
  ctx.fillStyle = grooveGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Aggregate tarmac speckle
  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const shade = 26 + Math.floor(Math.random() * 28);
    ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 6})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Solid crisp white track boundary lines
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(14, 0, 10, 512);
  ctx.fillRect(488, 0, 10, 512);

  // Dashed center lane divider
  ctx.fillStyle = 'rgba(241, 245, 249, 0.55)';
  for (let y = 24; y < 512; y += 128) {
    ctx.fillRect(252, y, 8, 64);
  }

  return finalizeColorTexture(canvas, anisotropy, 1, 1);
}

export function createKerbTexture(
  primary: string,
  secondary: string,
  anisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = secondary;
  ctx.fillRect(0, 128, 128, 128);

  // Slight tire scuff texture
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let i = 0; i < 300; i++) {
    ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 3);
  }

  return finalizeColorTexture(canvas, anisotropy, 1, 1);
}

export function createGroundTexture(
  baseHex: string,
  accentHex: string,
  isMidnight: boolean,
  anisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = accentHex;
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 1 + Math.random() * 4;
    ctx.fillRect(x, y, r, r);
  }

  if (isMidnight) {
    // Subtle urban paving grid
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.lineWidth = 2;
    for (let p = 0; p < 512; p += 64) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(512, p);
      ctx.stroke();
    }
  }

  return finalizeColorTexture(canvas, anisotropy, 36, 36);
}

export function createCheckeredTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const size = 32;
  for (let y = 0; y < 128; y += size) {
    for (let x = 0; x < 256; x += size) {
      const even = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = even ? '#F8FAFC' : '#0F172A';
      ctx.fillRect(x, y, size, size);
    }
  }

  return finalizeColorTexture(canvas, anisotropy, 2, 1);
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(128, 128, 22, 128, 128, 122);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.68)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
