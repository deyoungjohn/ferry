import { useEffect, useRef } from 'react';

/**
 * The hero picture: Ferry's stablecoins rolling along a twisting ribbon, drawn on a 2D canvas.
 * No 3D library and no video: a few kilobytes of code plus the five token icons. The canvas fills
 * a box whose size the page fixes (no layout shift); it pauses off screen and in a hidden tab, and
 * a person who asked for less motion gets one still frame.
 */

const TOKENS = ['usdc', 'pusd', 'usdt', 'musd', 'usdg'] as const;
const FILE: Record<(typeof TOKENS)[number], string> = {
  usdc: 'usdc.svg',
  pusd: 'pusd.svg',
  usdt: 'usdt.svg',
  musd: 'musd.png',
  usdg: 'usdg.svg',
};

/** Seconds a coin takes to roll the whole ribbon. */
const LAP_SECONDS = 9;
const COINS = 7;

interface Point {
  x: number;
  y: number;
}

/** The ribbon's spine, in a 1 x 1 box: in from the lower left, a dip, then up and out at the top right. */
function spine(t: number): Point {
  // Cubic Bezier through the frame, like the swoop of a ribbon seen from the side.
  const p0 = { x: -0.15, y: 0.62 };
  const p1 = { x: 0.32, y: 0.42 };
  const p2 = { x: 0.42, y: 1.08 };
  const p3 = { x: 1.15, y: 0.08 };
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * p1.x +
      3 * u * t * t * p2.x +
      t * t * t * p3.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * p1.y +
      3 * u * t * t * p2.y +
      t * t * t * p3.y,
  };
}

/** How far the band is turned toward the viewer at t: 1 = flat to us, -1 = its back. */
function twist(t: number): number {
  return Math.cos(t * Math.PI * 1.6 + 0.9);
}

function loadImages(base: string): Promise<HTMLImageElement[]> {
  return Promise.all(
    TOKENS.map(
      (token) =>
        new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(img);
          img.src = `${base}brand/tokens/${FILE[token]}`;
        }),
    ),
  );
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, w * 0.4, h);
  sky.addColorStop(0, '#b9b4f0');
  sky.addColorStop(0.45, '#ece6f2');
  sky.addColorStop(1, '#efc9be');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
}

function drawRibbon(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const steps = 140;
  const width = Math.min(w, h) * 0.2;
  for (let i = 0; i < steps; i += 1) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const a = spine(t0);
    const b = spine(t1);
    const f0 = twist(t0);
    const f1 = twist(t1);
    // Edges: the spine shifted up and down by the visible width of the band at that point.
    const e0 = (width * f0) / 2;
    const e1 = (width * f1) / 2;
    const ax = a.x * w;
    const ay = a.y * h;
    const bx = b.x * w;
    const by = b.y * h;
    ctx.beginPath();
    ctx.moveTo(ax, ay - e0);
    ctx.lineTo(bx, by - e1);
    ctx.lineTo(bx, by + e1);
    ctx.lineTo(ax, ay + e0);
    ctx.closePath();
    // Front face silver, back face rose; brighter where the band faces us squarely.
    const facing = (f0 + f1) / 2;
    const light = Math.abs(facing);
    if (facing >= 0) {
      const v = Math.round(178 + 70 * light);
      ctx.fillStyle = `rgb(${v - 6}, ${v - 4}, ${v + 2})`;
    } else {
      ctx.fillStyle = `rgb(${Math.round(196 + 40 * light)}, ${Math.round(150 + 30 * light)}, ${Math.round(168 + 30 * light)})`;
    }
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawCoin(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  r: number,
  spin: number,
) {
  const sx = Math.cos(spin);
  const face = Math.abs(sx);
  const thickness = r * 0.16;
  // Shadow on the ribbon.
  ctx.save();
  ctx.fillStyle = 'rgba(40, 30, 60, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.15, y + r * 1.02, r * 0.9, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Rim: the coin's edge, seen as it turns.
  ctx.save();
  const rim = ctx.createLinearGradient(x - r, y, x + r, y);
  rim.addColorStop(0, '#8d8a99');
  rim.addColorStop(0.5, '#e9e7f0');
  rim.addColorStop(1, '#77748a');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(
    x + thickness * Math.sign(sx || 1) * 0.6,
    y,
    Math.max(r * face, thickness),
    r,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  if (face < 0.08) return;
  // Face: a metal ring around the token art, squeezed by the turn.
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(face, 1);
  const ring = ctx.createLinearGradient(-r, -r, r, r);
  ring.addColorStop(0, '#f7f6fb');
  ring.addColorStop(0.5, '#b9b6c6');
  ring.addColorStop(1, '#efedf5');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  ctx.clip();
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, -r * 0.84, -r * 0.84, r * 1.68, r * 1.68);
  }
  // A sheen across the face.
  const sheen = ctx.createLinearGradient(-r, -r, r, r);
  sheen.addColorStop(0, 'rgba(255,255,255,0.35)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = sheen;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  images: HTMLImageElement[],
  w: number,
  h: number,
  seconds: number,
) {
  drawBackground(ctx, w, h);
  drawRibbon(ctx, w, h);
  // Until the token art has loaded, the sky and the ribbon only.
  if (images.length === 0) return;
  const base = Math.min(w, h);
  const coins: Array<{ t: number; index: number }> = [];
  for (let i = 0; i < COINS; i += 1) {
    const t = ((seconds / LAP_SECONDS + i / COINS) % 1) * 1.1 - 0.05;
    coins.push({ t, index: i });
  }
  // Farther coins first, so the nearer ones (lower right) overlap them.
  coins.sort((a, b) => a.t - b.t);
  for (const { t, index } of coins) {
    if (t < 0 || t > 1) continue;
    const p = spine(t);
    // Bigger toward the front of the scene: the ribbon comes toward us as it rises.
    const r = base * (0.07 + 0.06 * t);
    const edge = (Math.min(w, h) * 0.2 * twist(t)) / 2;
    const x = p.x * w;
    const y = p.y * h - Math.abs(edge) - r * 0.92;
    const spin = seconds * 2.4 + index * 1.3;
    drawCoin(ctx, images[index % images.length]!, x, y, r, spin);
  }
}

export function HeroCoins({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let images: HTMLImageElement[] = [];
    let raf = 0;
    let visible = true;
    let width = 0;
    let height = 0;
    const started = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still || !visible) drawFrame(ctx, images, width, height, 1.2);
    };

    const tick = (now: number) => {
      drawFrame(ctx, images, width, height, (now - started) / 1000);
      raf = requestAnimationFrame(tick);
    };
    const play = () => {
      if (still || raf || !visible || document.hidden) return;
      raf = requestAnimationFrame(tick);
    };
    const pause = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    const onScreen =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => {
            visible = Boolean(entry?.isIntersecting);
            if (visible) play();
            else pause();
          })
        : null;
    onScreen?.observe(canvas);
    const onVisibility = () => (document.hidden ? pause() : play());
    document.addEventListener('visibilitychange', onVisibility);

    resize();
    void loadImages(import.meta.env.BASE_URL).then((loaded) => {
      images = loaded;
      drawFrame(ctx, images, width, height, 1.2);
      play();
    });

    return () => {
      pause();
      observer?.disconnect();
      onScreen?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      data-testid="hero-coins"
    />
  );
}
