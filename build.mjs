// https://esbuild.github.io/getting-started/#build-scripts
// this build script should be used via `npm run build` (see package.json scripts)

import * as esbuild from "esbuild"
import { copyFileSync } from "node:fs"
import path from "node:path"

const srcdir = "src"
const outdir = "dist"

// bundle the js and css files
await esbuild.build({
    entryPoints: [
        path.join(srcdir, "main.ts"),
        path.join(srcdir, "main.css"),
    ],
    bundle: true,
    outdir: outdir,
    minify: true,
    sourcemap: true,
    target: "esnext",
})

// copy static files to the bundle dir
const filePathComponents = [["index.html"], ["ontologies", "fdp-o.ttl"]];
filePathComponents.forEach(pathComponents => {
    copyFileSync(path.join(srcdir, ...pathComponents), path.join(outdir, pathComponents.at(-1)))
});
