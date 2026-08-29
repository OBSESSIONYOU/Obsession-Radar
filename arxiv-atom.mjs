// Node-compatible arXiv Atom feed parser.
// The browser fetchers use DOMParser, which Node does not provide, so the
// daily-update script and tests share this regex-based parser instead.
// It keeps whitespace normalization and id/pdf extraction consistent with
// the browser implementation.

function normalizeXmlText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function textOf(entry, tagName) {
  const match = entry.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  if (!match) return "";
  return normalizeXmlText(decodeXmlEntities(match[1]));
}

function arxivIdFrom(value) {
  return normalizeXmlText(value)
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
    .replace(/^https?:\/\/arxiv\.org\/pdf\//i, "")
    .replace(/\.pdf$/i, "");
}

export function parseArxivAtom(xml) {
  const feedText = String(xml || "");
  if (!feedText.includes("<feed")) {
    throw new Error("arXiv XML parse failed");
  }
  const entries = feedText.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  return entries
    .map((entry) => {
      const id = textOf(entry, "id");
      const links = [...entry.matchAll(/<link\b([^>]*)\/?>/g)]
        .map((match) => {
          const attrs = match[1] || "";
          const attr = (name) => {
            const found = attrs.match(new RegExp(`${name}="([^"]*)"`));
            return found ? found[1] : "";
          };
          return {
            href: attr("href"),
            rel: attr("rel"),
            title: attr("title"),
            type: attr("type"),
          };
        });

      const url = (links.find((link) => link.rel === "alternate") || {}).href || id;
      const pdfLink = links.find((link) => link.title === "pdf" || link.type === "application/pdf");
      const pdfUrl = (pdfLink || {}).href || url.replace("/abs/", "/pdf/");

      const authors = [...entry.matchAll(/<author>[\s\S]*?<\/author>/g)]
        .map((author) => textOf(author[0], "name"))
        .filter(Boolean);

      const categories = [...entry.matchAll(/<category[^>]*term="([^"]*)"[^>]*\/?>/g)]
        .map((category) => normalizeXmlText(category[1]))
        .filter(Boolean);

      return {
        id,
        arxivId: arxivIdFrom(id || url),
        title: textOf(entry, "title"),
        summary: textOf(entry, "summary"),
        published: textOf(entry, "published"),
        updated: textOf(entry, "updated"),
        authors,
        categories,
        url,
        pdfUrl,
      };
    })
    .filter((entry) => entry.arxivId);
}

export { arxivIdFrom, normalizeXmlText };
