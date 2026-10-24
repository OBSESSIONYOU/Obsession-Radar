// No-API web source parsers for the daily radar.
// Each parser takes raw HTML/XML text and returns entries shaped for
// RadarCore adapters. Parsers are regex/DOM-free (Node + browser safe),
// never throw on malformed input, and always report what they found so the
// runner can record coverage honestly (visited / found / skipped).
//
// Sources (all verified reachable, see web-sources.test.mjs fixtures):
//   - GitHub Trending  https://github.com/trending          (HTML article rows)
//   - HN front page    https://news.ycombinator.com/        (titleline + subtext rows)
//   - HF Daily Papers  https://huggingface.co/papers        (data-props embedded JSON)
//   - QbitAI RSS       https://www.qbitai.com/feed          (RSS 2.0)
//   - Solidot RSS      https://www.solidot.org/index.rss   (RSS 2.0)
//   - papers.cool feed https://papers.cool/arxiv/<cat>/feed (Atom)

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 obsession-radar/1.0";

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function stripTags(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<!--\[CDATA\[([\s\S]*?)\]\]-->/g, "$1")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]*>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function parseCount(value) {
  const n = Number.parseInt(String(value || "").replace(/[\s,]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------- GitHub Trending

export function parseGithubTrending(html) {
  const articles = String(html || "").match(/<article[^>]*>[\s\S]*?<\/article>/g) || [];
  const repos = [];
  for (const article of articles) {
    const href = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"\/]+\/[^"\/?#]+)"/);
    if (!href) continue;
    const fullName = href[1];
    const description = stripTags(
      (article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "",
    );
    const stars = parseCount(
      ((article.match(/href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "")
        .replace(/<[^>]*>/g, ""),
    );
    const forks = parseCount(
      ((article.match(/href="\/[^"]+\/forks"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "")
        .replace(/<[^>]*>/g, ""),
    );
    const starsToday = parseCount((article.match(/([\d,]+) stars today/) || [])[1]);
    const language = stripTags(
      (article.match(/itemprop="programmingLanguage">([^<]+)</) || [])[1] || "",
    );
    const topics = [...article.matchAll(/href="\/topics\/([^"?#]+)"/g)]
      .map((m) => decodeHtmlEntities(m[1]))
      .filter(Boolean);
    repos.push({
      id: `trending:github.com/${fullName}`,
      fullName,
      title: fullName,
      url: `https://github.com/${fullName}`,
      description,
      stars,
      forks,
      starsToday,
      language,
      topics,
      // Trending has no reliable timestamp; treat as observed today.
      createdAt: new Date().toISOString(),
    });
  }
  return repos;
}

// ---------------------------------------------------------------- HN front page

export function parseHnFrontPage(html) {
  const text = String(html || "");
  const stories = [];
  const titleRe = /<span class="titleline"><a href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let match;
  const titles = [];
  while ((match = titleRe.exec(text))) {
    titles.push({ href: decodeHtmlEntities(match[1]), title: decodeHtmlEntities(match[2]) });
  }
  // Each story's metadata lives in one subline block:
  //   <span class="score">N points</span> ... <span class="age" title="ISO">...</span>
  //   ... | <a href="hide...">hide</a> | <a href="item?id=NNN">N comments|discuss</a></span>
  const sublines = text.match(/<span class="subline">[\s\S]*?<\/span><\/td>/g) || [];
  const metas = sublines.map((sub) => ({
    points: parseCount((sub.match(/<span class="score"[^>]*>([\d,]+) points/) || [])[1]),
    createdAt: (sub.match(/<span class="age" title="([^"]+)">/) || [])[1] || "",
    itemId: (sub.match(/<a href="item\?id=(\d+)">[\s\S]*?<\/a>\s*<\/span><\/td>$/) || [])[1] || "",
    comments: parseCount(
      (sub.match(/>([\d,\s]*(?:&nbsp;|\u00a0)?\s*comments)<\/a>/) || [])[1],
    ),
  }));
  const count = Math.min(titles.length, metas.length);
  for (let i = 0; i < count; i += 1) {
    const t = titles[i];
    const m = metas[i];
    const id = m.itemId || t.href;
    const hnUrl = m.itemId ? `https://news.ycombinator.com/item?id=${m.itemId}` : "";
    const url = /^https?:\/\//.test(t.href) ? t.href : hnUrl || t.href;
    stories.push({
      id: `frontpage:hn:${id}`,
      title: t.title,
      url,
      hnUrl,
      points: m.points,
      comments: m.comments,
      createdAt: m.createdAt,
    });
  }
  return stories;
}

// ---------------------------------------------------------------- HF Daily Papers

export function parseHuggingfacePapers(html) {
  const text = String(html || "");
  const papers = [];
  // Papers are embedded as HTML-escaped JSON inside data-props attributes.
  const blockRe = /&quot;paper&quot;:\s*\{&quot;id&quot;:&quot;([^&]+)&quot;([\s\S]*?)(?=&quot;paper&quot;:\s*\{|\"paper\&quot;|$)/g;
  let match;
  const seen = new Set();
  while ((match = blockRe.exec(text))) {
    const id = match[1];
    if (seen.has(id)) continue;
    const body = match[0].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const title = (body.match(/"title":"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
    const decodedTitle = safeJsonString(title) || stripTags(title);
    const upvotes = parseCount((body.match(/"upvotes":(\d+)/) || [])[1]);
    const publishedAt = (body.match(/"publishedAt":"([^"]+)"/) || [])[1] || "";
    const summaryRaw = (body.match(/"summary":"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
    const summary = safeJsonString(summaryRaw) || "";
    if (!id || (!decodedTitle && !summary)) continue;
    seen.add(id);
    papers.push({
      id: `hf:${id}`,
      paperId: id,
      title: decodedTitle,
      url: `https://huggingface.co/papers/${id}`,
      upvotes,
      publishedAt,
      summary: summary.slice(0, 400),
      createdAt: publishedAt,
    });
  }
  return papers;
}

function safeJsonString(value) {
  if (!value) return "";
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- RSS 2.0 (QbitAI / Solidot)

export function parseRssItems(xml, sourceLabel) {
  const items = String(xml || "").match(/<item>[\s\S]*?<\/item>/g) || [];
  return items
    .map((item) => {
      const title = stripTags((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
      let link = stripTags((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
      const guid = stripTags(
        ((item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [])[1] || "").trim(),
      );
      const pubDate = stripTags((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
      const description = stripTags(
        (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "",
      ).slice(0, 400);
      const categories = [...item.matchAll(/<category>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/category>/g)]
        .map((m) => stripTags(m[1]))
        .filter(Boolean);
      if (!link && guid && /^https?:\/\//.test(guid)) link = guid;
      if (!title || !link) return null;
      return {
        id: `rss:${sourceLabel ? sourceLabel + ":" : ""}${link}`,
        title,
        url: link,
        publishedAt: pubDate,
        createdAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        description,
        categories,
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- papers.cool Atom feed

export function parsePapersCoolAtom(xml) {
  const entries = String(xml || "").match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries
    .map((entry) => {
      const id = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || "";
      const arxivId = (id.match(/arxiv\/(.+)$/) || [])[1] || "";
      const title = stripTags((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
      const updated = stripTags((entry.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || "");
      const summary = stripTags(
        (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || "",
      ).slice(0, 400);
      const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
        .map((m) => stripTags(m[1]))
        .filter(Boolean);
      const link = (entry.match(/<link[^>]*href="([^"]+)"[^>]*\/>/) || [])[1] || id;
      if (!arxivId || !title) return null;
      return {
        id: `paperscool:${arxivId}`,
        arxivId,
        title,
        url: `https://arxiv.org/abs/${arxivId}`,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
        publishedAt: updated,
        createdAt: updated,
        summary,
        authors,
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- source registry

export const WEB_SOURCES = [
  {
    name: "GitHub Trending",
    kind: "html",
    url: "https://github.com/trending",
    parse: parseGithubTrending,
    adapter: "githubTrending",
  },
  {
    name: "HN Front Page",
    kind: "html",
    url: "https://news.ycombinator.com/",
    parse: parseHnFrontPage,
    adapter: "hnFront",
  },
  {
    name: "HF Daily Papers",
    kind: "html",
    url: "https://huggingface.co/papers",
    parse: parseHuggingfacePapers,
    adapter: "hfPaper",
  },
  {
    name: "QbitAI",
    kind: "rss",
    url: "https://www.qbitai.com/feed",
    parse: (xml) => parseRssItems(xml, "qbitai"),
    adapter: "rssNews",
  },
  {
    name: "Solidot",
    kind: "rss",
    url: "https://www.solidot.org/index.rss",
    parse: (xml) => parseRssItems(xml, "solidot"),
    adapter: "rssNews",
  },
  {
    name: "papers.cool",
    kind: "atom",
    url: "https://papers.cool/arxiv/cs.CL/feed",
    parse: parsePapersCoolAtom,
    adapter: "papersCool",
  },
];

export function decodeHtmlEntitiesForTest(value) {
  return decodeHtmlEntities(value);
}
