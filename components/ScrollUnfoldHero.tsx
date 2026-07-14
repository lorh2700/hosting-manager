'use client';

/**
 * ScrollUnfoldHero — 인터랙티브 히어로
 * ─────────────────────────────────────
 * · 스크롤 카드 언폴드 (기존 유지)
 * · WebGL 리퀴드 디스토션 배경 — 커서를 따라 마당 사진이 일렁임 (신규)
 * · 타이틀 글자 커서 반응(repel) + 글자 단위 인트로 리빌 (신규)
 * 터치 기기 / prefers-reduced-motion 환경에서는 무거운 효과가 자동으로 꺼집니다.
 */

import { useEffect, useRef } from 'react';
import { motion, useScroll, useTransform, MotionValue } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';

// 실제로 존재하는 페이지/앵커만 노출 — 사용하지 않는 About/Journal/Contact 제거.
const menuItems = [
  { title: 'BRAND',  desc: '브랜드 이야기', img: '/images/main_yard.webp',      link: '/brand' },
  { title: 'SPACES', desc: '우리의 공간들', img: '/images/unwa/main.webp',       link: '#spaces' },
  { title: 'TOURS',  desc: '북촌 투어',    img: '/images/byulha/DSC01954.webp', link: '/tours' },
];

// 카드 중앙 오프셋 (개수에 따라 자동 계산) — 3개면 offset ∈ {-1, 0, 1}
const CENTER_INDEX = (menuItems.length - 1) / 2;

const HERO_BG = '/images/main_yard.webp';
const TITLE_LINES = ['당신만의 특별한', '머무름'];
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* ── WebGL liquid background ─────────────────────────────── */

const TRAIL = 14;

const VERT = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0., 1.); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes, uImg;
uniform float uTime, uScroll;
uniform vec4 uTrail[${TRAIL}];
uniform sampler2D uTex;

