# zimbot97.github.io

Personal portfolio site for **Brian Lai (Lai Lap Hong)** — a robotics software engineer working on
autonomous navigation, LiDAR perception, SLAM, and ROS/ROS2 systems for field robots.

🔗 **Live:** https://zimbot97.github.io

A static, dependency-free single-page site (English + Chinese) with two interactive WebGL viewers:
an **interactive URDF viewer** for a 6-DOF arm and a **Gaussian-splat 3D scan** viewer, both rendered
in-browser with three.js.

## Highlights

- **Interactive URDF viewer** — the 6-DOF arm's original URDF + STL meshes rendered live with
  [urdf-loader](https://github.com/gkjohnson/urdf-loaders) and [three.js](https://threejs.org).
  Orbit / zoom / pan, per-joint sliders, and an animated "Reset pose".
- **Gaussian-splat showcase** — a 3D reconstruction rendered with
  [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D); loads a hosted model or a local file.
- **Bilingual** — English (`index.html`) and Chinese (`index_zh.html`), sharing one stylesheet and script.
- **Light / dark theme** toggle (dark by default), animated hero point-cloud, and scroll reveals.
- No build step, no framework — plain HTML/CSS/JS served straight from GitHub Pages.

## Project structure

```
.
├── index.html              # Main page (English)
├── index_zh.html           # Chinese page
├── assets/
│   ├── style.css           # All styling (shared by both pages)
│   ├── main.js             # Theme, nav, hero canvas, reveals, splat viewer
│   ├── urdf.js             # Interactive URDF viewer (three.js + urdf-loader)
│   ├── urdf/               # Robot model served to the viewer
│   │   ├── robotics_arm.urdf
│   │   └── meshes/*.STL
│   └── ply/                # Gaussian-splat model(s)
└── resource/               # Images, résumés (EN/CN), project media
```

Third-party libraries (three.js, urdf-loader, GaussianSplats3D) are loaded at runtime from the
[unpkg](https://unpkg.com) CDN via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)
in each HTML file — there are no vendored `node_modules`.

## Running locally

The viewers use ES modules and `fetch`, so a local web server is required (`file://` will not work):

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment

Hosted on **GitHub Pages** from the `main` branch. Pushing to `main` publishes automatically —
no build or CI step.

## Updating the URDF model

The arm is served from `assets/urdf/`. To swap in a different robot:

1. Copy the `.urdf` and its meshes into `assets/urdf/` (meshes under `assets/urdf/meshes/`).
2. In [`assets/urdf.js`](assets/urdf.js), update `URDF_URL` and the `PACKAGES` map so
   `package://<pkg_name>/...` paths in the URDF resolve to the mesh folder.

## Contact

- GitHub — [github.com/zimbot97](https://github.com/zimbot97)
- LinkedIn — [linkedin.com/in/brianlailaphong](https://linkedin.com/in/brianlailaphong)
