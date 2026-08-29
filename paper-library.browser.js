(function attachPaperLibrary(global) {
  const PAPER_LIBRARY_STORAGE_KEY = "agentsRadarLite.paperLibrary.v1";

  function emptyPaperLibrary() {
    return { items: {} };
  }

  function loadPaperLibrary(storage = global.localStorage) {
    if (!storage?.getItem) return emptyPaperLibrary();
    try {
      return normalizeLibrary(JSON.parse(storage.getItem(PAPER_LIBRARY_STORAGE_KEY) || "{}"));
    } catch {
      return emptyPaperLibrary();
    }
  }

  function savePaperLibrary(library, storage = global.localStorage) {
    if (!storage?.setItem) return;
    storage.setItem(PAPER_LIBRARY_STORAGE_KEY, JSON.stringify(normalizeLibrary(library)));
  }

  function mergePaperIntoLibrary(library, paper, patch = {}, now = new Date()) {
    const normalized = normalizeLibrary(library);
    const id = paperIdFor(paper);
    if (!id) return normalized;
    const previous = normalized.items[id] || {};
    const nextItem = {
      paper: compactPaper(paper || previous.paper),
      favorite: Boolean(previous.favorite),
      queued: Boolean(previous.queued),
      read: Boolean(previous.read),
      note: previous.note || "",
      ...patch,
      updatedAt: typeof now === "string" ? now : now.toISOString(),
    };
    return {
      items: {
        ...normalized.items,
        [id]: {
          ...nextItem,
          favorite: Boolean(nextItem.favorite),
          queued: Boolean(nextItem.queued),
          read: Boolean(nextItem.read),
          note: String(nextItem.note || ""),
        },
      },
    };
  }

  function removePaperFromLibrary(library, paperId) {
    const normalized = normalizeLibrary(library);
    const items = { ...normalized.items };
    delete items[paperId];
    return { items };
  }

  function paperLibraryToMarkdown(items) {
    const selected = normalizeItems(items);
    const lines = ["# Research Reading Queue", ""];
    if (!selected.length) {
      lines.push("暂无精读论文。", "");
      return `${lines.join("\n")}\n`;
    }
    selected.forEach((item, index) => {
      const paper = item.paper || {};
      lines.push(
        `${index + 1}. [${paper.title || "Untitled paper"}](${paper.url || paper.pdfUrl || ""})`,
        `   - 状态：${statusTextFor(item)}`,
        `   - Authors: ${(paper.authors || []).join(", ") || "unknown"}`,
        `   - Categories: ${(paper.categories || []).join(", ") || "unknown"}`,
        `   - 内容介绍：${paper.intro || "暂无中文介绍"}`,
        `   - PDF: ${paper.pdfUrl || "N/A"}`,
      );
      if (item.note) lines.push(`   - Note: ${item.note}`);
      lines.push("");
    });
    return `${lines.join("\n")}\n`;
  }

  function paperItemsToBibtex(items) {
    return normalizeItems(items)
      .map((item) => paperToBibtex(item.paper))
      .filter(Boolean)
      .join("\n\n");
  }

  function paperToBibtex(paper) {
    if (!paper) return "";
    const title = cleanBibtexValue(paper.title || "Untitled paper");
    const authors = Array.isArray(paper.authors) && paper.authors.length ? paper.authors.join(" and ") : "unknown";
    const year = yearFor(paper);
    const arxivId = arxivIdFor(paper);
    const key = bibtexKeyFor(paper, year);
    return [
      `@misc{${key},`,
      `  title = {${title}},`,
      `  author = {${cleanBibtexValue(authors)}},`,
      `  year = {${year}},`,
      arxivId ? `  eprint = {${arxivId}},` : "",
      arxivId ? "  archivePrefix = {arXiv}," : "",
      `  url = {${paper.url || paper.pdfUrl || ""}}`,
      "}",
    ].filter(Boolean).join("\n");
  }

  function normalizeLibrary(value) {
    const items = value && typeof value === "object" && value.items && typeof value.items === "object" ? value.items : {};
    return {
      items: Object.fromEntries(
        Object.entries(items)
          .filter(([, item]) => item?.paper)
          .map(([id, item]) => [
            id,
            {
              paper: compactPaper(item.paper),
              favorite: Boolean(item.favorite),
              queued: Boolean(item.queued),
              read: Boolean(item.read),
              note: String(item.note || ""),
              updatedAt: item.updatedAt || "",
            },
          ]),
      ),
    };
  }

  function normalizeItems(items) {
    return [...(Array.isArray(items) ? items : [])]
      .filter((item) => item?.paper)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function compactPaper(paper = {}) {
    return {
      id: paperIdFor(paper),
      title: paper.title || "Untitled paper",
      url: paper.url || "",
      pdfUrl: paper.pdfUrl || "",
      authors: Array.isArray(paper.authors) ? paper.authors : [],
      categories: Array.isArray(paper.categories) ? paper.categories : [],
      createdAt: paper.createdAt || "",
      updatedAt: paper.updatedAt || "",
      intro: paper.intro || "",
    };
  }

  function paperIdFor(paper = {}) {
    return paper.id || paper.url || paper.pdfUrl || "";
  }

  function statusTextFor(item) {
    const status = [];
    if (item.favorite) status.push("收藏");
    if (item.queued) status.push("精读");
    if (item.read) status.push("已读");
    return status.length ? status.join(" / ") : "未分类";
  }

  function yearFor(paper) {
    const date = new Date(paper.createdAt || paper.updatedAt || "");
    return Number.isFinite(date.getTime()) ? String(date.getUTCFullYear()) : String(new Date().getUTCFullYear());
  }

  function arxivIdFor(paper) {
    return String(paper.id || paper.url || paper.pdfUrl || "")
      .replace(/^arxiv:/i, "")
      .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
      .replace(/^https?:\/\/arxiv\.org\/pdf\//i, "")
      .replace(/\.pdf$/i, "");
  }

  function bibtexKeyFor(paper, year) {
    const firstAuthor = (paper.authors || [])[0] || "paper";
    const lastName = firstAuthor.split(/\s+/).filter(Boolean).at(-1) || "paper";
    const titleWords = String(paper.title || "paper")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join("");
    return `${lastName.toLowerCase().replace(/[^a-z0-9]/g, "")}${year}${titleWords || "paper"}`;
  }

  function cleanBibtexValue(value) {
    return String(value || "").replace(/[{}]/g, "");
  }

  global.PaperLibrary = {
    PAPER_LIBRARY_STORAGE_KEY,
    emptyPaperLibrary,
    loadPaperLibrary,
    savePaperLibrary,
    mergePaperIntoLibrary,
    removePaperFromLibrary,
    paperLibraryToMarkdown,
    paperItemsToBibtex,
    paperToBibtex,
    normalizeLibrary,
  };
})(window);
