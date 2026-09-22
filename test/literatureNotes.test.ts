import { assert } from "chai";
import {
  createLiteratureNote,
  extractLiteratureNoteSectionHtml,
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
});
