(function attachLibraryProfile(global) {
  // Personal relevance layer: builds a TF-IDF interest profile from the local
  // paper library (titles, intros, notes) and scores new papers against it.
  // Pure client-side, zero dependencies, shared shape with RadarCore scoring.

  const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "without",
    "from", "by", "as", "at", "is", "are", "was", "were", "be", "been", "being",
    "this", "that", "these", "those", "it", "its", "we", "our", "you", "your",
    "they", "their", "he", "she", "his", "her", "not", "no", "but", "if", "then",
    "than", "so", "such", "can", "could", "may", "might", "will", "would", "shall",
    "should", "must", "have", "has", "had", "do", "does", "did", "using", "use",
    "used", "based", "via", "toward", "towards", "into", "over", "under", "about",
    "between", "among", "through", "during", "before", "after", "above", "below",
    "more", "most", "less", "least", "very", "too", "also", "just", "only", "other",
    "new", "novel", "paper", "study", "work", "approach", "method", "methods",
    "model", "models", "result", "results", "experiment", "experiments",
    "的", "了", "和", "是", "在", "与", "对", "从", "被", "把", "让", "给",
    "这篇", "一个", "以及", "可以", "这个", "那个", "我们", "它们",
  ]);

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[a-z]+('\S)?/g, (word) => word + " ")
      .match(/[a-z][a-z0-9'-]{1,30}|[\u4e00-\u9fff]{2,6}/g) || [];
  }

  function isStopWord(token) {
    return STOP_WORDS.has(token);
  }

  function documentTextFor(item) {
    const paper = item.paper || {};
    return [
      paper.title || "",
      // Title words weigh double — strongest interest signal.
      paper.title || "",
      paper.intro || "",
      item.note || "",
      (paper.categories || []).join(" "),
    ].join(" ");
  }

  // Build { tokens: Map<term, weight>, size } from library items.
  // Weighting: queued > favorite > read > plain (reading intent beats passivity).
  function buildLibraryProfile(library) {
    const items = library?.items ? Object.values(library.items) : [];
    const docFreq = new Map();
    const documents = [];
    for (const item of items) {
      const tokens = tokenize(documentTextFor(item)).filter((t) => !isStopWord(t));
      if (!tokens.length) continue;
      const weight = item.queued ? 3 : item.favorite ? 2 : item.read ? 1.5 : 1;
      documents.push({ tokens, weight });
      for (const term of new Set(tokens)) docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
    if (!documents.length) return { terms: new Map(), documents: 0 };

    const profile = new Map();
    for (const { tokens, weight } of documents) {
      const tf = new Map();
      for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
      for (const [term, count] of tf) {
        const idf = Math.log((documents.length + 1) / (docFreq.get(term) + 0.5));
        const score = (count / tokens.length) * idf * weight;
        profile.set(term, (profile.get(term) || 0) + score);
      }
    }
    return { terms: profile, documents: documents.length };
  }

  function profileVectorNorm(profile) {
    let sum = 0;
    for (const value of profile.terms.values()) sum += value * value;
    return Math.sqrt(sum) || 1;
  }

  // Cosine-style similarity of a new paper against the profile, 0..1.
  function relevanceToProfile(paper, profile, norm) {
    if (!profile || !profile.terms.size || !norm) return 0;
    const text = [(paper.title || ""), (paper.intro || paper.abstract || paper.pageDescription || "")].join(" ");
    const tokens = tokenize(text).filter((t) => !isStopWord(t));
    if (!tokens.length) return 0;
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    let dot = 0;
    let paperNorm = 0;
    for (const [term, count] of tf) {
      const weight = count / tokens.length;
      paperNorm += weight * weight;
      const profileWeight = profile.terms.get(term);
      if (profileWeight) dot += weight * profileWeight;
    }
    if (!dot) return 0;
    return dot / (Math.sqrt(paperNorm) || 1) / norm;
  }

  // Top-k related library papers for AI-context injection.
  function relatedLibraryPapers(paper, library, limit = 3) {
    const items = library?.items ? Object.values(library.items) : [];
    if (!items.length || !paper) return [];
    const targetTokens = new Set(tokenize([paper.title || "", paper.abstract || paper.intro || ""].join(" ")));
    if (!targetTokens.size) return [];
    const scored = items
      .map((item) => {
        const tokens = new Set(tokenize(documentTextFor(item)));
        let overlap = 0;
        for (const token of targetTokens) if (tokens.has(token)) overlap += 1;
        return { item, overlap: overlap / Math.sqrt(targetTokens.size * (tokens.size || 1)) };
      })
      .filter((entry) => entry.overlap > 0.05)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit);
    return scored.map(({ item, overlap }) => ({
      title: item.paper?.title || "Untitled",
      note: item.note || "",
      queued: Boolean(item.queued),
      similarity: Number(overlap.toFixed(3)),
    }));
  }

  function profileSummary(profile, limit = 12) {
    if (!profile || !profile.terms.size) return [];
    return [...profile.terms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term, weight]) => ({ term, weight: Number(weight.toFixed(4)) }));
  }

  global.ObsessionLibraryProfile = {
    buildLibraryProfile,
    relevanceToProfile,
    profileVectorNorm,
    relatedLibraryPapers,
    profileSummary,
    tokenize,
    STOP_WORDS,
  };
})(window);
