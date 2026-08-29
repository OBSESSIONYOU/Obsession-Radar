(function startApp() {
  const QUERIES = window.RadarCore.AI_QUERIES;
  const TOPIC_STALE_MS = 12 * 60 * 60 * 1000;
  const paperLibraryApi = window.PaperLibrary;
  const topicRadarApi = window.TopicRadarStore;
  const aiApiConfigApi = window.AiApiConfig;
  const fetchers = window.ObsessionRadarFetchers.createRadarFetchers({ RadarCore: window.RadarCore });
  const INITIAL_VISIBLE_CANDIDATES = 15;
  const state = {
    radar: window.AGENTS_RADAR_LITE || null,
    source: window.AGENTS_RADAR_LITE ? "上次生成" : "示例数据",
    loading: false,
    error: "",
    sourceHealth: defaultSourceHealth(),
    paperStatus: "",
    candidatesExpanded: false,
    aiApiConfig: aiApiConfigApi.loadAiApiConfig(),
    apiSettingsOpen: false,
    apiTesting: false,
    apiStatus: "",
    paperLibrary: paperLibraryApi.loadPaperLibrary(),
    activeLibraryView: "queued",
    lastRun: window.AGENTS_RADAR_LITE_LAST_RUN || null,
    topicRadar: topicRadarApi.loadTopicRadarState(),
    topicPreview: null,
    topicLoading: false,
    topicError: "",
  };

  const sampleStories = Array.from({ length: 34 }, (_, index) => ({
    id: `sample-${index}`,
    title: [
      "Show HN: Local-first AI research notebook",
      "Open-source agent runtime for browser tasks",
      "Claude workflow patterns for small teams",
      "Vector search without a managed database",
      "Tiny LLM eval harness for product teams",
    ][index % 5],
    url: `https://example.com/obsession-radar/${index}`,
    hnUrl: `https://news.ycombinator.com/item?id=sample-${index}`,
    source: "Sample",
    points: 30 + index * 9,
    comments: 2 + index,
    author: "sample",
    createdAt: new Date(Date.now() - (index % 12) * 60 * 60 * 1000).toISOString(),
    pageDescription: [
      "介绍一个本地优先的 AI 研究笔记工具，用来收集链接、整理主题，并生成每日可读摘要。",
      "介绍一个面向浏览器任务的开源 agent runtime，包含页面操作、状态读取和自动化执行能力。",
      "介绍小团队如何用 Claude 组织研发工作流，包括资料筛选、任务拆分和周报输出。",
      "介绍不用托管数据库也能做向量搜索的轻量方案，适合个人项目和小型知识库。",
      "介绍一个给产品团队使用的 LLM 评测脚手架，用来比较提示词、模型输出和回归结果。",
    ][index % 5],
    matchedQueries: [QUERIES[index % QUERIES.length]],
  }));

  const elements = {
    status: document.querySelector("#statusText"),
    lastRun: document.querySelector("#lastRunText"),
    refresh: document.querySelector("#refreshButton"),
    apiSettingsButton: document.querySelector("#apiSettingsButton"),
    exportButton: document.querySelector("#exportButton"),
    exportReadingButton: document.querySelector("#exportReadingButton"),
    exportBibtexButton: document.querySelector("#exportBibtexButton"),
    stats: document.querySelector("#stats"),
    sourceHealth: document.querySelector("#sourceHealth"),
    topicForm: document.querySelector("#topicForm"),
    topicInput: document.querySelector("#topicInput"),
    topicSourceHn: document.querySelector("#topicSourceHn"),
    topicSourceGithub: document.querySelector("#topicSourceGithub"),
    topicSourceArxiv: document.querySelector("#topicSourceArxiv"),
    topicSourceSemanticScholar: document.querySelector("#topicSourceSemanticScholar"),
    topicSaveButton: document.querySelector("#topicSaveButton"),
    topicStatus: document.querySelector("#topicStatus"),
    topicSaved: document.querySelector("#topicSaved"),
    topicResultsPanel: document.querySelector("#topicResultsPanel"),
    topicResults: document.querySelector("#topicResults"),
    recommendations: document.querySelector("#recommendations"),
    candidateToggleButton: document.querySelector("#candidateToggleButton"),
    paperStatus: document.querySelector("#paperStatus"),
    papers: document.querySelector("#papers"),
    libraryTabs: document.querySelector("#libraryTabs"),
    paperLibrary: document.querySelector("#paperLibrary"),
    candidates: document.querySelector("#candidates"),
    markdown: document.querySelector("#markdownOutput"),
    apiSettingsPanel: document.querySelector("#apiSettingsPanel"),
    apiSettingsForm: document.querySelector("#apiSettingsForm"),
    apiEnabled: document.querySelector("#apiEnabled"),
    apiBaseUrl: document.querySelector("#apiBaseUrl"),
    apiKey: document.querySelector("#apiKey"),
    apiModel: document.querySelector("#apiModel"),
    apiWireApi: document.querySelector("#apiWireApi"),
    apiStatus: document.querySelector("#apiStatus"),
    apiTestButton: document.querySelector("#apiTestButton"),
    apiClearKeyButton: document.querySelector("#apiClearKeyButton"),
    apiCloseButton: document.querySelector("#apiCloseButton"),
  };

  elements.refresh.addEventListener("click", refreshLive);
  elements.apiSettingsButton.addEventListener("click", toggleApiSettings);
  elements.exportButton.addEventListener("click", downloadMarkdown);
  elements.exportReadingButton.addEventListener("click", downloadReadingMarkdown);
  elements.exportBibtexButton.addEventListener("click", downloadBibtex);
  elements.candidateToggleButton.addEventListener("click", toggleCandidates);
  elements.papers.addEventListener("click", handlePaperAction);
  elements.libraryTabs.addEventListener("click", handleLibraryView);
  elements.paperLibrary.addEventListener("click", handleLibraryAction);
  elements.paperLibrary.addEventListener("input", handleLibraryNoteInput);
  elements.topicForm.addEventListener("submit", handleTopicSubmit);
  elements.topicSaveButton.addEventListener("click", handleTopicSave);
  elements.topicSaved.addEventListener("click", handleSavedTopicAction);
  elements.apiSettingsForm.addEventListener("submit", handleApiSettingsSave);
  elements.apiTestButton.addEventListener("click", handleApiTest);
  elements.apiClearKeyButton.addEventListener("click", handleApiClearKey);
  elements.apiCloseButton.addEventListener("click", closeApiSettings);

  if (!state.radar) {
    state.radar = {
      ...window.RadarCore.buildDailyRadar(sampleStories),
      paperRadar: window.RadarCore.buildPaperRadar([]),
    };
  } else if (!state.radar.paperRadar) {
    state.radar = {
      ...state.radar,
      paperRadar: window.RadarCore.buildPaperRadar([]),
    };
  }
  state.topicPreview = activeTopicItem();
  if (state.topicPreview) {
    elements.topicInput.value = state.topicPreview.topic;
    setTopicSourceControls(state.topicPreview.sources);
  }
  loadLastRunStatus();
  render();

  async function loadLastRunStatus() {
    if (state.lastRun) {
      renderLastRunStatus();
      return;
    }

    try {
      const response = await fetch("./last-run.json", { cache: "no-store" });
      if (!response.ok) return;
      state.lastRun = await response.json();
      renderLastRunStatus();
    } catch {
      if (!state.lastRun) {
        renderLastRunStatus();
      }
    }
  }

  async function refreshLive() {
    if (state.apiSettingsOpen) {
      syncAiApiConfigFromForm();
    }
    const topic = normalizeTopicInput(elements.topicInput.value);
    const sources = selectedTopicSources();
    if (topic && !hasSelectedSource(sources)) {
      state.error = "至少选择一个来源";
      render();
      return;
    }

    state.loading = true;
    state.error = "";
    state.topicError = "";
    state.paperStatus = "";
    state.candidatesExpanded = false;
    renderStatus();
    renderTopicSearch();
    try {
      if (topic) {
        await refreshFocusedRadar(topic, sources);
      } else {
        await refreshDefaultRadar();
      }
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function refreshDefaultRadar() {
    const previousPaperRadar = state.radar?.paperRadar || window.RadarCore.buildPaperRadar([]);
    const [hnResult, githubResult, arxivResult, semanticScholarResult] = await Promise.all([
      fetchers.sourceJob("HN", fetchers.fetchHnStories()),
      fetchers.fetchGithubRepoStories()
        .then((stories) => ({ stories, error: "" }))
        .catch((error) => ({ source: "GitHub", stories: [], error: error.message || String(error) })),
      fetchers.fetchArxivPaperStories()
        .then((stories) => ({ stories, error: "" }))
        .catch((error) => ({ source: "arXiv", stories: [], error: error.message || String(error) })),
      fetchers.fetchSemanticScholarPaperStories()
        .then((stories) => ({ stories, error: "" }))
        .catch((error) => ({ source: "Semantic Scholar", stories: [], error: error.message || String(error) })),
    ]);
    hnResult.source = "HN";
    githubResult.source = "GitHub";
    arxivResult.source = "arXiv";
    semanticScholarResult.source = "Semantic Scholar";
    const sourceResults = [hnResult, githubResult, arxivResult, semanticScholarResult];
    state.sourceHealth = sourceHealthFromResults(sourceResults);
    const paperStories = [...arxivResult.stories, ...semanticScholarResult.stories];
    const paperRadar = arxivResult.error && semanticScholarResult.error
      ? previousPaperRadar
      : window.RadarCore.buildPaperRadar(paperStories);
    state.paperStatus = paperStatusFromResults([arxivResult, semanticScholarResult], paperRadar === previousPaperRadar);
    const mainStories = [...hnResult.stories, ...githubResult.stories];
    if (!mainStories.length && !paperStories.length) {
      throw new Error("四个来源暂时都失败，已保留上次日报，可稍后再试。");
    }
    // Keep the main board alive from whichever sources succeeded; paper
    // stories join the candidate pool under the shared source quota.
    const radar = {
      ...window.RadarCore.buildDailyRadar([...mainStories, ...paperStories], {
        sourceQuota: window.RadarCore.DEFAULT_SOURCE_QUOTA,
      }),
      paperRadar,
    };
    state.radar = await enhanceRadarIfEnabled(radar);
    state.source = sourceLabelFor(hnResult.error, githubResult.error, arxivResult.error, semanticScholarResult.error);
  }

  async function refreshFocusedRadar(topic, sources) {
    const topicResult = await fetchers.fetchTopicStories(topic, sources);
    const paperStories = topicResult.stories.filter(fetchers.isPaperStory);
    state.sourceHealth = sourceHealthFromResults(topicResult.results || []);
    const previousPaperRadar = state.radar?.paperRadar || window.RadarCore.buildPaperRadar([]);
    const paperSourceFailed = topicResult.errors.some((error) =>
      error.startsWith("arXiv:") || error.startsWith("Semantic Scholar:")
    );
    const paperRadar = paperStories.length || !paperSourceFailed
      ? window.RadarCore.buildFocusedPaperRadar(paperStories, { topic, aiOnly: false })
      : previousPaperRadar;
    state.paperStatus = paperStatusFromResults(
      (topicResult.results || []).filter((result) => result.source === "arXiv" || result.source === "Semantic Scholar"),
      paperRadar === previousPaperRadar,
    );
    const radar = {
      ...window.RadarCore.buildFocusedRadar(topicResult.stories, { topic }),
      paperRadar,
    };
    state.radar = await enhanceRadarIfEnabled(radar);
    state.source = focusedSourceLabelFor(topic, topicResult.errors);
    state.topicPreview = {
      topic,
      sources,
      radar: null,
      errors: topicResult.errors,
      updatedAt: new Date().toISOString(),
    };
  }

  async function enhanceRadarIfEnabled(radar) {
    const missing = aiApiConfigApi.missingAiApiConfigFields(state.aiApiConfig);
    if (missing.length) {
      const incompleteFields = missing.filter((field) => field !== "启用开关");
      state.apiStatus = state.aiApiConfig.enabled
        ? `API 设置未完整保存：缺少 ${incompleteFields.join("、")}，已使用规则摘要`
        : "";
      return radar;
    }
    const result = await aiApiConfigApi.enhanceRadarWithAiResult(radar, state.aiApiConfig);
    state.apiStatus = result.message || (result.ok ? "AI 增强已应用" : "AI 增强失败，已使用规则摘要");
    return result.radar;
  }

  async function handleTopicSubmit(event) {
    event.preventDefault();
    await refreshLive();
  }

  function handleTopicSave() {
    const topic = normalizeTopicInput(elements.topicInput.value);
    const sources = selectedTopicSources();
    if (!topic) {
      state.topicError = "请输入主题";
      renderTopicSearch();
      renderTopicRadar();
      return;
    }
    if (!hasSelectedSource(sources)) {
      state.topicError = "至少选择一个来源";
      renderTopicSearch();
      renderTopicRadar();
      return;
    }

    state.topicError = "";
    state.topicRadar = topicRadarApi.upsertTopicRadarItem(state.topicRadar, {
      topic,
      sources,
      radar: null,
      errors: [],
    });
    state.topicPreview = topicRadarApi.topicRadarItemFor(state.topicRadar, topic);
    persistTopicRadar();
    render();
  }

  function toggleApiSettings() {
    state.apiSettingsOpen = !state.apiSettingsOpen;
    renderApiSettings();
  }

  function closeApiSettings() {
    state.apiSettingsOpen = false;
    renderApiSettings();
  }

  function handleApiSettingsSave(event) {
    event.preventDefault();
    syncAiApiConfigFromForm();
    const missing = aiApiConfigApi.missingAiApiConfigFields(state.aiApiConfig);
    state.apiStatus = missing.length
      ? `API 设置已保存，但缺少 ${missing.join("、")}`
      : "API 设置已保存，可以用于 AI 摘要增强";
    render();
  }

  function syncAiApiConfigFromForm() {
    state.aiApiConfig = aiApiConfigApi.normalizeAiApiConfig({
      enabled: elements.apiEnabled.checked,
      baseUrl: elements.apiBaseUrl.value,
      apiKey: elements.apiKey.value,
      model: elements.apiModel.value,
      wireApi: elements.apiWireApi.value,
    });
    aiApiConfigApi.saveAiApiConfig(state.aiApiConfig);
    return state.aiApiConfig;
  }

  async function handleApiTest() {
    syncAiApiConfigFromForm();
    state.apiTesting = true;
    state.apiStatus = "正在测试 API 连接...";
    renderApiSettings();
    try {
      const result = await aiApiConfigApi.testAiApiConnection(state.aiApiConfig);
      state.apiStatus = result.message;
    } finally {
      state.apiTesting = false;
      renderApiSettings();
    }
  }

  function handleApiClearKey() {
    state.aiApiConfig = aiApiConfigApi.clearAiApiKey(state.aiApiConfig);
    state.apiStatus = "本地 API Key 已清除，AI 增强已关闭。";
    elements.apiKey.value = "";
    elements.apiEnabled.checked = false;
    renderApiSettings();
    renderTopicSearch();
  }

  function toggleCandidates() {
    state.candidatesExpanded = !state.candidatesExpanded;
    renderCandidates();
  }

  async function refreshSavedTopic(item, { silent = false } = {}) {
    if (!item?.topic || !hasSelectedSource(item.sources)) return;
    if (!silent) {
      state.topicLoading = true;
      state.topicError = "";
      renderTopicSearch();
      renderTopicRadar();
    }

    try {
      const record = await fetchTopicRecord(item.topic, item.sources);
      const nextRecord = record.radar.candidates.length || !item.radar
        ? record
        : { ...record, radar: item.radar };
      state.topicRadar = topicRadarApi.upsertTopicRadarItem(state.topicRadar, nextRecord);
      state.topicPreview = topicRadarApi.topicRadarItemFor(state.topicRadar, item.topic);
      persistTopicRadar();
    } catch (error) {
      state.topicRadar = topicRadarApi.upsertTopicRadarItem(state.topicRadar, {
        ...item,
        errors: [error.message || String(error)],
      });
      state.topicPreview = topicRadarApi.topicRadarItemFor(state.topicRadar, item.topic);
      persistTopicRadar();
    } finally {
      if (!silent) {
        state.topicLoading = false;
        render();
      } else {
        renderTopicSearch();
        renderTopicRadar();
        renderMarkdownOutput();
      }
    }
  }

  async function fetchTopicRecord(topic, sources) {
    const result = await fetchers.fetchTopicStories(topic, sources);
    return {
      topic,
      sources,
      radar: window.RadarCore.buildTopicRadar(result.stories, { topic }),
      errors: result.errors,
      updatedAt: new Date().toISOString(),
    };
  }

  function render() {
    renderStatus();
    renderLastRunStatus();
    renderStats();
    renderSourceHealth();
    renderTopicSearch();
    renderRecommendations();
    renderTopicRadar();
    renderPapers();
    renderPaperLibrary();
    renderCandidates();
    renderApiSettings();
    renderMarkdownOutput();
  }

  function renderStatus() {
    const generatedAt = new Date(state.radar?.generatedAt || Date.now());
    const generated = generatedAt.toLocaleString();
    const ageMs = Date.now() - generatedAt.getTime();
    const staleSuffix = Number.isFinite(ageMs) && ageMs > 24 * 60 * 60 * 1000
      ? ` · 数据已过期 ${Math.max(1, Math.floor(ageMs / (24 * 60 * 60 * 1000)))} 天，请刷新`
      : "";
    elements.status.textContent = state.loading
      ? "抓取中..."
      : state.error
        ? `抓取失败：${state.error}`
        : `${state.source} · ${generated}${staleSuffix}`;
    elements.refresh.disabled = state.loading;
  }

  function renderLastRunStatus() {
    if (!elements.lastRun) return;
    elements.lastRun.textContent = lastRunTextFor(state.lastRun);
  }

  function renderStats() {
    const items = [
      ["抓取", state.radar.totalFetched],
      ["去重", state.radar.uniqueCount],
      ["候选", state.radar.candidates.length],
      ["推荐", state.radar.recommendations.length],
    ];
    elements.stats.innerHTML = items
      .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
      .join("");
  }

  function renderSourceHealth() {
    if (!elements.sourceHealth) return;
    elements.sourceHealth.innerHTML = state.sourceHealth
      .map((item) => {
        const className = item.status === "ok"
          ? "is-ok"
          : item.status === "warn"
            ? "is-warn"
            : "is-idle";
        return `<span class="source-pill ${className}" title="${escapeAttr(item.detail)}">${escapeHtml(item.label)} · ${escapeHtml(item.text)}</span>`;
      })
      .join("");
  }

  function renderTopicSearch() {
    elements.topicSaveButton.disabled = state.topicLoading;
    elements.topicStatus.textContent = topicStatusText();
    elements.topicSaved.innerHTML = topicSavedItems()
      .map((item) => `
        <span class="topic-chip">
          <button class="${state.topicPreview?.topic === item.topic ? "is-active" : ""}" data-topic-select="${escapeAttr(item.topic)}" type="button">${escapeHtml(item.topic)}</button>
          <button data-topic-remove="${escapeAttr(item.topic)}" type="button">移除</button>
        </span>
      `)
      .join("");
  }

  function renderApiSettings() {
    elements.apiSettingsPanel.hidden = !state.apiSettingsOpen;
    elements.apiSettingsButton.classList.toggle("is-active", state.apiSettingsOpen);
    if (!state.apiSettingsOpen) return;

    elements.apiEnabled.checked = state.aiApiConfig.enabled;
    elements.apiBaseUrl.value = state.aiApiConfig.baseUrl;
    elements.apiKey.value = state.aiApiConfig.apiKey;
    elements.apiModel.value = state.aiApiConfig.model;
    elements.apiWireApi.value = state.aiApiConfig.wireApi;
    elements.apiTestButton.disabled = state.apiTesting;
    elements.apiTestButton.textContent = state.apiTesting ? "测试中..." : "测试 API";
    elements.apiStatus.textContent = state.apiStatus || "API 配置只保存在当前浏览器，不会写入日报或部署包。";
  }

  function renderRecommendations() {
    elements.recommendations.innerHTML = state.radar.recommendations
      .map(
        (story, index) => `
          <article class="recommendation">
            <div class="rank">#${index + 1}</div>
            <div class="recommendation-copy">
              <a class="story-title" href="${escapeAttr(story.url)}" target="_blank" rel="noreferrer">${escapeHtml(story.title)}</a>
              <p class="story-intro"><span class="intro-label">内容介绍：</span>${escapeHtml(story.intro || story.reason)}</p>
              <div class="story-meta">
                <span>${escapeHtml(story.source || "Source")}</span>
                <span>${story.score} 分</span>
                <span>${escapeHtml(primarySignalFor(story))}</span>
                <span>${escapeHtml(activitySignalFor(story))}</span>
              </div>
            </div>
          </article>
        `,
      )
      .join("");
  }

  function renderTopicRadar() {
    const topic = state.radar?.topic || "";
    const errors = state.topicPreview?.errors?.length
      ? `<div class="topic-warning">${escapeHtml(state.topicPreview.errors.join("；"))}</div>`
      : "";
    elements.topicResultsPanel.hidden = !topic;
    if (!topic) {
      elements.topicResults.innerHTML = "";
      return;
    }

    const generated = state.radar.generatedAt ? new Date(state.radar.generatedAt).toLocaleString() : "未知时间";
    elements.topicResults.innerHTML = `
      <div class="topic-summary">
        <strong>${escapeHtml(topic)}</strong>
        <span>${state.radar.candidates.length} 条候选 / ${state.radar.recommendations.length} 条推荐 · ${generated}</span>
        <a href="${escapeAttr(window.RadarCore.googleScholarSearchUrlFor(topic))}" target="_blank" rel="noreferrer">Google Scholar</a>
      </div>
      ${errors}
    `;
  }

  function renderCandidates() {
    const candidates = state.radar.candidates || [];
    const visibleCandidates = state.candidatesExpanded
      ? candidates
      : candidates.slice(0, INITIAL_VISIBLE_CANDIDATES);
    elements.candidates.innerHTML = visibleCandidates
      .map(
        (story, index) => `
          <li>
            <span>${String(index + 1).padStart(2, "0")}</span>
            <div class="candidate-copy">
              <a class="candidate-title" href="${escapeAttr(story.url)}" target="_blank" rel="noreferrer">${escapeHtml(story.title)}</a>
              <p><span class="intro-label">内容介绍：</span>${escapeHtml(story.intro || story.reason)}</p>
              <small>${escapeHtml(story.source || "Source")} · ${escapeHtml(primarySignalFor(story))}</small>
            </div>
            <em class="candidate-score">${story.score}</em>
          </li>
        `,
      )
      .join("");
    elements.candidateToggleButton.hidden = candidates.length <= INITIAL_VISIBLE_CANDIDATES;
    elements.candidateToggleButton.textContent = state.candidatesExpanded
      ? "收起候选"
      : `展开全部候选（共 ${candidates.length} 条）`;
  }

  function renderPapers() {
    const papers = state.radar.paperRadar?.recommendations || [];
    elements.paperStatus.textContent = state.paperStatus || paperRadarSummaryText();
    if (!papers.length) {
      elements.papers.innerHTML = `<div class="empty-state" role="status">暂无论文推荐，刷新后会尝试从 arXiv 和 Semantic Scholar 获取最新 AI/CS 论文。</div>`;
      return;
    }

    elements.papers.innerHTML = papers
      .map(
        (paper) => `
          <article class="paper">
            <a class="paper-title" href="${escapeAttr(paper.url)}" target="_blank" rel="noreferrer">${escapeHtml(paper.title)}</a>
            <p class="paper-intro"><span class="intro-label">内容介绍：</span>${escapeHtml(paper.intro || paper.reason)}</p>
            ${paper.readingPrompt ? `<p class="paper-reading"><span class="intro-label">精读提示：</span>${escapeHtml(paper.readingPrompt)}</p>` : ""}
            <div class="story-meta">
              <span>${escapeHtml(paper.source || "Paper")}</span>
              <span>${escapeHtml(formatAuthors(paper.authors))}</span>
              <span>${escapeHtml(formatCategories(paper.categories))}</span>
              <span>${paper.score || 0} 分</span>
            </div>
            <div class="paper-actions">
              <a href="${escapeAttr(paper.url)}" target="_blank" rel="noreferrer">${escapeHtml(paper.source || "Paper")}</a>
              <a href="${escapeAttr(paper.pdfUrl || paper.url)}" target="_blank" rel="noreferrer">PDF</a>
              <a href="${escapeAttr(paper.googleScholarUrl || window.RadarCore.googleScholarSearchUrlFor(paper))}" target="_blank" rel="noreferrer">Google Scholar</a>
              ${paperActionButtons(paper)}
            </div>
          </article>
        `,
      )
      .join("");
  }

  function renderPaperLibrary() {
    const items = libraryItemsForView(state.activeLibraryView);
    elements.libraryTabs.querySelectorAll("[data-library-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.libraryView === state.activeLibraryView);
    });

    if (!items.length) {
      elements.paperLibrary.innerHTML = `<div class="empty-state" role="status">${emptyLibraryTextFor(state.activeLibraryView)}</div>`;
      return;
    }

    elements.paperLibrary.innerHTML = items
      .map((item) => {
        const paper = item.paper;
        return `
          <article class="library-item">
            <a href="${escapeAttr(paper.url)}" target="_blank" rel="noreferrer">${escapeHtml(paper.title)}</a>
            <p><span class="intro-label">内容介绍：</span>${escapeHtml(paper.intro || "暂无中文介绍")}</p>
            ${paper.readingPrompt ? `<p><span class="intro-label">精读提示：</span>${escapeHtml(paper.readingPrompt)}</p>` : ""}
            <div class="story-meta">
              <span>${escapeHtml(paper.source || "Paper")}</span>
              <span>${escapeHtml(formatAuthors(paper.authors))}</span>
              <span>${escapeHtml(formatCategories(paper.categories))}</span>
              <span>${escapeHtml(statusTextForItem(item))}</span>
            </div>
            <div class="library-actions">
              <a href="${escapeAttr(paper.url)}" target="_blank" rel="noreferrer">${escapeHtml(paper.source || "Paper")}</a>
              <a href="${escapeAttr(paper.pdfUrl || paper.url)}" target="_blank" rel="noreferrer">PDF</a>
              <a href="${escapeAttr(paper.googleScholarUrl || window.RadarCore.googleScholarSearchUrlFor(paper))}" target="_blank" rel="noreferrer">Google Scholar</a>
              ${libraryActionButton(item, "favorite", "收藏")}
              ${libraryActionButton(item, "queued", "精读")}
              ${libraryActionButton(item, "read", "已读")}
              <button data-library-action="remove" data-paper-id="${escapeAttr(paper.id)}" type="button">移除</button>
            </div>
            <textarea class="note-input" data-note-id="${escapeAttr(paper.id)}" placeholder="写一点精读笔记、可复现实验点或后续想法...">${escapeHtml(item.note || "")}</textarea>
          </article>
        `;
      })
      .join("");
  }

  function handlePaperAction(event) {
    const button = event.target.closest("[data-paper-action]");
    if (!button) return;
    const paper = paperById(button.dataset.paperId);
    if (!paper) return;

    const current = state.paperLibrary.items[paper.id] || {};
    const action = button.dataset.paperAction;
    if (action === "copyCitation") {
      copyToClipboard(paperLibraryApi.paperToBibtex(paper), "BibTeX 引用已复制。");
      return;
    }
    if (action === "copyPdf") {
      copyToClipboard(paper.pdfUrl || paper.url, "PDF 链接已复制。");
      return;
    }
    const patch = {
      favorite: { favorite: !current.favorite },
      queued: { queued: !current.queued },
      read: { read: !current.read },
      note: { queued: true },
    }[action];
    if (!patch) return;

    state.paperLibrary = paperLibraryApi.mergePaperIntoLibrary(state.paperLibrary, paper, patch);
    if (action === "note") state.activeLibraryView = "queued";
    state.paperStatus = paperActionStatusText(action, patch);
    persistPaperLibrary();
    render();
    if (action === "note") focusNoteFor(paper.id);
  }

  function handleLibraryView(event) {
    const button = event.target.closest("[data-library-view]");
    if (!button) return;
    state.activeLibraryView = button.dataset.libraryView;
    renderPaperLibrary();
  }

  function handleLibraryAction(event) {
    const button = event.target.closest("[data-library-action]");
    if (!button) return;
    const paperId = button.dataset.paperId;
    const item = state.paperLibrary.items[paperId];
    if (!item) return;

    const action = button.dataset.libraryAction;
    if (action === "remove") {
      state.paperLibrary = paperLibraryApi.removePaperFromLibrary(state.paperLibrary, paperId);
    } else {
      state.paperLibrary = paperLibraryApi.mergePaperIntoLibrary(state.paperLibrary, item.paper, {
        [action]: !item[action],
      });
    }
    persistPaperLibrary();
    render();
  }

  function handleLibraryNoteInput(event) {
    const textarea = event.target.closest("[data-note-id]");
    if (!textarea) return;
    const item = state.paperLibrary.items[textarea.dataset.noteId];
    if (!item) return;
    state.paperLibrary = paperLibraryApi.mergePaperIntoLibrary(state.paperLibrary, item.paper, {
      note: textarea.value,
    });
    persistPaperLibrary();
  }

  function handleSavedTopicAction(event) {
    const selectButton = event.target.closest("[data-topic-select]");
    const removeButton = event.target.closest("[data-topic-remove]");
    if (selectButton) {
      const item = topicRadarApi.topicRadarItemFor(state.topicRadar, selectButton.dataset.topicSelect);
      if (!item) return;
      state.topicRadar = {
        ...state.topicRadar,
        activeTopic: item.topic,
      };
      state.topicPreview = item;
      elements.topicInput.value = item.topic;
      setTopicSourceControls(item.sources);
      persistTopicRadar();
      render();
      return;
    }
    if (removeButton) {
      state.topicRadar = topicRadarApi.removeTopicRadarItem(state.topicRadar, removeButton.dataset.topicRemove);
      state.topicPreview = activeTopicItem();
      persistTopicRadar();
      render();
    }
  }

  function downloadReadingMarkdown() {
    downloadText(
      "obsession-radar-reading-queue.md",
      paperLibraryApi.paperLibraryToMarkdown(Object.values(state.paperLibrary.items)),
      "text/markdown;charset=utf-8",
    );
  }

  function downloadBibtex() {
    downloadText(
      "obsession-radar-reading-queue.bib",
      paperLibraryApi.paperItemsToBibtex(Object.values(state.paperLibrary.items)) || "% No papers in reading queue.\n",
      "application/x-bibtex;charset=utf-8",
    );
  }

  function downloadMarkdown() {
    const markdown = composedMarkdown();
    downloadText("obsession-radar.md", markdown, "text/markdown;charset=utf-8");
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text || "");
      state.paperStatus = successMessage;
    } catch {
      state.paperStatus = "浏览器暂时不允许写入剪贴板，可打开链接后手动复制。";
    }
    renderPapers();
  }

  function paperActionButtons(paper) {
    const item = state.paperLibrary.items[paper.id] || {};
    return [
      paperActionButton(paper, "favorite", "收藏", item.favorite),
      paperActionButton(paper, "queued", "加入今日精读", item.queued),
      paperActionButton(paper, "read", "已读", item.read),
      paperActionButton(paper, "note", "笔记", Boolean(item.note)),
      paperActionButton(paper, "copyCitation", "复制引用", false),
      paperActionButton(paper, "copyPdf", "复制 PDF", false),
    ].join("");
  }

  function paperActionButton(paper, action, label, active) {
    return `<button class="${active ? "is-active" : ""}" data-paper-action="${action}" data-paper-id="${escapeAttr(paper.id)}" type="button">${label}</button>`;
  }

  function paperActionStatusText(action, patch) {
    if (action === "favorite") return patch.favorite ? "已收藏这篇论文。" : "已取消收藏。";
    if (action === "queued") return patch.queued ? "已加入今日精读。" : "已从今日精读移除。";
    if (action === "read") return patch.read ? "已标记为已读。" : "已取消已读标记。";
    if (action === "note") return "已加入精读队列，可在我的论文库里写笔记。";
    return paperRadarSummaryText();
  }

  function libraryActionButton(item, action, label) {
    return `<button class="${item[action] ? "is-active" : ""}" data-library-action="${action}" data-paper-id="${escapeAttr(item.paper.id)}" type="button">${label}</button>`;
  }

  function libraryItemsForView(view) {
    return Object.values(state.paperLibrary.items).filter((item) => {
      if (view === "favorite") return item.favorite;
      if (view === "read") return item.read;
      return item.queued;
    });
  }

  function paperById(paperId) {
    return (state.radar.paperRadar?.candidates || []).find((paper) => paper.id === paperId) ||
      (state.radar.paperRadar?.recommendations || []).find((paper) => paper.id === paperId);
  }

  function persistPaperLibrary() {
    paperLibraryApi.savePaperLibrary(state.paperLibrary);
  }

  function focusNoteFor(paperId) {
    window.setTimeout(() => {
      Array.from(elements.paperLibrary.querySelectorAll("[data-note-id]"))
        .find((element) => element.dataset.noteId === paperId)
        ?.focus();
    }, 0);
  }

  function emptyLibraryTextFor(view) {
    if (view === "favorite") return "还没有收藏论文。可以在科研论文卡片里点击“收藏”。";
    if (view === "read") return "还没有已读论文。读完后点击“已读”归档。";
    return "还没有精读论文。可以在科研论文卡片里点击“精读”加入队列。";
  }

  function statusTextForItem(item) {
    const status = [];
    if (item.favorite) status.push("收藏");
    if (item.queued) status.push("精读");
    if (item.read) status.push("已读");
    return status.length ? status.join(" / ") : "未分类";
  }

  function lastRunTextFor(lastRun) {
    if (!lastRun) return "自动更新：未读取到 last-run.json";
    if (lastRun.ok === null || typeof lastRun.ok === "undefined") return "自动更新：尚未运行";
    const finishedAt = lastRun.finishedAt ? new Date(lastRun.finishedAt).toLocaleString() : "未知时间";
    const result = lastRun.ok ? "成功" : "失败";
    const message = lastRun.message ? `，${lastRun.message}` : "";
    return `自动更新：${result} · ${finishedAt}${message}`;
  }

  function topicStoryCard(story, index) {
    return `
      <article class="topic-card">
        <div class="rank">#${index + 1}</div>
        <div>
          <a href="${escapeAttr(story.url)}" target="_blank" rel="noreferrer">${escapeHtml(story.title)}</a>
          <p><span class="intro-label">内容介绍：</span>${escapeHtml(story.intro || story.reason)}</p>
          <div class="story-meta">
            <span>${escapeHtml(story.source || "Source")}</span>
            <span>${story.score || 0} 分</span>
            <span>${escapeHtml(primarySignalFor(story))}</span>
            <span>${escapeHtml(activitySignalFor(story))}</span>
            ${story.googleScholarUrl ? `<a href="${escapeAttr(story.googleScholarUrl)}" target="_blank" rel="noreferrer">Google Scholar</a>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function topicStatusText() {
    if (state.loading) return "今日雷达：刷新中...";
    if (state.topicError) return `今日雷达主题：${state.topicError}`;
    const topic = normalizeTopicInput(elements.topicInput.value);
    const apiSuffix = state.apiStatus ? ` · ${state.apiStatus}` : "";
    return topic ? `主题雷达：${topic}${apiSuffix}` : `默认 AI 雷达${apiSuffix}`;
  }

  function topicSavedItems() {
    return Object.values(state.topicRadar.items)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function activeTopicItem() {
    if (state.topicRadar.activeTopic) {
      return topicRadarApi.topicRadarItemFor(state.topicRadar, state.topicRadar.activeTopic);
    }
    return topicSavedItems()[0] || null;
  }

  function selectedTopicSources() {
    return topicRadarApi.normalizeSources({
      hn: elements.topicSourceHn.checked,
      github: elements.topicSourceGithub.checked,
      arxiv: elements.topicSourceArxiv.checked,
      semanticScholar: elements.topicSourceSemanticScholar.checked,
    });
  }

  function setTopicSourceControls(sources) {
    const normalized = topicRadarApi.normalizeSources(sources);
    elements.topicSourceHn.checked = normalized.hn;
    elements.topicSourceGithub.checked = normalized.github;
    elements.topicSourceArxiv.checked = normalized.arxiv;
    elements.topicSourceSemanticScholar.checked = normalized.semanticScholar;
  }

  function hasSelectedSource(sources) {
    return Boolean(sources?.hn || sources?.github || sources?.arxiv || sources?.semanticScholar);
  }

  function persistTopicRadar() {
    topicRadarApi.saveTopicRadarState(state.topicRadar);
  }

  function refreshStaleTopics() {
    const staleItems = topicSavedItems()
      .filter((item) => Date.now() - Date.parse(item.updatedAt || item.radar?.generatedAt || 0) > TOPIC_STALE_MS)
      .slice(0, 5);
    staleItems.reduce(
      (chain, item) => chain.then(() => refreshSavedTopic(item, { silent: true })),
      Promise.resolve(),
    );
  }

  function renderMarkdownOutput() {
    elements.markdown.value = composedMarkdown();
  }

  function composedMarkdown() {
    return `${window.RadarCore.toMarkdown(state.radar)}${topicRadarMarkdown()}`;
  }

  function topicRadarMarkdown() {
    const items = [state.topicPreview, ...topicSavedItems()]
      .filter((item) => item?.radar?.recommendations?.length)
      .filter((item, index, list) => list.findIndex((candidate) => candidate.topic === item.topic) === index);
    if (!items.length) return "";

    const lines = ["", "## Interest Radar", ""];
    items.forEach((item) => {
      lines.push(`### ${item.topic}`, "");
      item.radar.recommendations.forEach((story, index) => {
        lines.push(
          `${index + 1}. [${story.title}](${story.url})`,
          `   - 内容介绍：${story.intro}`,
          `   - Source: ${story.source || "Source"} | Score: ${story.score || 0}`,
          "",
        );
      });
    });
    return `${lines.join("\n")}\n`;
  }

  function normalizeTopicInput(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function primarySignalFor(story) {
    if (story.source === "GitHub") return `${story.stars || story.points || 0} stars`;
    if (story.source === "Semantic Scholar") return `${story.citations || story.points || 0} citations`;
    return `${story.points || 0} points`;
  }

  function activitySignalFor(story) {
    if (story.source === "GitHub") return `${story.openIssues || story.comments || 0} issues`;
    if (story.source === "Semantic Scholar") return `${story.influentialCitations || story.comments || 0} influential`;
    return `${story.comments || 0} comments`;
  }

  function formatAuthors(authors = []) {
    if (!authors.length) return "作者未知";
    if (authors.length <= 2) return authors.join(", ");
    return `${authors.slice(0, 2).join(", ")} 等 ${authors.length} 位作者`;
  }

  function formatCategories(categories = []) {
    return categories.length ? categories.join(", ") : "分类未知";
  }

  function sourceLabelFor(hnError, githubError, arxivError, semanticScholarError) {
    if (!hnError && !githubError && !arxivError && !semanticScholarError) {
      return "实时 AI HN + GitHub + arXiv + Semantic Scholar";
    }
    const activeSources = [];
    if (!hnError) activeSources.push("实时 AI HN");
    if (!githubError) activeSources.push("GitHub");
    if (!arxivError) activeSources.push("arXiv");
    if (!semanticScholarError) activeSources.push("Semantic Scholar");
    const warnings = [];
    if (hnError) warnings.push(friendlySourceError("HN", hnError));
    if (githubError) warnings.push(friendlySourceError("GitHub", githubError));
    if (arxivError) warnings.push(friendlySourceError("arXiv", arxivError));
    if (semanticScholarError) warnings.push(friendlySourceError("Semantic Scholar", semanticScholarError));
    return `${activeSources.join(" + ") || "上次可用日报"}（${warnings.join("；")}）`;
  }

  function focusedSourceLabelFor(topic, errors) {
    const warnings = errors.length ? `（部分来源失败：${errors.map(errorTextForLabel).join("；")}）` : "";
    return `主题雷达：${topic}${warnings}`;
  }

  function defaultSourceHealth() {
    return ["HN", "GitHub", "arXiv", "Semantic Scholar"].map((source) => ({
      label: source,
      status: "idle",
      text: "待刷新",
      detail: "页面会在刷新今日雷达时检查该来源。",
    }));
  }

  function sourceHealthFromResults(results) {
    const bySource = new Map((results || []).map((result) => [result.source, result]));
    return ["HN", "GitHub", "arXiv", "Semantic Scholar"].map((source) => {
      const result = bySource.get(source);
      if (!result) {
        return {
          label: source,
          status: "idle",
          text: "未启用",
          detail: "本次刷新没有选择该来源。",
        };
      }
      if (result.error) {
        return {
          label: source,
          status: "warn",
          text: "需重试",
          detail: friendlySourceError(source, result.error),
        };
      }
      return {
        label: source,
        status: "ok",
        text: `${result.stories.length} 条`,
        detail: `${source} 本次抓取成功。`,
      };
    });
  }

  function paperStatusFromResults(results, retainedPrevious) {
    if (!results.length) return "本次没有启用论文来源。";
    const failures = results.filter((result) => result.error);
    if (failures.length === results.length) {
      return retainedPrevious
        ? "论文源暂时失败，已保留上次论文，可稍后刷新。"
        : `论文源暂时失败：${failures.map((result) => friendlySourceError(result.source, result.error)).join("；")}`;
    }
    if (failures.length) {
      return `部分论文源失败，已保留可用论文：${failures.map((result) => friendlySourceError(result.source, result.error)).join("；")}`;
    }
    return `论文源正常：${results.map((result) => `${result.source} ${result.stories.length} 条`).join("，")}`;
  }

  function paperRadarSummaryText() {
    const paperRadar = state.radar.paperRadar;
    if (!paperRadar) return "论文雷达尚未生成。";
    return `论文雷达：${paperRadar.candidates?.length || 0} 篇候选 / ${paperRadar.recommendations?.length || 0} 篇推荐。`;
  }

  function friendlySourceError(source, error) {
    const text = String(error || "");
    if (/429|rate limit|too many/i.test(text)) {
      return `${source} 上游限流，已保留可用结果，可稍后刷新`;
    }
    if (/5\d\d|timeout|network|fetch/i.test(text)) {
      return `${source} 上游或网络暂时失败，已保留可用结果`;
    }
    return `${source} 抓取失败：${text}`;
  }

  function errorTextForLabel(error) {
    const [source, ...rest] = String(error).split(":");
    return friendlySourceError(source.trim() || "来源", rest.join(":").trim() || error);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
})();
