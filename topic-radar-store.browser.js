(function attachTopicRadarStore(global) {
  const TOPIC_RADAR_STORAGE_KEY = "agentsRadarLite.topicRadar.v1";
  const MAX_SAVED_TOPICS = 5;

  function emptyTopicRadarState() {
    return { activeTopic: "", items: {} };
  }

  function loadTopicRadarState(storage = global.localStorage) {
    if (!storage?.getItem) return emptyTopicRadarState();

    try {
      return normalizeTopicRadarState(JSON.parse(storage.getItem(TOPIC_RADAR_STORAGE_KEY) || "{}"));
    } catch {
      return emptyTopicRadarState();
    }
  }

  function saveTopicRadarState(state, storage = global.localStorage) {
    if (!storage?.setItem) return;
    storage.setItem(TOPIC_RADAR_STORAGE_KEY, JSON.stringify(normalizeTopicRadarState(state)));
  }

  function upsertTopicRadarItem(state, item, now = new Date()) {
    const normalized = normalizeTopicRadarState(state);
    const topic = normalizeTopic(item?.topic);
    if (!topic) return normalized;

    const key = topicKeyFor(topic);
    const previous = normalized.items[key] || {};
    const nextItem = {
      topic,
      sources: normalizeSources(item.sources || previous.sources),
      radar: item.radar || previous.radar || null,
      errors: normalizeErrors(item.errors || []),
      updatedAt: typeof now === "string" ? now : now.toISOString(),
    };
    const items = {
      ...normalized.items,
      [key]: nextItem,
    };
    const keptEntries = Object.entries(items)
      .sort(([, a], [, b]) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, MAX_SAVED_TOPICS);

    return {
      activeTopic: topic,
      items: Object.fromEntries(keptEntries),
    };
  }

  function removeTopicRadarItem(state, topic) {
    const normalized = normalizeTopicRadarState(state);
    const key = topicKeyFor(topic);
    const items = { ...normalized.items };
    delete items[key];
    return {
      activeTopic: normalized.activeTopic && topicKeyFor(normalized.activeTopic) !== key ? normalized.activeTopic : "",
      items,
    };
  }

  function topicRadarItemFor(state, topic) {
    const normalized = normalizeTopicRadarState(state);
    return normalized.items[topicKeyFor(topic)] || null;
  }

  function normalizeTopicRadarState(value) {
    const items = value && typeof value === "object" && value.items && typeof value.items === "object"
      ? value.items
      : {};
    const normalizedItems = Object.fromEntries(
      Object.values(items)
        .map(normalizeTopicRadarItem)
        .filter(Boolean)
        .map((item) => [topicKeyFor(item.topic), item]),
    );
    const activeTopic = normalizeTopic(value?.activeTopic);

    return {
      activeTopic: activeTopic && normalizedItems[topicKeyFor(activeTopic)] ? activeTopic : "",
      items: normalizedItems,
    };
  }

  function normalizeSources(value = {}) {
    return {
      hn: value.hn !== false,
      github: value.github !== false,
      arxiv: value.arxiv !== false,
      semanticScholar: value.semanticScholar !== false,
    };
  }

  function normalizeTopicRadarItem(value) {
    const topic = normalizeTopic(value?.topic);
    if (!topic) return null;

    return {
      topic,
      sources: normalizeSources(value.sources),
      radar: value.radar && typeof value.radar === "object" ? value.radar : null,
      errors: normalizeErrors(value.errors || []),
      updatedAt: String(value.updatedAt || ""),
    };
  }

  function normalizeTopic(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function normalizeErrors(errors) {
    return Array.isArray(errors) ? errors.map((error) => String(error)).filter(Boolean).slice(0, 5) : [];
  }

  function topicKeyFor(topic) {
    return normalizeTopic(topic).toLowerCase();
  }

  global.TopicRadarStore = {
    TOPIC_RADAR_STORAGE_KEY,
    MAX_SAVED_TOPICS,
    emptyTopicRadarState,
    loadTopicRadarState,
    saveTopicRadarState,
    upsertTopicRadarItem,
    removeTopicRadarItem,
    topicRadarItemFor,
    normalizeTopicRadarState,
    normalizeSources,
  };
})(window);
