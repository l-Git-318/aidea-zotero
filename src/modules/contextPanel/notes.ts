import { renderMarkdownForNote } from "../../utils/markdown";
import { getZoteroItem } from "../../utils/zoteroItems";
import {
  sanitizeText,
  escapeNoteHtml,
  getCurrentLocalTimestamp,
} from "./textUtils";
import { MAX_SELECTED_IMAGES } from "./constants";
import {
  getTrackedAssistantNoteForParent,
  removeAssistantNoteMapEntry,
  rememberAssistantNoteForParent,
} from "./prefHelpers";
import type { Message } from "./types";
import { getPanelLang, type PanelLang } from "./i18n";

function resolveParentItemForNote(item: Zotero.Item): Zotero.Item | null {
  if (item.isAttachment() && item.parentID) {
    const parent = getZoteroItem(item.parentID);
    if (parent && parent.isRegularItem()) return parent;
    return null;
  }
  if (item.isRegularItem()) return item;
  return null;
}

function buildAssistantNoteHtml(
  contentText: string,
  modelName: string,
): string {
  const response = sanitizeText(contentText || "").trim();
  const source = modelName.trim() || "unknown";
  const timestamp = getCurrentLocalTimestamp();
  let responseHtml: string;
  try {
    // Use Zotero note-editor native math format so that note.setNote()
    // loads math correctly through ProseMirror's schema parser.
    responseHtml = renderMarkdownForNote(response);
  } catch (err) {
    ztoolkit.log("Note markdown render error:", err);
    responseHtml = escapeNoteHtml(response).replace(/\n/g, "<br/>");
  }
  return `<p><strong>${escapeNoteHtml(timestamp)}</strong></p><p><strong>${escapeNoteHtml(source)}:</strong></p><div>${responseHtml}</div><hr/><p>Written by AIdea plugin</p>`;
}

function renderChatMessageHtmlForNote(text: string): string {
  const safeText = sanitizeText(text || "").trim();
  if (!safeText) return "";
  try {
    // Reuse the same markdown-to-note rendering path as single-response save.
    return renderMarkdownForNote(safeText);
  } catch (err) {
    ztoolkit.log("Chat history markdown render error:", err);
    return escapeNoteHtml(safeText).replace(/\n/g, "<br/>");
  }
}

function normalizeScreenshotImagesForNote(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  for (const raw of images) {
    if (typeof raw !== "string") continue;
    const src = raw.trim();
    if (!src) continue;
    // Persist only embedded image data URLs; blob/object URLs are ephemeral.
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(src)) continue;
    out.push(src);
    if (out.length >= MAX_SELECTED_IMAGES) break;
  }
  return out;
}

function formatScreenshotEmbeddedLabel(count: number): string {
  return `Screenshots (${count}) are embedded below`;
}

function buildScreenshotImagesHtmlForNote(images: string[]): string {
  if (!images.length) return "";
  const label = formatScreenshotEmbeddedLabel(images.length);
  const blocks = images
    .map((src, index) => {
      const alt = `Screenshot ${index + 1}`;
      return `<p><img src="${escapeNoteHtml(src)}" alt="${escapeNoteHtml(alt)}"/></p>`;
    })
    .join("");
  return `<div><p>${escapeNoteHtml(label)}</p>${blocks}</div>`;
}

export function buildChatHistoryNotePayload(messages: Message[]): {
  noteHtml: string;
  noteText: string;
} {
  const timestamp = getCurrentLocalTimestamp();
  const textLines: string[] = [];
  const htmlBlocks: string[] = [];
  for (const msg of messages) {
    const text = sanitizeText(msg.text || "").trim();
    const screenshotImages = normalizeScreenshotImagesForNote(
      msg.screenshotImages,
    );
    const screenshotCount = screenshotImages.length;
    if (!text && !screenshotCount) continue;
    const speaker =
      msg.role === "user"
        ? "user"
        : sanitizeText(msg.modelName || "").trim() || "model";
    const screenshotHtml =
      msg.role === "user"
        ? buildScreenshotImagesHtmlForNote(screenshotImages)
        : "";
    const rendered = renderChatMessageHtmlForNote(text);
    if (!rendered && !screenshotHtml) continue;
    textLines.push(`${speaker}: ${text}`);
    const renderedBlock = rendered ? `<div>${rendered}</div>` : "";
    htmlBlocks.push(
      `<p><strong>${escapeNoteHtml(speaker)}:</strong></p>${renderedBlock}${screenshotHtml}`,
    );
  }
  const noteText = textLines.join("\n\n");
  const bodyHtml = htmlBlocks.join("<hr/>");
  return {
    noteText,
    noteHtml: `<p><strong>Chat history saved at ${escapeNoteHtml(timestamp)}</strong></p><div>${bodyHtml}</div><hr/><p>Written by AIdea plugin</p>`,
  };
}

