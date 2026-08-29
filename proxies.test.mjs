// Tests for the shared proxy logic in lib/proxies.mjs.
// Upstream fetches are stubbed via globalThis.fetch so the tests run offline.
import test from "node:test";
import assert from "node:assert/strict";
import {
  handleArxivProxy,
  handleGithubProxy,
  handleHnProxy,
  handleSemanticScholarProxy,
} from "./lib/proxies.mjs";

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(url, init);
  };
  return calls;
}

function jsonResult(body, status = 200) {
  return {
    ok: status === 200,
    status,
    text: async () => JSON.stringify(body),
  };
}

test("handleArxivProxy rejects missing query with 400", async () => {
  const result = await handleArxivProxy(new URLSearchParams(""));
  assert.equal(result.status, 400);
  assert.match(result.body, /Missing query/);
});

test("handleArxivProxy clamps limit and forwards search_query", async () => {
  const calls = stubFetch(() => jsonResult("<feed></feed>"));
  const result = await handleArxivProxy(new URLSearchParams({ query: 'all:"RAG"', limit: "999" }));
  assert.equal(result.status, 200);
  const url = new URL(calls[0].url);
  assert.equal(url.host, "export.arxiv.org");
  assert.equal(url.searchParams.get("max_results"), "30");
  assert.equal(url.searchParams.get("search_query"), 'all:"RAG"');
});

test("handleSemanticScholarProxy attaches API key from env and never caches failures", async () => {
  const calls = stubFetch(() => jsonResult({ data: [] }, 429));
  const result = await handleSemanticScholarProxy(
    new URLSearchParams({ query: "transformers", limit: "2" }),
    { SEMANTIC_SCHOLAR_API_KEY: "test-key" },
  );
  assert.equal(result.status, 429);
  assert.match(result.headers["Cache-Control"], /s-maxage=0/);
  assert.equal(calls[0].init.headers["x-api-key"], "test-key");
  assert.equal(new URL(calls[0].url).host, "api.semanticscholar.org");
});

test("handleHnProxy forwards query window and limit", async () => {
  const calls = stubFetch(() => jsonResult({ hits: [] }));
  const result = await handleHnProxy(new URLSearchParams({ query: "AI", since: "1000", limit: "500" }));
  assert.equal(result.status, 200);
  const url = new URL(calls[0].url);
  assert.equal(url.host, "hn.algolia.com");
  assert.equal(url.searchParams.get("hitsPerPage"), "50");
});

test("handleGithubProxy rejects missing q and normalizes per_page", async () => {
  const missing = await handleGithubProxy(new URLSearchParams(""));
  assert.equal(missing.status, 400);

  const calls = stubFetch(() => jsonResult({ items: [] }));
  const result = await handleGithubProxy(new URLSearchParams({ q: "topic:llm pushed:>2026-01-01", limit: "5" }));
  assert.equal(result.status, 200);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("per_page"), "5");
  assert.match(url.searchParams.get("q"), /topic:llm/);
});
