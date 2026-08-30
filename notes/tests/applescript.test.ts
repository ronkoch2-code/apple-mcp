import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  sanitize,
  listFolders,
  createFolder,
  listNotes,
  getNote,
  createNote,
  bodyPreservingTitle,
  updateNote,
  deleteNote,
  searchNotes,
} from "../src/applescript.js";
import { TEST_FOLDER, testNoteTitle, setupTestFolder, cleanupTestFolder, sleep } from "./setup.js";

// ---------------------------------------------------------------------------
// Unit tests — no Apple Notes interaction
// ---------------------------------------------------------------------------

describe("sanitize", () => {
  test("escapes backslashes", () => {
    expect(sanitize("a\\b")).toBe("a\\\\b");
  });

  test("escapes double quotes", () => {
    expect(sanitize('say "hello"')).toBe('say \\"hello\\"');
  });

  test("converts newlines to \\n", () => {
    expect(sanitize("line1\nline2")).toBe("line1\\nline2");
  });

  test("converts carriage returns to \\n", () => {
    expect(sanitize("line1\rline2")).toBe("line1\\nline2");
  });

  test("converts CRLF to \\n", () => {
    expect(sanitize("line1\r\nline2")).toBe("line1\\nline2");
  });

  test("handles combined special characters", () => {
    expect(sanitize('path\\to\n"file"')).toBe('path\\\\to\\n\\"file\\"');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — real Apple Notes operations in an isolated folder
// ---------------------------------------------------------------------------

describe("Apple Notes integration", () => {
  beforeAll(async () => {
    await cleanupTestFolder(); // ensure clean slate
    await setupTestFolder();
  }, 15_000);

  afterAll(async () => {
    await cleanupTestFolder();
  }, 15_000);

  // -- Folders --------------------------------------------------------------

  describe("folders", () => {
    test("listFolders includes the test folder", async () => {
      const folders = await listFolders();
      const names = folders.map((f) => f.name);
      expect(names).toContain(TEST_FOLDER);
    }, 10_000);
  });

  // -- Create & List Notes --------------------------------------------------

  describe("create and list notes", () => {
    const title = testNoteTitle("create");
    const body = "<h1>Hello</h1><p>Test note body</p>";

    test("createNote returns success message", async () => {
      const result = await createNote(title, body, TEST_FOLDER);
      expect(result).toContain("Note created");
      expect(result).toContain(title);
    }, 10_000);

    test("listNotes returns the created note with expected fields", async () => {
      await sleep(500);
      const notes = await listNotes(TEST_FOLDER);
      const match = notes.find((n) => n.title === title);
      expect(match).toBeDefined();
      expect(match!.id).toBeTruthy();
      expect(match!.creationDate).toBeTruthy();
      expect(match!.modificationDate).toBeTruthy();
    }, 10_000);
  });

  // -- Get Note -------------------------------------------------------------

  describe("getNote", () => {
    const title = testNoteTitle("get");
    const body = "<p>Retrievable note</p>";

    beforeAll(async () => {
      await createNote(title, body, TEST_FOLDER);
      await sleep(500);
    }, 10_000);

    test("getNote with folder returns correct note", async () => {
      const note = await getNote(title, TEST_FOLDER);
      expect(note.title).toBe(title);
      expect(note.body).toContain("Retrievable note");
      expect(note.id).toBeTruthy();
      expect(note.creationDate).toBeTruthy();
      expect(note.modificationDate).toBeTruthy();
    }, 10_000);

    test("getNote without folder finds the note", async () => {
      const note = await getNote(title);
      expect(note.title).toBe(title);
      expect(note.body).toContain("Retrievable note");
    }, 10_000);

    test("getNote throws for non-existent note", async () => {
      await expect(getNote("nonexistent-note-999999", TEST_FOLDER)).rejects.toThrow();
    }, 10_000);
  });

  // -- Update Note ----------------------------------------------------------

  describe("updateNote", () => {
    const title = testNoteTitle("update");
    // Apple Notes derives the note name from the body's first line,
    // so we keep the title as an <h1> to preserve it after updates.
    const originalBody = `<h1>${title}</h1><p>Original content</p>`;
    const updatedBody = `<h1>${title}</h1><p>Updated content</p>`;

    beforeAll(async () => {
      await createNote(title, originalBody, TEST_FOLDER);
      await sleep(500);
    }, 10_000);

    test("updateNote returns success message", async () => {
      const result = await updateNote(title, updatedBody, TEST_FOLDER);
      expect(result).toContain("Note updated");
    }, 10_000);

    test("getNote reflects the updated body", async () => {
      await sleep(500);
      const note = await getNote(title, TEST_FOLDER);
      expect(note.body).toContain("Updated content");
      expect(note.body).not.toContain("Original content");
    }, 10_000);
  });

  // -- Search Notes ---------------------------------------------------------

  describe("searchNotes", () => {
    const uniqueTag = `srch${Date.now()}`;
    const title = testNoteTitle(uniqueTag);

    beforeAll(async () => {
      await createNote(title, "<p>Searchable</p>", TEST_FOLDER);
      await sleep(500);
    }, 10_000);

    test("searchNotes within folder finds the note", async () => {
      const results = await searchNotes(uniqueTag, TEST_FOLDER);
      const match = results.find((r) => r.title === title);
      expect(match).toBeDefined();
      expect(match!.folder).toBe(TEST_FOLDER);
      expect(match!.id).toBeTruthy();
    }, 10_000);

    test("searchNotes across all folders finds the note", async () => {
      const results = await searchNotes(uniqueTag);
      const match = results.find((r) => r.title === title);
      expect(match).toBeDefined();
    }, 10_000);
  });

  // -- Delete Note ----------------------------------------------------------

  describe("deleteNote", () => {
    const title = testNoteTitle("delete");

    beforeAll(async () => {
      await createNote(title, "<p>To be deleted</p>", TEST_FOLDER);
      await sleep(500);
    }, 10_000);

    test("deleteNote returns success message", async () => {
      const result = await deleteNote(title, TEST_FOLDER);
      expect(result).toContain("Note deleted");
    }, 10_000);

    test("deleted note no longer appears in listing", async () => {
      await sleep(500);
      const notes = await listNotes(TEST_FOLDER);
      const match = notes.find((n) => n.title === title);
      expect(match).toBeUndefined();
    }, 10_000);

    test("deleteNote throws for non-existent note", async () => {
      await expect(deleteNote("nonexistent-note-999999", TEST_FOLDER)).rejects.toThrow();
    }, 10_000);
  });

  // -- Error cases ----------------------------------------------------------

  describe("error cases", () => {
    test("listNotes throws for non-existent folder", async () => {
      await expect(listNotes("NonExistentFolder-999999")).rejects.toThrow();
    }, 10_000);
  });
});


// ---------------------------------------------------------------------------
// bodyPreservingTitle — duplicate-title suppression (fix #374)
//
// The #327 fix added the <h1> heading. It overshot: a body whose first line
// was already an ESCAPED copy of the title never matched the raw title, so the
// heading was prepended anyway and the note showed the title twice — once as
// the real heading, once as a stray escaped line.
// ---------------------------------------------------------------------------

describe("bodyPreservingTitle", () => {
  const title = "Groceries & Sundries";
  const countTitles = (s: string) => (s.match(/Groceries/g) || []).length;

  test("drops a double-escaped duplicate first line", () => {
    const body = "&amp;lt;h1&amp;gt;Groceries &amp;amp; Sundries&amp;lt;/h1&amp;gt;\nmilk";
    expect(countTitles(bodyPreservingTitle(title, body))).toBe(1);
  });

  test("drops a single-escaped duplicate first line", () => {
    const body = "&lt;h1&gt;Groceries &amp; Sundries&lt;/h1&gt;\nmilk";
    expect(countTitles(bodyPreservingTitle(title, body))).toBe(1);
  });

  test("drops a raw duplicate first line", () => {
    expect(bodyPreservingTitle(title, "Groceries & Sundries\nmilk"))
      .toBe(`<h1>${title}</h1>milk`);
  });

  test("still prepends the title when the body does not carry it", () => {
    expect(bodyPreservingTitle(title, "milk\neggs"))
      .toBe(`<h1>${title}</h1>milk\neggs`);
  });

  test("leaves a body already led by the title alone (the #327 path)", () => {
    const body = `<h1>${title}</h1><div>milk</div>`;
    expect(bodyPreservingTitle(title, body)).toBe(body);
  });
});
