import { useEffect, useRef } from "react";
import { useMedia } from "../lib/hooks.js";

const INK = "10,34,48";

/**
 * Interactive background: particles drift along a smooth wind field, swirl around the pointer,
 * and move faster when the selected day's wind generation is higher (`wind` is 0..1).
 * Paints its own opaque background (so trails fade), sits behind everything, never captures input.
 */
export default function FlowField({ wind = 0.4 }) {
  const canvasRef = useRef(null);
  const windRef = useRef(wind);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  useEffect(() => { windRef.current = Math.min(1, Math.max(0, wind)); }, [wind]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, raf = 0, t = 0, parts = [];
    const mouse = { x: -9999, y: -9999 };
    const R = 170;

    const field = (x, y, time) =>
      Math.sin(x * 0.0021 + time * 0.00018) * 1.6 + Math.cos(y * 0.0027 - time * 0.00013) * 1.6 +
      Math.sin((x + y) * 0.0011 + time * 0.0001);
    const seed = () => ({ x: Math.random() * w, y: Math.random() * h, life: 60 + Math.random() * 200 });

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${INK})`; ctx.fillRect(0, 0, w, h);
      const n = Math.max(80, Math.min(700, Math.round((w * h) / (w < 700 ? 5200 : 3000))));
      parts = Array.from({ length: n }, seed);
      if (reduced) drawStatic();
    };

    const drawStatic = () => {           // one still frame of streamlines for reduced-motion users
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(150,220,208,0.10)";
      for (const p of parts) {
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        let x = p.x, y = p.y;
        for (let i = 0; i < 90; i++) { const a = field(x, y, 0); x += Math.cos(a) * 2.2; y += Math.sin(a) * 2.2; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    };

    const frame = () => {
      t += 16;
      const k = windRef.current;
      const speed = 0.7 + k * 2.4;
      ctx.fillStyle = `rgba(${INK},0.09)`; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1; ctx.strokeStyle = `rgba(150,220,208,${0.16 + k * 0.2})`;
      ctx.beginPath();
      for (const p of parts) {
        const a = field(p.x, p.y, t);
        let vx = Math.cos(a), vy = Math.sin(a);
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R) {                // swirl around, and slightly away from, the pointer
          const d = Math.sqrt(d2) || 1, f = 1 - d / R;
          vx += (-dy / d) * f * 2.2 + (dx / d) * f * 0.8;
          vy += (dx / d) * f * 2.2 + (dy / d) * f * 0.8;
        }
        const nx = p.x + vx * speed, ny = p.y + vy * speed;
        ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny);
        p.x = nx; p.y = ny; p.life -= 1;
        if (p.life <= 0 || nx < -20 || nx > w + 20 || ny < -20 || ny > h + 20) Object.assign(p, seed());
      }
      ctx.stroke();
      raf = requestAnimationFrame(frame);
    };

    const start = () => { if (!reduced && !raf) raf = requestAnimationFrame(frame); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = mouse.y = -9999; };
    const onVis = () => (document.hidden ? stop() : start());

    resize(); start();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  return <canvas ref={canvasRef} className="flow" aria-hidden="true" />;
}
