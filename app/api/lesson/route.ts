import { requireAccount } from "../../../lib/auth";

type SourcePage = {
  pageNumber: number;
  text: string;
};

type LessonSection = {
  heading: string;
  paragraphs: string[];
  keyTerms: Array<{ term: string; definition: string }>;
  sourcePages: number[];
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

type EvidenceQuote = {
  pageNumber: number;
  quote: string;
};

type GeneratedSection = {
  heading: string;
  paragraphs: Array<{ text: string; evidence: EvidenceQuote[] }>;
  keyTerms: Array<{ term: string; definition: string; evidence: EvidenceQuote[] }>;
  sourcePages: number[];
};

type StructuredLesson = {
  title: string;
  intro: string;
  introSourcePages: number[];
  sections: LessonSection[];
  rememberThis: string[];
  flashcards: StudyFlashcard[];
  quickTestQuestions: QuickTestQuestion[];
  insufficientInformation: boolean;
};

type GeneratedLesson = {
  title: string;
  intro: string;
  introEvidence: EvidenceQuote[];
  sections: GeneratedSection[];
  rememberThis: Array<{ text: string; evidence: EvidenceQuote[] }>;
  flashcards: Array<{
    question: string;
    answer: string;
    sourcePages: number[];
    evidence: EvidenceQuote[];
  }>;
  quickTestQuestions: Array<{
    topic: string;
    concept: string;
    difficulty: string;
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
    sourcePages: number[];
    questionEvidence: EvidenceQuote[];
    explanationEvidence: EvidenceQuote[];
  }>;
  insufficientInformation: boolean;
};

function normalizeEvidenceText(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function verifiedEvidencePages(value: unknown, sourceByPage: Map<number, string>) {
  if (!Array.isArray(value)) return [];

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
    const pageText = sourceByPage.get(evidence.pageNumber);
    if (pageText && normalizeEvidenceText(pageText).includes(quote)) verifiedPages.add(evidence.pageNumber);
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

  let body: { pages?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The lesson request was not valid." }, { status: 400 });
  }

  if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > MAX_PAGES) {
    return Response.json({ error: "Upload a PDF with 1 to 200 pages of selectable text." }, { status: 400 });
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

  const sourceText = pages.map(({ pageNumber, text }) => `[Page ${pageNumber}]\n${text}`).join("\n\n");
  const evidenceSchema = {
    type: "OBJECT",
    properties: { pageNumber: { type: "INTEGER" }, quote: { type: "STRING" } },
    required: ["pageNumber", "quote"],
  };

  // GEMINI_MODEL may be one model or a comma-separated fallback list, tried in order.
  const models = (process.env.GEMINI_MODEL?.split(",") ?? [])
    .map((name: string) => name.trim())
    .filter(Boolean);
  if (models.length === 0) models.push("gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite");

  try {
    const callGemini = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(110_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are a careful Science Olympiad Anatomy & Physiology teacher. The uploaded PDF text is the only authoritative source. Never use outside knowledge or fill gaps. If a PDF page only names an organ or term, do not add its function, definition, location, or other facts unless the PDF states them. Preserve scientific terminology and explain only supported details at an age-appropriate level. Do not add importance claims, adjectives such as vital or crucial, or descriptions absent from the source. Write a concise lesson for about five minutes: a short intro, then 3 to 5 teaching sections with natural explanatory paragraphs, not bullets or a wall of text. Include important terms only when the PDF supports their definitions. For the intro, every paragraph, every key-term definition, and every Remember This point, include an evidence quote copied exactly from a supplied page and its page number. Each quote must directly support all factual claims in that item; if no quote supports it, omit the item. The server checks these quotes against the PDF. Every section must cite the pages supporting its content. End with 2 to 4 short Remember This points. Also create 8 to 10 high-value flashcards for this lesson when the source supports that many distinct concepts. Each card tests one important concept, has a short scientifically accurate answer, does not repeat another card, and includes source page numbers plus exact evidence quotes for both its question and answer. Build cards from the lesson and supplied PDF together; never pad the set with unsupported or trivial facts. Create exactly five multiple-choice questions for a separate Quick Test using only supported facts in the lesson and PDF. Test understanding, mix easy, medium, and challenging, use four distinct plausible options, one correct option, and avoid ambiguity and repeated concepts. Give every question a topic and specific concept label. Include a brief explanation and separate exact evidence quotes for both question and explanation, with source pages present for both. If five distinct questions cannot be supported, return an empty quickTestQuestions array instead of inventing. If the PDF does not provide enough information, set insufficientInformation to true, explicitly say in intro that the uploaded material does not provide enough information, and leave sections, rememberThis, flashcards, and quickTestQuestions empty. Return only JSON matching the schema; never HTML or Markdown.",
            }],
          },
          contents: [{ role: "user", parts: [{ text: `Make the lesson from this extracted PDF text:\n\n${sourceText}` }] }],
          generationConfig: {
            temperature: 0.25,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                intro: { type: "STRING" },
                introEvidence: { type: "ARRAY", items: evidenceSchema },
                sections: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      heading: { type: "STRING" },
                      sourcePages: { type: "ARRAY", items: { type: "INTEGER" } },
                      paragraphs: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            text: { type: "STRING" },
                            evidence: { type: "ARRAY", items: evidenceSchema },
                          },
                          required: ["text", "evidence"],
                        },
                      },
                      keyTerms: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            term: { type: "STRING" },
                            definition: { type: "STRING" },
                            evidence: { type: "ARRAY", items: evidenceSchema },
                          },
                          required: ["term", "definition", "evidence"],
                        },
                      },
                    },
                    required: ["heading", "sourcePages", "paragraphs", "keyTerms"],
                  },
                },
                rememberThis: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      text: { type: "STRING" },
                      evidence: { type: "ARRAY", items: evidenceSchema },
                    },
                    required: ["text", "evidence"],
                  },
                },
                flashcards: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      question: { type: "STRING" },
                      answer: { type: "STRING" },
                      sourcePages: { type: "ARRAY", items: { type: "INTEGER" } },
                      evidence: { type: "ARRAY", items: evidenceSchema },
                    },
                    required: ["question", "answer", "sourcePages", "evidence"],
                  },
                },
                quickTestQuestions: {
                  type: "ARRAY",
                  items: {
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
                  },
                },
                insufficientInformation: { type: "BOOLEAN" },
              },
              required: ["title", "intro", "introEvidence", "sections", "rememberThis", "flashcards", "quickTestQuestions", "insufficientInformation"],
            },
          },
        }),
    });

    // Try each model in order. Overloaded (503/500) and rate-limited (429) answers are retried
    // with a short wait; an unknown model (404) moves on to the next one. 400/403 stop at once.
    const startedAt = Date.now();
    let geminiResponse: Response | null = null;
    let lastStatus = 0;
    let lastModel = models[0];

    outer: for (const model of models) {
      lastModel = model;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (Date.now() - startedAt > 150_000) break outer;
        const response = await callGemini(model).catch((fetchError: unknown) => {
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
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 4_000 * (attempt + 1)));
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
              ? `Gemini is overloaded right now (HTTP ${lastStatus} on ${lastModel}). Wait a few minutes and try again, or add a second model to GEMINI_MODEL, e.g. "gemini-3.8-flash,gemini-3.5-flash-lite".`
              : `Gemini did not answer (last status ${lastStatus || "no response"} on ${lastModel}). Please try again.`;
      return Response.json({ error: message }, { status: lastStatus === 429 ? 429 : 502 });
    }

    const result = await geminiResponse.json() as GeminiResponse;
    const responseText = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!responseText) throw new Error("Gemini returned an empty lesson.");

    const sourceByPage = new Map(pages.map((page) => [page.pageNumber, page.text]));
    const generated = JSON.parse(responseText) as Partial<GeneratedLesson>;
    if (
      typeof generated.title !== "string" || typeof generated.intro !== "string" ||
      !Array.isArray(generated.sections) || !Array.isArray(generated.rememberThis) ||
      !Array.isArray(generated.flashcards) ||
      !Array.isArray(generated.quickTestQuestions) ||
      typeof generated.insufficientInformation !== "boolean"
    ) {
      throw new Error("Gemini returned an invalid lesson structure.");
    }

    const introEvidence = verifiedEvidencePages(generated.introEvidence, sourceByPage);
    const sections = generated.insufficientInformation ? [] : generated.sections.flatMap((section) => {
      if (
        typeof section !== "object" || section === null || typeof section.heading !== "string" ||
        !Array.isArray(section.paragraphs) || !Array.isArray(section.keyTerms)
      ) return [];

      const paragraphs = section.paragraphs.flatMap((paragraph) => {
        if (typeof paragraph !== "object" || paragraph === null || !("text" in paragraph) || !("evidence" in paragraph)) return [];
        const supportedParagraph = paragraph as { text: unknown; evidence: unknown };
        if (typeof supportedParagraph.text !== "string" || !supportedParagraph.text.trim()) return [];
        const sourcePages = verifiedEvidencePages(supportedParagraph.evidence, sourceByPage);
        return sourcePages.length ? [{ text: supportedParagraph.text.trim(), sourcePages }] : [];
      }).slice(0, 4);
      const keyTerms = section.keyTerms.flatMap((keyTerm) => {
        if (
          typeof keyTerm !== "object" || keyTerm === null ||
          typeof keyTerm.term !== "string" || typeof keyTerm.definition !== "string" || !("evidence" in keyTerm)
        ) return [];
        const sourcePages = verifiedEvidencePages(keyTerm.evidence, sourceByPage);
        return sourcePages.length
          ? [{ term: keyTerm.term.trim(), definition: keyTerm.definition.trim(), sourcePages }]
          : [];
      }).filter((keyTerm) => keyTerm.term && keyTerm.definition).slice(0, 8);
      const sourcePages = [...new Set([...paragraphs, ...keyTerms].flatMap((item) => item.sourcePages))]
        .sort((first, second) => first - second);

      if (!section.heading.trim() || !paragraphs.length || !sourcePages.length) return [];
      return [{
        heading: section.heading.trim(),
        paragraphs: paragraphs.map((paragraph) => paragraph.text),
        keyTerms: keyTerms.map(({ term, definition }) => ({ term, definition })),
        sourcePages,
      }];
    }).slice(0, 6);

    const rememberThis = generated.insufficientInformation ? [] : generated.rememberThis.flatMap((item) => {
      if (typeof item !== "object" || item === null || !("text" in item) || !("evidence" in item)) return [];
      const point = item as { text: unknown; evidence: unknown };
      if (typeof point.text !== "string" || !point.text.trim()) return [];
      return verifiedEvidencePages(point.evidence, sourceByPage).length ? [point.text.trim()] : [];
    }).slice(0, 4);

    const flashcards = generated.insufficientInformation ? [] : generated.flashcards.flatMap((item) => {
      if (
        typeof item !== "object" || item === null || typeof item.question !== "string" ||
        typeof item.answer !== "string" || !Array.isArray(item.sourcePages)
      ) return [];

      const evidencePages = verifiedEvidencePages(item.evidence, sourceByPage);
      const sourcePages = [...new Set(item.sourcePages.filter(
        (pageNumber): pageNumber is number => typeof pageNumber === "number" &&
          Number.isInteger(pageNumber) && evidencePages.includes(pageNumber),
      ))].sort((first, second) => first - second);
      if (
        item.question.trim().length < 8 || item.answer.trim().length < 3 ||
        !sourcePages.length || item.question.length > 260 || item.answer.length > 500
      ) return [];

      return [{ question: item.question.trim(), answer: item.answer.trim(), sourcePages }];
    }).filter((card, index, cards) => cards.findIndex(
      (candidate) => normalizeEvidenceText(candidate.question) === normalizeEvidenceText(card.question),
    ) === index).slice(0, 10);

    const generatedQuestions = generated.insufficientInformation ? [] : generated.quickTestQuestions.flatMap((item) => {
      if (
        typeof item !== "object" || item === null || typeof item.topic !== "string" ||
        typeof item.concept !== "string" ||
        !(item.difficulty === "easy" || item.difficulty === "medium" || item.difficulty === "challenging") ||
        typeof item.question !== "string" || !Array.isArray(item.options) ||
        !item.options.every((option) => typeof option === "string") || item.options.length !== 4 ||
        typeof item.correctAnswer !== "number" || !Number.isInteger(item.correctAnswer) ||
        item.correctAnswer < 0 || item.correctAnswer > 3 || typeof item.explanation !== "string" ||
        !Array.isArray(item.sourcePages)
      ) return [];

      const questionPages = verifiedEvidencePages(item.questionEvidence, sourceByPage);
      const explanationPages = verifiedEvidencePages(item.explanationEvidence, sourceByPage);
      const evidencePages = new Set([...questionPages, ...explanationPages]);
      const sourcePages = [...new Set(item.sourcePages.filter(
        (pageNumber): pageNumber is number => typeof pageNumber === "number" &&
          Number.isInteger(pageNumber) && evidencePages.has(pageNumber),
      ))].sort((first, second) => first - second);
      const options = item.options.map((option) => option.trim());

      if (
        !item.topic.trim() || !item.concept.trim() || !item.question.trim() ||
        !item.explanation.trim() || item.question.length > 500 || item.explanation.length > 800 ||
        !questionPages.length || !explanationPages.length || !sourcePages.length ||
        options.some((option) => !option) || new Set(options.map(normalizeEvidenceText)).size !== 4
      ) return [];

      return [{
        topic: item.topic.trim(),
        concept: item.concept.trim(),
        difficulty: item.difficulty as QuickTestQuestion["difficulty"],
        question: item.question.trim(),
        options,
        correctAnswer: item.correctAnswer,
        explanation: item.explanation.trim(),
        sourcePages,
      }];
    }).filter((question, index, questions) => questions.findIndex(
      (candidate) => normalizeEvidenceText(candidate.concept) === normalizeEvidenceText(question.concept),
    ) === index).slice(0, 5);
    const quickTestQuestions = generatedQuestions.length === 5 ? generatedQuestions : [];

    const lesson: StructuredLesson = {
      title: generated.title.trim(),
      intro: generated.intro.trim(),
      introSourcePages: introEvidence,
      sections,
      rememberThis,
      flashcards,
      quickTestQuestions,
      insufficientInformation: generated.insufficientInformation,
    };

    if (!lesson.title || !lesson.intro) throw new Error("Gemini returned an incomplete lesson.");

    if (!lesson.insufficientInformation && (!introEvidence.length || !lesson.sections.length)) {
      return Response.json({
        title: "More source detail needed",
        intro: "The uploaded material does not provide enough directly verifiable information to build a cited lesson. Try a text-based packet with more explanation.",
        introSourcePages: [],
        sections: [],
        rememberThis: [],
        flashcards: [],
        quickTestQuestions: [],
        insufficientInformation: true,
      });
    }

    return Response.json({
      title: lesson.title,
      intro: lesson.intro,
      introSourcePages: lesson.introSourcePages,
      sections: lesson.sections,
      rememberThis: lesson.rememberThis,
      flashcards: lesson.flashcards,
      quickTestQuestions: lesson.quickTestQuestions,
      insufficientInformation: lesson.insufficientInformation,
    });
  } catch (caughtError) {
    console.error(
      "A&P lesson generation failed:",
      caughtError instanceof Error ? caughtError.message : "Unknown response error",
    );
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