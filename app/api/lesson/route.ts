import { requireAccount } from "../../../lib/auth";

// Generation runs several sequential/parallel Gemini calls, so allow a long function duration.
export const runtime = "nodejs";
export const maxDuration = 300;

type SourcePage = {
  pageNumber: number;
  text: string;
};

type LessonSection = {
  heading: string;
  paragraphs: string[];
  keyTerms: Array<{ term: string; definition: string }>;
  sourcePages: number[];
  flashcards: StudyFlashcard[];
  testQuestions: QuickTestQuestion[];
  visuals: LessonVisual[];
};

type StudyFlashcard = {
  question: string;
  answer: string;
  sourcePages: number[];
};

type QuickTestQuestion = {
  topic: string;
  concept: string;
  difficulty: "easy" | "medium" | "challenging";
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  sourcePages: number[];
};

type LessonVisual = {
  title: string;
  purpose: string;
  visualPrompt: string;
  sourcePages: number[];
  sourceQuotes: string[];
  type: "anatomy_diagram" | "concept_diagram" | "process_diagram";
};

type StructuredLesson = {
  title: string;
  intro: string;
  introSourcePages: number[];
  sections: LessonSection[];
  rememberThis: string[];
  flashcards: StudyFlashcard[];
  quickTestQuestions: QuickTestQuestion[];
  visuals: LessonVisual[];
  insufficientInformation: boolean;
};

function normalizeEvidenceText(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// A quote counts as verified when the page text contains it exactly, OR contains any run of five
// consecutive words from it. The tolerant run handles the small differences between the model's
// transcription (it also reads the PDF image) and the pdfjs-extracted text — differing spacing,
// subscripts (O₂), units (µm), or an added/dropped word at the edges — while still requiring a
// real verbatim span from the page, which is hard to fabricate.
function quoteMatchesPage(quoteNorm: string, pageNorm: string) {
  if (!quoteNorm) return false;
  if (pageNorm.includes(quoteNorm)) return true;
  const words = quoteNorm.split(" ").filter(Boolean);
  if (words.length < 5) return false;
  for (let index = 0; index + 5 <= words.length; index += 1) {
    if (pageNorm.includes(words.slice(index, index + 5).join(" "))) return true;
  }
  return false;
}

function verifiedEvidencePages(value: unknown, sourceByPage: Map<number, string>) {
  if (!Array.isArray(value)) return [];

  const normalizedPageCache = new Map<number, string>();
  const normalizedPage = (pageNumber: number) => {
    let pageNorm = normalizedPageCache.get(pageNumber);
    if (pageNorm === undefined) {
      const pageText = sourceByPage.get(pageNumber);
      pageNorm = pageText ? normalizeEvidenceText(pageText) : "";
      normalizedPageCache.set(pageNumber, pageNorm);
    }
    return pageNorm;
  };

  const verifiedPages = new Set<number>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || !("pageNumber" in item) || !("quote" in item)) continue;
    const evidence = item as { pageNumber: unknown; quote: unknown };
    if (
      typeof evidence.pageNumber !== "number" || !Number.isInteger(evidence.pageNumber) ||
      typeof evidence.quote !== "string" || evidence.quote.length > 400
    ) continue;

    const quote = normalizeEvidenceText(evidence.quote);
    if (quote.split(" ").length < 4) continue;

    // Prefer the cited page, but if the quote is not there, find the page that actually contains
    // it. This self-corrects small page-number mistakes instead of dropping a real quote.
    if (sourceByPage.has(evidence.pageNumber) && quoteMatchesPage(quote, normalizedPage(evidence.pageNumber))) {
      verifiedPages.add(evidence.pageNumber);
      continue;
    }
    for (const pageNumber of sourceByPage.keys()) {
      if (pageNumber === evidence.pageNumber) continue;
      if (quoteMatchesPage(quote, normalizedPage(pageNumber))) {
        verifiedPages.add(pageNumber);
        break;
      }
    }
  }

  return [...verifiedPages].sort((first, second) => first - second);
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

const MAX_TEXT_LENGTH = 80_000;
const MAX_PAGES = 200;
const MAX_MODULES = 20;
const MODULE_CONCURRENCY = 5;

class GeminiFailure extends Error {
  status: number;
  model: string;
  constructor(message: string, status: number, model: string) {
    super(message);
    this.name = "GeminiFailure";
    this.status = status;
    this.model = model;
  }
}

const evidenceSchema = {
  type: "OBJECT",
  properties: { pageNumber: { type: "INTEGER" }, quote: { type: "STRING" } },
  required: ["pageNumber", "quote"],
};