function appendAssistantAnswerToNoteHtml(
  existingHtml: string,
  newAnswerHtml: string,
): string {
  const base = (existingHtml || "").trim();
  const addition = (newAnswerHtml || "").trim();
  if (!base) return addition;
  if (!addition) return base;
  return `${base}<hr/>${addition}`;
}

const SELECTION_TRANSLATION_NOTE_TITLE = "AIdea \u5212\u8bcd\u7ffb\u8bd1";

type SelectionTranslationNoteCopy = {
  original: string;
  translation: string;
  source: string;
  model: string;
  provider: string;
  time: string;
  currentPdf: string;
};

const SELECTION_TRANSLATION_NOTE_COPIES: Record<
  PanelLang,
  SelectionTranslationNoteCopy
> = {
  "en-US": {
    original: "Original",
    translation: "Translation",
    source: "Source",
    model: "Model",
    provider: "Provider",
    time: "Time",
    currentPdf: "Current PDF",
  },
  "zh-CN": {
    original: "\u539f\u6587",
    translation: "\u8bd1\u6587",
    source: "\u6765\u6e90",
    model: "\u6a21\u578b",
    provider: "\u63d0\u4f9b\u5546",
    time: "\u65f6\u95f4",
    currentPdf: "\u5f53\u524d PDF",
  },
  "zh-TW": {
    original: "原文",
    translation: "譯文",
    source: "來源",
    model: "模型",
    provider: "提供商",
    time: "時間",
    currentPdf: "目前 PDF",
  },
  "ja-JP": {
    original: "原文",
    translation: "翻訳",
    source: "出典",
    model: "モデル",
    provider: "プロバイダー",
    time: "時刻",
    currentPdf: "現在の PDF",
  },
  "ko-KR": {
    original: "원문",
    translation: "번역",
    source: "출처",
    model: "모델",
    provider: "제공자",
    time: "시간",
    currentPdf: "현재 PDF",
  },
  "fr-FR": {
    original: "Original",
    translation: "Traduction",
    source: "Source",
    model: "Modele",
    provider: "Fournisseur",
    time: "Heure",
    currentPdf: "PDF actuel",
  },
  "de-DE": {
    original: "Original",
    translation: "Uebersetzung",
    source: "Quelle",
    model: "Modell",
    provider: "Anbieter",
    time: "Zeit",
    currentPdf: "Aktuelles PDF",
  },
  "es-ES": {
    original: "Original",
    translation: "Traduccion",
    source: "Fuente",
    model: "Modelo",
    provider: "Proveedor",
    time: "Hora",
    currentPdf: "PDF actual",
  },
  "ru-RU": {
    original: "Оригинал",
    translation: "Перевод",
    source: "Источник",
    model: "Модель",
    provider: "Провайдер",
    time: "Время",
    currentPdf: "Текущий PDF",
  },
  "pt-BR": {
    original: "Original",
    translation: "Traducao",
    source: "Fonte",
    model: "Modelo",
    provider: "Provedor",
    time: "Hora",
    currentPdf: "PDF atual",
  },
  "ar-SA": {
    original: "النص الأصلي",
    translation: "الترجمة",
    source: "المصدر",
    model: "النموذج",
    provider: "المزود",
    time: "الوقت",
    currentPdf: "ملف PDF الحالي",
  },
  "hi-IN": {
    original: "मूल पाठ",
    translation: "अनुवाद",
    source: "स्रोत",
    model: "मॉडल",
    provider: "प्रदाता",
    time: "समय",
    currentPdf: "वर्तमान PDF",
  },
};

type SelectionTranslationNoteParams = {
  selectedText: string;
  translation: string;
  model: string;
  provider?: string;
  pageLabel?: string;
};

function getSelectionTranslationNoteCopy() {
  return (
    SELECTION_TRANSLATION_NOTE_COPIES[getPanelLang()] ||
    SELECTION_TRANSLATION_NOTE_COPIES["en-US"]
  );
}

