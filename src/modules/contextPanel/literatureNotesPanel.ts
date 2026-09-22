/** Reader-only literature-note workspace. */
import { config } from "../../../package.json";
import {
  LITERATURE_NOTE_SECTIONS,
  loadLiteratureNote,
  updateLiteratureNote,
  type LiteratureNoteSection,
} from "./notes";
import {
  generateLiteratureNoteSection,
  getAutoFillableLiteratureNoteSections,
} from "./literatureNoteAI";
import { getPanelLang } from "./i18n";

type NoteCopy = {
  title: string;
  subtitle: string;
  chat: string;
  notes: string;
  saved: string;
  saving: string;
  unsaved: string;
  saveFailed: string;
  saveNow: string;
  aiOutput: string;
  fillEmpty: string;
  fill: string;
  fillFailed: string;
  filling: string;
  write: (label: string) => string;
  loadFailed: string;
  retry: string;
  labels: Record<LiteratureNoteSection, string>;
};

const EN_LABELS: Record<LiteratureNoteSection, string> = {
  question: "Research question",
  system: "System / study context",
  "key-findings": "Key findings",
  evidence: "Evidence",
  limitations: "Limitations",
  "use-for-my-project": "Use for my project",
  "reusable-info": "Reusable information",
  questions: "Questions / follow-up",
};

const ZH_LABELS: Record<LiteratureNoteSection, string> = {
  question: "研究问题",
  system: "研究体系 / 背景",
  "key-findings": "核心发现",
  evidence: "证据与数据",
  limitations: "局限性",
  "use-for-my-project": "与我的项目的关联",
  "reusable-info": "可复用信息",
  questions: "待追问的问题",
};

function getCopy(): NoteCopy {
  if (getPanelLang().startsWith("zh")) {
    return {
      title: "文献笔记",
      subtitle: "将阅读中的关键信息沉淀为可检索的研究记录",
      chat: "对话",
      notes: "笔记",
      saved: "已保存",
      saving: "正在保存…",
      unsaved: "有未保存的修改",
      saveFailed: "保存失败，请重试",
      saveNow: "立即保存",
      aiOutput: "AI 输出语言",
      fillEmpty: "填充空白栏目",
      fill: "AI 填充",
      fillFailed: "填充失败",
      filling: "正在生成",
      write: (label) => `填写${label}…`,
      loadFailed: "无法打开文献笔记",
      retry: "重试",
      labels: ZH_LABELS,
    };
  }
  return {
    title: "Research note",
    subtitle: "Turn reading into a structured, reusable research record.",
    chat: "Chat",
    notes: "Notes",
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved changes",
    saveFailed: "Save failed — try again",
    saveNow: "Save now",
    aiOutput: "AI output",
    fillEmpty: "Fill empty sections",
    fill: "AI fill",
    fillFailed: "AI fill failed",
    filling: "AI is drafting",
    write: (label) => `Write ${label}…`,
    loadFailed: "Couldn’t open the research note",
    retry: "Retry",
    labels: EN_LABELS,
  };
}

function htmlToText(doc: Document, html: string): string {
  const scratch = doc.createElement("div");
  scratch.innerHTML = html || "";
  return scratch.textContent || "";
}

function textToHtml(doc: Document, text: string): string {
  const escaped = doc.createElement("div");
  escaped.textContent = text;
  return `<p>${String(escaped.innerHTML).replace(/\n/g, "<br/>")}</p>`;
}

