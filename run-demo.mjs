// Node daily-update script: fetches Hacker News, GitHub, arXiv and Semantic
// Scholar, ranks with the same RadarCore rules as the browser, and writes
// daily-radar.json, daily-radar.md and demo-data.js.
// Run: node ./run-demo.mjs
import { writeFileSync, existsSync, copyFileSync, renameSync, unlinkSync, readFileSync } from "node:fs";
import RadarCore from "./radar-core.mjs";
import { parseArxivAtom } from "./arxiv-atom.mjs";
import { WEB_SOURCES, USER_AGENT } from "./web-sources.mjs";

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

// USER_AGENT comes from web-sources.mjs so API and page fetches share one identity.

const startedAt = new Date();
const CODE_LINK_CONCURRENCY = 4;
const CODE_LINK_BATCH_DELAY_MS = 1000;

function writeLastRun(ok, message, diagnostics = {}) {
  const payload = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ok,
    exitCode: ok ? 0 : 1,
    message,
    diagnostics,
  };
  const json = JSON.stringify(payload, null, 2);
  writeFileSync("last-run.json", json + "\n", "utf8");
  writeFileSync("last-run-data.js", "window.AGENTS_RADAR_LITE_LAST_RUN = " + json + ";\n", "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runQueriesWithSettledState(queries, runner, delayMs = 0) {
  return Promise.all(
    queries.map((query, index) => {
      const execution = index > 0 && delayMs > 0
        ? sleep(index * delayMs).then(() => runner(query))
        : runner(query);
      return execution
        .then((items) => ({ query, items }))
        .catch((error) => ({ query, items: [], error: error.message || String(error) }));
    }),
  );
}

function formatQueryLabel(query) {
  if (typeof query === "string") return query;
  if (query?.label) return query.label;
  if (query?.semanticQuery) return query.semanticQuery;
  if (query?.searchQuery) return query.searchQuery;
  if (query?.query) return query.query;
  return "unknown query";
}