function renderPlainTextForNote(text: string): string {
  const normalized = sanitizeText(text || "").trim();
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const body = escapeNoteHtml(paragraph.trim()).replace(/\n/g, "<br/>");
      return body ? `<p>${body}</p>` : "";
    })
    .filter(Boolean)
    .join("");
}

function renderTranslationTextForNote(text: string): string {
  const normalized = sanitizeText(text || "").trim();
  if (!normalized) return "";
  try {
    return renderMarkdownForNote(normalized);
  } catch (err) {
    ztoolkit.log("Selection translation note markdown render error:", err);
    return renderPlainTextForNote(normalized);
  }
}

function buildSelectionTranslationNoteEntryHtml(
  params: SelectionTranslationNoteParams,
): string {
  const copy = getSelectionTranslationNoteCopy();
  const timestamp = getCurrentLocalTimestamp();
  const originalHtml = renderPlainTextForNote(params.selectedText);
  const translationHtml = renderTranslationTextForNote(params.translation);
  const metaParts = [
    `${copy.source}: ${params.pageLabel || copy.currentPdf}`,
    `${copy.model}: ${params.model || "unknown"}`,
    params.provider ? `${copy.provider}: ${params.provider}` : "",
    `${copy.time}: ${timestamp}`,
  ]
    .filter(Boolean)
    .map((part) => escapeNoteHtml(part));

  return [
    `<p><strong>${escapeNoteHtml(copy.original)}</strong></p>`,
    `<blockquote>${originalHtml}</blockquote>`,
    `<p><strong>${escapeNoteHtml(copy.translation)}</strong></p>`,
    `<div>${translationHtml}</div>`,
    `<p><small>${metaParts.join(" · ")}</small></p>`,
  ].join("");
}

function isSelectionTranslationNote(note: Zotero.Item | null): boolean {
  if (!note || !note.isNote?.()) return false;
  try {
    return (note.getNote?.() || "").includes(SELECTION_TRANSLATION_NOTE_TITLE);
  } catch {
    return false;
  }
}

async function findSelectionTranslationNote(
  parentItem: Zotero.Item,
): Promise<Zotero.Item | null> {
  const noteIds = new Set<number>();
  try {
    const rawIds = await (parentItem as any).getNotes?.();
    if (Array.isArray(rawIds)) {
      for (const rawId of rawIds) {
        const id = Number(rawId);
        if (Number.isFinite(id) && id > 0) noteIds.add(Math.floor(id));
      }
    }
  } catch {
    /* fall back to library scan */
  }

  for (const noteId of noteIds) {
    const note = getZoteroItem(noteId);
    if (isSelectionTranslationNote(note)) return note;
  }

  try {
    const items = await Zotero.Items.getAll(
      parentItem.libraryID,
      true,
      false,
      false,
    );
    for (const item of items) {
      if (item.parentID !== parentItem.id) continue;
      if (isSelectionTranslationNote(item)) return item;
    }
  } catch (err) {
    ztoolkit.log("LLM: Failed to scan notes for selection translation", err);
  }
  return null;
}

export async function appendSelectionTranslationToNote(
  item: Zotero.Item,
  params: SelectionTranslationNoteParams,
): Promise<"created" | "appended"> {
  const parentItem = resolveParentItemForNote(item);
  if (!parentItem) {
    throw new Error("No parent item for selection translation note");
  }
  const entryHtml = buildSelectionTranslationNoteEntryHtml(params);
  const existingNote = await findSelectionTranslationNote(parentItem);
  if (existingNote) {
    const appendedHtml = appendAssistantAnswerToNoteHtml(
      existingNote.getNote?.() || "",
      entryHtml,
    );
    existingNote.setNote(appendedHtml);
    await existingNote.saveTx();
    ztoolkit.log(
      `LLM: Appended selection translation to note ${existingNote.id} for parent ${parentItem.id}`,
    );
    return "appended";
  }

  const note = new Zotero.Item("note");
  note.libraryID = parentItem.libraryID;
  note.parentID = parentItem.id;
  note.setNote(
    `<p><strong>${escapeNoteHtml(SELECTION_TRANSLATION_NOTE_TITLE)}</strong></p><hr/>${entryHtml}`,
  );
  await note.saveTx();
  ztoolkit.log(
    `LLM: Created selection translation note ${note.id} for parent ${parentItem.id}`,
  );
  return "created";
}

