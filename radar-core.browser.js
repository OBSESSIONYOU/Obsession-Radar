(function attachRadarCore(global) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const AI_QUERIES = [
    "generative AI",
    "LLM",
    "AI agents",
    "RAG",
    "prompt engineering",
    "OpenAI",
    "Anthropic Claude",
    "Codex",
    "MCP",
    "AI coding",
    "machine learning",
    "AI safety",
  ];

  const GITHUB_AI_QUERIES = [
    "artificial-intelligence",
    "generative-ai",
    "llm",
    "ai-agent",
    "rag",
    "openai",
    "claude",
    "mcp",
    "codex",
    "ai-coding",
  ];

  const PAPER_QUERIES = [
    {
      label: "LLM",
      searchQuery: '(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (all:LLM OR all:"large language model")',
      semanticQuery: "large language models",
    },
    {
      label: "RAG",
      searchQuery: '(cat:cs.AI OR cat:cs.CL OR cat:cs.IR) AND (all:RAG OR all:"retrieval augmented generation")',
      semanticQuery: "retrieval augmented generation",
    },
    {
      label: "AI agent",
      searchQuery: '(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (all:"AI agent" OR all:agentic)',
      semanticQuery: "AI agents agentic workflows",
    },
    {
      label: "AI coding",
      searchQuery: '(cat:cs.SE OR cat:cs.AI OR cat:cs.CL) AND (all:"AI coding" OR all:"code generation")',
      semanticQuery: "AI coding code generation",
    },
    {
      label: "Multimodal",
      searchQuery: '(cat:cs.CV OR cat:cs.CL OR cat:cs.AI) AND (all:multimodal OR all:"vision language")',
      semanticQuery: "multimodal vision language models",
    },
    {
      label: "AI safety",
      searchQuery: '(cat:cs.AI OR cat:cs.LG) AND (all:"AI safety" OR all:alignment OR all:evaluation)',
      semanticQuery: "AI safety alignment evaluation",
    },
  ];

  const AI_TOPIC_PATTERNS = [
    ["AI", /\b(?:ai|artificial intelligence|artificial-intelligence|generative ai|generative-ai|genai)\b/i],
    ["machine learning", /\b(?:machine learning|deep learning|neural networks?|transformers?)\b/i],
    ["LLM", /\b(?:llms?|large language models?|language models?)\b/i],
    ["RAG", /\b(?:rag|retrieval augmented generation|retrieval-augmented generation|vector search|vector-search|embeddings?)\b/i],
    ["AI agent", /\b(?:ai[-\s]?agents?|agents?|agentic|coding agents?|browser agents?|software agents?|agent runtime|scientific literature review)\b/i],
    ["prompt engineering", /\b(?:prompt engineering|prompt injection|system prompt|prompts?)\b/i],
    ["MCP", /\b(?:mcp|model context protocol)\b/i],
    ["OpenAI", /\b(?:openai|chatgpt|gpt-[0-9a-z.-]+)\b/i],
    ["Anthropic", /\b(?:anthropic|claude)\b/i],
    ["Claude", /\b(?:claude|claude code)\b/i],
    ["Codex", /\bcodex\b/i],
    ["Gemini", /\bgemini\b/i],
    ["DeepSeek", /\bdeepseek\b/i],
    ["AI coding", /\b(?:ai coding|ai-coding|vibe coding|coding with ai|llms? for coding|ai programming|code assistants?)\b/i],
    ["AI safety", /\b(?:ai safety|ai risk|model evals?|eval harness|alignment|distillation)\b/i],
  ];

  function dedupeStories(stories) {
    const seen = new Map();
    for (const story of stories) {
      const key = story.id || story.url;
      const previous = seen.get(key);
      if (!previous) {
        seen.set(key, {
          ...story,
          matchedQueries: [...new Set(story.matchedQueries || [])],
        });
        continue;
      }
      const stronger = (story.points || 0) > (previous.points || 0) ? story : previous;
      seen.set(key, {
        ...previous,
        ...stronger,
        matchedQueries: [...new Set([...(previous.matchedQueries || []), ...(story.matchedQueries || [])])],
        points: Math.max(previous.points || 0, story.points || 0),
        comments: Math.max(previous.comments || 0, story.comments || 0),
      });
    }
    return [...seen.values()];
  }

  function isAiRelatedStory(story) {
    return aiTopicsFor(story).length > 0;
  }

  function enrichAiStory(story) {
    const detectedTopics = aiTopicsFor(story);
    return {
      ...story,
      matchedQueries: [...new Set([...(story.matchedQueries || []), ...detectedTopics])],
    };
  }

  function githubRepoToStory(repo, query) {
    const topics = Array.isArray(repo.topics) ? repo.topics.filter(Boolean) : [];
    const baseStory = {
      id: `github:${repo.full_name}`,
      title: repo.full_name || repo.name || "unknown/repository",
      url: repo.html_url || "",
      source: "GitHub",
      points: repo.stargazers_count || 0,
      comments: repo.open_issues_count || 0,
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      openIssues: repo.open_issues_count || 0,
      createdAt: repo.pushed_at || repo.updated_at || repo.created_at,
      pageDescription: repo.description || "",
      githubTopics: topics,
      matchedQueries: [...new Set([query, ...topics].filter(Boolean))],
    };
    return enrichAiStory(baseStory);
  }

  function arxivPaperToStory(entry, query) {
    const label = typeof query === "string" ? query : query?.label;
    const baseStory = {
      id: `arxiv:${entry.arxivId}`,
      title: entry.title || "Untitled arXiv paper",
      url: entry.url || `https://arxiv.org/abs/${entry.arxivId}`,
      pdfUrl: entry.pdfUrl || `https://arxiv.org/pdf/${entry.arxivId}`,
      source: "arXiv",
      points: 0,
      comments: 0,
      authors: Array.isArray(entry.authors) ? entry.authors : [],
      categories: Array.isArray(entry.categories) ? entry.categories : [],
      createdAt: entry.published,
      updatedAt: entry.updated,
      abstract: entry.summary || "",
      pageDescription: entry.summary || "",
      matchedQueries: [label, ...(entry.categories || [])].filter(Boolean),
      googleScholarUrl: googleScholarSearchUrlFor(entry.title || entry.arxivId),
    };
    return enrichAiStory(baseStory);
  }

  function semanticScholarPaperToStory(paper, query) {
    const label = typeof query === "string" ? query : query?.label;
    const paperId = paper.paperId || paper.externalIds?.CorpusId || paper.externalIds?.DOI || paper.title;
    const authors = Array.isArray(paper.authors)
      ? paper.authors.map((author) => author?.name || author).filter(Boolean)
      : [];
    const fields = Array.isArray(paper.fieldsOfStudy) ? paper.fieldsOfStudy.filter(Boolean) : [];
    const categories = [
      ...fields,
      paper.venue,
      paper.year ? String(paper.year) : "",
    ].filter(Boolean);
    const publicationDate = paper.publicationDate || (paper.year ? `${paper.year}-01-01` : "");
    const title = paper.title || "Untitled Semantic Scholar paper";
    const baseStory = {
      id: `semanticscholar:${paperId}`,
      title,
      url: paper.url || (paper.paperId ? `https://www.semanticscholar.org/paper/${paper.paperId}` : ""),
      pdfUrl: paper.openAccessPdf?.url || "",
      source: "Semantic Scholar",
      points: paper.citationCount || 0,
      comments: paper.influentialCitationCount || 0,
      authors,
      categories,
      venue: paper.venue || "",
      year: paper.year || "",
      citations: paper.citationCount || 0,
      influentialCitations: paper.influentialCitationCount || 0,
      createdAt: publicationDate,
      updatedAt: publicationDate,
      abstract: paper.abstract || "",
      pageDescription: paper.abstract || "",
      externalIds: paper.externalIds || {},
      matchedQueries: [label, ...fields, paper.venue].filter(Boolean),
      googleScholarUrl: googleScholarSearchUrlFor(title),
    };
    return enrichAiStory(baseStory);
  }

  function googleScholarSearchUrlFor(queryOrStory) {
    const query = typeof queryOrStory === "string"
      ? queryOrStory
      : queryOrStory?.title || queryOrStory?.url || "";
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(normalizeText(query))}`;
  }

  function aiTopicsFor(story) {
    const text = searchableTextFor(story);
    return AI_TOPIC_PATTERNS
      .filter(([, pattern]) => pattern.test(text))
      .map(([label]) => label);
  }

  function scoreStory(story, now = new Date()) {
    const createdAt = new Date(story.createdAt || now);
    const ageHours = Math.max(0, (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000));
    const freshness = Math.max(0, 24 - Math.min(24, ageHours));
    const queryBreadth = new Set(story.matchedQueries || []).size;
    if (story.source === "GitHub") {
      const stars = story.stars ?? story.points ?? 0;
      const forks = story.forks ?? 0;
      const openIssues = story.openIssues ?? story.comments ?? 0;
      const topicBreadth = Math.min(queryBreadth, 4);
      return Math.round(
        Math.log10(stars + 1) * 45 +
          Math.log10(forks + 1) * 25 +
          Math.min(openIssues, 200) * 0.15 +
          topicBreadth * 14 +
          freshness * 1.8,
      );
    }
    return Math.round(
      (story.points || 0) * 1.15 +
        (story.comments || 0) * 2.4 +
        queryBreadth * 14 +
        freshness * 1.8,
    );
  }

  function buildDailyRadar(stories, options = {}) {
    const now = options.now || new Date();
    const candidateLimit = options.candidateLimit || 30;
    const recommendationLimit = options.recommendationLimit || 5;
    const ranked = dedupeStories(stories)
      .map((story) => ({
        ...story,
        score: scoreStory(story, now),
        intro: introFor(story),
        reason: reasonFor(story, now),
      }))
      .sort((a, b) => b.score - a.score || (b.points || 0) - (a.points || 0));
    const candidates = selectDailyCandidates(ranked, candidateLimit, now, options.sourceQuota);
    return {
      generatedAt: now.toISOString(),
      totalFetched: stories.length,
      uniqueCount: ranked.length,
      candidates,
      recommendations: selectDailyRecommendations(candidates, recommendationLimit, now),
    };
  }

  function selectDailyCandidates(ranked, limit, now, sourceQuota) {
    if (sourceQuota) return selectWithSourceQuota(ranked, limit, sourceQuota);
    const recentHn = ranked.filter((story) => isRecentHnStory(story, now));
    const hasGithub = ranked.some((story) => story.source === "GitHub");
    if (!hasGithub || !recentHn.length) return ranked.slice(0, limit);

    const desiredHn = Math.min(Math.floor(limit / 3), recentHn.length);
    const githubLimit = Math.max(0, limit - desiredHn);
    return selectWithGithubLimit(ranked, limit, githubLimit);
  }

  function selectWithSourceQuota(stories, limit, sourceQuota) {
    const selected = [];
    const selectedIds = new Set();
    for (const [source, quota] of Object.entries(sourceQuota || {})) {
      const pool = stories.filter((story) => story.source === source);
      for (const story of pool.slice(0, quota)) {
        selected.push(story);
        selectedIds.add(story.id);
      }
    }
    for (const story of stories) {
      if (selected.length >= limit) break;
      if (selectedIds.has(story.id)) continue;
      selected.push(story);
      selectedIds.add(story.id);
    }
    if (selected.length > limit) selected.length = limit;
    return selected.sort((a, b) => stories.indexOf(a) - stories.indexOf(b));
  }

  function selectDailyRecommendations(candidates, limit, now) {
    const recentHn = candidates.filter((story) => isRecentHnStory(story, now));
    const hasGithub = candidates.some((story) => story.source === "GitHub");
    if (!hasGithub || !recentHn.length) return candidates.slice(0, limit);

    const desiredHn = Math.min(2, recentHn.length, Math.max(0, limit - 1));
    const githubLimit = Math.max(0, limit - desiredHn);
    return selectWithGithubLimit(candidates, limit, githubLimit);
  }

  function selectWithGithubLimit(stories, limit, githubLimit) {
    const selected = [];
    let githubCount = 0;

    for (const story of stories) {
      if (story.source === "GitHub" && githubCount >= githubLimit) continue;
      selected.push(story);
      if (story.source === "GitHub") githubCount += 1;
      if (selected.length === limit) break;
    }

    if (selected.length < limit) {
      for (const story of stories) {
        if (selected.includes(story)) continue;
        selected.push(story);
        if (selected.length === limit) break;
      }
    }

    return selected.sort((a, b) => stories.indexOf(a) - stories.indexOf(b));
  }

  function isRecentHnStory(story, now) {
    if (story.source !== "Hacker News" && story.source !== "HN") return false;
    const createdAt = new Date(story.createdAt || 0).getTime();
    const ageMs = now.getTime() - createdAt;
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 72 * 60 * 60 * 1000;
  }

  function buildFocusedRadar(stories, options = {}) {
    const topic = normalizeText(options.topic || "");
    if (!topic) {
      return buildDailyRadar(stories, options);
    }
    return buildTopicRadar(stories, {
      ...options,
      topic,
      candidateLimit: options.candidateLimit || 30,
      recommendationLimit: options.recommendationLimit || 5,
    });
  }

  function buildPaperRadar(stories, options = {}) {
    const now = options.now || new Date();
    const candidateLimit = options.candidateLimit || 15;
    const recommendationLimit = options.recommendationLimit || 5;
    const ranked = dedupeStories(stories)
      .filter(isAiRelatedStory)
      .map((story) => ({
        ...story,
        score: scorePaper(story, now),
        intro: paperIntroFor(story),
        reason: paperReasonFor(story, now),
      }))
      .sort((a, b) => b.score - a.score || new Date(b.updatedAt || b.createdAt || now) - new Date(a.updatedAt || a.createdAt || now));
    const candidates = selectDailyCandidates(ranked, candidateLimit, now);
    return {
      generatedAt: now.toISOString(),
      totalFetched: stories.length,
      uniqueCount: ranked.length,
      candidates,
      recommendations: candidates.slice(0, recommendationLimit),
    };
  }

  function buildFocusedPaperRadar(stories, options = {}) {
    const now = options.now || new Date();
    const topic = normalizeText(options.topic || "");
    const candidateLimit = options.candidateLimit || 15;
    const recommendationLimit = options.recommendationLimit || 5;
    const aiOnly = options.aiOnly !== false && !topic;
    const ranked = dedupeStories(stories)
      .filter((story) => (aiOnly ? isAiRelatedStory(story) : true))
      .map((story) => ({
        ...story,
        score: scorePaper(story, now),
        intro: topic ? topicIntroFor(story, topic) : paperIntroFor(story),
        reason: paperReasonFor(story, now),
      }))
      .sort((a, b) => b.score - a.score || new Date(b.updatedAt || b.createdAt || now) - new Date(a.updatedAt || a.createdAt || now));
    const candidates = selectDailyCandidates(ranked, candidateLimit, now);
    return {
      generatedAt: now.toISOString(),
      topic,
      totalFetched: stories.length,
      uniqueCount: ranked.length,
      candidates,
      recommendations: candidates.slice(0, recommendationLimit),
    };
  }

  function buildTopicRadar(stories, options = {}) {
    const now = options.now || new Date();
    const topic = normalizeText(options.topic || "interest");
    const candidateLimit = options.candidateLimit || 20;
    const recommendationLimit = options.recommendationLimit || 5;
    const ranked = dedupeStories(stories)
      .map((story) => ({
        ...story,
        score: scoreTopicStory(story, now),
        intro: topicIntroFor(story, topic),
        reason: topicReasonFor(story, now),
      }))
      .sort((a, b) => b.score - a.score || (b.points || 0) - (a.points || 0));
    const candidates = selectDailyCandidates(ranked, candidateLimit, now);
    return {
      generatedAt: now.toISOString(),
      topic,
      totalFetched: stories.length,
      uniqueCount: ranked.length,
      candidates,
      recommendations: candidates.slice(0, recommendationLimit),
    };
  }

  function scorePaper(story, now = new Date()) {
    const publishedAt = new Date(story.createdAt || story.updatedAt || now);
    const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / DAY_MS);
    const freshness = Math.max(0, 14 - Math.min(14, ageDays));
    const queryBreadth = Math.min(new Set(story.matchedQueries || []).size, 5);
    const aiCategoryCount = (story.categories || []).filter((category) => /^cs\.(AI|LG|CL|CV|IR|SE)$/i.test(category)).length;
    const abstractLength = normalizeText(story.abstract || story.pageDescription || "").length;
    const citationSignal = Math.log10((story.citations ?? story.points ?? 0) + 1) * 10;
    const influentialSignal = Math.log10((story.influentialCitations ?? story.comments ?? 0) + 1) * 14;
    const pdfSignal = story.pdfUrl ? 6 : 0;

    return Math.round(
      freshness * 8 +
        queryBreadth * 16 +
        aiCategoryCount * 8 +
        Math.min(abstractLength / 120, 12) +
        citationSignal +
        influentialSignal +
        pdfSignal,
    );
  }

  function scoreTopicStory(story, now = new Date()) {
    const createdAt = new Date(story.createdAt || story.updatedAt || now);
    const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / DAY_MS);
    const freshness = Math.max(0, 30 - Math.min(30, ageDays));
    const queryBreadth = Math.min(new Set(story.matchedQueries || []).size, 5);

    if (story.source === "GitHub") {
      return Math.round(
        Math.log10((story.stars ?? story.points ?? 0) + 1) * 42 +
          Math.log10((story.forks ?? 0) + 1) * 20 +
          Math.min(story.openIssues ?? story.comments ?? 0, 250) * 0.12 +
          freshness * 1.6 +
          queryBreadth * 8,
      );
    }

    if (story.source === "arXiv" || story.source === "Semantic Scholar") {
      const abstractLength = normalizeText(story.abstract || story.pageDescription || "").length;
      const sourceSignal = story.source === "Semantic Scholar" ? 10 : 0;
      return Math.round(
        Math.max(0, 14 - Math.min(14, ageDays)) * 7 +
          queryBreadth * 10 +
          Math.min(abstractLength / 140, 14) +
          (story.pdfUrl ? 8 : 0) +
          Math.log10((story.citations ?? story.points ?? 0) + 1) * 10 +
          Math.log10((story.influentialCitations ?? story.comments ?? 0) + 1) * 12 +
          sourceSignal,
      );
    }

    return Math.round(
      (story.points || 0) * 1.05 +
        (story.comments || 0) * 2 +
        freshness * 1.4 +
        queryBreadth * 8,
    );
  }

  function toMarkdown(radar) {
    const lines = [
      "# Obsession Radar",
      "",
      `Generated: ${radar.generatedAt}`,
      ...(radar.topic ? [`Topic: ${radar.topic}`] : []),
      `Fetched: ${radar.totalFetched} links | Unique: ${radar.uniqueCount} | Candidates: ${radar.candidates.length}`,
      "",
      "## Top 5 Recommendations",
      "",
    ];
    radar.recommendations.forEach((story, index) => {
      const sourceLine = sourceLinkLineFor(story);
      lines.push(
        `${index + 1}. [${story.title}](${story.url})`,
        `   - 内容介绍：${story.intro}`,
        `   - Score: ${story.score} | Points: ${story.points || 0} | Comments: ${story.comments || 0}`,
        `   - Why: ${story.reason}`,
        sourceLine,
        "",
      );
    });
    lines.push("## 30-Link Candidate Pool", "");
    radar.candidates.forEach((story, index) => {
      lines.push(`${index + 1}. [${story.title}](${story.url}) - ${story.score} pts`);
      lines.push(`   - 内容介绍：${story.intro}`);
    });
    if (radar.paperRadar?.recommendations?.length) {
      lines.push("", "## Research Papers", "");
      radar.paperRadar.recommendations.forEach((paper, index) => {
        const paperSourceLine = sourceLinkLineFor(paper);
        lines.push(
          `${index + 1}. [${paper.title}](${paper.url})`,
          `   - 内容介绍：${paper.intro}`,
          `   - Authors: ${(paper.authors || []).join(", ") || "unknown"}`,
          `   - Categories: ${(paper.categories || []).join(", ") || "unknown"}`,
          `   - Score: ${paper.score} | Why: ${paper.reason}`,
          paperSourceLine,
          paper.pdfUrl ? `   - PDF: ${paper.pdfUrl}` : "   - PDF: unavailable",
          `   - Google Scholar: ${paper.googleScholarUrl || googleScholarSearchUrlFor(paper)}`,
          "",
        );
      });
    }
    return `${lines.join("\n")}\n`;
  }

  function sourceLinkLineFor(story) {
    if (story.source === "GitHub") return `   - GitHub: ${story.url}`;
    if (story.source === "arXiv") return `   - arXiv: ${story.url}`;
    if (story.source === "Semantic Scholar") return `   - Semantic Scholar: ${story.url}`;
    if (story.hnUrl) return `   - HN: ${story.hnUrl}`;
    return `   - Source: ${story.source || sourceFor(story)}`;
  }

  function introFor(story) {
    if (story.intro) return story.intro;
    const source = sourceFor(story);
    const content = contentSourceFor(story);
    if (story.source === "GitHub") {
      return `这个 GitHub 项目主要介绍了：${githubChineseSummaryFor(story, content)}。`;
    }
    return `这篇来自 ${source} 的帖子主要介绍了：${chineseSummaryFor(story, content)}。`;
  }

  function paperIntroFor(story) {
    if (story.intro) return story.intro;
    const text = normalizeText(`${story.title || ""} ${story.abstract || story.pageDescription || ""} ${(story.matchedQueries || []).join(" ")}`);
    const lower = text.toLowerCase();
    if (story.source === "Semantic Scholar") {
      if (lower.includes("retrieval") || lower.includes("rag") || lower.includes("citation")) {
        return "这篇来自 Semantic Scholar 的论文主要介绍了：面向科研文献综述的 RAG/Agent 方法，关注检索增强、引用依据和论文阅读流程。";
      }
      if (lower.includes("multimodal") || lower.includes("vision language") || lower.includes("vision-language")) {
        return "这篇来自 Semantic Scholar 的论文主要介绍了：多模态模型的训练与应用，关注视觉语言理解、跨模态推理和评测方法。";
      }
      if (lower.includes("code generation") || lower.includes("ai coding") || lower.includes("program repair")) {
        return "这篇来自 Semantic Scholar 的论文主要介绍了：AI 编程与代码生成方法，关注开发任务自动化、程序理解和工程评测。";
      }
      if (lower.includes("safety") || lower.includes("alignment") || lower.includes("evaluation") || lower.includes("eval")) {
        return "这篇来自 Semantic Scholar 的论文主要介绍了：AI 安全与模型评测方向，关注对齐、可靠性、风险识别和评测基准。";
      }
      if (lower.includes("agent") || lower.includes("agentic")) {
        return "这篇来自 Semantic Scholar 的论文主要介绍了：AI Agent 方法，关注任务规划、工具调用、多步骤推理和实际应用场景。";
      }
      if (lower.includes("llm") || lower.includes("large language model") || lower.includes("language models")) {
        return "这篇来自 Semantic Scholar 的论文主要介绍了：大语言模型相关方法，关注模型能力、训练策略、推理表现和落地应用。";
      }
      return `这篇来自 Semantic Scholar 的论文主要介绍了：与${topicsInChinese(story.matchedQueries || [])}相关的研究问题、方法设计和实验结论。`;
    }

    if (lower.includes("retrieval") || lower.includes("rag") || lower.includes("citation")) {
      return "这篇 arXiv 论文主要介绍了：面向科研文献综述的 RAG/Agent 方法，关注检索增强、引用依据和论文阅读流程。";
    }
    if (lower.includes("multimodal") || lower.includes("vision language") || lower.includes("vision-language")) {
      return "这篇 arXiv 论文主要介绍了：多模态模型的训练与应用，关注视觉语言理解、跨模态推理和评测方法。";
    }
    if (lower.includes("code generation") || lower.includes("ai coding") || lower.includes("program repair")) {
      return "这篇 arXiv 论文主要介绍了：AI 编程与代码生成方法，关注开发任务自动化、程序理解和工程评测。";
    }
    if (lower.includes("safety") || lower.includes("alignment") || lower.includes("evaluation") || lower.includes("eval")) {
      return "这篇 arXiv 论文主要介绍了：AI 安全与模型评测方向，关注对齐、可靠性、风险识别和评测基准。";
    }
    if (lower.includes("agent") || lower.includes("agentic")) {
      return "这篇 arXiv 论文主要介绍了：AI Agent 方法，关注任务规划、工具调用、多步骤推理和实际应用场景。";
    }
    if (lower.includes("llm") || lower.includes("large language model") || lower.includes("language models")) {
      return "这篇 arXiv 论文主要介绍了：大语言模型相关方法，关注模型能力、训练策略、推理表现和落地应用。";
    }
    return `这篇 arXiv 论文主要介绍了：与 ${topicsInChinese(story.matchedQueries || [])}相关的研究问题、方法设计和实验结论。`;
  }

  function topicIntroFor(story, topic = "interest") {
    if (story.intro) return story.intro;
    const cleanTopic = normalizeText(topic || (story.matchedQueries || [])[0] || "这个主题");
    const source = story.source || sourceFor(story);

    if (story.source === "GitHub") {
      return `这个 GitHub 项目与「${cleanTopic}」相关，主要关注开源实现、工程集成、功能边界和社区活跃度。`;
    }
    if (story.source === "arXiv") {
      return `这篇 arXiv 论文与「${cleanTopic}」相关，主要关注研究问题、方法设计、实验结果和后续阅读价值。`;
    }
    if (story.source === "Semantic Scholar") {
      return `这篇 Semantic Scholar 论文与「${cleanTopic}」相关，主要关注研究问题、引用影响、开放全文和后续阅读价值。`;
    }
    return `这条来自 ${source} 的内容与「${cleanTopic}」相关，主要关注技术动态、实践经验和社区讨论。`;
  }

  function contentSourceFor(story) {
    return [
      story.pageDescription,
      story.storyText,
      story.description,
      story.summary,
      story.contentSnippet,
      story.pageTitle && story.pageTitle !== story.title ? story.pageTitle : "",
    ].find((value) => isUsefulContentSource(value));
  }

  function isUsefulContentSource(value) {
    const normalized = normalizeText(value);
    const lower = normalized.toLowerCase();
    if (normalized.length < 24) return false;
    if (lower.includes("preflight checklist") && lower.includes("single bug report")) return false;
    if (lower.includes("i have searched existing issues") && lower.includes("reported yet")) return false;
    return true;
  }

  function chineseSummaryFor(story, content) {
    const title = normalizeText(story.title || "Untitled story");
    const text = normalizeText(`${title} ${content || ""}`);
    const subject = subjectFor(title, text);
    const focus = focusFor(text, story);
    return `${subject}，${focus}`;
  }

  function githubChineseSummaryFor(story, content) {
    const title = normalizeText(story.title || "GitHub repository");
    const text = normalizeText(`${title} ${content || ""} ${(story.githubTopics || []).join(" ")}`);
    const lower = text.toLowerCase();
    if (lower.includes("rag") || lower.includes("retrieval") || lower.includes("vector")) {
      return "面向 RAG 的开源工具，关注向量检索、知识库接入和工程集成";
    }
    if (lower.includes("mcp") || lower.includes("model context protocol")) {
      return "围绕 MCP 生态的开源项目，关注工具接入、上下文协议和 agent 集成";
    }
    if (lower.includes("codex") || lower.includes("ai-coding") || lower.includes("coding")) {
      return "面向 AI 编程的开源项目，关注代码生成、开发工作流和工程自动化";
    }
    if (lower.includes("agent") || lower.includes("agentic")) {
      return "面向 AI Agent 的开源框架，关注任务编排、工具调用和自动化执行";
    }
    if (lower.includes("openai") || lower.includes("claude") || lower.includes("anthropic")) {
      return "围绕主流大模型生态的项目，关注模型调用、应用开发和工作流集成";
    }
    if (lower.includes("llm") || lower.includes("language model")) {
      return "大语言模型相关开源项目，关注模型应用、推理能力和工程落地";
    }
    if (lower.includes("generative")) {
      return "生成式 AI 相关开源项目，关注内容生成、应用构建和开发者工具";
    }
    return `与${topicsInChinese(story.matchedQueries || [])}有关的开源项目，关注功能实现、工程集成和社区活跃度`;
  }

  function subjectFor(title, text) {
    const lower = text.toLowerCase();

    if (lower.includes("codex") && lower.includes("github discussions")) {
      return "用 Codex 监控 GitHub 讨论并生成每日工程推荐的工作流";
    }
    if (lower.includes("codex") && lower.includes("browser automation")) {
      return "OpenAI Codex CLI 新增浏览器自动化能力";
    }
    if (lower.includes("codex") && lower.includes("browser & terminal workflow")) {
      return "Codex 的浏览器和终端工作流";
    }
    if (lower.includes("stake") && lower.includes("us government")) {
      return "OpenAI 可能向美国政府提供股权的报道";
    }
    if (lower.includes("manufact") || (lower.includes("mcp") && lower.includes("cloud"))) {
      return "MCP 云服务 Manufact 以及 MCP 应用生产化";
    }
    if (lower.includes("watch a video") || lower.includes("claude-real-video")) {
      return "让 Claude 或其他 LLM 观看视频的开源工具";
    }
    if (lower.includes("askuserquestion") || lower.includes("no response after 60s")) {
      return "Claude Code 中 AskUserQuestion 超时后继续执行的问题";
    }
    if (lower.includes("lmdb") || lower.includes("lightning memory-mapped database")) {
      return "LMDB 内存映射数据库管理器";
    }
    if (lower.includes("ai evangelists") || lower.includes("linkedin feed")) {
      return "AI 布道者和 AI 网红内容泛滥的讨论";
    }
    if (lower.includes("different ways of using llms for coding") || lower.includes("flow state")) {
      return "使用 LLM、Claude Code 和 Codex 编程时难以进入心流的问题";
    }
    if (lower.includes("customer ip") && lower.includes("tokens")) {
      return "Anthropic 和 OpenAI 在客户 IP、token 价值上的争议";
    }
    if (lower.includes("ai coding is a nightmare")) {
      return "AI 编程体验中的失控、返工和协作成本";
    }
    if (lower.includes("chinese access to claude")) {
      return "Anthropic 收紧中国用户访问 Claude 的相关措施";
    }
    if (lower.includes("not smart") && lower.includes("artificial intelligence")) {
      return "当前 AI 能力边界以及下一阶段人工智能方向";
    }
    if (lower.includes("used hardware") || lower.includes("no cloud")) {
      return "用二手硬件高速运行大参数 LLM 的本地方案";
    }
    if (lower.includes("openui") || lower.includes("generative ui")) {
      return "生成式 UI 的开放标准 OpenUI";
    }
    if (lower.includes("claude code making an ass")) {
      return "Claude Code 使用中的误判、依赖和工程风险";
    }
    if (lower.includes("opplic")) {
      return "面向网页代理机构的 AI 增长员工产品";
    }
    if (lower.includes("claude fable")) {
      return "Claude Fable 模型在付费订阅中的保留与容量问题";
    }
    if (lower.includes("claude -p") || lower.includes("aws butler")) {
      return "用 Claude 命令行模式运行 AWS 助手代理";
    }
    if (lower.includes("rss reader")) {
      return "自托管 RSS 阅读器及内联 YouTube 阅读体验";
    }
    if (lower.includes("ai costs") || lower.includes("smart pricing")) {
      return "通过智能定价降低 AI 使用成本的方法";
    }
    if (lower.includes("glm-5.2") || lower.includes("chinese model")) {
      return "开源中文模型 GLM-5.2 与 Claude 的成本和能力对比";
    }
    if (lower.includes("$1b fde") || lower.includes("fde org")) {
      return "Amazon 新建 FDE 组织以及大厂 AI 落地团队布局";
    }
    if (lower.includes("llm etiquette")) {
      return "使用 LLM 时更礼貌、更高效的协作规范";
    }
    if (lower.includes("vibe coding")) {
      return "靠 vibe coding 做产品后的商业化与可持续性问题";
    }
    if (lower.includes("distillation")) {
      return "Anthropic 对模型蒸馏的态度及其行业讽刺点";
    }
    if (lower.includes("electricity use") || lower.includes("ai buildout")) {
      return "Google AI 基础设施扩张带来的用电增长";
    }
    if (lower.includes("teaching ai new skills")) {
      return "训练 AI 学会新技能所需的数据配方";
    }
    if (lower.includes("good day at work") && lower.includes("ai era")) {
      return "AI 时代好工作日应该是什么样子的讨论";
    }
    if (lower.includes("avoid ai")) {
      return "尽量避开 AI 功能和 AI 嵌入场景的方法";
    }
    if (lower.includes("without ai")) {
      return "不依赖 AI 也能享受网站构建的开发体验";
    }
    if (lower.includes("short leash") && lower.includes("ai coding")) {
      return "用短牵引方式控制 AI 编程输出的方法";
    }

    return `${translateTitle(title)}相关内容`;
  }

  function focusFor(text, story) {
    const lower = text.toLowerCase();
    if (lower.includes("github discussions") || lower.includes("classify posts") || lower.includes("daily engineering recommendations")) {
      return "聚焦 GitHub 讨论监控、帖子分类和每日工程推荐";
    }
    if (lower.includes("browser automation") || lower.includes("coding agents")) {
      return "聚焦浏览器自动化、网页操作和编程代理";
    }
    if (lower.includes("browser & terminal workflow")) {
      return "聚焦浏览器和终端工作流、agent 编程协作";
    }
    if (lower.includes("bug") || lower.includes("issue") || lower.includes("no response")) {
      return "说明复现现象、影响范围和排查线索";
    }
    if (lower.includes("mcp") && (lower.includes("cloud") || lower.includes("production") || lower.includes("deploy"))) {
      return "聚焦 MCP 服务部署、测试、监控和商店发布";
    }
    if (lower.includes("video") || lower.includes("transcript") || lower.includes("frames")) {
      return "涵盖视频帧提取、转录、本地运行和多模态理解";
    }
    if (lower.includes("stake") || lower.includes("government")) {
      return "讨论股权安排、AI 收益分享和政策影响";
    }
    if (lower.includes("pricing") || lower.includes("cost")) {
      return "关注成本结构、定价策略和实际落地收益";
    }
    if (lower.includes("coding") || lower.includes("programming") || lower.includes("code")) {
      return "讨论 AI 编程工具的使用体验、限制和工作流变化";
    }
    return `聚焦${topicsInChinese(story.matchedQueries || [])}相关背景、功能和讨论点`;
  }

  function translateTitle(title) {
    const stripped = normalizeText(title)
      .replace(/^(Show HN|Launch HN|Ask HN|AskHN|Blog HN):\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return stripped
      .replace(/adds browser automation for coding agents/i, "新增面向编程代理的浏览器自动化能力")
      .replace(/any LLM can watch a video/i, "让任意 LLM 观看视频")
      .replace(/open-source/i, "开源")
      .replace(/Chinese Model/i, "中文模型")
      .replace(/AI coding/i, "AI 编程")
      .replace(/AI costs/i, "AI 成本")
      .replace(/LLM Etiquette/i, "LLM 使用礼仪")
      .replace(/without AI/i, "不依赖 AI");
  }

  function topicsInChinese(topics) {
    const mapped = [...new Set(topics)].map((topic) => ({
      AI: "人工智能",
      LLM: "大语言模型",
      RAG: "RAG",
      "AI agent": "AI Agent",
      "prompt engineering": "提示词工程",
      MCP: "MCP",
      Claude: "Claude",
      Codex: "Codex",
      OpenAI: "OpenAI",
      Anthropic: "Anthropic",
      Gemini: "Gemini",
      DeepSeek: "DeepSeek",
      "AI coding": "AI 编程",
      "AI safety": "AI 安全",
      "machine learning": "机器学习",
    })[topic] || topic);
    return mapped.length ? mapped.join("、") : "AI 信息雷达";
  }

  function reasonFor(story, now) {
    const ageHours = Math.max(0, (now.getTime() - new Date(story.createdAt || now).getTime()) / (60 * 60 * 1000));
    const signals = [];
    if (story.source === "GitHub") {
      if ((story.stars || story.points || 0) >= 1000) signals.push("popular GitHub repo");
      if ((story.openIssues || story.comments || 0) >= 20) signals.push("active issue tracker");
      if ((story.matchedQueries || []).length > 1) signals.push("matched multiple AI topics");
      if (ageHours <= 72) signals.push("recently pushed");
      return signals.length ? signals.join(", ") : "balanced GitHub activity signal";
    }
    if ((story.points || 0) >= 100) signals.push("high HN points");
    if ((story.comments || 0) >= 30) signals.push("active discussion");
    if ((story.matchedQueries || []).length > 1) signals.push("matched multiple AI queries");
    if (ageHours <= 8) signals.push("fresh today");
    return signals.length ? signals.join(", ") : "balanced activity signal";
  }

  function paperReasonFor(story, now) {
    const publishedAt = new Date(story.createdAt || story.updatedAt || now);
    const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / DAY_MS);
    const topics = new Set(story.matchedQueries || []);
    const signals = [];

    if (ageDays <= 3) signals.push("fresh paper");
    for (const topic of ["RAG", "LLM", "AI agent", "AI coding", "Multimodal", "AI safety"]) {
      if (topics.has(topic)) signals.push(`matched ${topic}`);
    }
    if ((story.categories || []).some((category) => /^cs\.(AI|LG|CL|CV|IR|SE)$/i.test(category))) {
      signals.push("CS AI category");
    }
    if ((story.citations || 0) >= 20) signals.push("cited paper");
    if ((story.influentialCitations || 0) >= 5) signals.push("influential citations");
    if (story.pdfUrl) signals.push("has PDF");

    return signals.length ? signals.slice(0, 5).join(", ") : "balanced research signal";
  }

  function topicReasonFor(story, now) {
    const createdAt = new Date(story.createdAt || story.updatedAt || now);
    const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / DAY_MS);
    const signals = [];

    if (story.source === "GitHub") {
      if ((story.stars || story.points || 0) >= 500) signals.push("popular GitHub repo");
      if ((story.forks || 0) >= 50) signals.push("forked by developers");
      if (ageDays <= 30) signals.push("recently active");
      return signals.length ? signals.join(", ") : "balanced repository signal";
    }
    if (story.source === "arXiv" || story.source === "Semantic Scholar") {
      if (ageDays <= 14) signals.push("recent paper");
      if (story.pdfUrl) signals.push("has PDF");
      if ((story.citations || 0) >= 20) signals.push("cited paper");
      if ((story.categories || []).length) signals.push("categorized research");
      return signals.length ? signals.join(", ") : "balanced research signal";
    }
    if ((story.points || 0) >= 80) signals.push("high community attention");
    if ((story.comments || 0) >= 20) signals.push("active discussion");
    if (ageDays <= 7) signals.push("recent discussion");
    return signals.length ? signals.join(", ") : "balanced topic signal";
  }

  function sourceFor(story) {
    try {
      return new URL(story.url).hostname.replace(/^www\./, "");
    } catch {
      return story.source || "unknown source";
    }
  }

  function compactTitle(title) {
    const normalized = String(title).replace(/\s+/g, " ").trim();
    return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
  }

  function compactText(text) {
    const normalized = normalizeText(text);
    return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
  }

  function normalizeText(value) {
    return decodeHtmlEntities(String(value || ""))
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function searchableTextFor(story) {
    return normalizeText([
      story.title,
      story.url,
      story.storyText,
      story.pageTitle,
      story.pageDescription,
      story.description,
      story.summary,
      story.abstract,
      story.contentSnippet,
      story.venue,
      story.year,
      ...(story.authors || []),
      ...(story.categories || []),
      ...(story.githubTopics || []),
    ].filter(Boolean).join(" "));
  }

  const METHOD_HINT_PATTERNS = [
    /(?:we|this (?:paper|work)) (?:propose|present|introduce|develop)[^.]*?\b(?:the )?([A-Z][\w-]*(?: [A-Z][\w-]*){0,3})/i,
    /(?:a|an|new) ([A-Z][\w-]*(?:-[A-Z][\w-]*)*) (?:method|framework|approach|model|architecture|algorithm)/,
  ];
  const DATASET_HINT_PATTERN =
    /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})\s+(?:datasets?|benchmarks?|corpus(?:es)?|suite)\b/;

  const DATASET_HINT_STOP_WORDS = new Set([
    "a", "an", "the", "we", "our", "this", "new", "large", "small", "public",
    "existing", "novel", "two", "three", "several", "benchmark", "dataset",
  ]);

  function extractMethodHint(abstract) {
    const text = normalizeText(abstract);
    for (const pattern of METHOD_HINT_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length > 2) return match[1].trim();
    }
    return "";
  }

  function extractDatasetHint(abstract) {
    const match = normalizeText(abstract).match(DATASET_HINT_PATTERN);
    if (!match) return "";
    const hint = (match[1] || match[2] || "").trim();
    // Reject stop-word captures like "A dataset" that carry no real name.
    if (!hint || hint.split(/\s+/).every((word) => DATASET_HINT_STOP_WORDS.has(word.toLowerCase()))) {
      return "";
    }
    return hint;
  }

  // Rule-based reading advice so the daily report works without any AI key.
  function readingAdviceFor(paper) {
    const citations = paper.citations ?? paper.citationCount ?? 0;
    const abstractLength = normalizeText(paper.abstract || "").length;
    if (paper.codeUrl && abstractLength > 200) return "适合精读";
    if (paper.score >= 120 || citations >= 50 || (paper.codeUrl && abstractLength > 80)) return "适合精读";
    if (paper.score >= 60 || abstractLength > 120) return "值得浏览";
    return "关注动向";
  }

  function enrichPaperStory(paper) {
    return {
      ...paper,
      methodHint: paper.methodHint || extractMethodHint(paper.abstract),
      datasetHint: paper.datasetHint || extractDatasetHint(paper.abstract),
      readingAdvice: paper.readingAdvice || readingAdviceFor(paper),
    };
  }

  function decodeHtmlEntities(value) {
    return String(value || "")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }

  global.RadarCore = {
    DEFAULT_SOURCE_QUOTA: {
      "Hacker News": 10,
      GitHub: 12,
      arXiv: 4,
      "Semantic Scholar": 4,
    },
    AI_QUERIES,
    GITHUB_AI_QUERIES,
    PAPER_QUERIES,
    dedupeStories,
    scoreStory,
    scorePaper,
    scoreTopicStory,
    buildDailyRadar,
    buildFocusedRadar,
    buildPaperRadar,
    buildFocusedPaperRadar,
    buildTopicRadar,
    toMarkdown,
    introFor,
    paperIntroFor,
    topicIntroFor,
    isAiRelatedStory,
    enrichAiStory,
    aiTopicsFor,
    githubRepoToStory,
    arxivPaperToStory,
    semanticScholarPaperToStory,
    enrichPaperStory,
    extractMethodHint,
    extractDatasetHint,
    readingAdviceFor,
    googleScholarSearchUrlFor,
  };
})(window);
