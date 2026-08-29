// Node daily-update script: fetches Hacker News, GitHub, arXiv and Semantic
// Scholar, ranks with the same RadarCore rules as the browser, and writes
// daily-radar.json, daily-radar.md and demo-data.js.
// Run: node ./run-demo.mjs
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import RadarCore from "./radar-core.mjs";
import { parseArxivAtom } from "./arxiv-atom.mjs";

const OUTPUT_JSON = "daily-radar.json";
const OUTPUT_MD = "daily-radar.md";
const OUTPUT_JS = "demo-data.js";
const BACKUP_JSON = "daily-radar.json.bak";
const BACKUP_MD = "daily-radar.md.bak";
const BACKUP_JS = "demo-data.js.bak";

const GITHUB_REPOS_PER_QUERY = 10;
const GITHUB_PUSHED_WINDOW_DAYS = 30;
const ARXIV_PAPERS_PER_QUERY = 10;
const ARXIV_REQUEST_DELAY_MS = 3000;
const SEMANTIC_SCHOLAR_PAPERS_PER_QUERY = 10;

const HN_WINDOW_DAYS = 1;
const HN_HITS_PER_QUERY = 30;

const USER_AGENT = "obsession-radar/1.0";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchHnStories() {
  const sinceUnix = Math.floor((Date.now() - HN_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);
  const batches = await Promise.all(
    RadarCore.AI_QUERIES.map(async (query) => {
      const url =
        "https://hn.algolia.com/api/v1/search_by_date" +
        `?tags=story&query=${encodeURIComponent(query)}` +
        `&numericFilters=created_at_i>${sinceUnix}` +
        `&hitsPerPage=${HN_HITS_PER_QUERY}`;
      const payload = await fetchJson(url, { "User-Agent": USER_AGENT });
      return (payload.hits || []).map((hit) => ({
        id: hit.objectID,
        title: hit.title || hit.story_title || "Untitled HN story",
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: "Hacker News",
        points: hit.points || 0,
        comments: hit.num_comments || 0,
        author: hit.author || "unknown",
        createdAt: hit.created_at,
        storyText: hit.story_text || "",
        matchedQueries: [query],
      }));
    }),
  );
  const stories = batches.flat();
  if (!stories.length) throw new Error("no HN stories fetched");
  return stories.filter(RadarCore.isAiRelatedStory).map(RadarCore.enrichAiStory);
}

async function fetchGithubRepoQuery(query, pushedAfterDate) {
  const search = `topic:${query} pushed:>${pushedAfterDate}`;
  const url =
    "https://api.github.com/search/repositories" +
    `?q=${encodeURIComponent(search)}&sort=stars&order=desc&per_page=${GITHUB_REPOS_PER_QUERY}`;
  const payload = await fetchJson(url, { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT });
  return (payload.items || []).map((repo) => RadarCore.githubRepoToStory(repo, query));
}

async function fetchGithubRepoStories() {
  const pushedAfterDate = new Date(Date.now() - GITHUB_PUSHED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const batches = [];
  for (const query of RadarCore.GITHUB_AI_QUERIES) {
    batches.push(await fetchGithubRepoQuery(query, pushedAfterDate));
  }
  const stories = batches.flat();
  if (!stories.length) throw new Error("no GitHub repositories fetched");
  return stories.filter(RadarCore.isAiRelatedStory).map(RadarCore.enrichAiStory);
}

async function fetchArxivPaperQuery(query) {
  const url =
    "https://export.arxiv.org/api/query" +
    `?search_query=${encodeURIComponent(query.searchQuery)}` +
    `&start=0&max_results=${ARXIV_PAPERS_PER_QUERY}&sortBy=submittedDate&sortOrder=descending`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  return parseArxivAtom(xml).map((entry) => RadarCore.arxivPaperToStory(entry, query.label));
}

async function fetchArxivPaperStories() {
  const batches = [];
  for (const query of RadarCore.PAPER_QUERIES) {
    if (batches.length > 0) await sleep(ARXIV_REQUEST_DELAY_MS);
    try {
      batches.push(await fetchArxivPaperQuery(query));
    } catch {
      // Keep other paper queries alive when arXiv has a transient 503/429.
    }
  }
  return batches.flat().filter(RadarCore.isAiRelatedStory).map(RadarCore.enrichAiStory);
}

const SEMANTIC_SCHOLAR_FIELDS = [
  "paperId",
  "title",
  "abstract",
  "url",
  "venue",
  "year",
  "publicationDate",
  "authors",
  "citationCount",
  "influentialCitationCount",
  "openAccessPdf",
  "externalIds",
  "fieldsOfStudy",
].join(",");

async function fetchSemanticScholarPapers(query, label, limit) {
  const url =
    "https://api.semanticscholar.org/graph/v1/paper/search" +
    `?query=${encodeURIComponent(query)}&limit=${limit}&fields=${SEMANTIC_SCHOLAR_FIELDS}`;
  const payload = await fetchJson(url, { Accept: "application/json", "User-Agent": USER_AGENT });
  return (payload.data || [])
    .map((paper) => RadarCore.semanticScholarPaperToStory(paper, label))
    .filter((paper) => paper.title && paper.url);
}

async function fetchSemanticScholarPaperStories() {
  const batches = [];
  for (const query of RadarCore.PAPER_QUERIES) {
    try {
      batches.push(
        await fetchSemanticScholarPapers(
          query.semanticQuery || query.label,
          query.label,
          SEMANTIC_SCHOLAR_PAPERS_PER_QUERY,
        ),
      );
    } catch {
      // Public scholarly APIs can rate-limit individual queries; keep partial results.
    }
  }
  return batches.flat().filter(RadarCore.isAiRelatedStory).map(RadarCore.enrichAiStory);
}

async function collectStories() {
  const errors = [];
  const paperErrors = [];

  const jobs = [
    ["HN", fetchHnStories()],
    ["GitHub", fetchGithubRepoStories()],
  ];
  const settled = await Promise.all(
    jobs.map(async ([name, promise]) => {
      try {
        return { name, stories: await promise, error: "" };
      } catch (error) {
        return { name, stories: [], error: error.message || String(error) };
      }
    }),
  );
  for (const result of settled) {
    if (result.error) errors.push(`${result.name}: ${result.error}`);
  }

  // Paper sources run sequentially: arXiv enforces 3s between requests and
  // Semantic Scholar rate-limits aggressively.
  let arxivStories = [];
  let semanticScholarStories = [];
  try {
    arxivStories = await fetchArxivPaperStories();
  } catch (error) {
    paperErrors.push(`arXiv: ${error.message || error}`);
  }
  try {
    semanticScholarStories = await fetchSemanticScholarPaperStories();
  } catch (error) {
    paperErrors.push(`Semantic Scholar: ${error.message || error}`);
  }

  const mainStories = settled.flatMap((result) => result.stories);
  const paperStories = [...arxivStories, ...semanticScholarStories];

  return { mainStories, paperStories, errors: [...errors, ...paperErrors] };
}

function backupExistingOutputs() {
  for (const [target, backup] of [
    [OUTPUT_JSON, BACKUP_JSON],
    [OUTPUT_MD, BACKUP_MD],
    [OUTPUT_JS, BACKUP_JS],
  ]) {
    if (existsSync(target)) copyFileSync(target, backup);
  }
}

function restoreBackups() {
  for (const [target, backup] of [
    [OUTPUT_JSON, BACKUP_JSON],
    [OUTPUT_MD, BACKUP_MD],
    [OUTPUT_JS, BACKUP_JS],
  ]) {
    if (existsSync(backup)) {
      renameSync(backup, target);
    } else if (existsSync(target)) {
      unlinkSync(target);
    }
  }
}

function removeBackups() {
  for (const backup of [BACKUP_JSON, BACKUP_MD, BACKUP_JS]) {
    if (existsSync(backup)) unlinkSync(backup);
  }
}

function writeOutputs(radar, paperRadar) {
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    totalFetched: radar.totalFetched,
    uniqueCount: radar.uniqueCount,
    candidates: radar.candidates,
    recommendations: radar.recommendations,
    paperRadar,
  };
  writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
  writeFileSync(OUTPUT_MD, RadarCore.toMarkdown(payload), "utf8");
  writeFileSync(OUTPUT_JS, "window.AGENTS_RADAR_LITE = " + JSON.stringify(payload, null, 2) + ";\n", "utf8");
  return payload;
}

function validateOutputs(payload) {
  const mainCandidates = payload.candidates?.length || 0;
  const mainRecommendations = payload.recommendations?.length || 0;
  const paperCandidates = payload.paperRadar?.candidates?.length || 0;
  if (mainCandidates === 0 && mainRecommendations === 0) {
    throw new Error("main radar is empty");
  }
  if (paperCandidates === 0 && paperRadarMissingPapers(payload)) {
    throw new Error("paper radar is empty");
  }
  return { mainCandidates, mainRecommendations, paperCandidates };
}

function paperRadarMissingPapers(payload) {
  return (payload.paperRadar?.recommendations?.length || 0) === 0;
}

async function main() {
  console.log("[run-demo] fetching sources...");
  const { mainStories, paperStories, errors } = await collectStories();
  console.log(`[run-demo] main=${mainStories.length} papers=${paperStories.length} errors=${errors.length}`);

  const radar = RadarCore.buildDailyRadar(mainStories);
  const paperRadar = RadarCore.buildPaperRadar(paperStories);

  backupExistingOutputs();
  let payload;
  try {
    payload = writeOutputs(radar, paperRadar);
    const stats = validateOutputs(payload);
    removeBackups();
    console.log(
      `[run-demo] ok: main ${stats.mainCandidates}/${stats.mainRecommendations}, papers ${stats.paperCandidates}/${payload.paperRadar.recommendations.length}`,
    );
    if (errors.length) {
      console.warn(`[run-demo] partial-source warnings:\n  - ${errors.join("\n  - ")}`);
    }
  } catch (error) {
    restoreBackups();
    throw error;
  }

  if (!mainStories.length && !paperStories.length) {
    throw new Error("all sources failed");
  }
}

main().catch((error) => {
  console.error(`[run-demo] FAILED: ${error.message || error}`);
  process.exitCode = 1;
});