const flashcardSchema = {
  type: "OBJECT",
  properties: {
    question: { type: "STRING" },
    answer: { type: "STRING" },
    sourcePages: { type: "ARRAY", items: { type: "INTEGER" } },
    evidence: { type: "ARRAY", items: evidenceSchema },
  },
  required: ["question", "answer", "sourcePages", "evidence"],
};

const testQuestionSchema = {
  type: "OBJECT",
  properties: {
    topic: { type: "STRING" },
    concept: { type: "STRING" },
    difficulty: { type: "STRING", enum: ["easy", "medium", "challenging"] },
    question: { type: "STRING" },
    options: { type: "ARRAY", items: { type: "STRING" } },
    correctAnswer: { type: "INTEGER" },
    explanation: { type: "STRING" },
    sourcePages: { type: "ARRAY", items: { type: "INTEGER" } },
    questionEvidence: { type: "ARRAY", items: evidenceSchema },
    explanationEvidence: { type: "ARRAY", items: evidenceSchema },
  },
  required: ["topic", "concept", "difficulty", "question", "options", "correctAnswer", "explanation", "sourcePages", "questionEvidence", "explanationEvidence"],
};

const visualSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    purpose: { type: "STRING" },
    visualPrompt: { type: "STRING" },
    sourcePages: { type: "ARRAY", items: { type: "INTEGER" } },
    sourceQuotes: { type: "ARRAY", items: { type: "STRING" } },
    type: { type: "STRING", enum: ["anatomy_diagram", "concept_diagram", "process_diagram"] },
  },
  required: ["title", "purpose", "visualPrompt", "sourcePages", "sourceQuotes", "type"],
};

const outlineSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    intro: { type: "STRING" },
    introEvidence: { type: "ARRAY", items: evidenceSchema },
    modules: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          heading: { type: "STRING" },
          focus: { type: "STRING" },
          sourcePages: { type: "ARRAY", items: { type: "INTEGER" } },
        },
        required: ["heading", "focus", "sourcePages"],
      },
    },
    rememberThis: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, evidence: { type: "ARRAY", items: evidenceSchema } },
        required: ["text", "evidence"],
      },
    },
    insufficientInformation: { type: "BOOLEAN" },
  },
  required: ["title", "intro", "introEvidence", "modules", "rememberThis", "insufficientInformation"],
};

const moduleSchema = {
  type: "OBJECT",
  properties: {
    paragraphs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, evidence: { type: "ARRAY", items: evidenceSchema } },
        required: ["text", "evidence"],
      },
    },
    keyTerms: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { term: { type: "STRING" }, definition: { type: "STRING" }, evidence: { type: "ARRAY", items: evidenceSchema } },
        required: ["term", "definition", "evidence"],
      },
    },
    flashcards: { type: "ARRAY", items: flashcardSchema },
    testQuestions: { type: "ARRAY", items: testQuestionSchema },
    visuals: { type: "ARRAY", items: visualSchema },
  },
  required: ["paragraphs", "keyTerms", "flashcards", "testQuestions", "visuals"],
};

const quickTestSchema = {
  type: "OBJECT",
  properties: { quickTestQuestions: { type: "ARRAY", items: testQuestionSchema } },
  required: ["quickTestQuestions"],
};

const BASE_RULES = `You are a careful Science Olympiad Anatomy & Physiology teacher building a study package from the supplied PDF, for students around age 13.

SOURCE AUTHORITY: The supplied PDF is the only source. Use only facts explicitly supported by it. Never add outside knowledge, importance words such as "vital" or "crucial", or any fact, number, cause, or relationship the PDF does not state. If the PDF only names a term without explaining it, do not add its meaning.

READING LEVEL (most important style rule): Write for an average 13-year-old (grade 7 to 8). Use short, plain sentences of about 12 to 18 words. Prefer everyday words over textbook words when the meaning is the same (for example "makes" over "produces", "job" over "function", "tiny" over "microscopic"). When a scientific term is needed because the PDF teaches it, say its plain meaning first, then the term (for example "the main breathing muscle under your lungs, called the diaphragm"). Use a warm second-person voice ("your lungs", "you breathe in"). Keep paragraphs short (2 to 4 sentences). Simplifying must NEVER add or change a fact; it only rewords the same supported fact, and the evidence quote must still support the simpler sentence.

EVIDENCE: Every claim you present must be backed by an evidence quote. Copy each quote VERBATIM — character for character — from the "Packet page-numbered text" block provided in this request, and use that block's matching [Page N] number. Do NOT retype the quote from the PDF image; the application verifies quotes against that text block, so a quote typed from the picture (with different spacing or symbols) will be rejected and its item dropped. You may look at the diagrams to understand the material, but always take the actual quote from the text block. Pick a quote of at least 6 words that appears exactly in the text. Do not paraphrase, fix, shorten, or invent quotes, and do not use a quote that only partially supports its item.

DIAGRAMS: The application shows students the packet's own diagrams by rendering the real PDF pages; it does not generate new images. Blank practice or "label-it" worksheets (empty numbered boxes, no answers) contain NO facts — never treat their blanks as real structures or invent their labels.

OUTPUT: Return only JSON matching the supplied schema. No HTML, Markdown, or commentary.`;

