// Interactive URDF viewer for the 6-DOF arm.
// Loads the robot's original URDF + STL meshes and renders them with three.js.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import URDFLoader from "urdf-loader";

(function () {
  const stage = document.getElementById("urdf-stage");
  if (!stage) return;

  const statusEl = document.getElementById("urdf-status");
  const placeholder = document.getElementById("urdf-placeholder");
  const controlsWrap = document.getElementById("urdf-controls");
  const resetBtn = document.getElementById("urdf-reset");
  const setStatus = (m) => { if (statusEl) statusEl.textContent = m; };

  const URDF_URL = "./assets/urdf/robotics_arm.urdf";
  const PACKAGES = { robotics_arm_description: "./assets/urdf" };

  let renderer, scene, camera, controls, robot;
  let started = false;
  const initialAngles = {};
  const jointInputs = {};

  function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(0.6, 0.6, 0.6);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);

    // three r160: URDF meshes assume Z-up; rotate the whole scene so it reads naturally.
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 2, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-1.5, 1, -1);
    scene.add(fill);

    // Ground plane for a subtle shadow.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.ShadowMaterial({ opacity: 0.18 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.25, 0);

    resize();
    window.addEventListener("resize", resize);
    animate();
  }

  function resize() {
    const w = stage.clientWidth || 600;
    const h = stage.clientHeight || 420;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function loadRobot() {
    setStatus("loading meshes…");
    const manager = new THREE.LoadingManager();
    const loader = new URDFLoader(manager);
    loader.packages = PACKAGES;
    loader.loadMeshCb = (path, mgr, done) => {
      new STLLoader(mgr).load(
        path,
        (geom) => {
          geom.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({
            color: 0x9aa6b2, metalness: 0.35, roughness: 0.55,
          });
          const mesh = new THREE.Mesh(geom, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          done(mesh);
        },
        undefined,
        (err) => done(null, err)
      );
    };

    loader.load(
      URDF_URL,
      (result) => {
        robot = result;
        // URDF is Z-up; three.js is Y-up.
        robot.rotation.x = -Math.PI / 2;
        scene.add(robot);

        manager.onLoad = () => {
          frameRobot();
          buildSliders();
          if (placeholder) placeholder.style.display = "none";
          setStatus("ready — drag to orbit, use sliders to pose");
        };
        // Fallback if all meshes were already cached / no async loads pending.
        if (Object.keys(robot.joints).length) {
          setTimeout(() => {
            if (placeholder && placeholder.style.display !== "none") {
              frameRobot();
              buildSliders();
              placeholder.style.display = "none";
              setStatus("ready — drag to orbit, use sliders to pose");
            }
          }, 1200);
        }
      },
      undefined,
      (err) => {
        console.error(err);
        setStatus("failed to load model — see browser console");
      }
    );
  }

  function frameRobot() {
    const box = new THREE.Box3().setFromObject(robot);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.5;

    // Rest the base on the ground.
    robot.position.y -= box.min.y;

    controls.target.set(center.x, size.y * 0.45, center.z);
    const dist = maxDim * 1.25;
    camera.position.set(
      controls.target.x + dist,
      controls.target.y + dist * 0.55,
      controls.target.z + dist
    );
    camera.near = maxDim / 100;
    camera.far = maxDim * 50;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function buildSliders() {
    if (!controlsWrap || !robot) return;
    controlsWrap.innerHTML = "";
    const joints = robot.joints;
    Object.keys(joints).forEach((name) => {
      const j = joints[name];
      if (j.jointType === "fixed" || j.jointType === "continuous" && false) return;
      if (j.jointType === "fixed") return;

      const lower = Number(j.limit.lower);
      const upper = Number(j.limit.upper);
      const min = Number.isFinite(lower) ? lower : -Math.PI;
      const max = Number.isFinite(upper) && upper !== lower ? upper : Math.PI;
      const val = Number(j.angle) || 0;
      initialAngles[name] = val;

      const row = document.createElement("label");
      row.className = "urdf-slider";
      const span = document.createElement("span");
      span.className = "mono";
      span.textContent = name;
      const input = document.createElement("input");
      input.type = "range";
      input.min = min;
      input.max = max;
      input.step = (max - min) / 200 || 0.01;
      input.value = val;
      input.addEventListener("input", () => {
        cancelReset();
        robot.setJointValue(name, Number(input.value));
      });
      row.appendChild(span);
      row.appendChild(input);
      controlsWrap.appendChild(row);
      jointInputs[name] = input;
    });
  }

  let resetRaf = 0;
  function cancelReset() {
    if (resetRaf) { cancelAnimationFrame(resetRaf); resetRaf = 0; }
  }

  function animateReset(duration = 700) {
    if (!robot) return;
    cancelReset();
    const names = Object.keys(initialAngles);
    const from = names.map((n) => Number(robot.joints[n].angle) || 0);
    const to = names.map((n) => initialAngles[n]);
    // Frame count derived from duration; requestAnimationFrame supplies timestamps.
    let t = 0;
    const steps = Math.max(1, Math.round(duration / 16));
    const tick = () => {
      t += 1;
      const raw = Math.min(t / steps, 1);
      const e = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2; // easeInOutQuad
      names.forEach((n, i) => {
        const v = from[i] + (to[i] - from[i]) * e;
        robot.setJointValue(n, v);
        if (jointInputs[n]) jointInputs[n].value = v;
      });
      if (raw < 1) {
        resetRaf = requestAnimationFrame(tick);
      } else {
        resetRaf = 0;
      }
    };
    resetRaf = requestAnimationFrame(tick);
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => animateReset());
  }

  function boot() {
    if (started) return;
    started = true;
    init();
    loadRobot();
  }

  // Lazy-load when the section scrolls into view.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); boot(); }
    }, { rootMargin: "300px" });
    io.observe(stage);
  } else {
    boot();
  }
})();
