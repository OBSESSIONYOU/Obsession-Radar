// Generates web-sources.browser.js from web-sources.mjs so Node and the browser share
// one parser implementation (same pattern as radar-core.mjs reusing radar-core.browser.js).
// Run: node scripts/build-web-sources-browser.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "web-sources.mjs"), "utf8");

const body = source
  .replace(/^export const /gm, "const ")
  .replace(/^export function /gm, "function ")
  .replace(/^export \{[\s\S]*?\};?$/gm, "");

const banner = "// GENERATED from web-sources.mjs - do not edit; run node scripts/build-web-sources-browser.mjs\n";
const wrapper = banner + "(function attachObsessionWebSources(global) {\n" + body + "\n  global.ObsessionWebSources = {\n    parseGithubTrending,\n    parseHnFrontPage,\n    parseHuggingfacePapers,\n    parseRssItems,\n    parsePapersCoolAtom,\n    WEB_SOURCES,\n    USER_AGENT,\n  };\n})(window);\n";

writeFileSync(join(root, "web-sources.browser.js"), wrapper, "utf8");
console.log("web-sources.browser.js generated");