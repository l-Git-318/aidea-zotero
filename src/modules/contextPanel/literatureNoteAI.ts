/** Bounded-retrieval AI helpers for Literature Notes. */
import { callLLM } from "../../utils/llmClient";
import {
  buildReaderDocumentContext,
  ensureDocumentContext,
  resolveReaderDocument,
} from "./documentContext";
import type { LiteratureNoteSection } from "./notes";

const FILLABLE_SECTIONS: LiteratureNoteSection[] = [
  "question",
  "system",
  "key-findings",
  "evidence",
  "limitations",
  "reusable-info",
];

const sectionLabels: Record<LiteratureNoteSection, string> = {
  question: "Question",
  system: "System",
  "key-findings": "Key findings",
  evidence: "Evidence",
  limitations: "Limitations",
  "use-for-my-project": "Use for my project",
  "reusable-info": "Reusable info",
  questions: "Questions / Follow-up",
};

export function getAutoFillableLiteratureNoteSections(): LiteratureNoteSection[] {
  return [...FILLABLE_SECTIONS];
}

export async function generateLiteratureNoteSection(params: {
  item: Zotero.Item;
  section: LiteratureNoteSection;
  existingText?: string;
  language: "zh-CN" | "en";
}): Promise<string> {
  const { item, section, existingText = "", language } = params;
  if (!FILLABLE_SECTIONS.includes(section)) {
    throw new Error(`${sectionLabels[section]} requires user input`);
  }
  const document = resolveReaderDocument(item);
  if (!document) throw new Error("No readable document context is available");
  const context = await ensureDocumentContext(document);
  const question = `Extract evidence for the Literature Note section: ${sectionLabels[section]}`;
  const boundedContext = await buildReaderDocumentContext(
    document,
    context || undefined,
    question,
    false,
    undefined,
    { maxChunks: 6, maxLength: 12000 },
  );
  if (!boundedContext.trim()) {
    throw new Error("No retrievable document context is available");
  }
  return callLLM({
    context: boundedContext,
    prompt: [
      `Write only the ${sectionLabels[section]} section for a Literature Note.`,
      language === "zh-CN"
        ? "Write the answer in Simplified Chinese."
        : "Write the answer in English.",
      "Use only the supplied retrieval excerpts. Do not invent DOI, methods, results, figures, or conclusions.",
      "For uncertain claims, explicitly say that the excerpt does not confirm them.",
      section === "evidence"
        ? "For each claim, retain page, section, figure, or result references when an excerpt provides them."
        : "",
      existingText.trim()
        ? `Existing user text (preserve its intent; add only supported details):\n${existingText.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

/**
 * Discuss one note section with grounded paper excerpts. The caller decides
 * whether a response should be applied to the saved note text.
 */
export async function discussLiteratureNoteSection(params: {
  item: Zotero.Item;
  section: LiteratureNoteSection;
  noteText: string;
  question: string;
  language: "zh-CN" | "en";
}): Promise<string> {
  const { item, section, noteText, question, language } = params;
  const cleanQuestion = question.trim();
  if (!cleanQuestion) throw new Error("Ask a discussion question first");
  const document = resolveReaderDocument(item);
  if (!document) throw new Error("No readable document context is available");
  const context = await ensureDocumentContext(document);
  const boundedContext = await buildReaderDocumentContext(
    document,
    context || undefined,
    cleanQuestion,
    false,
    undefined,
    { maxChunks: 6, maxLength: 12000 },
  );
  if (!boundedContext.trim()) {
    throw new Error("No retrievable document context is available");
  }
  return callLLM({
    context: boundedContext,
    prompt: [
      `Discuss the Literature Note section: ${sectionLabels[section]}.`,
      language === "zh-CN"
        ? "Reply in Simplified Chinese."
        : "Reply in English.",
      "Answer the user's question directly and distinguish paper-supported claims from suggestions or uncertainty.",
      "Do not rewrite the note unless the user explicitly applies your response.",
      "When the excerpts support it, cite page, section, figure, or result references.",
      noteText.trim()
        ? `Current note section:\n${noteText.trim()}`
        : "Current note section is blank.",
      `User question:\n${cleanQuestion}`,
    ].join("\n\n"),
  });
}
