#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "source-root": { type: "string" },
    target: { type: "string" },
  },
});

const sourceRoot = values["source-root"];
const target = values.target;
if (!sourceRoot || !target) {
  throw new Error("Usage: package-t3code-server.mjs --source-root <t3code-root> --target <package-dir>");
}

const rootPackage = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
const serverPackage = JSON.parse(await readFile(join(sourceRoot, "apps", "server", "package.json"), "utf8"));
const catalog = rootPackage.workspaces?.catalog ?? {};
const dependencies = {};

for (const [name, specifier] of Object.entries(serverPackage.dependencies ?? {})) {
  const resolvedSpecifier = specifier === "catalog:" ? catalog[name] : specifier;
  if (!resolvedSpecifier || resolvedSpecifier === "workspace:*") {
    throw new Error(`Unable to resolve runtime dependency ${name} from t3code package metadata.`);
  }
  dependencies[name] = await exactInstalledVersion(sourceRoot, name, resolvedSpecifier);
}

/*
CDXC:T3CodePackaging 2026-06-06-05:50:
The packaged Ghostex app runs T3 Code from Web/t3code-server/dist/bin.mjs.
Generate a standalone package manifest with resolved catalog dependencies so npm can materialize production node_modules inside the app resources instead of depending on the developer monorepo layout.
*/
await writeFile(
  join(target, "package.json"),
  `${JSON.stringify(
    {
      name: "ghostex-t3code-server",
      private: true,
      type: "module",
      version: serverPackage.version ?? "0.0.0",
      bin: { t3: "./dist/bin.mjs" },
      dependencies,
      engines: serverPackage.engines,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

async function exactInstalledVersion(sourceRoot, packageName, fallbackSpecifier) {
  const packageJsonPath = join(
    sourceRoot,
    "apps",
    "server",
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // The generated package is still valid with the source specifier; the build
    // script's npm install smoke test will fail if the dependency cannot resolve.
  }
  return fallbackSpecifier;
}
