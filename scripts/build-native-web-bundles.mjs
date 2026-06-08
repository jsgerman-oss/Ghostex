#!/usr/bin/env bun
import { transformAsync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourceRootPrefixes = [
  `${path.join(repoRoot, "native", "sidebar")}${path.sep}`,
  `${path.join(repoRoot, "sidebar")}${path.sep}`,
  `${path.join(repoRoot, "shared")}${path.sep}`,
];

/*
CDXC:ReactCompiler 2026-06-06-21:20:
Ghostex.app ships the native sidebar, modal host, titlebar, tasks placeholder, and pet view as Bun-built WKWebView bundles, so installing React Compiler alone would not optimize this path.
Run React Compiler as a Babel transform inside the Bun build so native sidebar render churn gets compiler memoization while preserving the exact bundle filenames the host inlines.

CDXC:ReactCompiler 2026-06-06-21:20:
The compiler can replace pure component memo wrappers, but explicit useMemo/useCallback calls that cache expensive derivations, context values, or ref/effect identities should stay until each one is proven redundant.
*/
function shouldRunReactCompiler(filePath) {
  const absolutePath = path.resolve(filePath);
  return sourceRootPrefixes.some((prefix) => absolutePath.startsWith(prefix));
}

function loaderFor(filePath) {
  const extension = path.extname(filePath);
  if (extension === ".tsx") {
    return "tsx";
  }
  if (extension === ".ts") {
    return "ts";
  }
  if (extension === ".jsx") {
    return "jsx";
  }
  return "js";
}

function createReactCompilerPlugin() {
  return {
    name: "ghostex-react-compiler",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (!shouldRunReactCompiler(args.path)) {
          return undefined;
        }

        const source = await readFile(args.path, "utf8");
        const result = await transformAsync(source, {
          babelrc: false,
          compact: false,
          configFile: false,
          filename: args.path,
          parserOpts: {
            plugins: [
              "jsx",
              ["typescript", { disallowAmbiguousJSXLike: false, isTSX: args.path.endsWith(".tsx") }],
            ],
            sourceType: "module",
          },
          plugins: [reactCompiler],
        });

        return {
          contents: result?.code ?? source,
          loader: loaderFor(args.path),
        };
      });
    },
  };
}

function parseArgs(argv) {
  const parsed = {
    entrypoints: [],
    outdir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--outdir") {
      parsed.outdir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--outdir=")) {
      parsed.outdir = arg.slice("--outdir=".length);
      continue;
    }
    parsed.entrypoints.push(arg);
  }

  if (parsed.entrypoints.length === 0 || parsed.outdir.length === 0) {
    throw new Error(
      "Usage: bun scripts/build-native-web-bundles.mjs --outdir <dir> <entrypoint...>",
    );
  }

  return parsed;
}

const { entrypoints, outdir } = parseArgs(process.argv.slice(2));
const result = await Bun.build({
  entrypoints,
  format: "iife",
  naming: {
    asset: "[name].[ext]",
    entry: "[name].[ext]",
  },
  outdir,
  plugins: [createReactCompilerPlugin()],
  target: "browser",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
