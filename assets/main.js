/* ============================================================
   Brian Lai — Robotics Portfolio
   Shared script for index.html & index_zh.html
   ============================================================ */

/* ---------------- Theme toggle ---------------- */

(function initTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem("theme");
  // Dark is the default look for this design; honor an explicit light choice.
  root.setAttribute("data-theme", saved === "light" ? "light" : "dark");

  const btn = document.getElementById("theme-toggle");
  const syncIcon = () => {
    btn.textContent = root.getAttribute("data-theme") === "dark" ? "🌙" : "☀️";
  };
  syncIcon();

  btn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    syncIcon();
  });
})();

/* ---------------- Mobile nav ---------------- */

(function initNav() {
  const burger = document.getElementById("nav-burger");
  const links = document.getElementById("nav-links");
  burger.addEventListener("click", () => links.classList.toggle("open"));
  links.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => links.classList.remove("open"))
  );
})();

/* ---------------- Scroll reveal ---------------- */

(function initReveal() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
})();

/* ---------------- Hero point-cloud animation ----------------
   A lightweight LiDAR-style terrain scan: a rotating grid of
   points with a sweeping scan ring, rendered on a 2D canvas.
------------------------------------------------------------- */

(function initPointCloud() {
  const canvas = document.getElementById("pointcloud");
  if (!canvas) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const GRID = 46; // points per side
  const SPACING = 26;
  const points = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = (i - GRID / 2) * SPACING;
      const z = (j - GRID / 2) * SPACING;
      const y =
        Math.sin(i * 0.45) * 22 +
        Math.cos(j * 0.35) * 18 +
        Math.sin((i + j) * 0.2) * 14;
      points.push({ x, y, z, r: Math.hypot(x, z) });
    }
  }
  const MAX_R = (GRID / 2) * SPACING;

  let w, h;
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = w * DPR;
    canvas.height = h * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  function accentColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
  }

  let angle = 0.6;
  let scan = 0;
  const hudScan = document.getElementById("hud-scan");
  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const color = accentColor();
    // cloud sits right of the hero text on desktop, centered on mobile
    const cx = w > 820 ? w * 0.74 : w * 0.5;
    const cy = h * 0.56;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const tilt = 0.42;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const scanR = scan * MAX_R;

    for (let p = 0; p < points.length; p++) {
      const pt = points[p];
      // rotate around Y, then tilt around X
      const rx = pt.x * cosA - pt.z * sinA;
      const rz = pt.x * sinA + pt.z * cosA;
      const ry = pt.y * cosT - rz * sinT;
      const rz2 = pt.y * sinT + rz * cosT;

      const persp = 640 / (640 + rz2);
      const sx = cx + rx * persp * 0.9;
      const sy = cy + ry * persp * 0.9;
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;

      const depth = Math.max(0, Math.min(1, (rz2 + MAX_R) / (2 * MAX_R)));
      const nearScan = Math.abs(pt.r - scanR) < 34;
      const alpha = nearScan ? 0.95 : 0.12 + (1 - depth) * 0.4;
      const size = (nearScan ? 2.4 : 1.5) * persp;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (reduced) {
    draw(); // static frame, no animation
    return;
  }

  (function loop() {
    angle += 0.0022;
    scan = (scan + 0.004) % 1.2;
    draw();
    if (hudScan && ++frame % 6 === 0) {
      const deg = String(Math.round(((angle * 180) / Math.PI) % 360)).padStart(3, "0");
      hudScan.textContent = "SCAN " + deg + "°";
    }
    requestAnimationFrame(loop);
  })();
})();

/* ---------------- Gaussian splat viewer ----------------
   Lazily imports @mkkellogg/gaussian-splats-3d (via the import
   map in the page <head>) only when the visitor asks for it.

   To publish your scan: upload the file to the repo as one of
     resource/scene.ksplat   (recommended — smallest)
     resource/scene.splat
     resource/scene.ply
   The viewer probes those paths in order and loads the first hit.
   Tune camera placement in SPLAT_CONFIG below to fit your scene.
--------------------------------------------------------- */