const OUTLINE_TASK = `TASK: Create the lesson OUTLINE for the WHOLE packet. Do not write the module bodies yet.

COVER EVERYTHING — THIS IS CRITICAL: Your module list must span the ENTIRE teaching portion of the packet from the first content page to the last, with NO gaps. Walk through the packet page by page in order. Every page that TEACHES content must belong to a module. If the packet is organized as "Module 1", "Module 2", "Module 3" (or more), you MUST include ALL of them — never jump from Module 1 to Module 3 and skip Module 2. Before you finish, check that the sourcePages of your teaching modules together cover the whole teaching range with none missing in the middle.

PRACTICE MATERIAL IS NOT A MODULE: The packet's practice questions — its end-of-packet quiz, the answer key, the "Stop and check" questions, and the blank practice/label-it worksheets (for example "Practice A: fill in the 15 stops", "Practice B: label the lungs") — are NOT teaching content. Do NOT create a reading module for them and do NOT list their pages as a module's sourcePages. Instead, that practice material is used only to build the flashcards and the test questions in the later steps. So exclude those pages from the modules here, but remember they exist so the quiz and flashcards can be built from them.

- title: a short, student-friendly lesson title.
- intro: a short, friendly overview (a few sentences) of everything the student will learn, written at a 13-year-old level. Provide introEvidence quotes that support it.
- modules: break the ENTIRE packet into teaching modules, in the packet's own order. Follow the packet's modules and numbered subsections — one module per numbered subsection, or per small group of closely related subsections. Cover every module, subsection, table, and diagram; do not skip any. Prefer many short modules over a few long ones. For each module give: heading (echo the packet's own title when possible, for example "Module 1 · Why We Breathe", "Module 2 · The Trachea, Bronchial Tree and Alveoli", "The Larynx — Voice Box"), focus (one sentence on what it teaches), and sourcePages (the PDF page numbers it draws from).
- rememberThis: 2 to 4 short whole-packet takeaways, each with an evidence quote.
- insufficientInformation: set true ONLY if the packet lacks enough verifiable content to teach. If true, say so in the intro and return empty modules and rememberThis.`;

const QUICK_TEST_TASK = `TASK: Create the end-of-week Quick Test: exactly five multiple-choice questions spanning the WHOLE packet.

Draw them FIRST from the packet's own quiz and answer key. If the packet has a quiz, pick five multiple-choice items covering different modules, and use the matching answer-key entry to set the correct option and to write the explanation (the answer key's "why"). Only write an original question when the packet's quiz does not supply enough usable items.

The five questions should represent different concepts, mixing easy, medium, and challenging. Each needs: topic, concept, difficulty, question, four distinct plausible options, one correctAnswer index, a brief explanation, sourcePages, questionEvidence, and explanationEvidence (quotes copied from the page text). Avoid duplicate concepts, trick wording, and anything needing outside knowledge. If five solid questions cannot be supported, return an empty quickTestQuestions array.`;

