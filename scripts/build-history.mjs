// Builds history.json from the git history of daily-radar.json.
// Each daily-update commit becomes one archive day: top recommendations,
// candidate source mix, and (when present) coverage — the trend-lookback
// dataset for the frontend. Run: node scripts/build-history.mjs [--days=30]
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = "daily-radar.json";
const RETENTION_DAYS = 30;

function listDailyCommits(limitDays) {
  // Newest first from git log; keep one commit per day, then oldest first.
  // %x7c is the hex escape for "|" — a literal pipe would be parsed as a
  // shell pipe by cmd.exe on Windows.
  const log = execSync(
    `git log --format=%H%x7c%ad --date=format:%Y-%m-%d -- ${DATA_PATH}`,
    { cwd: root, maxBuffer: 10e6 },
  ).toString("utf8");
  const seenDays = new Set();
  const rows = [];
  for (const line of log.split("\n").filter(Boolean)) {
    const [hash, date] = line.split("|");
    if (seenDays.has(date)) continue;
    seenDays.add(date);
    rows.push({ hash, date });
  }
  // rows are newest-first; keep the most recent `limitDays` in oldest-first order.
  return rows.slice(0, limitDays).reverse();
}

function loadRadarAt(hash) {
  const blob = execSync(`git show ${hash}:${DATA_PATH}`, { cwd: root, maxBuffer: 30e6 }).toString("utf8");
  return JSON.parse(blob);
}

function summarize(radar) {
  const bySource = {};
  for (const candidate of radar.candidates || []) {
    const source = candidate.source || "unknown";
    bySource[source] = (bySource[source] || 0) + 1;
  }
  return {
    generatedAt: radar.generatedAt || "",
    totalFetched: radar.totalFetched ?? 0,
    uniqueCount: radar.uniqueCount ?? 0,
    recommendations: (radar.recommendations || []).map((story) => ({
      title: story.title,
      url: story.url,
      source: story.source || "",
      score: story.score ?? 0,
      points: story.points ?? 0,
    })),
    paperRecommendations: (radar.paperRadar?.recommendations || []).map((paper) => ({
      title: paper.title,
      url: paper.url,
      source: paper.source || "",
      score: paper.score ?? 0,
    })),
    sourceMix: bySource,
    coverage: (radar.coverage || []).map((item) => ({
      name: item.name,
      status: item.status,
      found: item.found ?? 0,
    })),
  };
}

function buildHistory(limitDays = RETENTION_DAYS) {
  const commits = listDailyCommits(limitDays);
  const days = [];
  for (const { hash, date } of commits) {
    try {
      days.push({ date, ...summarize(loadRadarAt(hash)) });
    } catch (error) {
      console.warn(`[history] skip ${date}: ${error.message}`);
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    retentionDays: RETENTION_DAYS,
    timezone: "Asia/Shanghai",
    days,
  };
  const outPath = join(root, "history.json");
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`[history] wrote ${days.length} days to ${outPath}`);
  return payload;
}

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
buildHistory(daysArg ? Number.parseInt(daysArg.slice(7), 10) || RETENTION_DAYS : RETENTION_DAYS);
