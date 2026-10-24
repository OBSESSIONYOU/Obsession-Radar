// Tests for the personal-relevance layer: TF-IDF library profile and its
// integration with RadarCore.scorePaper via setPersonalRelevanceFn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import RadarCore from "./radar-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "library-profile.browser.js"), "utf8");
const fakeWindow = {};
new Function("window", source)(fakeWindow);
const Profile = fakeWindow.ObsessionLibraryProfile;

const library = () => ({
  items: {
    rag: {
      queued: true,
      note: "RAG retrieval quality",
      paper: {
        title: "Retrieval Augmented Generation survey",
        intro: "retrieval augmented generation with vector search",
        categories: ["cs.IR"],
      },
    },
    agent: {
      favorite: true,
      note: "",
      paper: {
        title: "LLM agent tool use",
        intro: "language model agents calling tools",
        categories: ["cs.AI"],
      },
    },
    quant: {
      read: true,
      note: "quantization for edge deployment",
      paper: {
        title: "LLM quantization survey",
        intro: "int8 quantization of language models",
        categories: ["cs.LG"],
      },
    },
  },
});

test("buildLibraryProfile extracts weighted interest terms", () => {
  const profile = Profile.buildLibraryProfile(library());
  assert.equal(profile.documents, 3);
  assert.ok(profile.terms.size >= 10);
  const terms = Profile.profileSummary(profile, 8).map((e) => e.term);
  assert.ok(terms.includes("retrieval"), "queued RAG paper should dominate");
  assert.ok(terms.includes("quantization"));
});

test("buildLibraryProfile returns empty profile for empty library", () => {
  const profile = Profile.buildLibraryProfile({ items: {} });
  assert.equal(profile.documents, 0);
  assert.equal(profile.terms.size, 0);
  const norm = Profile.profileVectorNorm(profile);
  assert.equal(Profile.relevanceToProfile({ title: "anything" }, profile, norm), 0);
});

test("relevanceToProfile discriminates on-topic from off-topic papers", () => {
  const profile = Profile.buildLibraryProfile(library());
  const norm = Profile.profileVectorNorm(profile);
  const onTopic = {
    title: "Better RAG retrieval via hybrid search",
    abstract: "retrieval augmented generation improves with vector search reranking",
  };
  const offTopic = {
    title: "Concrete bridge vibration analysis",
    abstract: "finite element model of bridge decks under traffic load",
  };
  const onScore = Profile.relevanceToProfile(onTopic, profile, norm);
  const offScore = Profile.relevanceToProfile(offTopic, profile, norm);
  assert.ok(onScore > 0.2, `on-topic score should be meaningful, got ${onScore}`);
  assert.equal(offScore, 0);
});

test("relatedLibraryPapers finds overlapping library items", () => {
  const related = Profile.relatedLibraryPapers(
    { title: "RAG reranking with cross encoders", abstract: "retrieval augmented generation" },
    library(),
    2,
  );
  assert.ok(related.length >= 1);
  assert.equal(related[0].title, "Retrieval Augmented Generation survey");
  assert.ok(related[0].queued);
  assert.ok(related[0].similarity > 0);
});

test("RadarCore.setPersonalRelevanceFn boosts matching papers in scorePaper", () => {
  RadarCore.setPersonalRelevanceFn(null);
  const base = {
    source: "arXiv",
    title: "Any paper",
    createdAt: new Date().toISOString(),
    matchedQueries: ["t"],
    categories: ["cs.IR"],
    abstract: "x".repeat(200),
  };
  const plain = RadarCore.scorePaper({ ...base });
  RadarCore.setPersonalRelevanceFn(() => 1);
  const boosted = RadarCore.scorePaper({ ...base });
  RadarCore.setPersonalRelevanceFn(() => 0.5);
  const half = RadarCore.scorePaper({ ...base });
  RadarCore.setPersonalRelevanceFn(null);
  assert.equal(boosted - plain, 85, "full relevance adds 85 points");
  assert.ok(
    Math.abs((half - plain) - 42.5) <= 1,
    `half relevance adds ~42 points, got ${half - plain}`,
  );
});

test("setPersonalRelevanceFn ignores non-function and throwing callbacks", () => {
  RadarCore.setPersonalRelevanceFn("not a function");
  const score = RadarCore.scorePaper({ source: "arXiv", createdAt: new Date().toISOString() });
  assert.ok(Number.isFinite(score));
  RadarCore.setPersonalRelevanceFn(() => {
    throw new Error("boom");
  });
  const safeScore = RadarCore.scorePaper({ source: "arXiv", createdAt: new Date().toISOString() });
  assert.ok(Number.isFinite(safeScore));
  RadarCore.setPersonalRelevanceFn(null);
});
