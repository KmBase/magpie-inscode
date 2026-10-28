/**
 * Smoke test: simulate what the Magpie/OpenCode plugin host does with this
 * entry module — import it, call every exported function as a plugin, run the
 * returned config / provider / auth hooks, and print what the UI would show.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// --- 1. How the host picks the entry (per docs: exports["./server"] > main > exports["."] > index.*) ---
const pkgRoot = pathToFileURL(require.resolve("../package.json")).href.replace(/package\.json$/, "");
let entry = null;
if (pkg.exports?.["./server"]) entry = new URL(pkg.exports["./server"], pkgRoot).href;
else if (pkg.main) entry = new URL(pkg.main, pkgRoot).href;
else entry = new URL("index.mjs", pkgRoot).href;
console.log("> entry selected:", entry);

// --- 2. Import and call every function export as a plugin (OpenCode behavior) ---
const mod = await import(entry);
console.log("> module exports:", Object.keys(mod));

for (const [name, value] of Object.entries(mod)) {
  if (typeof value !== "function") {
    console.log(`> export ${name}: ${typeof value} -> skipped (not a function)`);
    continue;
  }
  console.log(`> calling export "${name}" as a plugin...`);
  let hooks;
  try {
    hooks = await value({ client: {} }, undefined);
  } catch (err) {
    console.log(`>   THREW: ${err.message}`);
    continue;
  }
  console.log(`>   returned hook keys: ${hooks ? Object.keys(hooks).join(", ") : "(none)"}`);
  const hookNames = hooks ? Object.keys(hooks).sort() : [];
  const ok = ["config", "auth", "provider"].every((h) => hookNames.includes(h));
  console.log(`>   has config/auth/provider: ${ok}`);

  // --- 3. Run the config hook, inspect the declared provider ---
  if (typeof hooks?.config === "function") {
    const cfg = {};
    try {
      await hooks.config(cfg);
      const providerKey = Object.keys(cfg.provider ?? {})[0];
      const p = cfg.provider?.[providerKey];
      console.log(`>   config -> provider "${providerKey}":`, JSON.stringify(p, null, 2));
    } catch (err) {
      console.log(`>   config hook THREW: ${err.message}`);
    }
  }

  // --- 4. Run auth.methods[0] authorize with no local creds (what the login shows) ---
  const auth = hooks?.auth;
  if (auth?.methods?.length) {
    const m = auth.methods[0];
    console.log(`>   auth.methods[0]: type=${m.type}, label=${m.label}, prompts=${m.prompts?.map((p) => p.key).join(",") ?? "(none)"}`);
    if (typeof m.authorize === "function") {
      // No user input at all — first thing the UI does after "add"
      try {
        const r = await m.authorize(undefined);
        console.log(`>   authorize() ->`, JSON.stringify(r).slice(0, 200));
      } catch (err) {
        console.log(`>   authorize() THREW: ${err.message}`);
      }
    }
  }
}