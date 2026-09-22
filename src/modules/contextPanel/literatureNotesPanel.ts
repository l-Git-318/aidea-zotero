/** Reader-only literature-note workspace. */
import { config } from "../../../package.json";
import {
  LITERATURE_NOTE_SECTIONS,
  loadLiteratureNote,
  saveLiteratureNoteDiscussion,
  updateLiteratureNote,
  type LiteratureNoteDiscussion,
  type LiteratureNoteSection,
} from "./notes";
import {
  discussLiteratureNoteSection,
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
  discuss: string;
  discussion: (label: string) => string;
  discussionHint: string;
  ask: string;
  asking: string;
  questionPlaceholder: (label: string) => string;
  noDiscussion: string;
  appendAnswer: string;
  replaceSection: string;
  close: string;
  discussionFailed: string;
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
      discuss: "讨论",
      discussion: (label) => `讨论：${label}`,
      discussionHint:
        "AI 将结合当前栏目和论文原文回答；只有你点击操作时才会写回笔记。",
      ask: "发送问题",
      asking: "正在思考…",
      questionPlaceholder: (label) => `围绕“${label}”继续提问…`,
      noDiscussion: "还没有讨论记录。",
      appendAnswer: "追加到本节",
      replaceSection: "替换本节",
      close: "关闭",
      discussionFailed: "讨论失败",
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
    discuss: "Discuss",
    discussion: (label) => `Discuss: ${label}`,
    discussionHint:
      "AI uses this section and paper excerpts. It only changes the note if you choose an action below an answer.",
    ask: "Ask",
    asking: "Thinking…",
    questionPlaceholder: (label) => `Ask about ${label}…`,
    noDiscussion: "No discussion yet.",
    appendAnswer: "Append to section",
    replaceSection: "Replace section",
    close: "Close",
    discussionFailed: "Discussion failed",
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
  let discussions: LiteratureNoteDiscussion[] = [];
  let activeDiscussionSection: LiteratureNoteSection | null = null;
  let discussionDrawer: HTMLElement | null = null;
  let discussionHistory: HTMLElement | null = null;
  let discussionPrompt: HTMLTextAreaElement | null = null;
  let discussionTitle: HTMLElement | null = null;

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

  const applyDiscussionAnswer = async (
    section: LiteratureNoteSection,
    response: string,
    mode: "append" | "replace",
  ) => {
    const textarea = fields.get(section);
    if (!textarea) return;
    const next =
      mode === "replace" || !textarea.value.trim()
        ? response
        : `${textarea.value.trim()}\n\n${response}`;
    textarea.value = next;
    scheduleSave(section, next);
    await flush();
  };

  const renderDiscussionHistory = () => {
    if (!discussionHistory || !activeDiscussionSection) return;
    const entries = discussions
      .filter((entry) => entry.section === activeDiscussionSection)
      .slice(-8);
    discussionHistory.replaceChildren();
    if (!entries.length) {
      const empty = doc.createElement("p");
      empty.className = "paperassistant-discussion-empty";
      empty.textContent = copy.noDiscussion;
      discussionHistory.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const question = doc.createElement("div");
      question.className = "paperassistant-discussion-message question";
      question.textContent = entry.question;
      const answer = doc.createElement("div");
      answer.className = "paperassistant-discussion-message answer";
      const response = doc.createElement("p");
      response.textContent = entry.response;
      const actions = doc.createElement("div");
      actions.className = "paperassistant-discussion-actions";
      const append = doc.createElement("button");
      append.type = "button";
      append.className = "paperassistant-note-button";
      append.textContent = copy.appendAnswer;
      append.addEventListener(
        "click",
        () =>
          void applyDiscussionAnswer(entry.section, entry.response, "append"),
      );
      const replace = doc.createElement("button");
      replace.type = "button";
      replace.className = "paperassistant-note-button";
      replace.textContent = copy.replaceSection;
      replace.addEventListener(
        "click",
        () =>
          void applyDiscussionAnswer(entry.section, entry.response, "replace"),
      );
      actions.append(append, replace);
      answer.append(response, actions);
      discussionHistory.append(question, answer);
    }
  };

  const openDiscussion = (section: LiteratureNoteSection) => {
    activeDiscussionSection = section;
    if (discussionTitle)
      discussionTitle.textContent = copy.discussion(copy.labels[section]);
    if (discussionPrompt) {
      discussionPrompt.placeholder = copy.questionPlaceholder(
        copy.labels[section],
      );
      discussionPrompt.value = "";
    }
    if (discussionDrawer) discussionDrawer.hidden = false;
    renderDiscussionHistory();
    discussionPrompt?.focus();
  };

  const submitDiscussion = async () => {
    const section = activeDiscussionSection;
    const prompt = discussionPrompt?.value.trim() || "";
    if (!section || !prompt || !discussionPrompt) return;
    const askButton = discussionDrawer?.querySelector(
      ".paperassistant-discussion-ask",
    ) as HTMLButtonElement | null;
    if (askButton) askButton.disabled = true;
    setStatus(`${copy.asking} ${copy.labels[section]}…`, "pending");
    try {
      await flush();
      const response = await discussLiteratureNoteSection({
        item,
        section,
        noteText: fields.get(section)?.value || "",
        question: prompt,
        language: aiLanguage,
      });
      const saved = await saveLiteratureNoteDiscussion(item, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        section,
        question: prompt,
        response: response.trim(),
        createdAt: new Date().toISOString(),
      });
      discussions = saved.discussions;
      discussionPrompt.value = "";
      renderDiscussionHistory();
      setStatus(copy.saved, "saved");
    } catch (error) {
      setStatus(`${copy.discussionFailed}: ${copy.labels[section]}`, "error");
      ztoolkit.log("Paper Assistant: Literature Note discussion failed", error);
    } finally {
      if (askButton) askButton.disabled = false;
    }
  };

  const createDiscussionDrawer = () => {
    const drawer = doc.createElement("aside");
    drawer.className = "paperassistant-discussion-drawer";
    drawer.hidden = true;
    const header = doc.createElement("header");
    const title = doc.createElement("strong");
    const hint = doc.createElement("p");
    hint.textContent = copy.discussionHint;
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "paperassistant-note-button";
    close.textContent = copy.close;
    close.addEventListener("click", () => {
      drawer.hidden = true;
    });
    header.append(title, close);
    const history = doc.createElement("div");
    history.className = "paperassistant-discussion-history";
    const composer = doc.createElement("div");
    composer.className = "paperassistant-discussion-composer";
    const prompt = doc.createElement("textarea");
    prompt.rows = 3;
    prompt.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void submitDiscussion();
      }
    });
    const ask = doc.createElement("button");
    ask.type = "button";
    ask.className =
      "paperassistant-note-button primary paperassistant-discussion-ask";
    ask.textContent = copy.ask;
    ask.addEventListener("click", () => void submitDiscussion());
    composer.append(prompt, ask);
    drawer.append(header, hint, history, composer);
    discussionDrawer = drawer;
    discussionHistory = history;
    discussionPrompt = prompt;
    discussionTitle = title;
    return drawer;
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
      discussions = note.discussions;
      activeDiscussionSection = null;
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
        const actions = doc.createElement("div");
        actions.className = "paperassistant-note-section-actions";
        const discussButton = doc.createElement("button");
        discussButton.type = "button";
        discussButton.className = "paperassistant-note-discuss";
        discussButton.textContent = copy.discuss;
        discussButton.addEventListener("click", () => openDiscussion(section));
        actions.appendChild(discussButton);
        if (getAutoFillableLiteratureNoteSections().includes(section)) {
          const fillButton = doc.createElement("button");
          fillButton.type = "button";
          fillButton.className = "paperassistant-note-fill";
          fillButton.textContent = copy.fill;
          fillButton.addEventListener("click", () => void fillSection(section));
          actions.appendChild(fillButton);
        }
        headingRow.appendChild(actions);
        card.append(headingRow, textarea);
        grid.appendChild(card);
      }

      notesRoot.replaceChildren(
        header,
        metadata,
        toolbar,
        grid,
        createDiscussionDrawer(),
      );
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
