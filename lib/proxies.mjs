// Shared upstream proxy logic for Cloudflare Pages Functions and Vercel routes.
// Each helper fetches the upstream API, normalizes errors, and returns
// { status, body, headers } so both runtimes can serve identical responses.

const HN_ALLOWED_HOST = "hn.algolia.com";
const GITHUB_ALLOWED_HOST = "api.github.com";
const ARXIV_ALLOWED_HOST = "export.arxiv.org";
const SEMANTIC_SCHOLAR_ALLOWED_HOST = "api.semanticscholar.org";

const DEFAULT_CACHE_SECONDS = 1800;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function cacheHeaders(cacheSeconds) {
  return {
    "Cache-Control": `public, max-age=300, s-maxage=${cacheSeconds}, stale-while-revalidate=600`,
  };
}

function jsonResponse(status, body, extraHeaders = {}) {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function textResponse(status, body, extraHeaders = {}) {
  return {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
    body,
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function handleHnProxy(params) {
  const query = String(params.get("query") || "").slice(0, 200);
  if (!query) {
    return jsonResponse(400, { error: "Missing query" });
  }
  const since = clampInt(params.get("since"), 0, Math.floor(Date.now() / 1000), 0);
  const limit = clampInt(params.get("limit"), 1, 50, 30);

  const url =
    `https://${HN_ALLOWED_HOST}/api/v1/search_by_date` +
    `?tags=story&query=${encodeURIComponent(query)}` +
    `&numericFilters=created_at_i>${since}` +
    `&hitsPerPage=${limit}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "obsession-radar/1.0" },
    });
    if (!response.ok) {
      return jsonResponse(response.status, { error: `HN upstream HTTP ${response.status}` }, cacheHeaders(60));
    }
    const body = await response.text();
    return {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(), ...cacheHeaders(DEFAULT_CACHE_SECONDS) },
      body,
    };
  } catch (error) {
    return jsonResponse(502, { error: `HN upstream failed: ${error.message || error}` }, cacheHeaders(60));
  }
}

export async function handleGithubProxy(params) {
  const q = String(params.get("q") || "").slice(0, 300);
  if (!q) {
    return jsonResponse(400, { error: "Missing q" });
  }
  const limit = clampInt(params.get("limit"), 1, 50, 20);

  const url =
    `https://${GITHUB_ALLOWED_HOST}/search/repositories` +
    `?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${limit}`;

  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "obsession-radar/1.0",
    };
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return jsonResponse(response.status, { error: `GitHub upstream HTTP ${response.status}` }, cacheHeaders(60));
    }
    const body = await response.text();
    return {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(), ...cacheHeaders(DEFAULT_CACHE_SECONDS) },
      body,
    };
  } catch (error) {
    return jsonResponse(502, { error: `GitHub upstream failed: ${error.message || error}` }, cacheHeaders(60));
  }
}

export async function handleArxivProxy(params) {
  const query = String(params.get("query") || "").slice(0, 300);
  if (!query) {
    return jsonResponse(400, { error: "Missing query" });
  }
  const limit = clampInt(params.get("limit"), 1, 30, 10);

  const url =
    `https://${ARXIV_ALLOWED_HOST}/api/query` +
    `?search_query=${encodeURIComponent(query)}` +
    `&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "obsession-radar/1.0" },
    });
    if (!response.ok) {
      return textResponse(response.status, `arXiv upstream HTTP ${response.status}`, cacheHeaders(120));
    }
    const body = await response.text();
    return {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8", ...corsHeaders(), ...cacheHeaders(DEFAULT_CACHE_SECONDS) },
      body,
    };
  } catch (error) {
    return textResponse(502, `arXiv upstream failed: ${error.message || error}`, cacheHeaders(120));
  }
}

export async function handleSemanticScholarProxy(params, env) {
  const query = String(params.get("query") || "").slice(0, 200);
  if (!query) {
    return jsonResponse(400, { error: "Missing query" });
  }
  const limit = clampInt(params.get("limit"), 1, 30, 10);

  const fields = [
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

  const url =
    `https://${SEMANTIC_SCHOLAR_ALLOWED_HOST}/graph/v1/paper/search` +
    `?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;

  const headers = { Accept: "application/json" };
  const apiKey = env && (env.SEMANTIC_SCHOLAR_API_KEY || (env.secrets && env.secrets.SEMANTIC_SCHOLAR_API_KEY));
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      // Never cache rate-limit or server errors; keep retrying upstream.
      return jsonResponse(response.status, { error: `Semantic Scholar upstream HTTP ${response.status}` }, cacheHeaders(0));
    }
    const body = await response.text();
    return {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(), ...cacheHeaders(DEFAULT_CACHE_SECONDS) },
      body,
    };
  } catch (error) {
    return jsonResponse(502, { error: `Semantic Scholar upstream failed: ${error.message || error}` }, cacheHeaders(0));
  }
}

export function isPreflight(request) {
  return request.method === "OPTIONS";
}

export function preflightResponse() {
  return {
    status: 204,
    headers: corsHeaders(),
    body: "",
  };
}
