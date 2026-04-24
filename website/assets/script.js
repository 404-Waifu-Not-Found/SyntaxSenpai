(() => {
  "use strict";

  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Copy-to-clipboard ---------- */
  document.querySelectorAll("[data-copy-target]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sel = btn.getAttribute("data-copy-target");
      const node = sel ? document.querySelector(sel) : null;
      if (!node) return;
      const text = node.innerText.trim();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("copy");
        selection.removeAllRanges();
      }
      const original = btn.textContent;
      btn.textContent = "Copied ✓";
      btn.classList.add("copied");
      burstConfetti(btn);
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("copied");
      }, 1600);
    });
  });

  /* ---------- Hide header on scroll down, show on scroll up ---------- */
  const header = document.querySelector(".site-header");
  if (header) {
    let lastY = window.scrollY;
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(() => {
          const y = window.scrollY;
          if (y > 120 && y > lastY + 8) header.classList.add("hide");
          else if (y < lastY - 4) header.classList.remove("hide");
          lastY = y;
          ticking = false;
        });
      },
      { passive: true }
    );
  }

  /* ---------- Scroll reveal ---------- */
  if (!prefersReducedMotion && "IntersectionObserver" in window) {
    const revealTargets = document.querySelectorAll(
      "[data-reveal], [data-reveal-stagger]"
    );
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
    );
    revealTargets.forEach((el) => io.observe(el));
  } else {
    document
      .querySelectorAll("[data-reveal], [data-reveal-stagger]")
      .forEach((el) => el.classList.add("in"));
  }

  /* ---------- Count-up hero stats ---------- */
  const statEls = document.querySelectorAll(".hero-stats strong[data-count]");
  if (statEls.length) {
    if (prefersReducedMotion) {
      statEls.forEach((el) => (el.textContent = el.dataset.count));
    } else {
      const runCount = (el) => {
        const target = parseFloat(el.dataset.count);
        const duration = 1100;
        const start = performance.now();
        const tick = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          const value = Math.round(target * eased);
          el.textContent = value.toString();
          if (t < 1) requestAnimationFrame(tick);
          else el.textContent = target.toString();
        };
        requestAnimationFrame(tick);
      };
      if ("IntersectionObserver" in window) {
        const sIo = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                runCount(e.target);
                sIo.unobserve(e.target);
              }
            }
          },
          { threshold: 0.4 }
        );
        statEls.forEach((el) => sIo.observe(el));
      } else {
        statEls.forEach(runCount);
      }
    }
  }

  /* ---------- Magnetic / spotlight tilt on cards ---------- */
  if (!prefersReducedMotion) {
    const isFine = window.matchMedia("(pointer: fine)").matches;
    if (isFine) {
      const tiltTargets = document.querySelectorAll(".card, .waifu");
      tiltTargets.forEach((el) => {
        el.addEventListener("mousemove", (ev) => {
          const r = el.getBoundingClientRect();
          const x = (ev.clientX - r.left) / r.width;
          const y = (ev.clientY - r.top) / r.height;
          const rx = (x - 0.5) * 10;
          const ry = (0.5 - y) * 10;
          el.style.transform = `perspective(900px) rotateX(${ry}deg) rotateY(${rx}deg) translateY(-4px) scale(1.01)`;
          el.style.setProperty("--mx", `${x * 100}%`);
          el.style.setProperty("--my", `${y * 100}%`);
        });
        el.addEventListener("mouseleave", () => {
          el.style.transform = "";
          el.style.removeProperty("--mx");
          el.style.removeProperty("--my");
        });
      });
    }
  }

  /* ---------- Parallax on hero title ---------- */
  if (!prefersReducedMotion) {
    const heroTitle = document.querySelector(".hero-title");
    const heroBadge = document.querySelector(".hero-badge");
    if (heroTitle) {
      window.addEventListener(
        "mousemove",
        (ev) => {
          const dx = (ev.clientX / window.innerWidth - 0.5) * 2;
          const dy = (ev.clientY / window.innerHeight - 0.5) * 2;
          heroTitle.style.transform = `translate3d(${dx * 6}px, ${dy * 4}px, 0)`;
          if (heroBadge)
            heroBadge.style.transform = `translate3d(${dx * -4}px, ${dy * -3}px, 0)`;
        },
        { passive: true }
      );
    }

    /* Parallax on aurora blobs from scroll */
    const blobs = document.querySelectorAll(".aurora .blob");
    if (blobs.length) {
      window.addEventListener(
        "scroll",
        () => {
          const y = window.scrollY;
          blobs.forEach((b, i) => {
            b.style.setProperty("--scroll-offset", `${y * (0.04 + i * 0.02)}px`);
            b.style.translate = `0 ${y * (0.04 + i * 0.02) * -1}px`;
          });
        },
        { passive: true }
      );
    }
  }

  /* ---------- Confetti / sparkle burst on click ---------- */
  function burstConfetti(origin) {
    if (prefersReducedMotion) return;
    const rect = origin.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ["#ff7eb9", "#a78bfa", "#7fd7ff", "#9cffd8", "#ffb2d1"];
    const host = document.body;
    for (let i = 0; i < 18; i++) {
      const el = document.createElement("span");
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 80;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const size = 6 + Math.random() * 8;
      el.style.cssText = `
        position: fixed;
        left: ${cx}px;
        top: ${cy}px;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        pointer-events: none;
        background: ${colors[i % colors.length]};
        box-shadow: 0 0 10px ${colors[i % colors.length]};
        z-index: 100;
        transform: translate(-50%, -50%);
        transition: transform 700ms cubic-bezier(0.1,0.8,0.2,1), opacity 700ms ease;
      `;
      host.appendChild(el);
      requestAnimationFrame(() => {
        el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4)`;
        el.style.opacity = "0";
      });
      setTimeout(() => el.remove(), 750);
    }
  }

  /* Click sparkle for every primary CTA */
  if (!prefersReducedMotion) {
    document.querySelectorAll(".btn-primary").forEach((b) =>
      b.addEventListener("click", () => burstConfetti(b))
    );
  }

  /* ---------- Canvas: sakura petals + twinkling stars ---------- */
  if (prefersReducedMotion) return;

  const petalsCanvas = document.getElementById("petals");
  const sparkCanvas = document.getElementById("sparkles");
  if (!petalsCanvas || !petalsCanvas.getContext) return;

  const pctx = petalsCanvas.getContext("2d");
  const sctx = sparkCanvas ? sparkCanvas.getContext("2d") : null;

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const petals = [];
  const sparks = [];

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    [petalsCanvas, sparkCanvas].forEach((c) => {
      if (!c) return;
      c.width = width * dpr;
      c.height = height * dpr;
      c.style.width = width + "px";
      c.style.height = height + "px";
      const cctx = c.getContext("2d");
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  };
  resize();
  window.addEventListener("resize", resize);

  const petalColors = ["#ff7eb9", "#ffb2d1", "#ffd1e4", "#a78bfa", "#c4b5fd", "#7fd7ff"];
  const sparkColors = ["#ffffff", "#ffd6ec", "#c4b5fd", "#7fd7ff", "#9cffd8"];

  const PETAL_COUNT = Math.max(18, Math.min(38, Math.floor(width / 48)));
  const SPARK_COUNT = Math.max(22, Math.min(60, Math.floor(width / 32)));

  const rand = (min, max) => Math.random() * (max - min) + min;

  const spawnPetal = (initial) => {
    const size = rand(7, 17);
    petals.push({
      x: rand(0, width),
      y: initial ? rand(0, height) : rand(-60, -10),
      size,
      vy: rand(0.4, 1.3),
      vx: rand(-0.5, 0.5),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.03, 0.03),
      color: petalColors[Math.floor(Math.random() * petalColors.length)],
      alpha: rand(0.35, 0.75),
      sway: rand(0.005, 0.015),
      swayPhase: rand(0, Math.PI * 2),
      shape: Math.random() < 0.3 ? "circle" : "petal",
    });
  };

  const spawnSpark = () => {
    sparks.push({
      x: rand(0, width),
      y: rand(0, height),
      size: rand(0.8, 2.6),
      life: rand(2000, 5000),
      born: performance.now(),
      color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
      phase: rand(0, Math.PI * 2),
    });
  };

  for (let i = 0; i < PETAL_COUNT; i++) spawnPetal(true);
  for (let i = 0; i < SPARK_COUNT; i++) spawnSpark();

  const drawPetal = (p) => {
    pctx.save();
    pctx.translate(p.x, p.y);
    pctx.rotate(p.rot);
    pctx.globalAlpha = p.alpha;
    pctx.fillStyle = p.color;
    pctx.shadowColor = p.color;
    pctx.shadowBlur = 6;
    if (p.shape === "circle") {
      pctx.beginPath();
      pctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      pctx.fill();
    } else {
      pctx.beginPath();
      pctx.moveTo(0, 0);
      pctx.bezierCurveTo(p.size / 2, -p.size / 2, p.size, p.size / 2, 0, p.size);
      pctx.bezierCurveTo(-p.size, p.size / 2, -p.size / 2, -p.size / 2, 0, 0);
      pctx.fill();
    }
    pctx.restore();
  };

  const drawSpark = (s, now) => {
    if (!sctx) return;
    const age = now - s.born;
    if (age > s.life) {
      s.x = rand(0, width);
      s.y = rand(0, height);
      s.born = now;
      s.life = rand(2000, 5000);
      s.phase = rand(0, Math.PI * 2);
      return;
    }
    const t = age / s.life;
    const pulse = (Math.sin(t * Math.PI * 2 + s.phase) + 1) / 2;
    const alpha = Math.sin(t * Math.PI) * (0.4 + pulse * 0.6);
    sctx.save();
    sctx.globalAlpha = Math.max(0, alpha);
    sctx.fillStyle = s.color;
    sctx.shadowColor = s.color;
    sctx.shadowBlur = 8;
    const r = s.size * (0.8 + pulse * 0.5);
    sctx.beginPath();
    sctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    sctx.fill();
    // 4-pointed cross for a twinkle
    sctx.strokeStyle = s.color;
    sctx.lineWidth = 0.6;
    sctx.beginPath();
    sctx.moveTo(s.x - r * 2, s.y);
    sctx.lineTo(s.x + r * 2, s.y);
    sctx.moveTo(s.x, s.y - r * 2);
    sctx.lineTo(s.x, s.y + r * 2);
    sctx.stroke();
    sctx.restore();
  };

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(32, now - last);
    last = now;
    pctx.clearRect(0, 0, width, height);
    if (sctx) sctx.clearRect(0, 0, width, height);

    for (const p of petals) {
      p.swayPhase += p.sway * dt;
      p.x += p.vx + Math.sin(p.swayPhase) * 0.5;
      p.y += p.vy * (dt / 16);
      p.rot += p.vr;

      if (p.y - p.size > height) {
        p.y = -p.size;
        p.x = rand(0, width);
      }
      if (p.x < -40) p.x = width + 20;
      if (p.x > width + 40) p.x = -20;

      drawPetal(p);
    }

    for (const s of sparks) drawSpark(s, now);

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