export async function createNoteFromAssistantText(
  item: Zotero.Item,
  contentText: string,
  modelName: string,
): Promise<"created" | "appended"> {
  const parentItem = resolveParentItemForNote(item);
  const parentId = parentItem?.id;

  // Always render from the plain-text / markdown source via
  // renderMarkdownForNote.  This produces clean HTML that Zotero's
  // ProseMirror note-editor can reliably parse.  (The previous approach
  // of injecting rendered DOM HTML from the bubble was fragile — KaTeX
  // span trees and sanitised classless wrappers were mostly dropped by
  // ProseMirror.)
  const html = buildAssistantNoteHtml(contentText, modelName);

  // Try to find an existing tracked note for this parent item.
  // If one exists and is still valid, append the new content to it.
  if (parentId) {
    const existingNote = getTrackedAssistantNoteForParent(parentId);
    if (existingNote) {
      try {
        const appendedHtml = appendAssistantAnswerToNoteHtml(
          existingNote.getNote() || "",
          html,
        );
        existingNote.setNote(appendedHtml);
        await existingNote.saveTx();
        ztoolkit.log(
          `LLM: Appended to existing note ${existingNote.id} for parent ${parentId}`,
        );
        return "appended";
      } catch (appendErr) {
        // If appending fails (e.g. note was deleted externally), fall through
        // to create a new note instead.
        ztoolkit.log(
          "LLM: Failed to append to existing note, creating new:",
          appendErr,
        );
        removeAssistantNoteMapEntry(parentId);
      }
    }
  }

  // No existing tracked note (or append failed) – create a brand-new note.
  const note = new Zotero.Item("note");
  note.libraryID = (parentItem || item).libraryID;
  if (parentId) {
    note.parentID = parentId;
  }
  note.setNote(html);
  const saveResult = await note.saveTx();
  // saveTx() returns the new item ID (number) on creation.
  // Also check note.id as a fallback.
  const newNoteId =
    typeof saveResult === "number" && saveResult > 0 ? saveResult : note.id;
  if (newNoteId && newNoteId > 0) {
    if (parentId) {
      rememberAssistantNoteForParent(parentId, newNoteId);
    }
    ztoolkit.log(
      `LLM: Created new note ${newNoteId} for parent ${parentId ?? "standalone"}`,
    );
  } else {
    ztoolkit.log(
      "LLM: Warning – note was saved but could not determine note ID",
    );
  }
  return "created";
}

export async function createNoteFromChatHistory(
  item: Zotero.Item,
  history: Message[],
): Promise<void> {
  const parentItem = resolveParentItemForNote(item);
  const parentId = parentItem?.id;
  // Chat history export always creates a brand-new, standalone note.
  // It does NOT append to the tracked assistant note and does NOT
  // update the tracked note ID, so single-response "Save as note"
  // keeps its own append chain undisturbed.
  const note = new Zotero.Item("note");
  note.libraryID = (parentItem || item).libraryID;
  if (parentId) {
    note.parentID = parentId;
  }
  note.setNote(buildChatHistoryNotePayload(history).noteHtml);
  await note.saveTx();
  ztoolkit.log(
    `LLM: Created chat history note for parent ${parentId ?? "standalone"}`,
  );
}

export async function createStandaloneNoteFromChatHistory(
  libraryID: number,
  history: Message[],
): Promise<void> {
  const normalizedLibraryID = Number.isFinite(libraryID)
    ? Math.floor(libraryID)
    : 0;
  if (normalizedLibraryID <= 0) {
    throw new Error("Invalid library ID for standalone note export");
  }
  const note = new Zotero.Item("note");
  note.libraryID = normalizedLibraryID;
  note.setNote(buildChatHistoryNotePayload(history).noteHtml);
  await note.saveTx();
  ztoolkit.log(
    `LLM: Created standalone chat history note in library ${normalizedLibraryID}`,
  );
}

// ---------------------------------------------------------------------------
// Literature Note backend
//
// These notes deliberately live in Zotero's normal child-note model.  The
// marker is content based (rather than a preference or an item id), so it
// remains stable when a library is synced, exported, or restored.
// ---------------------------------------------------------------------------

export const LITERATURE_NOTE_MARKER = "AIdea Literature Note";

