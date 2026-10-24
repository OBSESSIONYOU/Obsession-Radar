// Tests for the momentum quadrant chart module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "radar-chart.browser.js"), "utf8");
const fakeWindow = {};
new Function("window", source)(fakeWindow);
const Chart = fakeWindow.ObsessionRadarChart;

const radar = () => ({
  candidates: [
    { source: "Hacker News", matchedQueries: ["front page"] },
    { source: "GitHub Trending", matchedQueries: ["AI", "trending"] },
    { source: "arXiv", matchedQueries: ["LLM"] },
  ],
  paperRadar: {
    candidates: [
      { source: "arXiv", matchedQueries: ["LLM"] },
      { source: "HF Papers", matchedQueries: [] },
    ],
  },
});

test("topicBlipsFromRadar aggregates topics with quadrants and dominant sources", () => {
  const blips = Chart.topicBlipsFromRadar(radar());
  assert.ok(blips.length >= 4);
  const front = blips.find((b) => b.topic === "front page");
  assert.equal(front.quadrant, "agents");
  assert.equal(front.dominantSource, "Hacker News");
  const ai = blips.find((b) => b.topic === "AI");
  assert.equal(ai.quadrant, "models");
  const arxivBlip = blips.find((b) => b.topic === "arXiv 论文");
  assert.ok(arxivBlip, "paper sources get their own blips");
  assert.equal(arxivBlip.quadrant, "research");
});

test("topicBlipsFromRadar caps at 14 blips", () => {
  const many = {
    candidates: Array.from({ length: 30 }, (_, i) => ({
      source: "GitHub Trending",
      matchedQueries: ["topic" + i],
    })),
    paperRadar: { candidates: [] },
  };
  assert.equal(Chart.topicBlipsFromRadar(many).length, 14);
});

test("sourceMomentum compares latest share to prior-week average", () => {
  const history = {
    days: [
      { date: "2026-10-01", sourceMix: { GitHub: 10, "Hacker News": 20 } },
      { date: "2026-10-02", sourceMix: { GitHub: 10, "Hacker News": 20 } },
      { date: "2026-10-03", sourceMix: { GitHub: 20, "Hacker News": 10 } },
    ],
  };
  const momentum = Chart.sourceMomentum(history, "GitHub");
  assert.ok(momentum > 0, "rising share should be positive");
  const falling = Chart.sourceMomentum(history, "Hacker News");
  assert.ok(falling < 0, "falling share should be negative");
  assert.equal(Chart.sourceMomentum({ days: [] }, "GitHub"), 0);
});

test("renderRadarChartSvg produces well-formed SVG with blips and labels", () => {
  const blips = Chart.topicBlipsFromRadar(radar());
  const svg = Chart.renderRadarChartSvg({ blips, history: { days: [] } });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  const circles = (svg.match(/<circle/g) || []).length;
  assert.ok(circles >= blips.length + 3, "blips plus three rings");
  const texts = (svg.match(/<text/g) || []).length;
  assert.ok(texts >= blips.length + 4, "blip labels plus four quadrant labels");
  assert.ok(svg.includes("模型与厂商"));
  assert.ok(svg.includes("科研与论文"));
});

test("renderRadarChartSvg escapes hostile topic labels", () => {
  const svg = Chart.renderRadarChartSvg({
    blips: [{ topic: "<script>alert(1)</script>", count: 3, quadrant: "models", dominantSource: "" }],
    history: { days: [] },
  });
  assert.ok(!svg.includes("<script>"), "raw script tag must not survive");
  assert.ok(svg.includes("&lt;script&gt;"));
});
