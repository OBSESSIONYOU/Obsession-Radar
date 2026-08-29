// ESM wrapper around radar-core.browser.js so the Node daily-update script
// shares the exact same scoring/ranking logic as the browser without
// duplicating 40KB of rules.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "radar-core.browser.js"), "utf8");

const fakeWindow = { location: { protocol: "node:" } };
new Function("window", source)(fakeWindow);

if (!fakeWindow.RadarCore) {
  throw new Error("radar-core.browser.js did not attach RadarCore");
}

export const RadarCore = fakeWindow.RadarCore;
export default RadarCore;