function moduleTask(heading: string, focus: string, sourcePages: number[]) {
  const pageHint = sourcePages.length ? sourcePages.join(", ") : "the relevant pages";
  return `TASK: Write ONE module of the lesson, and only this module.

Module heading: "${heading}"
What it teaches: ${focus}
It draws mainly from PDF pages: ${pageHint}.

Teach only this module's content; do not cover other modules. Cover ALL of the content on this module's pages — do not skip any sub-topic, list, table, labeled diagram, or "stop and check" item that falls in this module. For example, if this module includes the air path from the nose to the alveoli, name every stop; if it includes the bronchial tree or the alveoli, teach each part the packet names. Produce:
- paragraphs: 3 to 6 short, kid-friendly explanatory paragraphs that together cover everything this module teaches, each with an evidence quote. Convert any relevant table rows and diagram labels into clear sentences so no fact is lost. Include the packet's own "Remember it" mnemonic or "Test tip" for this topic when present (do not invent new ones).
- keyTerms: the important terms this module teaches, each with a one-sentence plain definition and evidence. Only include terms the PDF defines or explains.
- flashcards: at least 5 cards (aim for 5 to 8) testing this module's key concepts, each with a short answer, sourcePages, and evidence. Build them from this module's practice material — the packet's own flashcards, its quiz items, its "Stop and check" questions, and its practice diagrams (for example turn the air-path "fill in the stops" practice into cards for each stop) — then add more from this module's content so there are at least 5. Each card must test a different concept; never pad with trivial or duplicate cards.
- testQuestions: at least 5 multiple-choice questions (aim for 5 to 6) on this module (four options, one correct), each with topic, concept, difficulty, explanation, sourcePages, questionEvidence, and explanationEvidence. Build them from this module's practice material: adapt the packet's quiz questions and "Stop and check" questions for this topic and use the answer key for the correct option and explanation; add more from this module's content so there are at least 5 distinct ones. Only use facts this module's pages support.
- visuals: if this module has a useful diagram in the packet, add one entry naming it and the page it appears on (title, purpose, visualPrompt describing what the existing figure shows, sourcePages, sourceQuotes copied from its caption/label, type). Ignore blank practice worksheets. If there is no useful diagram, return an empty visuals array.`;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const current = next;
      next += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// Calls Gemini with the model-fallback list and returns the parsed JSON object.
// Throws GeminiFailure when every model fails, or SyntaxError when the JSON is unparseable.
async function requestGeminiJson(
  models: string[],
  apiKey: string,
  systemText: string,
  parts: unknown[],
  schema: unknown,
  maxOutputTokens: number,
): Promise<unknown> {
  const call = (model: string) => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    },
  );

  let geminiResponse: Response | null = null;
  let lastStatus = 0;
  let lastModel = models[0];

  outer: for (const model of models) {
    lastModel = model;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await call(model).catch((fetchError: unknown) => {
        console.error(`Gemini ${model} request failed:`, fetchError instanceof Error ? fetchError.message : "unknown");
        return null;
      });
      if (!response) { lastStatus = 0; break; }
      lastStatus = response.status;
      if (response.ok) { geminiResponse = response; break outer; }

      const detail = await response.text().catch(() => "");
      console.error(`Gemini ${model} returned ${response.status}:`, detail.slice(0, 800));
      if (response.status === 400 || response.status === 401 || response.status === 403) break outer;
      if (response.status === 404) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)));
    }
  }

  if (!geminiResponse) {
    const message = lastStatus === 429
      ? "The Gemini quota is used up or the service is busy. Wait a minute and try again, or check your Gemini API usage limits."
      : lastStatus === 400 || lastStatus === 401 || lastStatus === 403
        ? "Gemini rejected the request. Check that GEMINI_API_KEY is valid and that access or billing is enabled for it."
        : lastStatus === 404
          ? `None of these Gemini models were found: ${models.join(", ")}. Set GEMINI_MODEL to an available model.`
          : lastStatus === 503 || lastStatus === 500
            ? `Gemini is overloaded right now (HTTP ${lastStatus} on ${lastModel}). Wait a few minutes and try again, or add a fallback model to GEMINI_MODEL.`
            : `Gemini did not answer (last status ${lastStatus || "no response"} on ${lastModel}). Please try again.`;
    throw new GeminiFailure(message, lastStatus, lastModel);
  }

  const result = await geminiResponse.json() as GeminiResponse;
  const responseText = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!responseText) throw new Error("Gemini returned an empty response.");
  return JSON.parse(responseText) as unknown;
}

