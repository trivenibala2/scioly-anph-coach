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
  flashcards: StudyFlashcard[];
  testQuestions: QuickTestQuestion[];
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
  flashcards: Array<{
    question: string;
    answer: string;
    sourcePages: number[];
    evidence: EvidenceQuote[];
  }>;
  testQuestions: Array<{
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
};

type LessonVisual = {
  title: string;
  purpose: string;
  visualPrompt: string;
  sourcePages: number[];
  sourceQuotes: string[];
  type: "anatomy_diagram" | "concept_diagram" | "process_diagram";
  imageUrl?: string;
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

type GeneratedVisual = {
  title: string;
  purpose: string;
  visualPrompt: string;
  sourcePages: number[];
  sourceQuotes: string[];
  type: "anatomy_diagram" | "concept_diagram" | "process_diagram";
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
  visuals: GeneratedVisual[];
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
           //   text: "You are a careful Science Olympiad Anatomy & Physiology teacher. The uploaded PDF text is the only authoritative source. Never use outside knowledge or fill gaps. If a PDF page only names an organ or term, do not add its function, definition, location, or other facts unless the PDF states them. Preserve scientific terminology and explain only supported details at an age-appropriate level. Do not add importance claims, adjectives such as vital or crucial, or descriptions absent from the source. Write a concise lesson for about five minutes: a short intro, then 3 to 5 teaching sections with natural explanatory paragraphs, not bullets or a wall of text. Include important terms only when the PDF supports their definitions. For the intro, every paragraph, every key-term definition, and every Remember This point, include an evidence quote copied exactly from a supplied page and its page number. Each quote must directly support all factual claims in that item; if no quote supports it, omit the item. The server checks these quotes against the PDF. Every section must cite the pages supporting its content. End with 2 to 4 short Remember This points. Also create 8 to 10 high-value flashcards for this lesson when the source supports that many distinct concepts. Each card tests one important concept, has a short scientifically accurate answer, does not repeat another card, and includes source page numbers plus exact evidence quotes for both its question and answer. Build cards from the lesson and supplied PDF together; never pad the set with unsupported or trivial facts. Create exactly five multiple-choice questions for a separate Quick Test using only supported facts in the lesson and PDF. Test understanding, mix easy, medium, and challenging, use four distinct plausible options, one correct option, and avoid ambiguity and repeated concepts. Give every question a topic and specific concept label. Include a brief explanation and separate exact evidence quotes for both question and explanation, with source pages present for both. If five distinct questions cannot be supported, return an empty quickTestQuestions array instead of inventing. If the PDF does not provide enough information, set insufficientInformation to true, explicitly say in intro that the uploaded material does not provide enough information, and leave sections, rememberThis, flashcards, and quickTestQuestions empty. Return only JSON matching the schema; never HTML or Markdown.",
                text: `You are a careful Science Olympiad Anatomy & Physiology teacher creating a student study package from the supplied PDF.

SOURCE AUTHORITY:
The supplied PDF is the only authoritative source. Use only information explicitly supported by the supplied PDF content. Never use outside knowledge, memory, assumptions, or general anatomy knowledge to fill gaps.

If the PDF names a structure or term without explaining it, do not add its function, definition, location, importance, or other facts unless the PDF provides them.

Preserve the scientific terminology and meaning used in the PDF. Explain supported information at an age-appropriate level.

Do not add importance claims, adjectives such as "vital" or "crucial", or descriptions that are not supported by the PDF.

FULL-PACKET COVERAGE:
Represent the ENTIRE supplied packet faithfully. Your goal is to teach every concept the packet teaches, so a student who reads your lesson has seen all the material in the packet.

Do NOT focus on only one small portion of the PDF. Do NOT drop a module, a numbered subsection, a table, or a labeled diagram just to be brief.

The packet is usually organized into numbered Modules (for example "Module 1", "Module 2", "Module 3") with numbered subsections (for example 1.1, 1.2, 1.3). Follow that structure. Turn each numbered subsection (or a small group of closely related subsections) into its own teaching section, and keep the packet's teaching order.

If the packet contains tables (for example a table of jobs, parts, cartilages, or muscles), convert every row into clear explanatory sentences or key terms so no row is lost. Tables carry heavily tested facts; never skip them.

The packet includes helpful study callouts such as "Remember it" (a mnemonic), "Test tip" (what tests like to ask), and "Stop and check" (a self-quiz). When a mnemonic or test tip is given, include it in the relevant section exactly as support allows, because students rely on these. Do not invent new mnemonics.

A packet often ends with its own flashcards, a quiz, and an answer key. Treat these as authoritative source material you SHOULD mine when building each section's flashcards and test questions — but map every mined card or question to the specific module/section whose content it tests. Do not treat a repeated answer key or a repeated flashcard as a brand-new concept.

Do not copy the packet word-for-word. Rephrase into a coherent, student-friendly lesson while keeping every scientific fact and term the packet supports.

LESSON:
Create a comprehensive lesson that covers ALL content from the supplied PDF material in a student-friendly, easy-to-understand format suitable for middle and high school students (Science Olympiad Division B/C).

Break the content into clear, digestible reading sections that mirror the packet's own modules and numbered subsections. Each section should be one focused topic that a student can read and understand in a single short study session (about 5 to 8 minutes).

Start with a short introduction that previews every module the student will work through, in order.

Then create one teaching section per numbered subsection of the packet (or per small group of tightly related subsections). Do not limit the number of sections — if the packet has 15 subsections of real teaching content, create about that many sections. It is far better to have many short, focused sections than a few long ones. Cover every module and every subsection.

Name each section clearly, ideally echoing the packet's own module/subsection title (for example "Module 1 · Why We Breathe", "The Nose and Nasal Cavity", "The Larynx — Voice Box") so students can match it to the packet.

Each section will be displayed on its own page with "Next" navigation, so students progress through the material one module at a time at their own pace.

READING LEVEL — WRITE FOR A 13-YEAR-OLD:
Write every section so an average 13-year-old (about 7th to 8th grade reading level) can read it easily and enjoy it. This is the most important style rule.

- Use short, plain sentences. Aim for about 12 to 18 words per sentence. Break long sentences into two.
- Use everyday words instead of textbook words whenever the meaning is the same. For example, prefer "makes" over "produces", "lets" over "facilitates", "job" over "function", "tiny" over "microscopic", "move air in and out" over "pulmonary ventilation" (then name the scientific term once).
- When you must use a scientific term (because the PDF teaches it and the student needs it), introduce it in a friendly way: say what it means in plain words first, then give the term. Example: "the main breathing muscle under your lungs, called the diaphragm".
- Explain hard ideas with simple, concrete comparisons to things a kid already knows, but ONLY when the comparison does not add any new fact beyond what the PDF supports. If you cannot make a safe comparison, just explain it plainly.
- Use a warm, encouraging second-person voice ("you breathe in", "your lungs"). It is fine to speak directly to the student.
- Keep paragraphs short: 2 to 4 sentences each. Do not write one giant wall of text, and do not write the lesson as a list of bullets.
- Keep each section focused and manageable - a student should be able to read and understand one section in about 5 to 8 minutes.

SIMPLIFY WITHOUT CHANGING THE FACTS:
Rephrasing for simplicity must never add, exaggerate, or change meaning. Do not add importance words such as "vital", "crucial", or "amazing" unless the PDF uses them. Do not add any fact, number, cause, or relationship that the PDF does not state. Simpler wording of the SAME supported fact is the goal; a simpler-sounding but unsupported claim is not allowed. Your evidence quote must still support the simplified sentence.

Use key terms only when the supplied PDF supports their meaning or definition. Write each key-term definition in one short, plain sentence a 13-year-old would understand, while keeping it accurate to the PDF.

For the intro, every paragraph, every key-term definition, and every Remember This point must have exact evidence copied from the supplied PDF and the page number supporting it.

Each evidence quote must directly support the factual claims in that item.

If a claim cannot be directly supported by supplied evidence, remove the claim rather than guessing.

Every section must include accurate source page numbers for the information presented in that section.

End with 2 to 4 short Remember This points.

Every Remember This point must have supporting evidence.

SOURCE EVIDENCE:
Every evidence quote MUST be copied exactly from the page's selectable TEXT, with its correct page number. The application verifies each quote against the extracted page text, so a quote that appears only inside a diagram image (not in the page text) will be rejected and its item dropped.

You may use diagrams and labeled figures to understand and explain the material, but when you state a fact, support it with a quote from the page text. If a fact is shown only in a figure and is not written anywhere in the text, do not present it as a cited claim.

Do not paraphrase an evidence quote. Do not invent an evidence quote. Do not use a quote that only partially supports the factual claim.

FLASHCARDS PER SECTION:
For each teaching section (module), create 3 to 6 high-value flashcards that test the key concepts covered in THAT SPECIFIC SECTION ONLY. This mirrors how the packet groups its own flashcards by module.

Build these flashcards from the section content, the supplied PDF pages referenced in that section, and — when the packet includes its own flashcards or quiz questions on that topic — from those as well. Prefer mining the packet's own flashcards and quiz items for the matching module over inventing new ones.

Each card should test one important concept from that section, have a short scientifically accurate answer, avoid repeating another card, and avoid trivial facts.

Every flashcard must include source page numbers and exact evidence supporting the information on the card.

The flashcards must be returned inside their section's data, not only as a separate global array.

SECTION TEST QUESTIONS:
For each teaching section (module), create 2 to 3 multiple-choice test questions that assess understanding of THAT SPECIFIC SECTION ONLY. This is the "module test" a student takes right after reading that module.

When the packet contains its own quiz questions (and an answer key) covering that module, adapt those questions and use the answer key's correct answer and its "why" as your explanation. Only invent a question when the packet does not already supply enough for that module.

Use only facts explicitly supported by the supplied PDF pages and section content.

Mix easy and medium difficulty questions for each section.

These per-section test questions are in addition to the global quick test questions.

GLOBAL QUICK TEST:
Also create exactly five multiple-choice questions for a separate end-of-week Quick Test that spans the whole packet.

Draw these FIRST from the packet's own quiz and answer key. If the packet includes a quiz, select five of its multiple-choice questions that span different modules, and use the matching answer-key entry to set the correct option and to write the explanation (the answer key's "why"). Only write an original question when the packet's quiz does not supply enough usable multiple-choice items.

The five questions should represent different concepts from across the packet. Mix easy, medium, and challenging questions.

Every test question — section-level and global — must have:
- one clear question
- four distinct plausible options
- exactly one correct answer
- a topic
- a specific concept label
- a brief explanation
- source pages
- exact evidence supporting the question
- exact evidence supporting the explanation

Avoid ambiguity, trick wording, duplicate concepts, and questions that depend on outside knowledge.

If five distinct questions cannot be supported by the supplied material, return an empty quickTestQuestions array instead of inventing questions.

VISUAL CONTENT IN THE PDF:
The supplied PDF may contain diagrams, illustrations, labeled anatomy figures, tables, charts, practice diagrams, captions, or other visual information that is important to learning.

Do NOT assume that information not present in extracted text is absent from the PDF.

When visual content is actually supplied and readable, use information explicitly shown in that visual as source-supported information.

If a diagram labels a structure or shows a relationship that is not stated in the surrounding extracted text, that visual information may be used because it is part of the supplied PDF.

However, never infer additional anatomy, functions, relationships, labels, terminology, or medical details that are not explicitly supported by the supplied PDF.

If a visual is unclear or unreadable, do not guess what it contains.

Some packets include blank practice or "label-it" worksheets: diagrams with empty numbered boxes or blank lines and no answers filled in. These contain NO factual information. Do not treat their numbered blanks as real structures, and do not invent the labels they are asking the student to supply.

USEFUL DIAGRAMS IN THE PACKET:
The application does NOT generate new illustrations. Instead, it shows the student the packet's OWN diagrams by rendering the actual uploaded PDF pages. Your job here is only to point at which existing PDF page holds the diagram that best helps each concept.

When the packet contains a diagram, figure, labeled anatomy illustration, chart, or process diagram that would significantly help a student understand a concept, add an entry to the visuals array that names it and records the page it appears on.

Do not point at a page merely for decoration, and do not point at blank practice/label-it worksheets (they have no answers).

For each useful diagram, return:
- title: the diagram's heading or a short name for it (for example "Air path: 15 stops" or "Right vs left lung")
- purpose: one sentence on what the student should notice in it
- visualPrompt: a short description of what the existing packet figure actually shows (not an instruction to generate anything new)
- sourcePages: the PDF page number(s) where this diagram appears
- sourceQuotes: exact text near or inside the figure that identifies it (for example its caption or title)
- type: anatomy_diagram, concept_diagram, or process_diagram

Only include a diagram that actually exists in the supplied PDF. If the packet has no useful diagrams, return an empty visuals array.

SOURCE PAGE VIEWING:
Every visuals entry must include accurate sourcePages so the application can render that original PDF page for the student. Do not recreate, modify, summarize, or invent the page; the application displays the real uploaded PDF page.

INSUFFICIENT INFORMATION:
If the supplied PDF does not provide enough information to create a reliable study package, set insufficientInformation to true.

When insufficientInformation is true:
- explicitly state in the intro that the supplied material does not provide enough information
- return empty sections
- return empty rememberThis
- return empty flashcards
- return empty quickTestQuestions
- return empty visuals

Do not invent missing information.

OUTPUT:
Return only JSON matching the supplied response schema.

Never return HTML, SVG, Mermaid, ASCII art, Markdown, commentary, or explanations outside the JSON.`    
           }],
          },
          contents: [{
            role: "user",
            parts: [
              {
                text: pdfPart
                  ? "Build the study package from the attached PDF. Read its diagrams and labeled figures as well as its text. The page-numbered text below is provided so your page citations line up with the application's source checks; cite the same page numbers."
                  : "Make the lesson from this extracted PDF text.",
              },
              ...(pdfPart ? [pdfPart] : []),
              { text: `Page-numbered text:\n\n${sourceText}` },
            ],
          }],
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 65_536,
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
                      testQuestions: {
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
                    },
                    required: ["heading", "sourcePages", "paragraphs", "keyTerms", "flashcards", "testQuestions"],
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
                visuals: {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING" },
      purpose: { type: "STRING" },
      visualPrompt: { type: "STRING" },
      sourcePages: {
        type: "ARRAY",
        items: { type: "INTEGER" },
      },
      sourceQuotes: {
        type: "ARRAY",
        items: { type: "STRING" },
      },
      type: {
        type: "STRING",
        enum: ["anatomy_diagram", "concept_diagram", "process_diagram"],
      },
    },
    required: [
      "title",
      "purpose",
      "visualPrompt",
      "sourcePages",
      "sourceQuotes",
      "type",
    ],
  },
},
                insufficientInformation: { type: "BOOLEAN" },
              },
              required: ["title", "intro", "introEvidence", "sections", "rememberThis", "flashcards", "quickTestQuestions", "visuals", "insufficientInformation"],
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
      !Array.isArray(generated.visuals) ||
      typeof generated.insufficientInformation !== "boolean"
    ) {
      throw new Error("Gemini returned an invalid lesson structure.");
    }

    const introEvidence = verifiedEvidencePages(generated.introEvidence, sourceByPage);
    const sections = generated.insufficientInformation ? [] : generated.sections.flatMap((section) => {
      if (
        typeof section !== "object" || section === null || typeof section.heading !== "string" ||
        !Array.isArray(section.paragraphs) || !Array.isArray(section.keyTerms) ||
        !Array.isArray(section.flashcards) || !Array.isArray(section.testQuestions)
      ) return [];

      const paragraphs = section.paragraphs.flatMap((paragraph) => {
        if (typeof paragraph !== "object" || paragraph === null || !("text" in paragraph) || !("evidence" in paragraph)) return [];
        const supportedParagraph = paragraph as { text: unknown; evidence: unknown };
        if (typeof supportedParagraph.text !== "string" || !supportedParagraph.text.trim()) return [];
        const sourcePages = verifiedEvidencePages(supportedParagraph.evidence, sourceByPage);
        return sourcePages.length ? [{ text: supportedParagraph.text.trim(), sourcePages }] : [];
      }).slice(0, 6);
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

      const sectionFlashcards = section.flashcards.flatMap((item) => {
        if (
          typeof item !== "object" || item === null || typeof item.question !== "string" ||
          typeof item.answer !== "string" || !Array.isArray(item.sourcePages)
        ) return [];

        const evidencePages = verifiedEvidencePages(item.evidence, sourceByPage);
        const cardSourcePages = [...new Set(item.sourcePages.filter(
          (pageNumber): pageNumber is number => typeof pageNumber === "number" &&
            Number.isInteger(pageNumber) && evidencePages.includes(pageNumber),
        ))].sort((first, second) => first - second);
        if (
          item.question.trim().length < 8 || item.answer.trim().length < 3 ||
          !cardSourcePages.length || item.question.length > 260 || item.answer.length > 500
        ) return [];

        return [{ question: item.question.trim(), answer: item.answer.trim(), sourcePages: cardSourcePages }];
      }).slice(0, 6);

      const sectionTestQuestions = section.testQuestions.flatMap((item) => {
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
        const testSourcePages = [...new Set(item.sourcePages.filter(
          (pageNumber): pageNumber is number => typeof pageNumber === "number" &&
            Number.isInteger(pageNumber) && evidencePages.has(pageNumber),
        ))].sort((first, second) => first - second);
        const options = item.options.map((option) => option.trim());

        if (
          !item.topic.trim() || !item.concept.trim() || !item.question.trim() ||
          !item.explanation.trim() || item.question.length > 500 || item.explanation.length > 800 ||
          !questionPages.length || !explanationPages.length || !testSourcePages.length ||
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
          sourcePages: testSourcePages,
        }];
      }).slice(0, 3);

      const sourcePages = [...new Set([...paragraphs, ...keyTerms].flatMap((item) => item.sourcePages))]
        .sort((first, second) => first - second);

      if (!section.heading.trim() || !paragraphs.length || !sourcePages.length) return [];
      return [{
        heading: section.heading.trim(),
        paragraphs: paragraphs.map((paragraph) => paragraph.text),
        keyTerms: keyTerms.map(({ term, definition }) => ({ term, definition })),
        sourcePages,
        flashcards: sectionFlashcards,
        testQuestions: sectionTestQuestions,
      }];
    }).slice(0, 20);

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

    const visuals = generated.insufficientInformation ? [] : generated.visuals.flatMap((item) => {
      if (
        typeof item !== "object" || item === null || typeof item.title !== "string" ||
        typeof item.purpose !== "string" || typeof item.visualPrompt !== "string" ||
        !Array.isArray(item.sourcePages) || !Array.isArray(item.sourceQuotes) ||
        !(item.type === "anatomy_diagram" || item.type === "concept_diagram" || item.type === "process_diagram")
      ) return [];

      const validSourcePages = item.sourcePages.filter(
        (pageNumber): pageNumber is number => typeof pageNumber === "number" &&
          Number.isInteger(pageNumber) && sourceByPage.has(pageNumber)
      );
      const validSourceQuotes = item.sourceQuotes.filter(
        (quote): quote is string => typeof quote === "string" && quote.trim().length > 0
      );

      if (
        !item.title.trim() || !item.purpose.trim() || !item.visualPrompt.trim() ||
        !validSourcePages.length || !validSourceQuotes.length
      ) return [];

      return [{
        title: item.title.trim(),
        purpose: item.purpose.trim(),
        visualPrompt: item.visualPrompt.trim(),
        sourcePages: validSourcePages.sort((a, b) => a - b),
        sourceQuotes: validSourceQuotes,
        type: item.type,
      }];
    }).slice(0, 10);

    const lesson: StructuredLesson = {
      title: generated.title.trim(),
      intro: generated.intro.trim(),
      introSourcePages: introEvidence,
      sections,
      rememberThis,
      flashcards,
      quickTestQuestions,
      visuals,
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
        visuals: [],
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
      visuals: lesson.visuals,
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