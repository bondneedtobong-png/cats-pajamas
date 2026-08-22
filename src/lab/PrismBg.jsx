// Prism из react-bits (MIT, DavidHDev/react-bits) — луч сквозь призму.
// Шейдер вендорнут в prismShader.js (единственная правка — uTint, см. там),
// обвязка своя: только режим 'rotate' (медленное покачивание), без hover/3d,
// плюс общий glHost с паузой вне экрана и reduced-motion.
//
// Радугу reactbits гасим до фирменной пары: uSaturation почти обесцвечивает
// спектр, uTint красит луч в золото #B08900 с сливовой тенью (логобук стр. 29).
import { useEffect, useRef } from 'react';
import { mountGL, hexToRGB } from './glHost.js';
import { PRISM_VERT, PRISM_FRAG } from './prismShader.js';

export default function PrismBg({
  height = 3.4,
  baseWidth = 5.6,
  glow = 0.30,
  noise = 0.22,
  scale = 3.4,
  colorFrequency = 0.7,
  bloom = 0.45,
  saturation = 0.30, // 1.5 в оригинале — там радуга
  hueShift = 0,
  timeScale = 0.28,  // «тихо и текуче»
  tint = '#B08900',  // золото логобука, чуть светлее для свечения
}) {
  const ref = useRef(null);

  useEffect(() => {
    const H = Math.max(0.001, height);
    const BASE_HALF = Math.max(0.001, baseWidth) * 0.5;

    return mountGL(ref.current, {
      vertex: PRISM_VERT,
      fragment: PRISM_FRAG,
      uniforms: {
        iResolution: { value: [1, 1] },
        iTime: { value: 0 },
        uHeight: { value: H },
        uBaseHalf: { value: BASE_HALF },
        uUseBaseWobble: { value: 1 }, // режим 'rotate' из оригинала
        uRot: { value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) },
        uGlow: { value: glow },
        uOffsetPx: { value: [0, 0] },
        uNoise: { value: noise },
        uSaturation: { value: saturation },
        uScale: { value: scale },
        uHueShift: { value: hueShift },
        uColorFreq: { value: colorFrequency },
        uBloom: { value: bloom },
        uCenterShift: { value: H * 0.25 },
        uInvBaseHalf: { value: 1 / BASE_HALF },
        uInvHeight: { value: 1 / H },
        uMinAxis: { value: Math.min(BASE_HALF, H) },
        uPxScale: { value: 1 / (100 * scale) },
        uTimeScale: { value: timeScale },
        uTint: { value: hexToRGB(tint) },
      },
      // Prism считает в пикселях буфера, а не в CSS-пикселях.
      onResize: (program, gl) => {
        program.uniforms.iResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
        program.uniforms.uPxScale.value = 1 / ((gl.drawingBufferHeight || 1) * 0.1 * scale);
      },
      onFrame: (program, dt) => { program.uniforms.iTime.value += dt; },
    });
  }, [height, baseWidth, glow, noise, scale, colorFrequency, bloom, saturation, hueShift, timeScale, tint]);

  return <div ref={ref} className="labbg" aria-hidden="true" />;
}
