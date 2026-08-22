// Общая обвязка для WebGL-фонов витрины (src/lab): создать рендерер ogl,
// держать размер, крутить кадры — и, главное, вести себя прилично:
//   • prefers-reduced-motion — рисуем ОДИН кадр и останавливаемся (правило
//     доступности из CLAUDE.md, единственное оставшееся жёсткое);
//   • секция уехала с экрана или вкладку свернули — цикл на паузу, чтобы
//     фон не жёг батарею, пока его никто не видит;
//   • на выходе гасим контекст (WEBGL_lose_context): у браузера лимит на
//     число живых WebGL-контекстов, а вариантов на витрине несколько.
import { Renderer, Triangle, Program, Mesh } from 'ogl';

export function mountGL(container, { vertex, fragment, uniforms, onFrame, onResize, dpr = [1, 2] }) {
  const renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, dpr[1]) });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  gl.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  container.appendChild(gl.canvas);

  const geometry = new Triangle(gl);
  const program = new Program(gl, { vertex, fragment, uniforms });
  const mesh = new Mesh(gl, { geometry, program });

  const resize = () => {
    const w = container.offsetWidth || 1;
    const h = container.offsetHeight || 1;
    renderer.setSize(w, h);
    if (program.uniforms.uResolution) program.uniforms.uResolution.value = [w, h];
    if (program.uniforms.iResolution) program.uniforms.iResolution.value = [w, h];
    onResize?.(program, gl, w, h); // шейдеру может быть нужен размер буфера, а не CSS-пиксели
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let running = false;
  let last = performance.now();

  const draw = (t) => {
    const dt = Math.min((t - last) / 1000, 1 / 20); // после паузы не прыгаем во времени
    last = t;
    onFrame?.(program, dt, t);
    renderer.render({ scene: mesh });
  };

  const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };

  const start = () => {
    if (running || still) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  draw(performance.now()); // первый кадр рисуем всегда — в т.ч. при reduced-motion
  start();

  // Пауза, когда фон не виден: вне экрана или вкладка в фоне.
  const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0 });
  io.observe(container);
  const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    stop();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', resize);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
  };
}

// '#B08900' → [0.69, 0.537, 0]
export function hexToRGB(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
