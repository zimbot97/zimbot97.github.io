// Interactive URDF viewer for the 6-DOF arm.
// Loads the robot's original URDF + STL meshes and renders them with three.js,
// adds a table + graspable props, and scripts pick-and-place demos.
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
  const tabsWrap = document.getElementById("urdf-tabs");
  const resetBtn = document.getElementById("urdf-reset");
  const setStatus = (m) => { if (statusEl) statusEl.textContent = m; };

  const URDF_URL = "./assets/urdf/robotics_arm.urdf";
  const PACKAGES = { robotics_arm_description: "./assets/urdf" };

  // Joints hidden from the slider panel: the finger joints all mimic gripper_joint,
  // and gripper_base_joint is driven by the pick demos — so only gripper_joint is
  // exposed for the end effector.
  const HIDDEN_JOINTS = new Set([
    "gripper_base_joint",
    "right_outer_joint", "right_inner_joint", "left_inner_joint",
    "left_knuckle_joint", "left_finger_joint",
  ]);

  const GRIP_OPEN = 0.0;
  const GRIP_CLOSE = 0.42;

  let renderer, scene, camera, controls, robot;
  let started = false;
  let busy = false;
  let heldObj = null;
  const initialAngles = {};
  const jointInputs = {};
  const props = {};

  const homePose = () => ({ ...initialAngles });
  const clampPi = (v) => Math.max(0, Math.min(Math.PI, v));

  function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(0.6, 0.6, 0.6);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 2, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.05;
    key.shadow.camera.far = 8;
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

        const ready = () => {
          if (placeholder && placeholder.style.display === "none") return;
          restOnGround();
          buildSliders();
          buildScene();
          buildTabs();
          frameView();
          if (placeholder) placeholder.style.display = "none";
          setStatus("ready — pose with sliders, or run a pick demo");
        };
        manager.onLoad = ready;
        // Fallback if all meshes were already cached / no async loads pending.
        if (Object.keys(robot.joints).length) setTimeout(ready, 1200);
      },
      undefined,
      (err) => {
        console.error(err);
        setStatus("failed to load model — see browser console");
      }
    );
  }

  function restOnGround() {
    const box = new THREE.Box3().setFromObject(robot);
    if (!box.isEmpty()) robot.position.y -= box.min.y;
    robot.updateMatrixWorld(true);
  }

  // Fit the camera to the whole scene (robot + table + props).
  function frameView() {
    const box = new THREE.Box3().setFromObject(robot);
    [props.table, props.cube, props.ball].forEach((o) => o && box.expandByObject(o));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.5;

    controls.target.set(center.x, center.y, center.z);
    const dist = maxDim * 1.35;
    camera.position.set(center.x + dist, center.y + dist * 0.55, center.z + dist * 0.45);
    camera.near = maxDim / 100;
    camera.far = maxDim * 50;
    camera.updateProjectionMatrix();
    controls.update();
  }

  // ---- forward kinematics + tiny numeric IK ----
  function setPose(p) {
    Object.keys(p).forEach((n) => robot.setJointValue(n, p[n]));
  }

  // Grasp point cached in the gripper_base local frame: the midpoint between the
  // fingertips (not the finger joint origins), so it lands where objects are held.
  let tcpLocal = null;
  function computeTcpLocal() {
    robot.setJointValue("gripper_joint", GRIP_OPEN);
    robot.updateMatrixWorld(true);
    const lc = new THREE.Box3().setFromObject(robot.links.left_finger).getCenter(new THREE.Vector3());
    const rc = new THREE.Box3().setFromObject(robot.links.right_finger).getCenter(new THREE.Vector3());
    const mid = lc.add(rc).multiplyScalar(0.5);
    const base = new THREE.Vector3();
    robot.links.gripper_base.getWorldPosition(base);
    // Nudge from the finger centers toward the tips along the gripper's forward axis.
    mid.add(mid.clone().sub(base).multiplyScalar(0.25));
    tcpLocal = robot.links.gripper_base.worldToLocal(mid.clone());
  }
  function tcpWorld() {
    robot.updateMatrixWorld(true);
    return robot.links.gripper_base.localToWorld(tcpLocal.clone());
  }

  // Solve joint_1..3 (grid + local refine) to bring the gripper to `target`.
  function solveIK(target) {
    const j4 = 0.6, jb = 0.0;
    robot.setJointValue("joint_4", j4);
    robot.setJointValue("gripper_base_joint", jb);
    const cost = (q1, q2, q3) => {
      robot.setJointValue("joint_1", q1);
      robot.setJointValue("joint_2", q2);
      robot.setJointValue("joint_3", q3);
      return tcpWorld().distanceToSquared(target);
    };
    let best = { q1: 0, q2: 1, q3: 1 }, bestD = Infinity;
    const N = 10;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
      const q1 = (a / (N - 1)) * Math.PI, q2 = (b / (N - 1)) * Math.PI, q3 = (c / (N - 1)) * Math.PI;
      const d = cost(q1, q2, q3);
      if (d < bestD) { bestD = d; best = { q1, q2, q3 }; }
    }
    let step = Math.PI / (N - 1);
    for (let iter = 0; iter < 4; iter++) {
      step *= 0.5;
      const b0 = { ...best };
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
        const q1 = clampPi(b0.q1 + da * step), q2 = clampPi(b0.q2 + db * step), q3 = clampPi(b0.q3 + dc * step);
        const d = cost(q1, q2, q3);
        if (d < bestD) { bestD = d; best = { q1, q2, q3 }; }
      }
    }
    return {
      joint_1: best.q1, joint_2: best.q2, joint_3: best.q3, joint_4: j4, gripper_base_joint: jb,
    };
  }

  function solvePoses(target, H) {
    const up = (dy) => target.clone().add(new THREE.Vector3(0, dy, 0));
    // Lift target: higher and pulled back toward the base so the arm stands more
    // upright and the held prop is clearly visible above the table.
    const liftT = new THREE.Vector3(target.x * 0.6, target.y + H * 0.5, target.z * 0.6);
    return {
      approach: solveIK(up(H * 0.16)),
      grasp: solveIK(target),
      lift: solveIK(liftT),
    };
  }

  // Build a short table with a graspable cube + ball the arm can actually reach.
  function buildScene() {
    computeTcpLocal();
    const bbox = new THREE.Box3().setFromObject(robot);
    const H = Math.max(...bbox.getSize(new THREE.Vector3()).toArray()) || 0.5;
    const cubeSide = H * 0.055;
    const half = cubeSide / 2;
    const ballR = half;
    const tableTop = H * 0.24;         // table height
    const cy = tableTop + half;        // prop center height (resting on the table)

    const tCube = new THREE.Vector3(H * 0.42, cy, H * 0.17);
    const tBall = new THREE.Vector3(H * 0.42, cy, -H * 0.17);

    const cubePoses = solvePoses(tCube, H);
    const ballPoses = solvePoses(tBall, H);

    // Where the gripper *actually* ends up in each grasp pose (IK is approximate),
    // so props sit exactly in the gripper rather than at the requested target.
    setPose(cubePoses.grasp);
    const gCube = tcpWorld();
    setPose(ballPoses.grasp);
    const gBall = tcpWorld();

    // Restore the home pose after all the IK probing.
    setPose(homePose());
    robot.setJointValue("gripper_joint", GRIP_OPEN);
    robot.updateMatrixWorld(true);

    // Table top meets the underside of the props.
    const topY = Math.max(0.02, Math.min(gCube.y, gBall.y) - half);

    // Table.
    const minX = Math.min(gCube.x, gBall.x), maxX = Math.max(gCube.x, gBall.x);
    const minZ = Math.min(gCube.z, gBall.z), maxZ = Math.max(gCube.z, gBall.z);
    const margin = H * 0.14;
    const tw = (maxX - minX) + margin * 2;
    const td = (maxZ - minZ) + margin * 2;
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(tw, topY, td),
      new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.9, metalness: 0.0 })
    );
    table.position.set((minX + maxX) / 2, topY / 2, (minZ + maxZ) / 2);
    table.castShadow = true; table.receiveShadow = true;
    scene.add(table);
    props.table = table;

    // Cube.
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(cubeSide, cubeSide, cubeSide),
      new THREE.MeshStandardMaterial({ color: 0x2dd4bf, metalness: 0.1, roughness: 0.5 })
    );
    cube.position.copy(gCube);
    cube.castShadow = true; cube.receiveShadow = true;
    cube.userData = { home: { pos: cube.position.clone(), quat: cube.quaternion.clone() }, poses: cubePoses };
    scene.add(cube);
    props.cube = cube;

    // Ball.
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(ballR, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.1, roughness: 0.35 })
    );
    ball.position.copy(gBall);
    ball.castShadow = true; ball.receiveShadow = true;
    ball.userData = { home: { pos: ball.position.clone(), quat: ball.quaternion.clone() }, poses: ballPoses };
    scene.add(ball);
    props.ball = ball;
  }

  function buildSliders() {
    if (!controlsWrap || !robot) return;
    controlsWrap.innerHTML = "";
    Object.keys(robot.joints).forEach((name) => {
      const j = robot.joints[name];
      if (j.jointType === "fixed" || HIDDEN_JOINTS.has(name)) return;

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
        if (busy) return;
        cancelAnim();
        robot.setJointValue(name, Number(input.value));
      });
      row.appendChild(span);
      row.appendChild(input);
      controlsWrap.appendChild(row);
      jointInputs[name] = input;
    });
  }

  function buildTabs() {
    if (!tabsWrap) return;
    tabsWrap.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => { if (!busy) pick(btn.dataset.action); });
    });
  }

  // ---- animation ----
  let animRaf = 0;
  function cancelAnim() {
    if (animRaf) { cancelAnimationFrame(animRaf); animRaf = 0; }
  }
  function animatePose(targets, duration = 600) {
    return new Promise((resolve) => {
      if (!robot) return resolve();
      cancelAnim();
      const names = Object.keys(targets);
      const from = names.map((n) => Number(robot.joints[n].angle) || 0);
      const to = names.map((n) => targets[n]);
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
        if (raw < 1) { animRaf = requestAnimationFrame(tick); }
        else { animRaf = 0; resolve(); }
      };
      animRaf = requestAnimationFrame(tick);
    });
  }

  function setControlsEnabled(on) {
    if (tabsWrap) tabsWrap.querySelectorAll("button").forEach((b) => (b.disabled = !on));
    if (resetBtn) resetBtn.disabled = !on;
    Object.values(jointInputs).forEach((i) => (i.disabled = !on));
  }

  function attach(obj) {
    robot.links.gripper_base.attach(obj);
    heldObj = obj;
  }
  function release() {
    if (!heldObj) return;
    const home = heldObj.userData.home;
    scene.attach(heldObj);
    heldObj.position.copy(home.pos);
    heldObj.quaternion.copy(home.quat);
    heldObj = null;
  }

  async function pick(action) {
    const kind = action === "pick-ball" ? "ball" : "cube";
    const obj = props[kind];
    if (!obj) return;
    const poses = obj.userData.poses;

    busy = true;
    setControlsEnabled(false);
    release(); // put any held prop back first

    setStatus("opening gripper…");
    await animatePose({ gripper_joint: GRIP_OPEN }, 250);
    setStatus(`reaching for ${kind}…`);
    await animatePose(poses.approach, 800);
    await animatePose(poses.grasp, 600);
    setStatus(`grasping ${kind}…`);
    await animatePose({ gripper_joint: GRIP_CLOSE }, 350);
    attach(obj);
    setStatus(`lifting ${kind}…`);
    await animatePose(poses.lift, 800);
    setStatus(`holding ${kind} — Reset pose to place it back`);

    busy = false;
    setControlsEnabled(true);
  }

  async function doReset() {
    busy = true;
    setControlsEnabled(false);
    release();
    setStatus("returning home…");
    await animatePose({ ...homePose(), gripper_joint: GRIP_OPEN }, 700);
    setStatus("ready — pose with sliders, or run a pick demo");
    busy = false;
    setControlsEnabled(true);
  }

  if (resetBtn) resetBtn.addEventListener("click", () => { if (!busy) doReset(); });

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
