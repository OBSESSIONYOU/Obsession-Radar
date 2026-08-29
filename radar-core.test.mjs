import test from "node:test";
import assert from "node:assert/strict";
import RadarCore from "./radar-core.mjs";

function hnStory(overrides = {}) {
  return {
    id: "hn-1",
    title: "LLM agents in production",
    url: "https://example.com",
    source: "Hacker News",
    points: 100,
    comments: 40,
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    matchedQueries: ["LLM"],
    ...overrides,
  };
}

function githubStory(overrides = {}) {
  return {
    id: "github:me/repo",
    title: "me/repo",
    url: "https://github.com/me/repo",
    source: "GitHub",
    stars: 5000,
    forks: 300,
    openIssues: 20,
    createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    matchedQueries: ["llm"],
    ...overrides,
  };
}

test("RadarCore exposes the expected API surface", () => {
  for (const key of [
    "AI_QUERIES",
    "GITHUB_AI_QUERIES",
    "PAPER_QUERIES",
    "dedupeStories",
    "scoreStory",
    "scorePaper",
    "buildDailyRadar",
    "buildPaperRadar",
    "toMarkdown",
    "isAiRelatedStory",
    "githubRepoToStory",
    "arxivPaperToStory",
    "semanticScholarPaperToStory",
  ]) {
    assert.ok(RadarCore[key], `missing RadarCore.${key}`);
  }
});

test("buildDailyRadar ranks, dedupes and caps candidates", () => {
  const stories = [
    hnStory(),
    hnStory({ id: "hn-1", title: "duplicate" }),
    hnStory({ id: "hn-2", points: 5, comments: 1, title: "LLM tooling" }),
    githubStory(),
  ];
  const radar = RadarCore.buildDailyRadar(stories);
  assert.ok(radar.generatedAt);
  assert.equal(radar.totalFetched, stories.length);
  assert.ok(radar.candidates.length <= 30);
  assert.ok(radar.recommendations.length <= 5);
  assert.ok(radar.candidates.every((candidate) => typeof candidate.score === "number"));
});

test("buildPaperRadar ranks arXiv paper stories", () => {
  const paper = {
    id: "arxiv:2401.1v1",
    title: "Retrieval augmented generation survey",
    url: "https://arxiv.org/abs/2401.1v1",
    pdfUrl: "https://arxiv.org/pdf/2401.1v1",
    source: "arXiv",
    authors: ["A", "B"],
    categories: ["cs.AI", "cs.CL"],
    createdAt: new Date().toISOString(),
    abstract: "A survey of RAG methods.",
    matchedQueries: ["RAG"],
  };
  const paperRadar = RadarCore.buildPaperRadar([paper]);
  assert.ok(paperRadar.candidates.length >= 1);
  assert.ok(paperRadar.candidates[0].title.includes("Retrieval augmented generation"));
});

test("buildDailyRadar sourceQuota reserves slots per source", () => {
  const stories = [];
  for (let i = 0; i < 40; i += 1) {
    stories.push(hnStory({ id: `hn-${i}`, points: 1000 - i, title: `HN story ${i}` }));
  }
  for (let i = 0; i < 5; i += 1) {
    stories.push(githubStory({ id: `github:me/repo-${i}`, title: `me/repo-${i}` }));
  }
  for (let i = 0; i < 6; i += 1) {
    stories.push({
      id: `arxiv:2401.${i}v1`,
      title: `Paper ${i}`,
      url: `https://arxiv.org/abs/2401.${i}v1`,
      source: "arXiv",
      createdAt: new Date().toISOString(),
      abstract: "paper abstract text",
      matchedQueries: ["LLM"],
    });
  }
  const radar = RadarCore.buildDailyRadar(stories, { sourceQuota: { GitHub: 5, arXiv: 4 } });
  const bySource = {};
  for (const candidate of radar.candidates) {
    bySource[candidate.source] = (bySource[candidate.source] || 0) + 1;
  }
  assert.ok(bySource.GitHub >= 5, `expected at least 5 GitHub, got ${bySource.GitHub}`);
  assert.ok(bySource.arXiv >= 4, `expected at least 4 arXiv, got ${bySource.arXiv}`);
  assert.equal(radar.candidates.length, 30);
  assert.ok(radar.candidates.every((candidate) => candidate.score !== undefined));
});

test("buildDailyRadar without sourceQuota keeps legacy behavior", () => {
  const stories = [hnStory(), githubStory()];
  const radar = RadarCore.buildDailyRadar(stories);
  assert.equal(radar.candidates.length, 2);
});

test("toMarkdown renders a report with title and links", () => {
  const radar = RadarCore.buildDailyRadar([hnStory(), githubStory()]);
  const markdown = RadarCore.toMarkdown(radar);
  assert.match(markdown, /https:\/\/example\.com/);
  assert.ok(markdown.length > 100);
});
