/**
 * Finds every STATIC import path from a route's entry files to a target module.
 *
 * Exists because "I removed the static imports" is a claim that needs checking:
 * one missed edge anywhere in the graph keeps a 641 kB chunk on the critical
 * path, and the bundle output only tells you that it failed, not why.
 *
 * Dynamic `await import(...)` edges are deliberately ignored — those are the ones
 * that move code off the critical path.
 *
 * Usage: node scripts/trace-critical-imports.mjs firebase/firestore
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const target = process.argv[2] || "firebase/firestore";
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const ENTRIES = [
  "src/app/layout.tsx",
  "src/app/page.tsx",
];

/** Resolve an import specifier to a file on disk, or null if external. */
function resolve(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // node_modules
  for (const ext of [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]) {
    const f = base + ext;
    if (existsSync(f)) return f;
  }
  return existsSync(base) ? base : null;
}

/**
 * Static import specifiers only. `import(...)` is skipped by requiring the
 * statement to begin at a line start with `import`/`export ... from`.
 */
function staticImports(file) {
  const src = readFileSync(file, "utf8");
  const out = [];
  const re = /^[ \t]*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  // bare `import "x"` side-effect form
  const re2 = /^[ \t]*import\s+["']([^"']+)["']/gm;
  while ((m = re2.exec(src)) !== null) out.push(m[1]);
  return out;
}

const paths = [];
const visited = new Set();

function walk(file, trail) {
  if (visited.has(file)) return;
  visited.add(file);
  for (const spec of staticImports(file)) {
    if (spec === target || spec.startsWith(target + "/")) {
      paths.push([...trail, file, `[${spec}]`]);
      continue;
    }
    const next = resolve(spec, file);
    if (next) walk(next, [...trail, file]);
  }
}

for (const e of ENTRIES) {
  const f = path.join(ROOT, e);
  if (!existsSync(f)) continue;
  visited.clear();
  walk(f, []);
}

const rel = (f) => (f.startsWith("[") ? f : path.relative(ROOT, f));

if (paths.length === 0) {
  console.log(`No STATIC import path from the entry files reaches "${target}".`);
  console.log("If the bundle still loads it eagerly, the edge is outside src/ —");
  console.log("check next.config.ts, instrumentation files, or a barrel re-export.");
} else {
  console.log(`${paths.length} static path(s) from entry to "${target}":\n`);
  const seen = new Set();
  for (const p of paths) {
    const key = p.map(rel).join(" -> ");
    if (seen.has(key)) continue;
    seen.add(key);
    console.log("  " + p.map(rel).join("\n    -> "));
    console.log("");
  }
}