export function mountLiteratureNotesPanel(
  host: HTMLElement,
  item: Zotero.Item,
): void {
  if (host.querySelector("#paperassistant-reader-mode-bar")) return;
  const doc = host.ownerDocument;
  const chat = host.querySelector("#llm-main") as HTMLElement | null;
  if (!doc || !chat) return;

  const copy = getCopy();
  const bar = doc.createElement("nav");
  bar.id = "paperassistant-reader-mode-bar";
  bar.className = "paperassistant-reader-mode-bar";
  bar.setAttribute("aria-label", "Paper Assistant view");
  const chatButton = doc.createElement("button");
  chatButton.type = "button";
  chatButton.className = "paperassistant-reader-mode active";
  chatButton.textContent = copy.chat;
  const notesButton = doc.createElement("button");
  notesButton.type = "button";
  notesButton.className = "paperassistant-reader-mode";
  notesButton.textContent = copy.notes;
  bar.append(chatButton, notesButton);

  const notesRoot = doc.createElement("section");
  notesRoot.id = "paperassistant-literature-notes";
  notesRoot.className = "paperassistant-literature-notes";
  notesRoot.hidden = true;
  notesRoot.setAttribute("aria-label", "Paper Assistant research note");

  let saveTimer: number | null = null;
  let pending: Partial<Record<LiteratureNoteSection, string>> = {};
  const fields = new Map<LiteratureNoteSection, HTMLTextAreaElement>();
  let aiLanguage: "zh-CN" | "en" = getPanelLang().startsWith("zh")
    ? "zh-CN"
    : "en";
  let status: HTMLElement | null = null;

  const setStatus = (text: string, tone: "saved" | "pending" | "error") => {
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const flush = async () => {
    if (!Object.keys(pending).length) return;
    const updates = pending;
    pending = {};
    if (saveTimer !== null) {
      doc.defaultView?.clearTimeout(saveTimer);
      saveTimer = null;
    }
    setStatus(copy.saving, "pending");
    try {
      await updateLiteratureNote(item, updates);
      setStatus(copy.saved, "saved");
    } catch (error) {
      pending = { ...updates, ...pending };
      setStatus(copy.saveFailed, "error");
      ztoolkit.log("Paper Assistant: Literature Note autosave failed", error);
    }
  };

  const scheduleSave = (section: LiteratureNoteSection, value: string) => {
    pending[section] = textToHtml(doc, value);
    setStatus(copy.unsaved, "pending");
    if (saveTimer !== null) doc.defaultView?.clearTimeout(saveTimer);
    saveTimer = doc.defaultView?.setTimeout(() => void flush(), 750) || null;
  };

  const fillSection = async (section: LiteratureNoteSection) => {
    const textarea = fields.get(section);
    if (!textarea) return;
    textarea.disabled = true;
    setStatus(`${copy.filling} ${copy.labels[section]}…`, "pending");
    try {
      const generated = await generateLiteratureNoteSection({
        item,
        section,
        existingText: textarea.value,
        language: aiLanguage,
      });
      textarea.value = generated.trim();
      scheduleSave(section, textarea.value);
    } catch (error) {
      setStatus(`${copy.fillFailed}: ${copy.labels[section]}`, "error");
      ztoolkit.log("Paper Assistant: Literature Note AI fill failed", error);
    } finally {
      textarea.disabled = false;
    }
  };

  const renderLoadFailure = (error: unknown) => {
    const card = doc.createElement("div");
    card.className = "paperassistant-note-error";
    const title = doc.createElement("strong");
    title.textContent = copy.loadFailed;
    const detail = doc.createElement("p");
    detail.textContent =
      error instanceof Error && error.message
        ? error.message
        : "Select a PDF or a library item with a parent record.";
    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "paperassistant-note-button primary";
    retry.textContent = copy.retry;
    retry.addEventListener("click", () => void load());
    card.append(title, detail, retry);
    notesRoot.replaceChildren(card);
  };

  const load = async () => {
    if (notesRoot.dataset.loading === "true") return;
    notesRoot.dataset.loading = "true";
    try {
      const note = await loadLiteratureNote(item);
      fields.clear();
      const header = doc.createElement("header");
      header.className = "paperassistant-note-header";
      const brand = doc.createElement("div");
      brand.className = "paperassistant-note-brand";
      const icon = doc.createElement("img");
      icon.src = `chrome://${config.addonRef}/content/icons/paper-assistant-96.png`;
      icon.alt = "";
      const heading = doc.createElement("div");
      const title = doc.createElement("h2");
      title.textContent = copy.title;
      const subtitle = doc.createElement("p");
      subtitle.textContent = copy.subtitle;
      heading.append(title, subtitle);
      brand.append(icon, heading);
      status = doc.createElement("span");
      status.className = "paperassistant-note-status";
      header.append(brand, status);

      const metadata = doc.createElement("dl");
      metadata.className = "paperassistant-note-metadata";
      for (const [label, value] of Object.entries(note.metadata)) {
        const entry = doc.createElement("div");
        const dt = doc.createElement("dt");
        dt.textContent = label;
        const dd = doc.createElement("dd");
        dd.textContent = value || "—";
        entry.append(dt, dd);
        metadata.appendChild(entry);
      }

      const toolbar = doc.createElement("div");
      toolbar.className = "paperassistant-note-toolbar";
      const languageLabel = doc.createElement("label");
      languageLabel.textContent = copy.aiOutput;
      const languageSelect = doc.createElement("select");
      languageSelect.className = "paperassistant-note-language";
      languageSelect.setAttribute("aria-label", copy.aiOutput);
      for (const [value, label] of [
        ["zh-CN", "中文"],
        ["en", "English"],
      ]) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = value === aiLanguage;
        languageSelect.appendChild(option);
      }
      languageSelect.addEventListener("change", () => {
        aiLanguage = languageSelect.value === "zh-CN" ? "zh-CN" : "en";
      });
      const saveButton = doc.createElement("button");
      saveButton.type = "button";
      saveButton.className = "paperassistant-note-button";
      saveButton.textContent = copy.saveNow;
      saveButton.addEventListener("click", () => void flush());
      const autoFillButton = doc.createElement("button");
      autoFillButton.type = "button";
      autoFillButton.className = "paperassistant-note-button primary";
      autoFillButton.textContent = copy.fillEmpty;
      autoFillButton.addEventListener("click", async () => {
        autoFillButton.disabled = true;
        try {
          for (const section of getAutoFillableLiteratureNoteSections()) {
            if (!fields.get(section)?.value.trim()) await fillSection(section);
          }
          await flush();
        } finally {
          autoFillButton.disabled = false;
        }
      });
      toolbar.append(languageLabel, languageSelect, saveButton, autoFillButton);

      const grid = doc.createElement("div");
      grid.className = "paperassistant-note-grid";
      for (const section of LITERATURE_NOTE_SECTIONS) {
        const card = doc.createElement("article");
        card.className = "paperassistant-note-section";
        const headingRow = doc.createElement("div");
        headingRow.className = "paperassistant-note-section-heading";
        const heading = doc.createElement("label");
        const inputID = `paperassistant-note-${section}`;
        heading.htmlFor = inputID;
        heading.textContent = copy.labels[section];
        const textarea = doc.createElement("textarea");
        textarea.id = inputID;
        textarea.dataset.section = section;
        textarea.rows = 4;
        textarea.value = htmlToText(doc, note.sections[section]);
        textarea.placeholder = copy.write(copy.labels[section]);
        textarea.addEventListener("input", () =>
          scheduleSave(section, textarea.value),
        );
        fields.set(section, textarea);
        headingRow.appendChild(heading);
        if (getAutoFillableLiteratureNoteSections().includes(section)) {
          const fillButton = doc.createElement("button");
          fillButton.type = "button";
          fillButton.className = "paperassistant-note-fill";
          fillButton.textContent = copy.fill;
          fillButton.addEventListener("click", () => void fillSection(section));
          headingRow.appendChild(fillButton);
        }
        card.append(headingRow, textarea);
        grid.appendChild(card);
      }

      notesRoot.replaceChildren(header, metadata, toolbar, grid);
      notesRoot.dataset.loaded = "true";
      setStatus(copy.saved, "saved");
    } catch (error) {
      notesRoot.dataset.loaded = "";
      ztoolkit.log("Paper Assistant: Literature Note load failed", error);
      renderLoadFailure(error);
    } finally {
      notesRoot.dataset.loading = "";
    }
  };

  const show = (mode: "chat" | "notes") => {
    const showNotes = mode === "notes";
    chat.hidden = showNotes;
    notesRoot.hidden = !showNotes;
    chatButton.classList.toggle("active", !showNotes);
    notesButton.classList.toggle("active", showNotes);
    if (showNotes && notesRoot.dataset.loaded !== "true") void load();
  };

  chatButton.addEventListener(
    "click",
    () => void flush().finally(() => show("chat")),
  );
  notesButton.addEventListener("click", () => show("notes"));
  (host as any).__paperAssistantFlushLiteratureNote = flush;
  host.prepend(bar);
  host.appendChild(notesRoot);
}

export async function flushLiteratureNotesPanel(
  host: HTMLElement,
): Promise<void> {
  await (host as any).__paperAssistantFlushLiteratureNote?.();
}
