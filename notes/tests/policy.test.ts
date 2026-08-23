import { describe, test, expect } from "bun:test";
import {
  parsePolicyFromArgv,
  isPolicyActive,
  checkWritePolicy,
  type WritePolicy,
} from "../src/policy.js";

const FINN_POLICY: WritePolicy = {
  writeFolder: "Finn Claw",
  writePrefix: "FC--",
};

const OFF_POLICY: WritePolicy = {
  writeFolder: null,
  writePrefix: null,
};

// --- parsePolicyFromArgv ---

describe("parsePolicyFromArgv", () => {
  test("returns nulls when flags absent", () => {
    const p = parsePolicyFromArgv(["node", "index.js"]);
    expect(p.writeFolder).toBeNull();
    expect(p.writePrefix).toBeNull();
  });

  test("parses both flags", () => {
    const p = parsePolicyFromArgv([
      "node",
      "index.js",
      "--write-folder=Finn Claw",
      "--write-prefix=FC--",
    ]);
    expect(p.writeFolder).toBe("Finn Claw");
    expect(p.writePrefix).toBe("FC--");
  });

  test("ignores empty flag values", () => {
    const p = parsePolicyFromArgv(["--write-folder=", "--write-prefix="]);
    expect(p.writeFolder).toBeNull();
    expect(p.writePrefix).toBeNull();
  });

  test("handles folder names with spaces and special chars", () => {
    const p = parsePolicyFromArgv(["--write-folder=My Folder (2)", "--write-prefix=X:"]);
    expect(p.writeFolder).toBe("My Folder (2)");
    expect(p.writePrefix).toBe("X:");
  });
});

// --- isPolicyActive ---

describe("isPolicyActive", () => {
  test("false when both nulls", () => {
    expect(isPolicyActive(OFF_POLICY)).toBe(false);
  });

  test("false when only one flag set", () => {
    expect(isPolicyActive({ writeFolder: "X", writePrefix: null })).toBe(false);
    expect(isPolicyActive({ writeFolder: null, writePrefix: "Y" })).toBe(false);
  });

  test("true when both set", () => {
    expect(isPolicyActive(FINN_POLICY)).toBe(true);
  });
});

// --- checkWritePolicy: policy off ---

describe("checkWritePolicy (policy off)", () => {
  test("permits everything when policy inactive", () => {
    for (const op of ["create_note", "update_note", "delete_note", "append_to_note", "move_note", "create_folder", "delete_folder"] as const) {
      const r = checkWritePolicy(OFF_POLICY, op, { title: "anything", folder: "anywhere" });
      expect(r.allowed).toBe(true);
    }
  });
});

// --- checkWritePolicy: structural blocks ---

describe("checkWritePolicy (structural blocks)", () => {
  test("move_note always denied under policy", () => {
    const r = checkWritePolicy(FINN_POLICY, "move_note", {
      title: "FC--x",
      fromFolder: "Finn Claw",
      toFolder: "Finn Claw",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("move_note");
  });

  test("create_folder always denied under policy", () => {
    const r = checkWritePolicy(FINN_POLICY, "create_folder", { folderName: "Finn Claw" });
    expect(r.allowed).toBe(false);
  });

  test("delete_folder always denied under policy — even the write folder itself", () => {
    const r = checkWritePolicy(FINN_POLICY, "delete_folder", { folderName: "Finn Claw" });
    expect(r.allowed).toBe(false);
  });
});

// --- checkWritePolicy: prefix + folder gate ---

describe("checkWritePolicy (prefix + folder gate)", () => {
  test("allows write when both prefix and folder match", () => {
    const r = checkWritePolicy(FINN_POLICY, "create_note", {
      title: "FC--research notes",
      folder: "Finn Claw",
    });
    expect(r.allowed).toBe(true);
  });

  test("denies write when title missing prefix", () => {
    const r = checkWritePolicy(FINN_POLICY, "create_note", {
      title: "research notes",
      folder: "Finn Claw",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("FC--");
  });

  test("denies write when title has wrong prefix", () => {
    const r = checkWritePolicy(FINN_POLICY, "update_note", {
      title: "Notes -- FC--fake",
      folder: "Finn Claw",
    });
    expect(r.allowed).toBe(false);
  });

  test("denies write when folder wrong", () => {
    const r = checkWritePolicy(FINN_POLICY, "update_note", {
      title: "FC--plan",
      folder: "Personal",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Finn Claw");
  });

  test("denies write when folder missing (unspecified)", () => {
    const r = checkWritePolicy(FINN_POLICY, "update_note", {
      title: "FC--plan",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Finn Claw");
  });

  test("denies write when both wrong", () => {
    const r = checkWritePolicy(FINN_POLICY, "delete_note", {
      title: "bank passwords",
      folder: "Personal",
    });
    expect(r.allowed).toBe(false);
  });

  test("append_to_note gated the same as create/update", () => {
    const allowed = checkWritePolicy(FINN_POLICY, "append_to_note", {
      title: "FC--log",
      folder: "Finn Claw",
    });
    expect(allowed.allowed).toBe(true);

    const denied = checkWritePolicy(FINN_POLICY, "append_to_note", {
      title: "daily journal",
      folder: "Finn Claw",
    });
    expect(denied.allowed).toBe(false);
  });

  test("empty title rejected", () => {
    const r = checkWritePolicy(FINN_POLICY, "create_note", {
      title: "",
      folder: "Finn Claw",
    });
    expect(r.allowed).toBe(false);
  });

  test("prefix-only match without folder still rejected", () => {
    // Belt-and-suspenders: even a well-prefixed title can't land outside the folder
    const r = checkWritePolicy(FINN_POLICY, "create_note", {
      title: "FC--stealth",
      folder: "Personal",
    });
    expect(r.allowed).toBe(false);
  });
});