const SPLAT_CONFIG = {
  candidates: [
    "./assets/ply/fire_hydrant.splat",
    "./resource/scene.ksplat",
    "./resource/scene.splat",
    "./resource/scene.ply",
  ],
  viewer: {
    cameraUp: [0, -1, 0], // most captures are Y-down; flip to [0,1,0] if upside-down
    initialCameraPosition: [-2.5, -1.5, -3.5],
    initialCameraLookAt: [0, 0, 0],
    sharedMemoryForWorkers: false, // required on GitHub Pages (no COOP/COEP headers)
  },
  scene: {
    splatAlphaRemovalThreshold: 5,
    progressiveLoad: true,
  },
};

(function initSplatViewer() {
  const stage = document.getElementById("splat-stage");
  if (!stage) return;

  const placeholder = document.getElementById("splat-placeholder");
  const statusEl = document.getElementById("splat-status");
  const loadBtn = document.getElementById("splat-load");
  const fileBtn = document.getElementById("splat-file-btn");
  const fileInput = document.getElementById("splat-file");

  // Localized strings come from data-* attributes on the stage element
  const msg = (key) => stage.dataset["msg" + key] || key;

  let viewer = null;
  let busy = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function findHostedModel() {
    for (const url of SPLAT_CONFIG.candidates) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) return url;
      } catch (_) {
        /* ignore network errors, try next */
      }
    }
    return null;
  }

  async function startViewer(source, format) {
    const GS = await import("@mkkellogg/gaussian-splats-3d");
    if (viewer) {
      await viewer.dispose();
      viewer = null;
    }
    placeholder.style.display = "none";
    viewer = new GS.Viewer({ rootElement: stage, ...SPLAT_CONFIG.viewer });

    const opts = { ...SPLAT_CONFIG.scene, showLoadingUI: true };
    if (format) {
      const map = {
        ply: GS.SceneFormat.Ply,
        splat: GS.SceneFormat.Splat,
        ksplat: GS.SceneFormat.KSplat,
      };
      opts.format = map[format];
      opts.progressiveLoad = false; // object URLs load in one shot
    }
    await viewer.addSplatScene(source, opts);
    viewer.start();
  }

  async function guard(task) {
    if (busy) return;
    busy = true;
    loadBtn.disabled = true;
    fileBtn.disabled = true;
    try {
      await task();
      setStatus(msg("Ready"));
    } catch (err) {
      console.error(err);
      placeholder.style.display = "";
      setStatus(msg("Error"));
    } finally {
      busy = false;
      loadBtn.disabled = false;
      fileBtn.disabled = false;
    }
  }

  loadBtn.addEventListener("click", () =>
    guard(async () => {
      setStatus(msg("Searching"));
      const url = await findHostedModel();
      if (!url) {
        setStatus(msg("Notfound"));
        throw new Error("No hosted splat model found at " + SPLAT_CONFIG.candidates.join(", "));
      }
      setStatus(msg("Loading"));
      const ext = url.split(".").pop().toLowerCase();
      await startViewer(url, ext);
    })
  );

  // Auto-load the hosted model as soon as the viewer is on screen.
  const autoLoad = () =>
    guard(async () => {
      setStatus(msg("Searching"));
      const url = await findHostedModel();
      if (!url) {
        setStatus(msg("Notfound"));
        throw new Error("No hosted splat model found at " + SPLAT_CONFIG.candidates.join(", "));
      }
      setStatus(msg("Loading"));
      const ext = url.split(".").pop().toLowerCase();
      await startViewer(url, ext);
    });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) {
        obs.disconnect();
        autoLoad();
      }
    }, { rootMargin: "200px" });
    io.observe(stage);
  } else {
    autoLoad();
  }

  fileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["ply", "splat", "ksplat"].includes(ext)) {
      setStatus(msg("Badformat"));
      return;
    }
    guard(async () => {
      setStatus(msg("Loading"));
      await startViewer(URL.createObjectURL(file), ext);
    });
  });
})();
