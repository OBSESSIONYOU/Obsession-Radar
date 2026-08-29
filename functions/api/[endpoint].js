import {
  handleArxivProxy,
  handleGithubProxy,
  handleHnProxy,
  handleSemanticScholarProxy,
  isPreflight,
  preflightResponse,
} from "../../lib/proxies.mjs";

function responseFrom(result) {
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
}

export async function onRequestGet({ request, params, env }) {
  const name = params.endpoint;
  const url = new URL(request.url);

  if (name === "arxiv") {
    return responseFrom(await handleArxivProxy(url.searchParams));
  }
  if (name === "semantic-scholar") {
    return responseFrom(await handleSemanticScholarProxy(url.searchParams, env));
  }
  if (name === "hn") {
    return responseFrom(await handleHnProxy(url.searchParams));
  }
  if (name === "github") {
    return responseFrom(await handleGithubProxy(url.searchParams));
  }
  return new Response(JSON.stringify({ error: "Unknown API endpoint" }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestOptions({ request }) {
  if (isPreflight(request)) {
    return responseFrom(preflightResponse());
  }
  return new Response(null, { status: 204 });
}
