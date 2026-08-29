import {
  handleArxivProxy,
  handleGithubProxy,
  handleHnProxy,
  handleSemanticScholarProxy,
  preflightResponse,
} from "../lib/proxies.mjs";

function responseFrom(result) {
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return responseFrom(preflightResponse());
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const { searchParams, pathname } = new URL(request.url);
  const endpoint = pathname.replace(/^\/api\//, "").replace(/\/$/, "");

  if (endpoint === "arxiv") {
    return responseFrom(await handleArxivProxy(searchParams));
  }
  if (endpoint === "semantic-scholar") {
    return responseFrom(await handleSemanticScholarProxy(searchParams, process.env));
  }
  if (endpoint === "hn") {
    return responseFrom(await handleHnProxy(searchParams));
  }
  if (endpoint === "github") {
    return responseFrom(await handleGithubProxy(searchParams));
  }
  return new Response(JSON.stringify({ error: "Unknown API endpoint" }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const config = {
  runtime: "edge",
};
