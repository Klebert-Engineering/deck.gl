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
100 km above the globe. Drag to move it, right-drag to orbit it, or wheel/pinch to approach it.
The synchronous provider returns only the coordinate, its freshly projected pixel, and a
one-kilometre demonstration distance floor. No feature object is retained by the controller.
This example uses the fork's root package API; published stable packages do not yet expose it.
See [GlobeController target navigation](https://deck.gl/docs/api-reference/core/globe-controller).