const literatureNoteCreationByParent = new Map<
  string,
  Promise<LiteratureNote>
>();

export const LITERATURE_NOTE_SECTIONS = [
  "question",
  "system",
  "key-findings",
  "evidence",
  "limitations",
  "use-for-my-project",
  "reusable-info",
  "questions",
] as const;

export type LiteratureNoteSection = (typeof LITERATURE_NOTE_SECTIONS)[number];

export type LiteratureNoteMetadata = {
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
};

export type LiteratureNote = {
  item: Zotero.Item;
  parentItem: Zotero.Item;
  metadata: LiteratureNoteMetadata;
  sections: Record<LiteratureNoteSection, string>;
};

const LITERATURE_SECTION_LABELS: Record<LiteratureNoteSection, string> = {
  question: "Question",
  system: "System",
  "key-findings": "Key findings",
  evidence: "Evidence",
  limitations: "Limitations",
  "use-for-my-project": "Use for my project",
  "reusable-info": "Reusable info",
  questions: "Questions / Follow-up",
};

export function resolveLiteratureNoteParent(
  item: Zotero.Item,
): Zotero.Item | null {
  return resolveParentItemForNote(item);
}

export function getLiteratureNoteMetadata(
  item: Zotero.Item,
): LiteratureNoteMetadata {
  const parent = resolveParentItemForNote(item) || item;
  const creators = (() => {
    try {
      return (parent.getCreators?.() || [])
        .map(
          (creator: any) =>
            [creator.firstName, creator.lastName].filter(Boolean).join(" ") ||
            creator.name ||
            "",
        )
        .filter(Boolean)
        .join(", ");
    } catch {
      return "";
    }
  })();
  const field = (name: string) => {
    try {
      return String(parent.getField?.(name) || "").trim();
    } catch {
      return "";
    }
  };
  return {
    title: field("title"),
    authors: creators,
    journal: field("publicationTitle"),
    year: field("date").match(/\d{4}/)?.[0] || field("date"),
    doi: field("DOI"),
  };
}

function escapeLiteratureHtml(value: string): string {
  return escapeNoteHtml(String(value || "")).replace(/\n/g, "<br/>");
}

function emptyLiteratureSections(): Record<LiteratureNoteSection, string> {
  return Object.fromEntries(
    LITERATURE_NOTE_SECTIONS.map((section) => [section, ""]),
  ) as Record<LiteratureNoteSection, string>;
}

function renderLiteratureNoteHtml(
  metadata: LiteratureNoteMetadata,
  sections: Record<LiteratureNoteSection, string>,
): string {
  const metaRows = [
    ["Title", metadata.title],
    ["Authors", metadata.authors],
    ["Journal", metadata.journal],
    ["Year", metadata.year],
    ["DOI", metadata.doi],
  ]
    .map(
      ([label, value]) =>
        `<p><strong>${label}:</strong> ${escapeLiteratureHtml(value)}</p>`,
    )
    .join("");
  const bodies = LITERATURE_NOTE_SECTIONS.map((section) => {
    const body = sections[section] || "";
    return `<h2 data-aidea-literature-section="${section}">${LITERATURE_SECTION_LABELS[section]}</h2><div data-aidea-literature-body="${section}">${body}</div>`;
  }).join("");
  return `<h1>${LITERATURE_NOTE_MARKER}</h1><div data-aidea-literature-note="1"><h2>Metadata</h2><div data-aidea-literature-metadata="1">${metaRows}</div>${bodies}</div>`;
}

