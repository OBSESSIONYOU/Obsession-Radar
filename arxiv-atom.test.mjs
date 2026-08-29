import test from "node:test";
import assert from "node:assert/strict";
import { parseArxivAtom, arxivIdFrom } from "./arxiv-atom.mjs";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <title>  A   Study of
    Retrieval </title>
    <summary>Abstract &amp; intro text.</summary>
    <published>2026-01-02T00:00:00Z</published>
    <updated>2026-01-03T00:00:00Z</updated>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL"/>
    <link href="http://arxiv.org/abs/2401.12345v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.12345v1" type="application/pdf"/>
  </entry>
  <entry></entry>
</feed>`;

test("parseArxivAtom extracts entry fields", () => {
  const entries = parseArxivAtom(SAMPLE);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.arxivId, "2401.12345v1");
  assert.equal(entry.title, "A Study of Retrieval");
  assert.equal(entry.summary, "Abstract & intro text.");
  assert.deepEqual(entry.authors, ["Ada Lovelace", "Alan Turing"]);
  assert.deepEqual(entry.categories, ["cs.AI", "cs.CL"]);
  assert.equal(entry.url, "http://arxiv.org/abs/2401.12345v1");
  assert.equal(entry.pdfUrl, "http://arxiv.org/pdf/2401.12345v1");
});

test("parseArxivAtom rejects non-Atom payloads", () => {
  assert.throws(() => parseArxivAtom("<html><body>blocked</body></html>"), /arXiv XML parse failed/);
});

test("arxivIdFrom handles abs, pdf and .pdf suffixes", () => {
  assert.equal(arxivIdFrom("https://arxiv.org/abs/2401.1v2"), "2401.1v2");
  assert.equal(arxivIdFrom("https://arxiv.org/pdf/2401.1.pdf"), "2401.1");
  assert.equal(arxivIdFrom("2401.1"), "2401.1");
});
