(function attachAiApiConfig(global) {
  const AI_API_CONFIG_STORAGE_KEY = "agentsRadarLite.aiApiConfig.v1";
  const AI_WIRE_APIS = new Set(["responses", "chat_completions"]);

  function emptyAiApiConfig() {
    return {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      model: "",
      wireApi: "responses",
    };
  }

  function loadAiApiConfig(storage = global.localStorage) {
    if (!storage?.getItem) return emptyAiApiConfig();
    try {
      return normalizeAiApiConfig(JSON.parse(storage.getItem(AI_API_CONFIG_STORAGE_KEY) || "{}"));
    } catch {
      return emptyAiApiConfig();
    }
  }

  function saveAiApiConfig(config, storage = global.localStorage) {
    if (!storage?.setItem) return;
    storage.setItem(AI_API_CONFIG_STORAGE_KEY, JSON.stringify(normalizeAiApiConfig(config)));
  }

  function clearAiApiKey(config = {}, storage = global.localStorage) {
    const nextConfig = {
      ...normalizeAiApiConfig(config),
      enabled: false,
      apiKey: "",
    };
    saveAiApiConfig(nextConfig, storage);
    return nextConfig;
  }

  function normalizeAiApiConfig(value = {}) {
    const wireApi = AI_WIRE_APIS.has(value.wireApi) ? value.wireApi : "responses";
    return {
      enabled: value.enabled === true,
      baseUrl: normalizeBaseUrl(value.baseUrl),
      apiKey: String(value.apiKey || "").trim(),
      model: String(value.model || "").trim(),
      wireApi,
    };
  }

  function redactAiApiConfig(config) {
    return {
      ...normalizeAiApiConfig(config),
      apiKey: "",
    };
  }

  function isAiApiConfigured(config) {
    return missingAiApiConfigFields(config).length === 0;
  }

  function missingAiApiConfigFields(config) {
    const normalized = normalizeAiApiConfig(config);
    const missing = [];
    if (!normalized.enabled) missing.push("启用开关");
    if (!normalized.baseUrl) missing.push("Base URL");
    if (!normalized.apiKey) missing.push("API Key");
    if (!normalized.model) missing.push("Model");
    return missing;
  }

  async function enhanceRadarWithAi(radar, config, options = {}) {
    const result = await enhanceRadarWithAiResult(radar, config, options);
    return result.radar;
  }

  async function enhanceRadarWithAiResult(radar, config, options = {}) {
    const normalized = normalizeAiApiConfig(config);
    const missing = missingAiApiConfigFields(normalized);
    if (missing.length) {
      return {
        ok: false,
        code: "incomplete",
        missing,
        radar,
        message: incompleteConfigMessage(missing),
      };
    }

    const items = enhancementItemsFor(radar);
    if (!items.length) {
      return {
        ok: false,
        code: "no_items",
        radar,
        message: "没有需要 AI 增强的推荐项，已使用规则摘要",
      };
    }

    try {
      const callAiCompletion = options.callAiCompletion || defaultCallAiCompletion;
      const text = await callAiCompletion(normalized, enhancementPromptFor(radar, items));
      if (!String(text || "").trim()) {
        return {
          ok: false,
          code: "empty_response",
          radar,
          message: "AI 接口返回了空内容，已使用规则摘要",
        };
      }

      const enhancements = parseEnhancementResponse(text);
      if (!enhancements.size) {
        return {
          ok: false,
          code: "empty_items",
          radar,
          message: "AI 返回了 JSON，但没有 items 推荐结果，已使用规则摘要",
        };
      }

      const appliedCount = countAppliedEnhancements(radar, enhancements);
      if (!appliedCount) {
        return {
          ok: false,
          code: "id_mismatch",
          radar,
          message: "AI 返回了 JSON，但没有匹配当前推荐项 ID，已使用规则摘要",
        };
      }

      return {
        ok: true,
        code: "ok",
        radar: applyEnhancements(radar, enhancements),
        appliedCount,
        message: `AI 增强已应用（${appliedCount} 项）`,
      };
    } catch (error) {
      if (error?.name === "SyntaxError") {
        return {
          ok: false,
          code: "parse_error",
          radar,
          message: "AI 返回内容不是可解析 JSON，已使用规则摘要；可以在 API 设置里切换接口类型或换模型再试",
        };
      }
      return {
        ok: false,
        code: "failed",
        radar,
        message: aiApiFailureMessage(error, normalized, "AI 增强"),
      };
    }
  }

  async function defaultCallAiCompletion(config, prompt) {
    const normalized = normalizeAiApiConfig(config);
    const endpoint = normalized.wireApi === "chat_completions" ? "chat/completions" : "responses";
    const response = await fetch(`${normalized.baseUrl}/v1/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${normalized.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBodyFor(normalized, prompt)),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(15000)
        : undefined,
    });
    if (!response.ok) {
      const error = new Error(`AI API HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    return textFromAiPayload(payload, normalized.wireApi);
  }


  async function testAiApiConnection(config, options = {}) {
    const normalized = normalizeAiApiConfig(config);
    const missing = missingAiApiConfigFields(normalized);
    if (missing.length) {
      return {
        ok: false,
        code: "incomplete",
        missing,
        message: incompleteConfigMessage(missing),
      };
    }

    try {
      const callAiCompletion = options.callAiCompletion || defaultCallAiCompletion;
      await callAiCompletion(
        normalized,
        "请只输出一个 JSON 对象：{\"ok\":true}。不要输出 Markdown。",
      );
      return {
        ok: true,
        code: "ok",
        message: "API 测试成功，可以用于 AI 摘要增强",
      };
    } catch (error) {
      return {
        ok: false,
        code: "failed",
        message: aiApiFailureMessage(error, normalized),
      };
    }
  }
  function requestBodyFor(config, prompt) {
    const system = "你是科研和技术信息雷达助手。只输出 JSON，不要输出 Markdown。";
    if (config.wireApi === "chat_completions") {
      return {
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      };
    }
    return {
      model: config.model,
      temperature: 0.2,
      input: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    };
  }

  function textFromAiPayload(payload, wireApi) {
    const parts = [];
    if (wireApi === "chat_completions") {
      parts.push(...(payload?.choices || []).map((choice) => choice?.message?.content || choice?.text));
    }
    parts.push(payload?.output_text);
    parts.push(payload?.message?.content);
    parts.push(...(payload?.choices || []).map((choice) => choice?.message?.content || choice?.text));
    parts.push(...(payload?.output || []).map((item) => item?.content || item?.text));
    return parts
      .map(textFromContentPart)
      .filter(Boolean)
      .join("\n");
  }

  function enhancementItemsFor(radar) {
    return [
      ...(radar?.recommendations || []),
      ...(radar?.paperRadar?.recommendations || []),
    ]
      .filter(Boolean)
      .slice(0, 10)
      .map((item) => ({
        id: item.id || item.url || item.title,
        title: item.title,
        source: item.source || "",
        intro: item.intro || "",
        reason: item.reason || "",
        abstract: item.abstract || item.pageDescription || "",
      }));
  }

  function enhancementPromptFor(radar, items) {
    return JSON.stringify({
      task: "为信息雷达推荐项生成更自然的中文内容介绍和简短推荐理由。",
      topic: radar?.topic || "默认 AI 雷达",
      rules: [
        "只输出 JSON 对象，不要输出 Markdown 或解释文本",
        "items 必须是数组",
        "每个 items.id 必须从输入 items 里原样复制，不要翻译、改写或省略",
        "不要编造输入里没有的 id",
      ],
      output_schema: {
        items: [
          {
            id: "原始 id",
            intro: "一句中文内容介绍，不直接复制英文摘要",
            reason: "一句推荐理由",
            readingPrompt: "如果是论文，可给一句精读提示；不是论文可省略",
          },
        ],
      },
      items,
    });
  }

  function parseEnhancementResponse(text) {
    const parsed = parseJsonFromAiText(text);
    const items = Array.isArray(parsed)
      ? parsed
      : firstArray(parsed?.items, parsed?.recommendations, parsed?.results);
    return new Map(
      items
        .filter((item) => item?.id)
        .map((item) => [String(item.id), {
          intro: cleanAiText(item.intro),
          reason: cleanAiText(item.reason),
          readingPrompt: cleanAiText(item.readingPrompt),
        }]),
    );
  }

  function parseJsonFromAiText(text) {
    const raw = String(text || "").trim();
    const candidates = [stripJsonFence(raw)];
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidates.push(fenced[1].trim());

    const objectStart = raw.indexOf("{");
    const objectEnd = raw.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(raw.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = raw.indexOf("[");
    const arrayEnd = raw.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      candidates.push(raw.slice(arrayStart, arrayEnd + 1));
    }

    let lastError;
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new SyntaxError("AI response was not JSON");
  }

  function stripJsonFence(value) {
    return String(value || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  function firstArray(...values) {
    return values.find(Array.isArray) || [];
  }

  function textFromContentPart(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map(textFromContentPart).filter(Boolean).join("\n");
    }
    if (typeof value !== "object") return "";
    if (typeof value.text === "string") return value.text;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.content === "string" || Array.isArray(value.content)) {
      return textFromContentPart(value.content);
    }
    if (typeof value.value === "string") return value.value;
    if (value.text && typeof value.text.value === "string") return value.text.value;
    return "";
  }

  function countAppliedEnhancements(radar, enhancements) {
    return [
      ...(radar?.recommendations || []),
      ...(radar?.paperRadar?.recommendations || []),
    ].filter((story) => enhancements.has(String(story.id || story.url || story.title))).length;
  }

  function applyEnhancements(radar, enhancements) {
    return {
      ...radar,
      candidates: applyEnhancementsToStories(radar.candidates || [], enhancements),
      recommendations: applyEnhancementsToStories(radar.recommendations || [], enhancements),
      paperRadar: radar.paperRadar
        ? {
          ...radar.paperRadar,
          candidates: applyEnhancementsToStories(radar.paperRadar.candidates || [], enhancements),
          recommendations: applyEnhancementsToStories(radar.paperRadar.recommendations || [], enhancements),
        }
        : radar.paperRadar,
    };
  }

  function applyEnhancementsToStories(stories, enhancements) {
    return stories.map((story) => {
      const key = String(story.id || story.url || story.title);
      const enhancement = enhancements.get(key);
      if (!enhancement) return story;
      return {
        ...story,
        intro: enhancement.intro || story.intro,
        reason: enhancement.reason || story.reason,
        readingPrompt: enhancement.readingPrompt || story.readingPrompt,
      };
    });
  }

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function cleanAiText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 260);
  }


  function incompleteConfigMessage(missing) {
    return `API 设置未完整保存：缺少 ${missing.join("、")}，已使用规则摘要`;
  }

  function aiApiFailureMessage(error, config, action = "API 测试") {
    const status = Number(error?.status) || Number(String(error?.message || "").match(/HTTP\s+(\d+)/i)?.[1]);
    const interfaceHint = config.wireApi === "responses"
      ? "如果中转站不支持 responses，请切换到 chat/completions 再试。"
      : "如果中转站要求 responses，请切换接口类型再试。";

    if (status === 400) {
      return `${action}失败：HTTP 400。请求格式或模型名可能不匹配，先确认模型名；${interfaceHint}`;
    }
    if (status === 401 || status === 403) {
      return `${action}失败：HTTP ${status}。API Key 无效、权限不足或未启用该模型。`;
    }
    if (status === 402) {
      return `${action}失败：HTTP 402。中转站账户余额或额度可能不足。`;
    }
    if (status === 404) {
      return `${action}失败：HTTP 404。请确认 Base URL 是 API 根地址，不要填 /keys；${interfaceHint}`;
    }
    if (status === 429) {
      return `${action}失败：HTTP 429。上游限流或额度耗尽，稍后再试。`;
    }
    if (status >= 500) {
      return `${action}失败：HTTP ${status}。中转站或上游模型服务暂时异常。`;
    }
    return `${action}失败：网络/CORS 拦截或中转站不可达。请确认 Base URL 是根地址，例如 https://bmapi.020212.xyz。`;
  }
  global.AiApiConfig = {
    AI_API_CONFIG_STORAGE_KEY,
    emptyAiApiConfig,
    loadAiApiConfig,
    saveAiApiConfig,
    clearAiApiKey,
    normalizeAiApiConfig,
    redactAiApiConfig,
    isAiApiConfigured,
    missingAiApiConfigFields,
    enhanceRadarWithAi,
    enhanceRadarWithAiResult,
    defaultCallAiCompletion,
    testAiApiConnection,
  };
})(window);