function extractLiteratureSection(
  html: string,
  section: LiteratureNoteSection,
): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<div\\s+data-aidea-literature-body=["']${escaped}["'][^>]*>`,
    "i",
  ).exec(String(html || ""));
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  // Section bodies may contain Markdown-rendered nested divs.  Locate the
  // matching closing div instead of slicing to the next heading, which would
  // accidentally include this body's closing tag and corrupt the next save.
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 1;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(html))) {
    if (/^<\/div\b/i.test(tag[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, tag.index);
  }
  return "";
}

// Exported for regression tests.  Production callers should use load/update.
export function extractLiteratureNoteSectionHtml(
  html: string,
  section: LiteratureNoteSection,
): string {
  return extractLiteratureSection(html, section);
}

function parseLiteratureNote(
  note: Zotero.Item,
  parentItem: Zotero.Item,
): LiteratureNote {
  const html = String(note.getNote?.() || "");
  const sections = emptyLiteratureSections();
  for (const section of LITERATURE_NOTE_SECTIONS) {
    sections[section] = extractLiteratureSection(html, section);
  }
  return {
    item: note,
    parentItem,
    metadata: getLiteratureNoteMetadata(parentItem),
    sections,
  };
}

function isLiteratureNote(note: Zotero.Item | null): boolean {
  if (!note || !note.isNote?.()) return false;
  try {
    return String(note.getNote?.() || "").includes(LITERATURE_NOTE_MARKER);
  } catch {
    return false;
  }
}

/** Locate the one canonical Literature Note for a regular item or attachment. */
export async function findLiteratureNote(
  item: Zotero.Item,
): Promise<LiteratureNote | null> {
  const parentItem = resolveLiteratureNoteParent(item);
  if (!parentItem) return null;
  const ids = new Set<number>();
  try {
    for (const rawId of (await (parentItem as any).getNotes?.()) || []) {
      const id = Number(rawId);
      if (Number.isFinite(id) && id > 0) ids.add(Math.floor(id));
    }
  } catch {
    // A library scan below is retained for older Zotero APIs.
  }
  for (const id of ids) {
    const note = getZoteroItem(id);
    if (isLiteratureNote(note)) return parseLiteratureNote(note!, parentItem);
  }
  try {
    const candidates = await Zotero.Items.getAll(
      parentItem.libraryID,
      true,
      false,
      false,
    );
    for (const candidate of candidates) {
      if (candidate.parentID === parentItem.id && isLiteratureNote(candidate)) {
        return parseLiteratureNote(candidate, parentItem);
      }
    }
  } catch (err) {
    ztoolkit.log("AIdea: literature note lookup failed", err);
  }
  return null;
}

export async function createLiteratureNote(
  item: Zotero.Item,
): Promise<LiteratureNote> {
  const parentItem = resolveLiteratureNoteParent(item);
  if (!parentItem)
    throw new Error("Literature Note requires a regular parent item");
  const key = `${parentItem.libraryID}:${parentItem.id}`;
  const active = literatureNoteCreationByParent.get(key);
  if (active) return active;
  const creation = (async () => {
    // Recheck *inside* the per-parent critical section. Reader selection and
    // the Notes view can request a note concurrently.
    const existing = await findLiteratureNote(parentItem);
    if (existing) return existing;
    const note = new Zotero.Item("note");
    note.libraryID = parentItem.libraryID;
    note.parentID = parentItem.id;
    const metadata = getLiteratureNoteMetadata(parentItem);
    const sections = emptyLiteratureSections();
    note.setNote(renderLiteratureNoteHtml(metadata, sections));
    await note.saveTx();
    ztoolkit.log(
      `AIdea: created Literature Note ${note.id} for parent ${parentItem.id}`,
    );
    return { item: note, parentItem, metadata, sections };
  })();
  literatureNoteCreationByParent.set(key, creation);
  try {
    return await creation;
  } finally {
    if (literatureNoteCreationByParent.get(key) === creation) {
      literatureNoteCreationByParent.delete(key);
    }
  }
}

export async function loadLiteratureNote(
  item: Zotero.Item,
): Promise<LiteratureNote> {
  return (await findLiteratureNote(item)) || createLiteratureNote(item);
}

export async function updateLiteratureNote(
  item: Zotero.Item,
  updates: Partial<Record<LiteratureNoteSection, string>>,
): Promise<LiteratureNote> {
  const current = await loadLiteratureNote(item);
  const sections = { ...current.sections };
  for (const section of LITERATURE_NOTE_SECTIONS) {
    if (updates[section] !== undefined)
      sections[section] = String(updates[section] || "");
  }
  current.item.setNote(renderLiteratureNoteHtml(current.metadata, sections));
  await current.item.saveTx();
  ztoolkit.log(`AIdea: saved Literature Note ${current.item.id}`);
  return { ...current, sections };
}

export async function appendToLiteratureNoteSection(
  item: Zotero.Item,
  section: LiteratureNoteSection,
  html: string,
): Promise<LiteratureNote> {
  const current = await loadLiteratureNote(item);
  const addition = String(html || "").trim();
  if (!addition) return current;
  const previous = current.sections[section] || "";
  return updateLiteratureNote(item, {
    [section]: previous ? `${previous}<hr/>${addition}` : addition,
  });
}
