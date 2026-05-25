import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  opacity: number;
  life: number;
  maxLife: number;
}

interface StarfieldProps {
  className?: string;
}

export function Starfield({ className = '' }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    const stars: Star[] = [];
    let shootingStars: ShootingStar[] = [];
    let lastTime = 0;

    const STAR_COUNT = reducedMotion ? 400 : 1200;
    const SHOOTING_STAR_INTERVAL = reducedMotion ? 0 : 3000;
    let lastShootingStar = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initStars() {
      stars.length = 0;
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          z: Math.random(),
          size: Math.random() * 1.5 + 0.3,
          opacity: Math.random() * 0.7 + 0.3,
          twinkleSpeed: Math.random() * 2 + 0.5,
          twinkleOffset: Math.random() * Math.PI * 2,
        });
      }
    }

    function spawnShootingStar(now: number) {
      if (now - lastShootingStar < SHOOTING_STAR_INTERVAL) return;
      if (Math.random() > 0.3) return;
      lastShootingStar = now;

      const startX = Math.random() * width * 0.8 + width * 0.1;
      const startY = Math.random() * height * 0.3;
      const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.3;
      const speed = Math.random() * 300 + 200;

      shootingStars.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length: Math.random() * 80 + 40,
        opacity: 1,
        life: 0,
        maxLife: Math.random() * 0.6 + 0.4,
      });
    }

    function drawNebula() {
      const nebulas = [
        { x: width * 0.2, y: height * 0.3, r: width * 0.4, color: 'rgba(88, 28, 135, 0.08)' },
        { x: width * 0.7, y: height * 0.6, r: width * 0.35, color: 'rgba(30, 58, 138, 0.06)' },
        { x: width * 0.5, y: height * 0.15, r: width * 0.3, color: 'rgba(67, 56, 202, 0.05)' },
      ];

      for (const n of nebulas) {
        const g = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, n.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx!.fillStyle = g;
        ctx!.fillRect(0, 0, width, height);
      }
    }

    function drawStars(time: number) {
      const mx = (mouseRef.current.x - width / 2) * 0.02;
      const my = (mouseRef.current.y - height / 2) * 0.02;

      for (const star of stars) {
        const parallaxX = mx * (star.z * 2 + 0.5);
        const parallaxY = my * (star.z * 2 + 0.5);
        const driftSpeed = reducedMotion ? 0 : 2 + star.z * 8;
        const driftY = ((time * 0.0001 * driftSpeed) % height);

        const sx = star.x + parallaxX;
        let sy = star.y - driftY + parallaxY;
        if (sy < 0) sy += height;

        const twinkle = reducedMotion
          ? 1
          : 0.5 + 0.5 * Math.sin(time * 0.001 * star.twinkleSpeed + star.twinkleOffset);
        const alpha = star.opacity * twinkle * (0.4 + star.z * 0.6);

        ctx!.beginPath();
        ctx!.arc(sx, sy, star.size * (0.6 + star.z * 0.4), 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx!.fill();

        if (star.z > 0.7 && !reducedMotion) {
          ctx!.beginPath();
          ctx!.arc(sx, sy, star.size * 3, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(255, 255, 255, ${alpha * 0.15})`;
          ctx!.fill();
        }
      }
    }

    function drawShootingStars(dt: number) {
      shootingStars = shootingStars.filter((ss) => ss.life < ss.maxLife);

      for (const ss of shootingStars) {
        ss.life += dt;
        ss.x += ss.vx * dt;
        ss.y += ss.vy * dt;

        const progress = ss.life / ss.maxLife;
        ss.opacity = progress < 0.1 ? progress / 0.1 : 1 - (progress - 0.1) / 0.9;

        const tailX = ss.x - ss.vx * dt * (ss.length / 40);
        const tailY = ss.y - ss.vy * dt * (ss.length / 40);

        const grad = ctx!.createLinearGradient(tailX, tailY, ss.x, ss.y);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, `rgba(255,255,255,${ss.opacity})`);

        ctx!.beginPath();
        ctx!.moveTo(tailX, tailY);
        ctx!.lineTo(ss.x, ss.y);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();

        ctx!.beginPath();
        ctx!.arc(ss.x, ss.y, 2, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255,255,255,${ss.opacity})`;
        ctx!.fill();
      }
    }

    function frame(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      ctx!.clearRect(0, 0, width, height);
      ctx!.fillStyle = '#030508';
      ctx!.fillRect(0, 0, width, height);

      drawNebula();
      drawStars(now);

      if (!reducedMotion) {
        spawnShootingStar(now);
        drawShootingStars(dt);
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    function onMouseMove(e: MouseEvent) {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    }

    function onResize() {
      resize();
      initStars();
    }

    resize();
    initStars();
    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full ${className}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