function processSection(raw: unknown, heading: string, sourceByPage: Map<number, string>): LessonSection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as {
    paragraphs?: unknown; keyTerms?: unknown; flashcards?: unknown; testQuestions?: unknown; visuals?: unknown;
  };
  if (
    !Array.isArray(data.paragraphs) || !Array.isArray(data.keyTerms) ||
    !Array.isArray(data.flashcards) || !Array.isArray(data.testQuestions)
  ) return null;

  const paragraphs = data.paragraphs.flatMap((paragraph) => {
    if (typeof paragraph !== "object" || paragraph === null || !("text" in paragraph) || !("evidence" in paragraph)) return [];
    const supported = paragraph as { text: unknown; evidence: unknown };
    if (typeof supported.text !== "string" || !supported.text.trim()) return [];
    const sourcePages = verifiedEvidencePages(supported.evidence, sourceByPage);
    return sourcePages.length ? [{ text: supported.text.trim(), sourcePages }] : [];
  }).slice(0, 6);

  const keyTerms = data.keyTerms.flatMap((keyTerm) => {
    if (
      typeof keyTerm !== "object" || keyTerm === null ||
      !("term" in keyTerm) || !("definition" in keyTerm) || !("evidence" in keyTerm)
    ) return [];
    const term = keyTerm as { term: unknown; definition: unknown; evidence: unknown };
    if (typeof term.term !== "string" || typeof term.definition !== "string") return [];
    const sourcePages = verifiedEvidencePages(term.evidence, sourceByPage);
    return sourcePages.length ? [{ term: term.term.trim(), definition: term.definition.trim() }] : [];
  }).filter((keyTerm) => keyTerm.term && keyTerm.definition).slice(0, 8);

  const flashcards = data.flashcards
    .flatMap((item) => processFlashcard(item, sourceByPage))
    .filter((card, index, cards) => cards.findIndex(
      (candidate) => normalizeEvidenceText(candidate.question) === normalizeEvidenceText(card.question),
    ) === index)
    .slice(0, 8);
  const testQuestions = data.testQuestions
    .flatMap((item) => processTestQuestion(item, sourceByPage))
    .filter((question, index, questions) => questions.findIndex(
      (candidate) => normalizeEvidenceText(candidate.question) === normalizeEvidenceText(question.question),
    ) === index)
    .slice(0, 6);
  const visuals = Array.isArray(data.visuals) ? processVisuals(data.visuals, sourceByPage) : [];

  const sourcePages = [...new Set([
    ...paragraphs.flatMap((item) => item.sourcePages),
    ...visuals.flatMap((visual) => visual.sourcePages),
  ])].sort((first, second) => first - second);
  if (!heading.trim() || !paragraphs.length || !sourcePages.length) return null;

  return {
    heading: heading.trim(),
    paragraphs: paragraphs.map((paragraph) => paragraph.text),
    keyTerms,
    sourcePages,
    flashcards,
    testQuestions,
    visuals,
  };
}

function processFlashcard(item: unknown, sourceByPage: Map<number, string>): StudyFlashcard[] {
  if (
    typeof item !== "object" || item === null || !("question" in item) || !("answer" in item) || !("sourcePages" in item)
  ) return [];
  const card = item as { question: unknown; answer: unknown; sourcePages: unknown; evidence?: unknown };
  if (typeof card.question !== "string" || typeof card.answer !== "string" || !Array.isArray(card.sourcePages)) return [];

  // A card is kept when its evidence quote verifies against the PDF text. We prefer the model's
  // own sourcePages when they line up with the verified pages, but fall back to the verified
  // pages so a card is not dropped just because its separate sourcePages field disagrees.
  const evidencePages = verifiedEvidencePages(card.evidence, sourceByPage);
  if (!evidencePages.length) return [];
  const matchedPages = [...new Set(card.sourcePages.filter(
    (pageNumber): pageNumber is number => typeof pageNumber === "number" && Number.isInteger(pageNumber) && evidencePages.includes(pageNumber),
  ))].sort((first, second) => first - second);
  const sourcePages = matchedPages.length ? matchedPages : evidencePages;
  if (
    card.question.trim().length < 8 || card.answer.trim().length < 3 ||
    card.question.length > 260 || card.answer.length > 500
  ) return [];

  return [{ question: card.question.trim(), answer: card.answer.trim(), sourcePages }];
}

