# Three.js Editor source pin

- Upstream: https://github.com/mrdoob/three.js/tree/2431a09f46f34c560bc8e44b33be0e567723d5b9/editor
- Revision: `r185`, commit `2431a09f46f34c560bc8e44b33be0e567723d5b9`
- License: MIT; see `LICENSE` copied from the pinned upstream repository.
- The browser editor is built from `admin/src/vendor/threejs-editor/` by the admin Vite multi-page build and served at `/threejs-editor/`.
- Required upstream `editor/` files are vendored intact. `bootstrap.js` is the DigiWorld entry adapter; `Menubar.Status.js` removes upstream's misleading browser-local autosave indicator because it is not the DigiWorld persistence path.
- Runtime dependencies needed by the official editor are pinned in `admin/package.json`; the upstream `editor/examples/`, Three.js example fonts and decoder support files are served from `admin/public/examples/`.

To update: choose a tagged/reproducible Three.js revision; copy its `editor/` tree and `LICENSE`; update the bootstrap imports/entry as required; inspect upstream imports for `three-gpu-pathtracer`, `three-mesh-bvh`, fonts, decoders and all absolute example paths; rebuild the admin and repeat the headed iframe smoke test. Never replace this source at runtime with the mutable `threejs.org/editor/` deployment.
