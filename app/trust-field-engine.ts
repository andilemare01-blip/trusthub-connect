/**
 * Thousands of dots gather to spell one word, the way many small voices add up to a reputation.
 * A finger or cursor scatters them and they find their way back. Stops when off-screen or hidden.
 */
type Dot = { x: number; y: number; vx: number; vy: number; tx: number; ty: number; gold: boolean };

const WORD = "Trust";
const INK = "#dff3e8";
const GOLD = "#f2c14e";

function targets(width: number, height: number, family: string, step: number): { x: number; y: number }[] {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const narrow = width < 760;
  let size = narrow ? width * 0.36 : Math.min(width * 0.24, height * 0.52);
  context.font = `800 ${size}px ${family}`;
  const fit = (width * (narrow ? 0.9 : 0.7)) / context.measureText(WORD).width;
  size *= Math.min(fit, 1.6);
  context.font = `800 ${size}px ${family}`;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillStyle = "#fff";
  context.fillText(WORD, width / 2, height * (narrow ? 0.3 : 0.36));
  const pixels = context.getImageData(0, 0, width, height).data;
  const found: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) if (pixels[(y * width + x) * 4 + 3] > 128) found.push({ x, y });
  return found;
}

export function startTrustField(canvas: HTMLCanvasElement, family: string, reducedMotion: boolean): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  let dots: Dot[] = []; let width = 0; let height = 0; let frame = 0; let visible = true; let born = 0;
  const pointer = { x: -9999, y: -9999 };
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  function draw() {
    context!.clearRect(0, 0, width, height);
    const radius = width < 760 ? 1.15 : 1.35;
    for (const color of [INK, GOLD]) {
      context!.fillStyle = color;
      context!.beginPath();
      for (const dot of dots) {
        if (dot.gold !== (color === GOLD)) continue;
        context!.moveTo(dot.x + radius, dot.y);
        context!.arc(dot.x, dot.y, radius, 0, 6.2832);
      }
      context!.fill();
    }
  }

  function layout() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    const step = width < 760 ? 4 : 5;
    const points = targets(width, height, family, step);
    const previous = dots;
    dots = points.map((point, index) => {
      const old = previous[index];
      const angle = Math.random() * 6.2832, reach = Math.max(width, height) * (0.45 + Math.random() * 0.5);
      return { x: old?.x ?? width / 2 + Math.cos(angle) * reach, y: old?.y ?? height / 2 + Math.sin(angle) * reach, vx: 0, vy: 0, tx: point.x, ty: point.y, gold: old?.gold ?? Math.random() < 0.07 };
    });
    if (reducedMotion) { for (const dot of dots) { dot.x = dot.tx; dot.y = dot.ty; } draw(); }
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    if (!visible || document.hidden) return;
    born ||= now;
    // The opening pull starts soft, so the word seems to gather rather than snap.
    const pull = Math.min((now - born) / 2200, 1) * 0.022 + 0.004;
    const reach = width < 760 ? 70 : 120;
    for (const dot of dots) {
      const breath = Math.sin(now * 0.0012 + dot.tx * 0.03) * 0.012;
      dot.vx += (dot.tx - dot.x) * pull + breath; dot.vy += (dot.ty - dot.y) * pull + Math.cos(now * 0.001 + dot.ty * 0.03) * 0.012;
      const dx = dot.x - pointer.x, dy = dot.y - pointer.y, distance = dx * dx + dy * dy;
      if (distance < reach * reach && distance > 1) { const force = (1 - Math.sqrt(distance) / reach) * 2.6 / Math.sqrt(distance); dot.vx += dx * force; dot.vy += dy * force; }
      dot.vx *= 0.86; dot.vy *= 0.86; dot.x += dot.vx; dot.y += dot.vy;
    }
    draw();
  }

  const move = (event: PointerEvent) => { const box = canvas.getBoundingClientRect(); pointer.x = event.clientX - box.left; pointer.y = event.clientY - box.top; };
  const leave = () => { pointer.x = -9999; pointer.y = -9999; };
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  let timer = 0;
  const resize = () => { clearTimeout(timer); timer = window.setTimeout(layout, 150); };
  layout();
  if (!reducedMotion) {
    observer.observe(canvas);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", leave, { passive: true });
    frame = requestAnimationFrame(tick);
  }
  window.addEventListener("resize", resize);
  return () => { cancelAnimationFrame(frame); clearTimeout(timer); observer.disconnect(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", leave); window.removeEventListener("resize", resize); };
}
