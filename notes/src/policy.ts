/**
 * Policy gate for the Apple Notes MCP server.
 *
 * Coworker fork: this file is not in the upstream @griches/apple-notes-mcp.
 *
 * Two independent policies:
 *
 *   1. WRITE policy — prefix + folder boundary. An LLM can only create,
 *      update, delete, or append to notes whose title starts with a
 *      configured prefix (e.g., "FC:") inside a configured folder (e.g.,
 *      "Finn Claw"). When either flag is unset the write policy is inactive
 *      and the server behaves like the upstream build.
 *
 *   2. READ allowlist — optional folder whitelist. When set (via
 *      --read-allowlist=Folder1,Folder2), list_folders / list_notes /
 *      search_notes / get_note responses are filtered to only the named
 *      folders. Used for Keith's MCP config so his Finn sessions can see
 *      the shared Finn Claw folder but NOT Ron's private notes. When unset,
 *      reads are unrestricted (Ron's config).
 */

export interface WritePolicy {
  writeFolder: string | null;
  writePrefix: string | null;
  readAllowlist: string[] | null; // null = unrestricted; [] = deny-all
}

export function parsePolicyFromArgv(argv: string[]): WritePolicy {
  const pick = (flag: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`${flag}=`));
    if (!hit) return null;
    const value = hit.slice(flag.length + 1);
    return value.length > 0 ? value : null;
  };
  const allowlistRaw = pick("--read-allowlist");
  return {
    writeFolder: pick("--write-folder"),
    writePrefix: pick("--write-prefix"),
    readAllowlist: allowlistRaw
      ? allowlistRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : null,
  };
}

export function isPolicyActive(policy: WritePolicy): boolean {
  return !!(policy.writeFolder && policy.writePrefix);
}

export function isReadAllowlistActive(policy: WritePolicy): boolean {
  return policy.readAllowlist !== null;
}

export interface ReadCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether a read op targeting a specific folder is allowed.
 *
 * When the read allowlist is inactive, all reads pass. When active, only
 * folders listed in --read-allowlist are visible. Folder matches are
 * case-sensitive and exact (matching AppleScript folder-name semantics).
 */
export function checkReadPolicy(
  policy: WritePolicy,
  targetFolder: string | undefined,
): ReadCheckResult {
  if (!isReadAllowlistActive(policy)) {
    return { allowed: true };
  }
  const allowed = policy.readAllowlist!;
  if (!targetFolder) {
    return {
      allowed: false,
      reason:
        `Read blocked by Coworker policy: must specify a folder from the read allowlist ` +
        `(${allowed.join(", ")}). Unscoped reads across all folders are disabled under this policy.`,
    };
  }
  if (!allowed.includes(targetFolder)) {
    return {
      allowed: false,
      reason:
        `Read blocked by Coworker policy: folder '${targetFolder}' is not in the read allowlist ` +
        `(${allowed.join(", ")}). This session can only see notes in allowlisted folders.`,
    };
  }
  return { allowed: true };
}

/**
 * Filter a list of folders to only those in the read allowlist.
 * Accepts either string names or {name}-shaped objects, returning the
 * same shape. Pass-through when the allowlist is inactive.
 */
export function filterFoldersByReadPolicy<T extends string | { name: string }>(
  policy: WritePolicy,
  folders: T[],
): T[] {
  if (!isReadAllowlistActive(policy)) return folders;
  const allowed = new Set(policy.readAllowlist!);
  return folders.filter((f) => {
    const name = typeof f === "string" ? f : f.name;
    return allowed.has(name);
  });
}

export type WriteOp =
  | "create_note"
  | "update_note"
  | "delete_note"
  | "append_to_note"
  | "move_note"
  | "create_folder"
  | "delete_folder";

export interface PolicyCheckArgs {
  title?: string;
  folder?: string;
  fromFolder?: string;
  toFolder?: string;
  folderName?: string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

const STRUCTURALLY_BLOCKED = new Set<WriteOp>([
  "move_note",
  "create_folder",
  "delete_folder",
]);

export function checkWritePolicy(
  policy: WritePolicy,
  op: WriteOp,
  args: PolicyCheckArgs,
): PolicyCheckResult {
  // Policy off → permit everything (backwards compatible with upstream behavior).
  if (!isPolicyActive(policy)) {
    return { allowed: true };
  }

  const folder = policy.writeFolder!;
  const prefix = policy.writePrefix!;

  if (STRUCTURALLY_BLOCKED.has(op)) {
    return {
      allowed: false,
      reason:
        `Operation '${op}' is disabled under the Coworker write-policy. ` +
        `Under this policy Finn Claw may only create, update, append to, or delete notes ` +
        `whose title starts with '${prefix}' inside the '${folder}' folder. ` +
        `Moving notes between folders and creating or deleting folders are not allowed.`,
    };
  }

  const title = args.title ?? "";
  const targetFolder = args.folder ?? "";

  if (!title.startsWith(prefix)) {
    return {
      allowed: false,
      reason:
        `Write blocked by Coworker policy: note title must start with '${prefix}' ` +
        `(got '${title || "(empty)"}'). Only notes titled '${prefix}...' can be modified.`,
    };
  }

  if (targetFolder !== folder) {
    return {
      allowed: false,
      reason:
        `Write blocked by Coworker policy: target folder must be '${folder}' ` +
        `(got '${targetFolder || "(unspecified)"}'). ` +
        `Pass folder: "${folder}" explicitly on every write.`,
    };
  }

  return { allowed: true };
}
