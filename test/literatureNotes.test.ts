import { assert } from "chai";
import {
  createLiteratureNote,
  extractLiteratureNoteSectionHtml,
  resolveLiteratureNoteParent,
} from "../src/modules/contextPanel/notes";

describe("Literature Notes", function () {
  it("extracts a section without consuming its closing div", function () {
    const html = [
      '<h1>Paper Assistant Literature Note</h1><div data-aidea-literature-note="1">',
      '<h2 data-aidea-literature-section="question">Question</h2>',
      '<div data-aidea-literature-body="question"><p>Question</p><div><p>Nested evidence</p></div></div>',
      '<h2 data-aidea-literature-section="system">System</h2>',
      '<div data-aidea-literature-body="system"><p>System</p></div></div>',
    ].join("");
    assert.equal(
      extractLiteratureNoteSectionHtml(html, "question"),
      "<p>Question</p><div><p>Nested evidence</p></div>",
    );
    assert.equal(
      extractLiteratureNoteSectionHtml(html, "system"),
      "<p>System</p>",
    );
  });

  it("serializes concurrent creation for one parent item", async function () {
    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    let created = 0;
    const saved: any[] = [];
    const parent = {
      id: 9,
      libraryID: 1,
      isRegularItem: () => true,
      isAttachment: () => false,
      getNotes: async () => [],
      getCreators: () => [],
      getField: () => "",
    };
    class Note {
      id = 0;
      libraryID = 0;
      parentID = 0;
      private html = "";
      constructor(_type: string) {
        created += 1;
      }
      isNote() {
        return true;
      }
      getNote() {
        return this.html;
      }
      setNote(value: string) {
        this.html = value;
      }
      async saveTx() {
        this.id = this.id || 100 + saved.length;
        if (!saved.includes(this)) saved.push(this);
        return this.id;
      }
    }
    (globalThis as any).ztoolkit = { log: () => undefined };
    (globalThis as any).Zotero = {
      Item: Note,
      Items: {
        get: (id: number) => saved.find((note) => note.id === id) || false,
        getAll: async () => saved,
      },
    };
    try {
      const [first, second] = await Promise.all([
        createLiteratureNote(parent as Zotero.Item),
        createLiteratureNote(parent as Zotero.Item),
      ]);
      assert.strictEqual(first.item, second.item);
      assert.equal(created, 1);
    } finally {
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });

  it("uses the attachment's loaded parent before falling back to an item lookup", function () {
    const parent = {
      id: 9,
      isRegularItem: () => true,
    };
    const attachment = {
      parentID: 9,
      parentItem: parent,
      isAttachment: () => true,
      isRegularItem: () => false,
    };
    assert.strictEqual(
      resolveLiteratureNoteParent(attachment as Zotero.Item),
      parent,
    );
  });

  it("creates and reuses a standalone note for an unparented PDF attachment", async function () {
    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    const saved: any[] = [];
    const attachment = {
      id: 25,
      libraryID: 1,
      parentID: false,
      isAttachment: () => true,
      isRegularItem: () => false,
      getCreators: () => [],
      getField: (field: string) => (field === "title" ? "Standalone PDF" : ""),
    };
    class Note {
      id = 0;
      libraryID = 0;
      parentID: number | undefined;
      private html = "";
      isNote() {
        return true;
      }
      getNote() {
        return this.html;
      }
      setNote(value: string) {
        this.html = value;
      }
      async saveTx() {
        this.id = this.id || 200 + saved.length;
        if (!saved.includes(this)) saved.push(this);
        return this.id;
      }
    }
    (globalThis as any).ztoolkit = { log: () => undefined };
    (globalThis as any).Zotero = {
      Item: Note,
      Items: {
        get: (id: number) => saved.find((note) => note.id === id) || false,
        getAll: async () => saved,
      },
    };
    try {
      const first = await createLiteratureNote(attachment as Zotero.Item);
      const second = await createLiteratureNote(attachment as Zotero.Item);
      assert.strictEqual(first.item, second.item);
      assert.isUndefined((first.item as any).parentID);
      assert.include(
        first.item.getNote(),
        'data-paper-assistant-source-item="1:25"',
      );
    } finally {
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });

  it("reuses a legacy AIdea literature note instead of creating a duplicate", async function () {
    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    let created = 0;
    const legacyNote = {
      id: 101,
      parentID: 9,
      isNote: () => true,
      getNote: () => "<h1>AIdea Literature Note</h1>",
    };
    const parent = {
      id: 9,
      libraryID: 1,
      isRegularItem: () => true,
      isAttachment: () => false,
      getNotes: async () => [101],
      getCreators: () => [],
      getField: () => "",
    };
    class Note {
      constructor(_type: string) {
        created += 1;
      }
    }
    (globalThis as any).ztoolkit = { log: () => undefined };
    (globalThis as any).Zotero = {
      Item: Note,
      Items: {
        get: (id: number) => (id === legacyNote.id ? legacyNote : false),
        getAll: async () => [legacyNote],
      },
    };
    try {
      const note = await createLiteratureNote(parent as Zotero.Item);
      assert.strictEqual(note.item, legacyNote);
      assert.equal(created, 0);
    } finally {
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });
});
