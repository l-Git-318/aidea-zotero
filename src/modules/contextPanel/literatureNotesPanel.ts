/** Reader-only Chat / Notes switcher.  It keeps the existing chat DOM mounted
 * and renders a separate, per-attachment Literature Note editor beside it. */
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

const labels: Record<LiteratureNoteSection, string> = {
  question: "Question",
  system: "System",
  "key-findings": "Key findings",
  evidence: "Evidence",
  limitations: "Limitations",
  "use-for-my-project": "Use for my project",
  "reusable-info": "Reusable info",
  questions: "Questions / Follow-up",
};

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
  if (host.querySelector("#aidea-reader-mode-bar")) return;
  const doc = host.ownerDocument;
  const chat = host.querySelector("#llm-main") as HTMLElement | null;
  if (!doc || !chat) return;

  const bar = doc.createElement("div");
  bar.id = "aidea-reader-mode-bar";
  bar.className = "aidea-reader-mode-bar";
  const chatButton = doc.createElement("button");
  chatButton.type = "button";
  chatButton.className = "aidea-reader-mode active";
  chatButton.textContent = "Chat";
  const notesButton = doc.createElement("button");
  notesButton.type = "button";
  notesButton.className = "aidea-reader-mode";
  notesButton.textContent = "Notes";
  bar.append(chatButton, notesButton);

  const notesRoot = doc.createElement("section");
  notesRoot.id = "aidea-literature-notes";
  notesRoot.className = "aidea-literature-notes";
  notesRoot.hidden = true;
  notesRoot.setAttribute("aria-label", "AIdea Literature Note");
  const status = doc.createElement("div");
  status.className = "aidea-literature-status";
  status.textContent = "Loading…";
  notesRoot.appendChild(status);

  const show = (mode: "chat" | "notes") => {
    const notes = mode === "notes";
    chat.hidden = notes;
    notesRoot.hidden = !notes;
    chatButton.classList.toggle("active", !notes);
    notesButton.classList.toggle("active", notes);
    if (notes && !notesRoot.dataset.loaded) void load();
  };

  let saveTimer: number | null = null;
  let pending: Partial<Record<LiteratureNoteSection, string>> = {};
  const fields = new Map<LiteratureNoteSection, HTMLTextAreaElement>();
  let aiLanguage: "zh-CN" | "en" = getPanelLang().startsWith("zh")
    ? "zh-CN"
    : "en";
  const flush = async () => {
    if (!Object.keys(pending).length) return;
    const updates = pending;
    pending = {};
    if (saveTimer !== null) {
      doc.defaultView?.clearTimeout(saveTimer);
      saveTimer = null;
    }
    status.textContent = "Saving…";
    try {
      await updateLiteratureNote(item, updates);
      status.textContent = "Saved";
    } catch (error) {
      pending = { ...updates, ...pending };
      status.textContent = "Save failed";
      ztoolkit.log("AIdea: Literature Note autosave failed", error);
    }
  };
  const scheduleSave = (section: LiteratureNoteSection, value: string) => {
    pending[section] = textToHtml(doc, value);
    status.textContent = "Unsaved changes";
    if (saveTimer !== null) doc.defaultView?.clearTimeout(saveTimer);
    saveTimer = doc.defaultView?.setTimeout(() => void flush(), 750) || null;
  };

  const fillSection = async (section: LiteratureNoteSection) => {
    const textarea = fields.get(section);
    if (!textarea) return;
    textarea.disabled = true;
    status.textContent = `AI is filling ${labels[section]}…`;
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
      status.textContent = `AI fill failed: ${labels[section]}`;
      ztoolkit.log("AIdea: Literature Note AI fill failed", error);
    } finally {
      textarea.disabled = false;
    }
  };

  const load = async () => {
    notesRoot.dataset.loaded = "loading";
    try {
      const note = await loadLiteratureNote(item);
      notesRoot.textContent = "";
      const title = doc.createElement("h2");
      title.textContent = "AIdea Literature Note";
      const metadata = doc.createElement("dl");
      metadata.className = "aidea-literature-metadata";
      for (const [label, value] of Object.entries(note.metadata)) {
        const dt = doc.createElement("dt");
        dt.textContent = label;
        const dd = doc.createElement("dd");
        dd.textContent = value || "—";
        metadata.append(dt, dd);
      }
      notesRoot.append(title, metadata);
      const aiControls = doc.createElement("div");
      aiControls.className = "aidea-literature-ai-controls";
      const languageLabel = doc.createElement("label");
      languageLabel.textContent = "AI output";
      const languageSelect = doc.createElement("select");
      languageSelect.className = "aidea-literature-language";
      languageSelect.setAttribute("aria-label", "AI output language");
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
      const autoFillButton = doc.createElement("button");
      autoFillButton.type = "button";
      autoFillButton.className = "aidea-literature-ai-fill";
      autoFillButton.textContent = "AI auto-fill empty sections";
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
      aiControls.append(languageLabel, languageSelect, autoFillButton);
      notesRoot.appendChild(aiControls);
      for (const section of LITERATURE_NOTE_SECTIONS) {
        const wrap = doc.createElement("div");
        wrap.className = "aidea-literature-section";
        const headingRow = doc.createElement("div");
        headingRow.className = "aidea-literature-section-heading";
        const heading = doc.createElement("label");
        heading.textContent = labels[section];
        const textarea = doc.createElement("textarea");
        textarea.dataset.section = section;
        textarea.rows = 3;
        textarea.value = htmlToText(doc, note.sections[section]);
        textarea.placeholder = `Write ${labels[section]}…`;
        textarea.addEventListener("input", () =>
          scheduleSave(section, textarea.value),
        );
        fields.set(section, textarea);
        if (getAutoFillableLiteratureNoteSections().includes(section)) {
          const fillButton = doc.createElement("button");
          fillButton.type = "button";
          fillButton.className = "aidea-literature-ai-fill";
          fillButton.textContent = "AI fill";
          fillButton.addEventListener("click", () => void fillSection(section));
          headingRow.append(heading, fillButton);
        } else {
          headingRow.appendChild(heading);
        }
        wrap.append(headingRow, textarea);
        notesRoot.appendChild(wrap);
      }
      notesRoot.appendChild(status);
      status.textContent = "Saved";
      notesRoot.dataset.loaded = "true";
    } catch (error) {
      status.textContent = "Unable to load Literature Note";
      notesRoot.dataset.loaded = "";
      ztoolkit.log("AIdea: Literature Note load failed", error);
    }
  };

  chatButton.addEventListener(
    "click",
    () => void flush().finally(() => show("chat")),
  );
  notesButton.addEventListener("click", () => show("notes"));
  // Reader panel teardown and PDF switches are allowed to invoke this.
  (host as any).__aideaFlushLiteratureNote = flush;
  host.prepend(bar);
  host.appendChild(notesRoot);
}

export async function flushLiteratureNotesPanel(
  host: HTMLElement,
): Promise<void> {
  await (host as any).__aideaFlushLiteratureNote?.();
}
