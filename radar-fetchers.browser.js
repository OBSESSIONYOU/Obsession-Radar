(function attachRadarFetchers(global) {
  function createRadarFetchers({ RadarCore }) {
    const QUERIES = RadarCore.AI_QUERIES;
    const GITHUB_QUERIES = RadarCore.GITHUB_AI_QUERIES;
    const PAPER_QUERIES = RadarCore.PAPER_QUERIES;
    const GITHUB_REPOS_PER_QUERY = 10;
    const GITHUB_PUSHED_WINDOW_DAYS = 30;
    const ARXIV_PAPERS_PER_QUERY = 10;
    const ARXIV_REQUEST_DELAY_MS = 3000;
    const SEMANTIC_SCHOLAR_PAPERS_PER_QUERY = 10;
    const TOPIC_HN_WINDOW_DAYS = 7;
    const TOPIC_HN_HITS_PER_QUERY = 30;
    const TOPIC_GITHUB_REPOS_PER_QUERY = 20;
    const TOPIC_GITHUB_PUSHED_WINDOW_DAYS = 30;
    const TOPIC_ARXIV_RESULTS_PER_QUERY = 10;
    const TOPIC_SEMANTIC_SCHOLAR_RESULTS_PER_QUERY = 10;

    async function fetchHnStories() {
      const sinceUnix = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
      const batches = await Promise.all(
        QUERIES.map(async (query) => {
          const url = hnApiUrl(query, sinceUnix, 30);
          const response = await fetch(url, {
            headers: { "User-Agent": "obsession-radar/1.0" },
          });
          if (!response.ok) throw new Error(`HN ${query}: HTTP ${response.status}`);
          const payload = await response.json();
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
      return stories
        .filter(RadarCore.isAiRelatedStory)
        .map(RadarCore.enrichAiStory);
    }

    async function fetchGithubRepoStories() {
      const pushedAfterDate = new Date(Date.now() - GITHUB_PUSHED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const batches = [];
      for (const query of GITHUB_QUERIES) {
        batches.push(await fetchGithubRepoQuery(query, pushedAfterDate));
      }
      const stories = batches.flat();
      if (!stories.length) throw new Error("no GitHub repositories fetched");
      return stories
        .filter(RadarCore.isAiRelatedStory)
        .map(RadarCore.enrichAiStory);
    }

    async function fetchGithubRepoQuery(query, pushedAfterDate) {
      const search = `topic:${query} pushed:>${pushedAfterDate}`;
      const url = githubRepoApiUrl(search, GITHUB_REPOS_PER_QUERY);
      const response = await fetch(url, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error(`GitHub ${query}: HTTP ${response.status}`);
      const payload = await response.json();
      return (payload.items || []).map((repo) => RadarCore.githubRepoToStory(repo, query));
    }

    async function fetchArxivPaperStories() {
      const batches = [];
      for (const query of PAPER_QUERIES) {
        if (batches.length > 0) await sleep(ARXIV_REQUEST_DELAY_MS);
        try {
          batches.push(await fetchArxivPaperQuery(query));
        } catch {
          // Keep other paper queries alive when arXiv has a transient 503/429.
        }
      }
      return batches
        .flat()
        .filter(RadarCore.isAiRelatedStory)
        .map(RadarCore.enrichAiStory);
    }

    async function fetchArxivPaperQuery(query) {
      const response = await fetch(arxivApiUrl(query.searchQuery, ARXIV_PAPERS_PER_QUERY));
      if (!response.ok) throw new Error(`arXiv ${query.label}: HTTP ${response.status}`);
      const xml = await response.text();
      return parseArxivAtom(xml).map((entry) => RadarCore.arxivPaperToStory(entry, query.label));
    }

    async function fetchSemanticScholarPaperStories() {
      const batches = [];
      for (const query of PAPER_QUERIES) {
        try {
          batches.push(await fetchSemanticScholarPaperQuery(query));
        } catch {
          // Public scholarly APIs can rate-limit individual queries; keep partial results.
        }
      }
      return batches
        .flat()
        .filter(RadarCore.isAiRelatedStory)
        .map(RadarCore.enrichAiStory);
    }

    async function fetchSemanticScholarPaperQuery(query) {
      return fetchSemanticScholarPapers(query.semanticQuery || query.label, query.label, SEMANTIC_SCHOLAR_PAPERS_PER_QUERY);
    }

    async function fetchTopicStories(topic, sources) {
      const jobs = [];
      if (sources.hn) jobs.push(sourceJob("HN", fetchTopicHnStories(topic)));
      if (sources.github) jobs.push(sourceJob("GitHub", fetchTopicGithubStories(topic)));
      if (sources.arxiv) jobs.push(sourceJob("arXiv", fetchTopicArxivPapers(topic)));
      if (sources.semanticScholar) jobs.push(sourceJob("Semantic Scholar", fetchTopicSemanticScholarPapers(topic)));

      const results = await Promise.all(jobs);
      const stories = results.flatMap((result) => result.stories);
      const errors = results.flatMap((result) => result.error ? [`${result.source}: ${result.error}`] : []);
      return {
        stories,
        errors,
        results,
      };
    }

    async function sourceJob(source, promise) {
      try {
        const stories = await promise;
        return { source, stories, error: "" };
      } catch (error) {
        return { source, stories: [], error: error.message || String(error) };
      }
    }

    async function fetchTopicHnStories(topic) {
      const sinceUnix = Math.floor((Date.now() - TOPIC_HN_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);
      const url = hnApiUrl(topic, sinceUnix, TOPIC_HN_HITS_PER_QUERY);
      const response = await fetch(url, {
        headers: { "User-Agent": "obsession-radar/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return (payload.hits || []).map((hit) => ({
        id: `hn:${hit.objectID}`,
        title: hit.title || hit.story_title || "Untitled HN story",
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: "Hacker News",
        points: hit.points || 0,
        comments: hit.num_comments || 0,
        author: hit.author || "unknown",
        createdAt: hit.created_at,
        storyText: hit.story_text || "",
        matchedQueries: [topic],
      }));
    }

    async function fetchTopicGithubStories(topic) {
      const pushedAfterDate = new Date(Date.now() - TOPIC_GITHUB_PUSHED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const search = `${topic} in:name,description,readme pushed:>${pushedAfterDate}`;
      const url = githubRepoApiUrl(search, TOPIC_GITHUB_REPOS_PER_QUERY);
      const response = await fetch(url, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return (payload.items || []).map((repo) => RadarCore.githubRepoToStory(repo, topic));
    }

    async function fetchTopicArxivPapers(topic) {
      const searchQuery = arxivTopicQuery(topic);
      const response = await fetch(arxivApiUrl(searchQuery, TOPIC_ARXIV_RESULTS_PER_QUERY));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      return parseArxivAtom(xml).map((entry) => RadarCore.arxivPaperToStory(entry, topic));
    }

    async function fetchTopicSemanticScholarPapers(topic) {
      return fetchSemanticScholarPapers(topic, topic, TOPIC_SEMANTIC_SCHOLAR_RESULTS_PER_QUERY);
    }

    async function fetchSemanticScholarPapers(query, label, limit) {
      const response = await fetch(semanticScholarApiUrl(query, limit), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return (payload.data || [])
        .map((paper) => RadarCore.semanticScholarPaperToStory(paper, label))
        .filter((paper) => paper.title && paper.url);
    }

    function semanticScholarApiUrl(query, limit) {
      const params = new URLSearchParams({
        query,
        limit: String(limit),
      });
      if (global.location.protocol === "http:" || global.location.protocol === "https:") {
        return `/api/semantic-scholar?${params}`;
      }
      params.set("fields", semanticScholarFields());
      return `https://api.semanticscholar.org/graph/v1/paper/search?${params}`;
    }

    function hnApiUrl(query, sinceUnix, limit) {
      const params = new URLSearchParams({
        query,
        since: String(sinceUnix),
        limit: String(limit),
      });
      if (global.location.protocol === "http:" || global.location.protocol === "https:") {
        return `/api/hn?${params}`;
      }
      return (
        "https://hn.algolia.com/api/v1/search_by_date" +
        `?tags=story&query=${encodeURIComponent(query)}` +
        `&numericFilters=created_at_i>${sinceUnix}` +
        `&hitsPerPage=${encodeURIComponent(String(limit))}`
      );
    }

    function githubRepoApiUrl(search, limit) {
      const params = new URLSearchParams({
        q: search,
        limit: String(limit),
      });
      if (global.location.protocol === "http:" || global.location.protocol === "https:") {
        return `/api/github?${params}`;
      }
      return (
        "https://api.github.com/search/repositories" +
        `?q=${encodeURIComponent(search)}` +
        "&sort=stars" +
        "&order=desc" +
        `&per_page=${encodeURIComponent(String(limit))}`
      );
    }

    function arxivApiUrl(query, limit) {
      const params = new URLSearchParams({
        query,
        limit: String(limit),
      });
      if (global.location.protocol === "http:" || global.location.protocol === "https:") {
        return `/api/arxiv?${params}`;
      }
      return `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${encodeURIComponent(String(limit))}&sortBy=submittedDate&sortOrder=descending`;
    }

    function semanticScholarFields() {
      return [
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
    }

    function parseArxivAtom(xml) {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) {
        throw new Error("arXiv XML parse failed");
      }
      return Array.from(doc.getElementsByTagName("entry"))
        .map((entry) => {
          const links = Array.from(entry.getElementsByTagName("link")).map((link) => ({
            href: link.getAttribute("href") || "",
            rel: link.getAttribute("rel") || "",
            title: link.getAttribute("title") || "",
            type: link.getAttribute("type") || "",
          }));
          const url = links.find((link) => link.rel === "alternate")?.href || firstText(entry, "id");
          const pdfUrl =
            links.find((link) => link.title === "pdf" || link.type === "application/pdf")?.href ||
            url.replace("/abs/", "/pdf/");

          return {
            id: firstText(entry, "id"),
            arxivId: arxivIdFrom(firstText(entry, "id") || url),
            title: firstText(entry, "title"),
            summary: firstText(entry, "summary"),
            published: firstText(entry, "published"),
            updated: firstText(entry, "updated"),
            authors: Array.from(entry.getElementsByTagName("author"))
              .map((author) => firstText(author, "name"))
              .filter(Boolean),
            categories: Array.from(entry.getElementsByTagName("category"))
              .map((category) => category.getAttribute("term") || "")
              .filter(Boolean),
            url,
            pdfUrl,
          };
        })
        .filter((entry) => entry.arxivId);
    }

    function firstText(node, tagName) {
      return normalizeXmlText(node.getElementsByTagName(tagName)[0]?.textContent || "");
    }

    function arxivIdFrom(value) {
      return normalizeXmlText(value)
        .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
        .replace(/^https?:\/\/arxiv\.org\/pdf\//i, "")
        .replace(/\.pdf$/i, "");
    }

    function normalizeXmlText(value) {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function arxivTopicQuery(topic) {
      return `all:"${normalizeTopicInput(topic).replace(/"/g, " ")}"`;
    }

    function normalizeTopicInput(value) {
      return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
    }

    function isPaperStory(story) {
      return story.source === "arXiv" || story.source === "Semantic Scholar";
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    return {
      fetchHnStories,
      fetchGithubRepoStories,
      fetchArxivPaperStories,
      fetchSemanticScholarPaperStories,
      fetchTopicStories,
      sourceJob,
      isPaperStory,
    };
  }

  global.ObsessionRadarFetchers = {
    createRadarFetchers,
  };
})(window);