function summarizeSettledErrors(staged) {
  return staged.filter((item) => item.error).map((item) => `${formatQueryLabel(item.query)}: ${item.error}`);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Fetch one no-API web source (HTML/RSS/Atom page), parse it, and report
// coverage honestly: visited-ok / visited-empty / unreachable, mirroring the
// coverage discipline of aggregator sites we studied. Fetches are sequential
// with a small delay to stay polite to pages that have no API contract.
const WEB_SOURCE_DELAY_MS = 1500;

function webStoryAdapter(name) {
  if (name === "GitHub Trending") return RadarCore.githubTrendingToStory;
  if (name === "HN Front Page") return RadarCore.hnFrontToStory;
  if (name === "HF Daily Papers") return RadarCore.hfPaperToStory;
  if (name === "papers.cool") return RadarCore.papersCoolToStory;
  if (name === "QbitAI") return (entry) => RadarCore.rssNewsToStory(entry, "QbitAI");
  if (name === "Solidot") return (entry) => RadarCore.rssNewsToStory(entry, "Solidot");
  return (entry) => RadarCore.rssNewsToStory(entry, name);
}

async function fetchWebSource(source) {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/rss+xml,application/atom+xml,text/xml,*/*" },
    });
    if (!response.ok) {
      return {
        name: source.name,
        url: source.url,
        status: `HTTP ${response.status}`,
        found: 0,
        observedAt: startedAt,
        stories: [],
      };
    }
    const text = await response.text();
    const entries = source.parse(text);
    const adapter = webStoryAdapter(source.name);
    const stories = entries.map(adapter);
    return {
      name: source.name,
      url: source.url,
      status: entries.length ? `ok (${entries.length} parsed)` : "ok (empty result)",
      found: entries.length,
      observedAt: startedAt,
      stories,
    };
  } catch (error) {
    return {
      name: source.name,
      url: source.url,
      status: `unreachable: ${error.message || error}`,
      found: 0,
      observedAt: startedAt,
      stories: [],
    };
  }
}

async function collectWebSources(diagnostics) {
  const results = [];
  for (const [index, source] of WEB_SOURCES.entries()) {
    if (index > 0) await sleep(WEB_SOURCE_DELAY_MS);
    const result = await fetchWebSource(source);
    results.push(result);
    if (result.found === 0) {
      diagnostics.warnings.push(`web source ${source.name}: ${result.status}`);
    }
  }
  return results;
}

async function fetchHnStories() {
  const sinceUnix = Math.floor((Date.now() - HN_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);
  const settled = await runQueriesWithSettledState(RadarCore.AI_QUERIES, (query) => {
    const url =
      "https://hn.algolia.com/api/v1/search_by_date" +
      `?tags=story&query=${encodeURIComponent(query)}` +
      `&numericFilters=created_at_i>${sinceUnix}` +
      `&hitsPerPage=${HN_HITS_PER_QUERY}`;
    return fetchJson(url, { "User-Agent": USER_AGENT }).then((payload) =>
      (payload.hits || []).map((hit) => ({
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
      })),
    );
  });
  const stories = settled.flatMap((item) => item.items);
  if (!stories.length && settled.some((item) => item.error)) {
    const failed = summarizeSettledErrors(settled).join("; ");
    throw new Error(failed ? `HN queries failed: ${failed}` : "no HN stories fetched");
  }
  if (!stories.length) {
    throw new Error("no HN stories fetched");
  }
  const enriched = stories.filter(RadarCore.isAiRelatedStory).map(RadarCore.enrichAiStory);
  const warnings = summarizeSettledErrors(settled);
  return warnings.length ? { stories: enriched, warnings } : enriched;
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
  const settled = await runQueriesWithSettledState(
    RadarCore.GITHUB_AI_QUERIES,
    (query) => fetchGithubRepoQuery(query, pushedAfterDate),
  );
  const stories = settled.flatMap((item) => item.items);
  if (!stories.length && settled.some((item) => item.error)) {
    const failed = summarizeSettledErrors(settled).join("; ");
    throw new Error(failed ? `GitHub queries failed: ${failed}` : "no GitHub repositories fetched");
  }
  if (!stories.length) throw new Error("no GitHub repositories fetched");
  const enriched = stories.filter(RadarCore.isAiRelatedStory).map(RadarCore.enrichAiStory);
  const warnings = summarizeSettledErrors(settled);
  return warnings.length ? { stories: enriched, warnings } : enriched;
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
  const settled = await runQueriesWithSettledState(RadarCore.PAPER_QUERIES, fetchArxivPaperQuery, ARXIV_REQUEST_DELAY_MS);
  const stories = settled.flatMap((item) => item.items);
  if (!stories.length && settled.some((item) => item.error)) {
    const failed = summarizeSettledErrors(settled).join("; ");
    throw new Error(`arXiv queries failed: ${failed}`);
  }
  const enriched = stories
    .filter(RadarCore.isAiRelatedStory)
    .map(RadarCore.enrichAiStory);
  const warnings = summarizeSettledErrors(settled);
  return warnings.length ? { stories: enriched, warnings } : enriched;
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

const CODE_LOOKUP_LIMIT = 12;

// Look up a code repository for the top-ranked papers so the daily report can
// show "适合精读" advice and code links. Runs at most once per paper per day;
// failures are silently ignored (advice falls back to abstract-only rules).
async function attachCodeLinks(paperStories) {
  const candidates = [...paperStories].sort(
    (a, b) => (b.citations ?? 0) - (a.citations ?? 0),
  );
  const queue = candidates.slice(0, CODE_LOOKUP_LIMIT);
  const lookupOne = async (paper) => {
    const title = String(paper.title || "").trim();
    if (!title) return;
    try {
      const url =
        "https://api.github.com/search/repositories" +
        `?q=${encodeURIComponent(title.slice(0, 100))}&sort=stars&order=desc&per_page=1`;
      const payload = await fetchJson(url, {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      });
      const repo = (payload.items || [])[0];
      if (repo && titleSimilarity(repo.name, title) > 0.3) {
        paper.codeUrl = repo.html_url;
      }
    } catch {
      // Rate limits or no match: leave the paper without a code link.
    }
  };

  for (let index = 0; index < queue.length; index += CODE_LINK_CONCURRENCY) {
    const batch = queue.slice(index, index + CODE_LINK_CONCURRENCY);
    await Promise.all(batch.map(lookupOne));
    if (index + CODE_LINK_CONCURRENCY < queue.length) {
      await sleep(CODE_LINK_BATCH_DELAY_MS);
    }
  }
}

function titleSimilarity(repoName, paperTitle) {
  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const repoWords = new Set(normalize(repoName).split(" "));
  const paperWords = normalize(paperTitle).split(" ").filter(Boolean);
  if (!paperWords.length || !repoWords.size) return 0;
  const hits = paperWords.filter((word) => repoWords.has(word)).length;
  return hits / paperWords.length;
}

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
  const settled = await runQueriesWithSettledState(
    RadarCore.PAPER_QUERIES,
    (query) => fetchSemanticScholarPapers(query.semanticQuery || query.label, query.label, SEMANTIC_SCHOLAR_PAPERS_PER_QUERY),
  );
  const stories = settled.flatMap((item) => item.items);
  if (!stories.length && settled.some((item) => item.error)) {
    const failed = summarizeSettledErrors(settled).join("; ");
    throw new Error(`Semantic Scholar queries failed: ${failed}`);
  }
  const enriched = stories
    .filter(RadarCore.isAiRelatedStory)
    .map(RadarCore.enrichAiStory);
  const warnings = summarizeSettledErrors(settled);
  return warnings.length ? { stories: enriched, warnings } : enriched;
}

async function collectSourceStories(sourceJobs) {
  const settled = await Promise.all(
    sourceJobs.map(async ({ name, run }) => {
      try {
        const payload = await run();
        const stories = Array.isArray(payload) ? payload : payload?.stories || [];
        const warnings = Array.isArray(payload)
          ? []
          : (payload?.warnings || []).map((item) => `${name}: ${item}`);
        return { name, stories, warnings, error: "" };
      } catch (error) {
        return { name, stories: [], error: error.message || String(error) };
      }
    }),
  );
  const errors = settled.filter((entry) => entry.error).map((entry) => `${entry.name}: ${entry.error}`);
  const warnings = settled.flatMap((entry) => entry.warnings || []);
  return { settled, errors, warnings };
}

async function collectStories(diagnostics = { errors: [], warnings: [] }) {
  const [mainSources, paperSources, webResults] = await Promise.all([
    collectSourceStories([
      { name: "HN", run: fetchHnStories },
      { name: "GitHub", run: fetchGithubRepoStories },
    ]),
    collectSourceStories([
      { name: "arXiv", run: fetchArxivPaperStories },
      { name: "Semantic Scholar", run: fetchSemanticScholarPaperStories },
    ]),
    collectWebSources(diagnostics),
  ]);

  const mainStories = mainSources.settled.flatMap((result) => result.stories);
  const paperStories = paperSources.settled.flatMap((result) => result.stories);
  await attachCodeLinks(paperStories);

  // Web sources feed both boards: news/trending into the main radar, paper
  // feeds into the paper radar, and every visit is recorded as coverage.
  const webStories = webResults.flatMap((result) => result.stories);
  const webPaperStories = webStories.filter((story) =>
    story.source === "HF Papers" || story.source === "papers.cool",
  );
  const webMainStories = webStories.filter(
    (story) => story.source !== "HF Papers" && story.source !== "papers.cool",
  );

  return {
    mainStories: [...mainStories, ...webMainStories],
    paperStories: [...paperStories, ...webPaperStories],
    coverage: webResults.map(({ stories, ...rest }) => ({ ...rest, kept: stories.length })),
    errors: [...mainSources.errors, ...paperSources.errors],
    warnings: [...mainSources.warnings, ...paperSources.warnings],
  };
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

function writeOutputs(radar, paperRadar, diagnostics = {}, coverage = []) {
  const generatedAt = new Date().toISOString();
  const history = loadHistorySafely();
  const momentum = buildMomentumSummary(radar, history);
  const payload = {
    generatedAt,
    totalFetched: radar.totalFetched,
    uniqueCount: radar.uniqueCount,
    candidates: radar.candidates,
    recommendations: radar.recommendations,
    paperRadar,
    coverage,
    momentum,
    diagnostics,
  };
  writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
  const markdown = RadarCore.toMarkdown(payload);
  const notes = [];
  if (diagnostics.errors?.length) {
    notes.push(`源失败: ${diagnostics.errors.join("; ")}`);
  }
  if (diagnostics.warnings?.length) {
    notes.push(`查询告警: ${diagnostics.warnings.join("; ")}`);
  }
  const markdownWithNotes = notes.length ? `${markdown}\n\n## 执行告警\n\n${notes.map((note) => `- ${note}`).join("\n")}\n` : markdown;
  writeFileSync(OUTPUT_MD, markdownWithNotes, "utf8");
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

// Loads history.json (built by scripts/build-history.mjs) when present and
// computes 7-day share momentum per source for the markdown momentum section.
function loadHistorySafely() {
  try {
    if (!existsSync("history.json")) return null;
    return JSON.parse(readFileSync("history.json", "utf8"));
  } catch {
    return null;
  }
}

function sourceMomentumMap(history) {
  const days = history?.days || [];
  if (days.length < 2) return new Map();
  const share = (day, source) => {
    const mix = day.sourceMix || {};
    const total = Object.values(mix).reduce((sum, n) => sum + n, 0) || 1;
    return (mix[source] || 0) / total;
  };
  const latest = days[days.length - 1];
  const earlier = days.slice(Math.max(0, days.length - 8), days.length - 1);
  const sources = new Set(Object.keys(latest.sourceMix || {}));
  const momentum = new Map();
  for (const source of sources) {
    const before = earlier.length
      ? earlier.reduce((sum, d) => sum + share(d, source), 0) / earlier.length
      : 0;
    momentum.set(source, share(latest, source) - before);
  }
  return momentum;
}

function buildMomentumSummary(radar, history) {
  const counts = new Map();
  for (const story of [...(radar.candidates || []), ...(radar.paperRadar?.candidates || [])]) {
    const source = story.source || "unknown";
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  const momentum = sourceMomentumMap(history);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({
      source,
      count,
      momentum: momentum.has(source) ? Number(momentum.get(source).toFixed(3)) : null,
    }));
}

function paperRadarMissingPapers(payload) {
  return (payload.paperRadar?.recommendations?.length || 0) === 0;
}

async function main() {
  console.log("[run-demo] fetching sources...");
  const diagnostics = {
    errors: [],
    warnings: [],
  };
  try {
    const { mainStories, paperStories, coverage, errors, warnings } = await collectStories(diagnostics);
    diagnostics.errors = errors;
    diagnostics.warnings = warnings;
    const webFound = coverage.reduce((sum, item) => sum + item.found, 0);
    console.log(`[run-demo] main=${mainStories.length} papers=${paperStories.length} web=${webFound} errors=${errors.length} warnings=${warnings.length}`);

    const radar = RadarCore.buildDailyRadar([...mainStories, ...paperStories], {
      sourceQuota: RadarCore.DEFAULT_SOURCE_QUOTA,
    });
    const paperRadar = RadarCore.buildPaperRadar(paperStories.map(RadarCore.enrichPaperStory));

    backupExistingOutputs();
    const payload = writeOutputs(radar, paperRadar, diagnostics, coverage);
    const stats = validateOutputs(payload);
    removeBackups();
    console.log(
      `[run-demo] ok: main ${stats.mainCandidates}/${stats.mainRecommendations}, papers ${stats.paperCandidates}/${payload.paperRadar.recommendations.length}`,
    );
    if (errors.length) {
      console.warn(`[run-demo] partial-source warnings:\n  - ${errors.join("\n  - ")}`);
    }
    if (warnings.length) {
      console.warn(`[run-demo] partial-query warnings:\n  - ${warnings.join("\n  - ")}`);
    }
    writeLastRun(true, "Daily radar updated successfully.", diagnostics);
  } catch (error) {
    restoreBackups();
    writeLastRun(false, `Daily radar update failed: ${error.message || error}`, {
      ...diagnostics,
      errors: [...diagnostics.errors, error.message || error],
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(`[run-demo] FAILED: ${error.message || error}`);
  process.exitCode = 1;
});
