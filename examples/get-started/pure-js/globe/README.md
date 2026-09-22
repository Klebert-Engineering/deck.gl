## Example: Use deck.gl GlobeView

Uses [Vite](https://vitejs.dev/) to bundle and serve files.

## Usage

To install dependencies:

```bash
npm install
# or
yarn
```

Commands:

* `npm start` is the development target, to serve the app and hot reload.
* `npm run build` is the production target, to create the final bundle and write to disk.

To use the experimental target-navigation fork from this checkout, build the repository
first, then run `npm run start-local` from this example directory. Open `/?target-navigation` to show a point
100 km above the globe, starting at spherical zoom 4. Drag to move it, right-drag to orbit it, or wheel/pinch to approach it.
Choose built-in picking or a synchronous numeric provider; the provider returns only the coordinate
and its freshly projected pixel. The null-provider choice intentionally selects stock navigation.
Disable the option for comparison, or reset to cancel the old controller through a new view identity.
The non-interactive marker/status uses only public `interactionTargetPosition` and `viewId`.
No feature object is retained by the controller.

The target mode uses only in-memory geometry and does not fetch countries or airports. It works
without runtime external services after dependency installation; the ordinary Globe example's remote
datasets are unchanged. Check a production bundle against the fork with:

```bash
npm run build -- --config ../../../vite.config.local.mjs
```

Do not use a plain stable-package build as proof of fork integration. Async GPU picking falls back
to stock unless a synchronous provider returns a fresh coordinate. Globe/Mercator projection changes
end the target session; this demo does not promise cross-projection invariants, orthographic navigation,
collision avoidance or FirstPerson support.
This example uses the fork's root package API; published stable packages do not yet expose it.
See [GlobeController target navigation](https://deck.gl/docs/api-reference/core/globe-controller).
