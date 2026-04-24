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

  /* ---------- Sakura petal canvas ---------- */
  if (prefersReducedMotion) return;

  const canvas = document.getElementById("petals");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const petals = [];

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const colors = ["#ff7eb9", "#ffb2d1", "#a78bfa", "#c4b5fd", "#7fd7ff"];
  const TOTAL = Math.max(14, Math.min(28, Math.floor(width / 60)));

  const rand = (min, max) => Math.random() * (max - min) + min;

  const spawn = (initial) => {
    const size = rand(8, 16);
    petals.push({
      x: rand(0, width),
      y: initial ? rand(0, height) : rand(-40, -10),
      size,
      vy: rand(0.4, 1.2),
      vx: rand(-0.4, 0.4),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.02, 0.02),
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: rand(0.35, 0.7),
      sway: rand(0.004, 0.012),
      swayPhase: rand(0, Math.PI * 2),
    });
  };

  for (let i = 0; i < TOTAL; i++) spawn(true);

  const drawPetal = (p) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(p.size / 2, -p.size / 2, p.size, p.size / 2, 0, p.size);
    ctx.bezierCurveTo(-p.size, p.size / 2, -p.size / 2, -p.size / 2, 0, 0);
    ctx.fill();
    ctx.restore();
  };

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(32, now - last);
    last = now;
    ctx.clearRect(0, 0, width, height);

    for (const p of petals) {
      p.swayPhase += p.sway * dt;
      p.x += p.vx + Math.sin(p.swayPhase) * 0.4;
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

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
