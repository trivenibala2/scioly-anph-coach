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
  sections: LessonSection[];
  rememberThis: string[];
  insufficientInformation: boolean;
};

type GeneratedLesson = {
  title: string;
  intro: string;
  introEvidence: EvidenceQuote[];
  sections: GeneratedSection[];
  rememberThis: Array<{ text: string; evidence: EvidenceQuote[] }>;
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

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are a careful Science Olympiad Anatomy & Physiology teacher. The uploaded PDF text is the only authoritative source. Never use outside knowledge or fill gaps. If a PDF page only names an organ or term, do not add its function, definition, location, or other facts unless the PDF states them. Preserve scientific terminology and explain only supported details at an age-appropriate level. Do not add importance claims, adjectives such as vital or crucial, or descriptions absent from the source. Write a concise lesson for about five minutes: a short intro, then 3 to 5 teaching sections with natural explanatory paragraphs, not bullets or a wall of text. Include important terms only when the PDF supports their definitions. For the intro, every paragraph, every key-term definition, and every Remember This point, include an evidence quote copied exactly from a supplied page and its page number. Each quote must directly support all factual claims in that item; if no quote supports it, omit the item. The server checks these quotes against the PDF. Every section must cite the pages supporting its content. End with 2 to 4 short Remember This points. If the PDF does not provide enough information, set insufficientInformation to true, explicitly say in intro that the uploaded material does not provide enough information, and leave sections and rememberThis empty. Return only JSON matching the schema; never HTML or Markdown.",
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
                insufficientInformation: { type: "BOOLEAN" },
              },
              required: ["title", "intro", "introEvidence", "sections", "rememberThis", "insufficientInformation"],
            },
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      return Response.json(
        { error: geminiResponse.status === 429 ? "The lesson service is busy. Wait a moment and try again." : "Gemini could not create a lesson. Check the server API key and try again." },
        { status: geminiResponse.status === 429 ? 429 : 502 },
      );
    }

    const result = await geminiResponse.json() as GeminiResponse;
    const responseText = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!responseText) throw new Error("Gemini returned an empty lesson.");

    const sourceByPage = new Map(pages.map((page) => [page.pageNumber, page.text]));
    const generated = JSON.parse(responseText) as Partial<GeneratedLesson>;
    if (
      typeof generated.title !== "string" || typeof generated.intro !== "string" ||
      !Array.isArray(generated.sections) || !Array.isArray(generated.rememberThis) ||
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

    const lesson: StructuredLesson = {
      title: generated.title.trim(),
      intro: generated.intro.trim(),
      sections,
      rememberThis,
      insufficientInformation: generated.insufficientInformation,
    };

    if (
      !lesson.title || !lesson.intro ||
      (!lesson.insufficientInformation && (!introEvidence.length || !lesson.sections.length))
    ) {
      throw new Error("Gemini returned incomplete or unsupported lesson content.");
    }

    return Response.json({
      title: lesson.title,
      intro: lesson.intro,
      sections: lesson.sections,
      rememberThis: lesson.rememberThis,
      insufficientInformation: lesson.insufficientInformation,
    });
  } catch {
    return Response.json({ error: "We couldn’t create a lesson just now. Please try again." }, { status: 502 });
  }
}