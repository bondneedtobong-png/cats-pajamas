// Silk из react-bits (MIT, DavidHDev/react-bits) — текучая ткань/атлас.
// Шейдер скопирован как есть, а вот обвязка переписана: оригинал тянет
// three + @react-three/fiber (~150 КБ gzip ради одной плоскости), здесь тот же
// шейдер крутится на ogl (~10 КБ), который уже нужен Aurora и Prism.
// Цвет — фирменный «дополнительный» #371931 из логобука (стр. 29), а не
// дефолтный серо-фиолетовый reactbits.
import { useEffect, useRef } from 'react';
import { mountGL, hexToRGB } from './glHost.js';

const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform float uTime;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;
uniform vec2  uResolution;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2  r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  vec2  vUv        = gl_FragCoord.xy / uResolution;
  float rnd        = noise(gl_FragCoord.xy);
  vec2  uv         = rotateUvs(vUv * uScale, uRotation);
  vec2  tex        = uv * uScale;
  float tOffset    = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;
  col.a = 1.0;
  gl_FragColor = col;
}
`;

export default function SilkBg({
  color = '#371931',   // логобук стр. 29, «дополнительный»
  speed = 3.2,         // медленнее дефолтных 5 — бар, а не заставка
  scale = 1.1,
  rotation = 0.15,
  noiseIntensity = 1.2,
}) {
  const ref = useRef(null);

  useEffect(() => {
    return mountGL(ref.current, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: hexToRGB(color) },
        uSpeed: { value: speed },
        uScale: { value: scale },
        uRotation: { value: rotation },
        uNoiseIntensity: { value: noiseIntensity },
        uResolution: { value: [1, 1] },
      },
      onFrame: (program, dt) => { program.uniforms.uTime.value += dt; },
    });
  }, [color, speed, scale, rotation, noiseIntensity]);

  return <div ref={ref} className="labbg" aria-hidden="true" />;
}