function processTestQuestion(item: unknown, sourceByPage: Map<number, string>): QuickTestQuestion[] {
  if (typeof item !== "object" || item === null) return [];
  const question = item as {
    topic?: unknown; concept?: unknown; difficulty?: unknown; question?: unknown; options?: unknown;
    correctAnswer?: unknown; explanation?: unknown; sourcePages?: unknown; questionEvidence?: unknown; explanationEvidence?: unknown;
  };
  if (
    typeof question.topic !== "string" || typeof question.concept !== "string" ||
    !(question.difficulty === "easy" || question.difficulty === "medium" || question.difficulty === "challenging") ||
    typeof question.question !== "string" || !Array.isArray(question.options) ||
    !question.options.every((option) => typeof option === "string") || question.options.length !== 4 ||
    typeof question.correctAnswer !== "number" || !Number.isInteger(question.correctAnswer) ||
    question.correctAnswer < 0 || question.correctAnswer > 3 || typeof question.explanation !== "string" ||
    !Array.isArray(question.sourcePages)
  ) return [];

  // Keep a question when its own evidence quote verifies against the PDF text. The explanation's
  // quote is a bonus (it adds pages when present) but is not required, so a solid question is not
  // dropped just because the explanation quote didn't match exactly. Fall back to the verified
  // pages when the model's separate sourcePages field disagrees.
  const questionPages = verifiedEvidencePages(question.questionEvidence, sourceByPage);
  const explanationPages = verifiedEvidencePages(question.explanationEvidence, sourceByPage);
  const evidencePages = [...new Set([...questionPages, ...explanationPages])].sort((first, second) => first - second);
  const matchedPages = [...new Set(question.sourcePages.filter(
    (pageNumber): pageNumber is number => typeof pageNumber === "number" && Number.isInteger(pageNumber) && evidencePages.includes(pageNumber),
  ))].sort((first, second) => first - second);
  const sourcePages = matchedPages.length ? matchedPages : evidencePages;
  const options = question.options.map((option) => option.trim());

  if (
    !question.topic.trim() || !question.concept.trim() || !question.question.trim() ||
    !question.explanation.trim() || question.question.length > 500 || question.explanation.length > 800 ||
    !questionPages.length || !sourcePages.length ||
    options.some((option) => !option) || new Set(options.map(normalizeEvidenceText)).size !== 4
  ) return [];

  return [{
    topic: question.topic.trim(),
    concept: question.concept.trim(),
    difficulty: question.difficulty,
    question: question.question.trim(),
    options,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation.trim(),
    sourcePages,
  }];
}

function processVisuals(items: unknown[], sourceByPage: Map<number, string>): LessonVisual[] {
  return items.flatMap((item) => {
    if (
      typeof item !== "object" || item === null || !("title" in item) || !("purpose" in item) ||
      !("visualPrompt" in item) || !("sourcePages" in item) || !("sourceQuotes" in item) || !("type" in item)
    ) return [];
    const visual = item as {
      title: unknown; purpose: unknown; visualPrompt: unknown; sourcePages: unknown; sourceQuotes: unknown; type: unknown;
    };
    if (
      typeof visual.title !== "string" || typeof visual.purpose !== "string" || typeof visual.visualPrompt !== "string" ||
      !Array.isArray(visual.sourcePages) || !Array.isArray(visual.sourceQuotes) ||
      !(visual.type === "anatomy_diagram" || visual.type === "concept_diagram" || visual.type === "process_diagram")
    ) return [];

    const validSourcePages = visual.sourcePages.filter(
      (pageNumber): pageNumber is number => typeof pageNumber === "number" && Number.isInteger(pageNumber) && sourceByPage.has(pageNumber),
    );
    const validSourceQuotes = visual.sourceQuotes.filter(
      (quote): quote is string => typeof quote === "string" && quote.trim().length > 0,
    );
    if (!visual.title.trim() || !visual.purpose.trim() || !visual.visualPrompt.trim() || !validSourcePages.length || !validSourceQuotes.length) return [];

    return [{
      title: visual.title.trim(),
      purpose: visual.purpose.trim(),
      visualPrompt: visual.visualPrompt.trim(),
      sourcePages: [...new Set(validSourcePages)].sort((a, b) => a - b),
      sourceQuotes: validSourceQuotes,
      type: visual.type,
    }];
  });
}

const INSUFFICIENT_RESPONSE = {
  title: "More source detail needed",
  intro: "The uploaded material does not provide enough directly verifiable information to build a cited lesson. Try a text-based packet with more explanation.",
  introSourcePages: [] as number[],
  sections: [] as LessonSection[],
  rememberThis: [] as string[],
  flashcards: [] as StudyFlashcard[],
  quickTestQuestions: [] as QuickTestQuestion[],
  visuals: [] as LessonVisual[],
  insufficientInformation: true,
};

