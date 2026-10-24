// Tests for web-sources.mjs parsers and their RadarCore adapters.
// Fixtures are real captures under test-fixtures/web-sources/ (see README).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import RadarCore from "./radar-core.mjs";
import {
  parseGithubTrending,
  parseHnFrontPage,
  parseHuggingfacePapers,
  parseRssItems,
  parsePapersCoolAtom,
} from "./web-sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "test-fixtures", "web-sources");
const load = (name) => readFileSync(join(fixtures, name), "utf8");

test("parseGithubTrending extracts repo rows with stars and stars-today", () => {
  const repos = parseGithubTrending(load("github-trending.html"));
  assert.ok(repos.length >= 5, "expected several trending repos");
  const first = repos[0];
  assert.match(first.id, /^trending:github\.com\//);
  assert.equal(first.url, `https://github.com/${first.fullName}`);
  assert.ok(first.stars > 0, "stars should be parsed");
  assert.ok(first.starsToday >= 0, "stars-today should be parsed");
  assert.equal(typeof first.description, "string");
});

test("parseGithubTrending tolerates empty input", () => {
  assert.deepEqual(parseGithubTrending(""), []);
  assert.deepEqual(parseGithubTrending("<html>no rows</html>"), []);
});

test("parseHnFrontPage pairs titles with points, comments and timestamps", () => {
  const stories = parseHnFrontPage(load("hn-front.html"));
  assert.ok(stories.length >= 10, "expected front-page stories");
  const first = stories[0];
  assert.match(first.id, /^frontpage:hn:/);
  assert.ok(first.points > 0, "points should be parsed");
  assert.ok(first.comments >= 0, "comments should be parsed");
  assert.ok(Number.isFinite(new Date(first.createdAt).getTime()), "createdAt should be a date");
  assert.match(first.hnUrl, /^https:\/\/news\.ycombinator\.com\/item\?id=/);
});

test("parseHuggingfacePapers extracts embedded JSON paper cards", () => {
  const papers = parseHuggingfacePapers(load("hf-papers.html"));
  assert.ok(papers.length >= 10, "expected several papers");
  const first = papers[0];
  assert.match(first.id, /^hf:/);
  assert.ok(first.upvotes > 0, "upvotes should be parsed");
  assert.ok(first.title.length > 5, "title should be decoded");
  assert.match(first.url, /^https:\/\/huggingface\.co\/papers\//);
});

test("parseRssItems handles plain and CDATA feeds", () => {
  const qbitai = parseRssItems(load("qbitai-rss.xml"), "qbitai");
  assert.ok(qbitai.length >= 5, "expected qbitai items");
  assert.ok(qbitai[0].title.length > 3);
  assert.match(qbitai[0].url, /^https?:\/\//);
  assert.ok(qbitai[0].createdAt);

  const solidot = parseRssItems(load("solidot-rss.xml"), "solidot");
  assert.ok(solidot.length >= 5, "expected solidot items (CDATA titles)");
  assert.ok(!solidot[0].title.includes("CDATA"), "CDATA wrappers must be stripped");
});

test("parsePapersCoolAtom extracts arXiv entries with authors", () => {
  const papers = parsePapersCoolAtom(load("paperscool-cs.CL.xml"));
  assert.ok(papers.length >= 10, "expected feed entries");
  const first = papers[0];
  assert.match(first.arxivId, /^[0-9]{4}\.[0-9]{4,5}/);
  assert.match(first.url, /^https:\/\/arxiv\.org\/abs\//);
  assert.ok(Array.isArray(first.authors) && first.authors.length > 0);
});

test("RadarCore adapters map parsed entries onto scored stories", () => {
  const trending = RadarCore.githubTrendingToStory(parseGithubTrending(load("github-trending.html"))[0]);
  assert.equal(trending.source, "GitHub Trending");
  assert.ok(trending.score === undefined, "adapter must not pre-score");

  const hn = RadarCore.hnFrontToStory(parseHnFrontPage(load("hn-front.html"))[0]);
  assert.equal(hn.source, "Hacker News");
  assert.ok(hn.points > 0);

  const hf = RadarCore.hfPaperToStory(parseHuggingfacePapers(load("hf-papers.html"))[0]);
  assert.equal(hf.source, "HF Papers");
  assert.match(hf.googleScholarUrl, /^https:\/\/scholar\.google\.com/);

  const news = RadarCore.rssNewsToStory(parseRssItems(load("qbitai-rss.xml"), "qbitai")[0], "QbitAI");
  assert.equal(news.source, "QbitAI");

  const cool = RadarCore.papersCoolToStory(parsePapersCoolAtom(load("paperscool-cs.CL.xml"))[0]);
  assert.equal(cool.source, "papers.cool");
  assert.match(cool.pdfUrl, /arxiv\.org\/pdf\//);
});

test("scoreStory boosts GitHub Trending momentum over stale-star repos", () => {
  const base = { source: "GitHub", stars: 43049, forks: 2687, matchedQueries: ["t"] };
  const plain = RadarCore.scoreStory({ ...base, createdAt: new Date().toISOString() });
  const trending = RadarCore.scoreStory({
    ...base,
    source: "GitHub Trending",
    starsToday: 2271,
    createdAt: new Date().toISOString(),
  });
  assert.ok(trending > plain, "stars-today momentum should add score");
});

test("DEFAULT_SOURCE_QUOTA reserves slots for web sources", () => {
  const quota = RadarCore.DEFAULT_SOURCE_QUOTA;
  assert.equal(quota["GitHub Trending"], 6);
  assert.equal(quota["HF Papers"], 2);
  assert.equal(quota.QbitAI, 1);
  assert.equal(quota.Solidot, 1);
});
