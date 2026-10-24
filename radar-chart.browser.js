(function attachRadarChart(global) {
  // Zero-dependency SVG quadrant chart: topic blips sized by today's board share,
  // colored by 7-day source-share momentum (green rising / red falling / blue neutral).

  const QUADRANTS = [
    { id: 'models', label: '模型与厂商', x: 1, y: -1 },
    { id: 'agents', label: 'Agent 与工具', x: -1, y: -1 },
    { id: 'retrieval', label: 'RAG 与检索', x: -1, y: 1 },
    { id: 'research', label: '科研与论文', x: 1, y: 1 },
  ];

  const TOPIC_QUADRANT = {
    AI: 'models', LLM: 'models', OpenAI: 'models', Anthropic: 'models', Claude: 'models',
    Gemini: 'models', DeepSeek: 'models', 'machine learning': 'models',
    'AI agent': 'agents', 'AI coding': 'agents', MCP: 'agents', Codex: 'agents',
    'prompt engineering': 'agents', trending: 'agents', 'front page': 'agents',
    RAG: 'retrieval',
  };

  const PAPER_SOURCES = new Set(['arXiv', 'Semantic Scholar', 'HF Papers', 'papers.cool']);

  function quadrantForTopic(topic, source) {
    if (PAPER_SOURCES.has(source)) return 'research';
    return TOPIC_QUADRANT[topic] || 'models';
  }

  function topicBlipsFromRadar(radar) {
    const counts = new Map();
    const stories = [
      ...(radar && radar.candidates ? radar.candidates : []),
      ...(radar && radar.paperRadar && radar.paperRadar.candidates ? radar.paperRadar.candidates : []),
    ];
    for (const story of stories) {
      const source = story.source || '';
      const isPaper = PAPER_SOURCES.has(source);
      const topics = (story.matchedQueries || []).filter(Boolean);
      const keys = isPaper
        ? [source === 'arXiv' ? 'arXiv 论文' : source === 'HF Papers' ? 'HF 热议论文' : source === 'papers.cool' ? 'papers.cool' : 'SS 论文']
        : (topics.length ? topics : ['其他']).slice(0, 3);
      for (const key of keys) {
        const entry = counts.get(key) || { topic: key, count: 0, quadrant: quadrantForTopic(key, source), sources: new Map() };
        entry.count += 1;
        entry.sources.set(source, (entry.sources.get(source) || 0) + 1);
        counts.set(key, entry);
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 14)
      .map((entry) => ({
        topic: entry.topic,
        count: entry.count,
        quadrant: entry.quadrant,
        dominantSource: Array.from(entry.sources.entries()).sort((a, b) => b[1] - a[1])[0] ? Array.from(entry.sources.entries()).sort((a, b) => b[1] - a[1])[0][0] : '',
      }));
  }

  function sourceMomentum(history, source) {
    const days = history && history.days ? history.days : [];
    if (days.length < 2) return 0;
    const latest = days[days.length - 1];
    const earlier = days.slice(Math.max(0, days.length - 8), days.length - 1);
    const share = (day) => {
      const mix = day.sourceMix || {};
      const total = Object.values(mix).reduce((sum, n) => sum + n, 0) || 1;
      return (mix[source] || 0) / total;
    };
    const before = earlier.length ? earlier.reduce((sum, d) => sum + share(d), 0) / earlier.length : 0;
    return share(latest) - before;
  }

  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) & 0x7fffffff;
    }
    return hash;
  }

  function esc(value) {
    return String(value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split("\"").join('&quot;');
  }

  var ATTR_QUOTE = String.fromCharCode(34);

  function attr(name, value) {
    return name + '=' + ATTR_QUOTE + value + ATTR_QUOTE;
  }

  function renderRadarChartSvg(options) {
    const blips = options.blips || [];
    const history = options.history;
    const size = options.size || 460;
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 46;
    const maxCount = Math.max.apply(null, [1].concat(blips.map((b) => b.count)));
    const quadCenter = {};
    for (const q of QUADRANTS) quadCenter[q.id] = { x: cx + q.x * R * 0.48, y: cy + q.y * R * 0.48 };

    const parts = [];
    parts.push('<svg ' + attr('viewBox', '0 0 ' + size + ' ' + size) + ' ' + attr('role', 'img') + ' ' + attr('aria-label', '主题动量雷达图') + ' style=' + ATTR_QUOTE + 'width:100%;height:auto' + ATTR_QUOTE + '>');
    [1, 0.66, 0.33].forEach((factor) => {
      parts.push('<circle ' + attr('cx', cx) + ' ' + attr('cy', cy) + ' ' + attr('r', (R * factor).toFixed(1)) + ' fill=' + ATTR_QUOTE + 'none' + ATTR_QUOTE + ' stroke=' + ATTR_QUOTE + '#e4dfc8' + ATTR_QUOTE + ' stroke-width=' + ATTR_QUOTE + '1' + ATTR_QUOTE + ' stroke-dasharray=' + ATTR_QUOTE + '4 4' + ATTR_QUOTE + '/>');
    });
    parts.push('<line ' + attr('x1', cx - R) + ' ' + attr('y1', cy) + ' ' + attr('x2', cx + R) + ' ' + attr('y2', cy) + ' stroke=' + ATTR_QUOTE + '#e4dfc8' + ATTR_QUOTE + ' stroke-width=' + ATTR_QUOTE + '1' + ATTR_QUOTE + '/>');
    parts.push('<line ' + attr('x1', cx) + ' ' + attr('y1', cy - R) + ' ' + attr('x2', cx) + ' ' + attr('y2', cy + R) + ' stroke=' + ATTR_QUOTE + '#e4dfc8' + ATTR_QUOTE + ' stroke-width=' + ATTR_QUOTE + '1' + ATTR_QUOTE + '/>');
    const labelStyle = 'font-size=' + ATTR_QUOTE + '13' + ATTR_QUOTE + ' fill=' + ATTR_QUOTE + '#665c4a' + ATTR_QUOTE + ' text-anchor=' + ATTR_QUOTE + 'middle' + ATTR_QUOTE;
    parts.push('<text ' + attr('x', cx + R * 0.5) + ' ' + attr('y', cy - R - 14) + ' ' + labelStyle + '>' + esc(QUADRANTS[0].label) + '</text>');
    parts.push('<text ' + attr('x', cx - R * 0.5) + ' ' + attr('y', cy - R - 14) + ' ' + labelStyle + '>' + esc(QUADRANTS[1].label) + '</text>');
    parts.push('<text ' + attr('x', cx - R * 0.5) + ' ' + attr('y', cy + R + 24) + ' ' + labelStyle + '>' + esc(QUADRANTS[2].label) + '</text>');
    parts.push('<text ' + attr('x', cx + R * 0.5) + ' ' + attr('y', cy + R + 24) + ' ' + labelStyle + '>' + esc(QUADRANTS[3].label) + '</text>');

    const placed = [];
    for (const blip of blips) {
      const center = quadCenter[blip.quadrant] || quadCenter.models;
      const angle = (hashString(blip.topic) % 628) / 100;
      const dist = 0.30 + ((hashString(blip.topic + 'd') % 100) / 100) * 0.62;
      let x = center.x + Math.cos(angle) * R * 0.42 * dist;
      let y = center.y + Math.sin(angle) * R * 0.42 * dist;
      const r = 6 + Math.round((blip.count / maxCount) * 16);
      for (let guard = 0; guard < 24; guard += 1) {
        const hit = placed.find((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 16);
        if (!hit) break;
        x += Math.cos(angle) * 9;
        y += Math.sin(angle) * 9;
      }
      placed.push({ x: x, y: y, r: r });

      const momentum = sourceMomentum(history, blip.dominantSource);
      const color = momentum > 0.02 ? '#087f5b' : momentum < -0.02 ? '#e64b3c' : '#4b6bff';
      parts.push('<g>');
      parts.push('<circle ' + attr('cx', x.toFixed(1)) + ' ' + attr('cy', y.toFixed(1)) + ' ' + attr('r', r) + ' fill=' + ATTR_QUOTE + color + ATTR_QUOTE + ' fill-opacity=' + ATTR_QUOTE + '0.78' + ATTR_QUOTE + ' stroke=' + ATTR_QUOTE + '#211a12' + ATTR_QUOTE + ' stroke-width=' + ATTR_QUOTE + '1.5' + ATTR_QUOTE + '/>');
      const label = blip.topic + ' (' + blip.count + ')';
      parts.push('<text ' + attr('x', x.toFixed(1)) + ' ' + attr('y', (y - r - 5).toFixed(1)) + ' font-size=' + ATTR_QUOTE + '11' + ATTR_QUOTE + ' fill=' + ATTR_QUOTE + '#211a12' + ATTR_QUOTE + ' text-anchor=' + ATTR_QUOTE + 'middle' + ATTR_QUOTE + '>' + esc(label) + '</text>');
      parts.push('</g>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  global.ObsessionRadarChart = {
    QUADRANTS: QUADRANTS,
    topicBlipsFromRadar: topicBlipsFromRadar,
    sourceMomentum: sourceMomentum,
    renderRadarChartSvg: renderRadarChartSvg,
  };
})(window);