export async function POST(request: Request) {
  if (!requireAccount(request, "admin")) {
    return Response.json({ error: "Only the admin can generate lessons." }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Lesson generation isn’t configured yet. Add GEMINI_API_KEY to the server environment." },
      { status: 503 },
    );
  }

  let body: { pages?: unknown; pdf?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The lesson request was not valid." }, { status: 400 });
  }

  if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > MAX_PAGES) {
    return Response.json({ error: "Upload a PDF with 1 to 200 pages of selectable text." }, { status: 400 });
  }

  // The PDF itself (base64) is optional. When present, it is sent to Gemini as a document part
  // so the model can read diagrams and labeled figures, not just the extracted text.
  let pdfPart: { inlineData: { mimeType: string; data: string } } | null = null;
  if (body.pdf !== undefined && body.pdf !== null) {
    const pdf = body.pdf as { data?: unknown; mimeType?: unknown };
    if (
      typeof pdf.data !== "string" || pdf.data.length === 0 || pdf.data.length > 30_000_000 ||
      pdf.mimeType !== "application/pdf"
    ) {
      return Response.json({ error: "The uploaded PDF data was not valid." }, { status: 400 });
    }
    pdfPart = { inlineData: { mimeType: "application/pdf", data: pdf.data } };
  }

  const pages: SourcePage[] = [];
  const seenPageNumbers = new Set<number>();
  let textLength = 0;

  for (const candidate of body.pages) {
    if (
      typeof candidate !== "object" || candidate === null ||
      !("pageNumber" in candidate) || !("text" in candidate)
    ) {
      return Response.json({ error: "The extracted page data was not valid." }, { status: 400 });
    }

    const page = candidate as { pageNumber: unknown; text: unknown };
    if (
      typeof page.pageNumber !== "number" || !Number.isInteger(page.pageNumber) ||
      page.pageNumber < 1 || page.pageNumber > MAX_PAGES || seenPageNumbers.has(page.pageNumber) ||
      typeof page.text !== "string"
    ) {
      return Response.json({ error: "The extracted page data was not valid." }, { status: 400 });
    }

    const text = page.text.trim();
    textLength += text.length;
    if (textLength > MAX_TEXT_LENGTH) {
      return Response.json({ error: "This study packet has too much text for one lesson. Try a shorter PDF." }, { status: 413 });
    }

    seenPageNumbers.add(page.pageNumber);
    if (text) pages.push({ pageNumber: page.pageNumber, text });
  }

  if (!pages.length) {
    return Response.json({ error: "No selectable text was found in this PDF." }, { status: 400 });
  }

  const sourceByPage = new Map(pages.map((page) => [page.pageNumber, page.text]));
  const sourceText = pages.map(({ pageNumber, text }) => `[Page ${pageNumber}]\n${text}`).join("\n\n");

  // GEMINI_MODEL may be one model or a comma-separated fallback list, tried in order.
  const models = (process.env.GEMINI_MODEL?.split(",") ?? [])
    .map((name: string) => name.trim())
    .filter(Boolean);
  if (models.length === 0) models.push("gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite");

  const makeParts = (instruction: string) => [
    { text: instruction },
    ...(pdfPart ? [pdfPart] : []),
    { text: `Packet page-numbered text:\n\n${sourceText}` },
  ];

  try {
    // Pass 1: the outline (title, intro, module list, remember-this). Small output.
    const outlineRaw = await requestGeminiJson(models, apiKey, BASE_RULES, makeParts(OUTLINE_TASK), outlineSchema, 16_384);
    if (typeof outlineRaw !== "object" || outlineRaw === null) throw new Error("Gemini returned an invalid outline.");
    const outline = outlineRaw as {
      title?: unknown; intro?: unknown; introEvidence?: unknown; modules?: unknown;
      rememberThis?: unknown; insufficientInformation?: unknown;
    };
    if (
      typeof outline.title !== "string" || typeof outline.intro !== "string" ||
      !Array.isArray(outline.modules) || !Array.isArray(outline.rememberThis) ||
      typeof outline.insufficientInformation !== "boolean"
    ) {
      throw new Error("Gemini returned an invalid outline.");
    }

    const introSourcePages = verifiedEvidencePages(outline.introEvidence, sourceByPage);
    const title = outline.title.trim();
    const intro = outline.intro.trim();
    if (!title || !intro) throw new Error("Gemini returned an incomplete outline.");

    const moduleStubs = outline.modules.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const stub = item as { heading?: unknown; focus?: unknown; sourcePages?: unknown };
      if (typeof stub.heading !== "string" || !stub.heading.trim()) return [];
      const stubPages = Array.isArray(stub.sourcePages)
        ? stub.sourcePages.filter((pageNumber): pageNumber is number => typeof pageNumber === "number" && Number.isInteger(pageNumber))
        : [];
      return [{ heading: stub.heading.trim(), focus: typeof stub.focus === "string" ? stub.focus.trim() : "", sourcePages: stubPages }];
    }).slice(0, MAX_MODULES);

    // Only give up before generating when the model named no modules at all. We do NOT gate on the
    // intro's quotes verifying (intros are paraphrased overviews) or on the model's own
    // insufficientInformation flag — the real test is whether the modules produce verifiable content.
    if (!moduleStubs.length) {
      return Response.json(INSUFFICIENT_RESPONSE);
    }

    // Pass 2: each module in parallel (bounded), so no single response can grow large enough
    // to truncate. Each module is attempted up to twice so a transient failure or a response
    // that momentarily fails verification does not silently drop a whole module of the packet.
    let moduleFailure: GeminiFailure | null = null;
    const moduleResults = await mapWithConcurrency(moduleStubs, MODULE_CONCURRENCY, async (stub) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const raw = await requestGeminiJson(
            models, apiKey, BASE_RULES, makeParts(moduleTask(stub.heading, stub.focus, stub.sourcePages)), moduleSchema, 32_768,
          );
          const section = processSection(raw, stub.heading, sourceByPage);
          if (section) return section;
        } catch (error) {
          if (error instanceof GeminiFailure) moduleFailure = error;
          console.error(`Module "${stub.heading}" attempt ${attempt + 1} failed:`, error instanceof Error ? error.message : "unknown");
        }
      }
      console.error(`Module "${stub.heading}" produced no verifiable content after retry.`);
      return null;
    });

    const sections = moduleResults.flatMap((section) => (section ? [section] : []));
    if (!sections.length) {
      if (moduleFailure) throw moduleFailure;
      return Response.json(INSUFFICIENT_RESPONSE);
    }

    // Aggregate the per-module diagrams into the top-level array the app uses for page rendering.
    const visuals = sections.flatMap((section) => section.visuals).slice(0, 12);
    // The global deck is validated to at most 10 cards; per-module decks (in sections) are uncapped.
    const flashcards = sections
      .flatMap((section) => section.flashcards)
      .filter((card, index, cards) => cards.findIndex(
        (candidate) => normalizeEvidenceText(candidate.question) === normalizeEvidenceText(card.question),
      ) === index)
      .slice(0, 10);

    const rememberThis = outline.rememberThis.flatMap((item) => {
      if (typeof item !== "object" || item === null || !("text" in item) || !("evidence" in item)) return [];
      const point = item as { text: unknown; evidence: unknown };
      if (typeof point.text !== "string" || !point.text.trim()) return [];
      return verifiedEvidencePages(point.evidence, sourceByPage).length ? [point.text.trim()] : [];
    }).slice(0, 4);

    // Pass 3: the whole-packet quick test (five questions from the packet quiz/answer key).
    let quickTestQuestions: QuickTestQuestion[] = [];
    try {
      const quickRaw = await requestGeminiJson(models, apiKey, BASE_RULES, makeParts(QUICK_TEST_TASK), quickTestSchema, 16_384);
      const quick = quickRaw as { quickTestQuestions?: unknown };
      if (Array.isArray(quick.quickTestQuestions)) {
        const verified = quick.quickTestQuestions
          .flatMap((item) => processTestQuestion(item, sourceByPage))
          .filter((question, index, questions) => questions.findIndex(
            (candidate) => normalizeEvidenceText(candidate.concept) === normalizeEvidenceText(question.concept),
          ) === index)
          .slice(0, 5);
        quickTestQuestions = verified.length === 5 ? verified : [];
      }
    } catch (error) {
      // The quick test is optional; a lesson with sections is still useful without it.
      console.error("Quick test generation failed:", error instanceof Error ? error.message : "unknown");
    }

    const lesson: StructuredLesson = {
      title,
      intro,
      introSourcePages,
      sections,
      rememberThis,
      flashcards,
      quickTestQuestions,
      visuals,
      insufficientInformation: false,
    };

    return Response.json(lesson);
  } catch (caughtError) {
    console.error(
      "A&P lesson generation failed:",
      caughtError instanceof Error ? caughtError.message : "Unknown response error",
    );
    if (caughtError instanceof GeminiFailure) {
      return Response.json({ error: caughtError.message }, { status: caughtError.status === 429 ? 429 : 502 });
    }
    // This route is admin-only, so it is safe to say what actually went wrong (no secrets are included).
    const reason = caughtError instanceof Error && (caughtError.name === "TimeoutError" || caughtError.name === "AbortError")
      ? "Gemini took too long to answer. Try a shorter PDF or try again."
      : caughtError instanceof SyntaxError
        ? "Gemini returned malformed JSON (the answer may have been cut off). Try again, or try a shorter PDF."
        : caughtError instanceof Error
          ? caughtError.message
          : "Unknown error.";
    return Response.json({ error: `We couldn’t create a lesson: ${reason}` }, { status: 502 });
  }
}