vec2 cover(vec2 uv){
  float ra = uRes.x / uRes.y, ri = uImg.x / uImg.y;
  vec2 s = (ra < ri) ? vec2(ra / ri, 1.) : vec2(1., ri / ra);
  return (uv - .5) * s + .5;
}
void main(){
  vec2 suv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;

  /* idle breathing */
  vec2 drift = vec2(sin(uTime * .12), cos(uTime * .09)) * .006;

  /* cursor ripple trail */
  vec2 disp = vec2(0.);
  for(int i = 0; i < ${TRAIL}; i++){
    vec4 t = uTrail[i];
    if(t.w <= 0.001) continue;
    vec2 d = suv - t.xy;
    d.x *= aspect;
    float dist = length(d);
    float decay = exp(-t.z * 2.2) * t.w;
    float ripple = sin(dist * 26. - t.z * 7.) * exp(-dist * 6.5) * decay;
    disp += normalize(d + 1e-4) * ripple * .04;
  }

  vec2 uv = cover(suv + drift) + disp;
  uv = (uv - .5) * (1. - uScroll * .1) + .5;

  vec3 col;
  col.r = texture2D(uTex, uv + disp * .35).r;
  col.g = texture2D(uTex, uv).g;
  col.b = texture2D(uTex, uv - disp * .35).b;

  /* cinematic grade: darken + vignette + grain */
  float vig = smoothstep(1.25, .35, length(suv - .5));
  col *= mix(.32, .62, vig);
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (grain - .5) * .03;
  gl_FragColor = vec4(col, 1.);
}
`;

function LiquidBackground({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgOpacity = useTransform(scrollYProgress, [0.05, 0.45], [1, 0.3]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = U('uRes'), uImg = U('uImg'), uTime = U('uTime'),
          uScroll = U('uScroll'), uTrail = U('uTrail[0]');

    /* texture — 이미지 로드 전 임시 다크 그라데이션 */
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // 이미지 상하 반전 방지 (WebGL은 Y축이 반대)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    let imgW = 1600, imgH = 1000;

    const fallback = document.createElement('canvas');
    fallback.width = 8; fallback.height = 8;
    const fctx = fallback.getContext('2d')!;
    const g = fctx.createLinearGradient(0, 0, 8, 8);
    g.addColorStop(0, '#1a1815');
    g.addColorStop(1, '#0C0A09');
    fctx.fillStyle = g;
    fctx.fillRect(0, 0, 8, 8);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, fallback);

    const img = new window.Image();
    img.src = HERO_BG;
    img.onload = () => {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    };

    /* cursor trail */
    const touch = matchMedia('(hover: none)').matches;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const trail = new Float32Array(TRAIL * 4);
    let head = 0, lastX = -1, lastY = -1;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (r.height === 0 || e.clientY > r.bottom || e.clientY < r.top) return;
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      const dx = x - lastX, dy = y - lastY;
      if (Math.hypot(dx, dy) < 0.008) return;
      const v = Math.min(Math.hypot(dx, dy) * 22, 1.4);
      lastX = x; lastY = y;
      trail[head * 4] = x;
      trail[head * 4 + 1] = y;
      trail[head * 4 + 2] = 0;
      trail[head * 4 + 3] = 0.35 + v * 0.65;
      head = (head + 1) % TRAIL;
    };
    if (!touch && !reduced) window.addEventListener('pointermove', onMove, { passive: true });

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      for (let i = 0; i < TRAIL; i++) trail[i * 4 + 2] += dt;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uImg, imgW, imgH);
      gl.uniform1f(uTime, now / 1000);
      gl.uniform1f(uScroll, scrollYProgress.get());
      gl.uniform4fv(uTrail, trail);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [scrollYProgress]);

  return (
    <motion.div style={{ opacity: bgOpacity }} className="absolute inset-0 z-0" aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-0 bg-gradient-to-b from-stone-950/60 via-transparent to-[#0C0A09]" />
    </motion.div>
  );
}

/* ── 커서에 반응해 밀려나는 글자들 ───────────────────────── */

function useCharRepel(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (matchMedia('(hover: none)').matches) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const chars = Array.from(root.querySelectorAll<HTMLElement>('[data-ch]'))
      .map((el) => ({ el, x: 0, y: 0 }));
    let mx = -9999, my = -9999;
    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
    window.addEventListener('pointermove', onMove, { passive: true });

    let raf = 0;
    const tick = () => {
      const R = Math.min(window.innerWidth * 0.14, 180);
      for (const c of chars) {
        const r = c.el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = cx - mx, dy = cy - my;
        const d = Math.hypot(dx, dy);
        let tx = 0, ty = 0;
        if (d < R && d > 0) {
          const f = (1 - d / R) * 28;
          tx = (dx / d) * f;
          ty = (dy / d) * f;
        }
        c.x += (tx - c.x) * 0.09;
        c.y += (ty - c.y) * 0.09;
        c.el.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [rootRef]);
}

/* ── Unfolding card (기존 로직 유지) ─────────────────────── */

function MenuCard({ item, index, scrollYProgress }: { item: (typeof menuItems)[number], index: number, scrollYProgress: MotionValue<number> }) {
  const start = 0.08 + (index * 0.10);
  const end = start + 0.30;
  const offset = index - CENTER_INDEX;

  const y = useTransform(scrollYProgress, [start, end], ["120vh", "0vh"]);
  const rotate = useTransform(scrollYProgress, [start, end], [20, offset * 10]);
  const x = useTransform(scrollYProgress, [start, end], ["0vw", `${offset * 26}vw`]);
  const scale = useTransform(scrollYProgress, [start, end], [0.8, 1]);

  return (
    <motion.div
      style={{ y, rotate, x, scale }}
      className="absolute w-[240px] md:w-[280px] lg:w-[320px] h-[360px] md:h-[420px] lg:h-[480px] bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden shadow-2xl origin-bottom pointer-events-auto"
    >
      <Link href={item.link} className="block w-full h-full group">
        <Image
          src={item.img}
          alt={item.title}
          fill
          sizes="(min-width: 1024px) 320px, (min-width: 768px) 280px, 240px"
          className="object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"
        />
        <div className="absolute inset-0 p-8 flex flex-col justify-end bg-gradient-to-t from-stone-950/90 via-stone-950/40 to-transparent">
          <h3 className="text-2xl font-light tracking-widest mb-2">{item.title}</h3>
          <p className="text-stone-300 text-sm font-light">{item.desc}</p>
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Hero ────────────────────────────────────────────────── */

export function ScrollUnfoldHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });
  useCharRepel(titleRef);

  const textOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.15], [0, -100]);
  const textScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.9]);
  // 텍스트가 사라진 뒤에는 글자 호버 이벤트도 비활성화
  const textPointer = useTransform(textOpacity, (o) => (o > 0.5 ? 'auto' : 'none'));

  return (
    <div ref={containerRef} data-scroll-hero className="relative h-[250vh] bg-[#0C0A09] w-full">
      <div className="sticky top-0 h-screen w-full overflow-hidden flex flex-col items-center justify-center">

        {/* Liquid WebGL background */}
        <LiquidBackground scrollYProgress={scrollYProgress} />

        {/* Hero Text */}
        <motion.div
          ref={titleRef}
          style={{ opacity: textOpacity, y: textY, scale: textScale }}
          className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10 pointer-events-none"
        >
          <motion.h1
            style={{ pointerEvents: textPointer }}
            className="text-5xl md:text-7xl lg:text-[90px] font-light tracking-tight leading-[1.1] mb-8"
          >
            {TITLE_LINES.map((line, li) => (
              <span key={line} className="block overflow-hidden">
                {Array.from(line).map((ch, ci) => (
                  <motion.span
                    key={ci}
                    initial={{ y: '112%', rotate: 4 }}
                    animate={{ y: 0, rotate: 0 }}
                    transition={{ duration: 1.1, delay: 0.15 + li * 0.16 + ci * 0.035, ease: EASE }}
                    className="inline-block whitespace-pre"
                  >
                    <span
                      data-ch
                      className="inline-block will-change-transform transition-colors duration-300 hover:text-amber-200"
                    >
                      {ch}
                    </span>
                  </motion.span>
                ))}
              </span>
            ))}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9, ease: EASE }}
            className="text-stone-200 text-sm md:text-base font-light tracking-wide max-w-2xl leading-relaxed mb-12"
          >
            북촌의 디자인 한옥 스테이.<br className="hidden md:block" />
            정성스럽게 가꾼 공간에서, 시간이 머무는 머무름을 경험해 보세요.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.3 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="w-[1px] h-12 bg-gradient-to-b from-stone-400 to-transparent"></div>
            <div className="text-xs uppercase tracking-[0.3em] text-stone-400">
              Scroll to explore
            </div>
          </motion.div>
        </motion.div>

        {/* Unfolding Cards */}
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none mt-20">
          {menuItems.map((item, i) => (
            <MenuCard key={item.title} item={item} index={i} scrollYProgress={scrollYProgress} />
          ))}
        </div>
      </div>
    </div>
  );
}
