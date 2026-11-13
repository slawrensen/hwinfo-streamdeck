import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.lawrensen.hwinfo.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "es",
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	// The hwsm native bridge is loaded via createRequire("./hwsm.node") at
	// runtime (scripts/copy-hwsm.mjs vendors it beside the bundle); nothing
	// here imports a native module statically, so no externals.
	external: [],
	// @elgato/utils declares no sideEffects, so rollup keeps its barrel's
	// Option/OptionGroup modules for their top-level z.object() calls even
	// though nothing imports a binding from them, dragging all of zod
	// (~14 KB minified) into the bundle. The SDK runtime only uses
	// Enumerable/EventEmitter/withResolvers/Lazy. Marking the lists/ modules
	// side-effect free lets rollup drop them, and zod falls out with its
	// last importer; if a future SDK version starts importing Option, the
	// modules are retained again automatically, and the bundle gate
	// (scripts/bundle-inventory.mjs, in the unit suite and in CI) fails on
	// the zod that comes back with them.
	// ws's ESM entry (wrapper.mjs) re-exports WebSocketServer,
	// createWebSocketStream and subprotocol. The SDK imports only the default
	// client, but rollup keeps CommonJS modules for their side effects, so
	// about 7.5 KB of server code shipped. Marked side-effect free, the three
	// drop out. They come back on their own if the client ever requires one.
	treeshake: {
		moduleSideEffects: (id) => !/[\\/]@elgato[\\/]utils[\\/]dist[\\/]lists[\\/]/.test(id) && !/[\\/]ws[\\/]lib[\\/](?:websocket-server|stream|subprotocol)\.js/.test(id)
	},
	plugins: [
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching &&
			terser({
				compress: { passes: 2 },
				format: { comments: false }
			}),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

export default config;
