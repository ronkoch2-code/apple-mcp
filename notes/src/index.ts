#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as applescript from "./applescript.js";
import {
  parsePolicyFromArgv,
  isPolicyActive,
  isReadAllowlistActive,
  checkWritePolicy,
  checkReadPolicy,
  filterFoldersByReadPolicy,
  type WriteOp,
  type PolicyCheckArgs,
} from "./policy.js";

const readOnly = process.argv.includes("--read-only");
const confirmDestructive = process.argv.includes("--confirm-destructive");
const writePolicy = parsePolicyFromArgv(process.argv);
const policyActive = isPolicyActive(writePolicy);
const readAllowlistActive = isReadAllowlistActive(writePolicy);

function policyDenial(op: WriteOp, args: PolicyCheckArgs): { content: [{ type: "text"; text: string }]; isError: true } | null {
  const result = checkWritePolicy(writePolicy, op, args);
  if (result.allowed) return null;
  return {
    content: [{ type: "text", text: `Policy error: ${result.reason}` }],
    isError: true,
  };
}

function readDenial(folder: string | undefined): { content: [{ type: "text"; text: string }]; isError: true } | null {
  const result = checkReadPolicy(writePolicy, folder);
  if (result.allowed) return null;
  return {
    content: [{ type: "text", text: `Policy error: ${result.reason}` }],
    isError: true,
  };
}

const server = new McpServer({
  name: "apple-notes",
  version: "1.0.0",
});

// ---- list_folders ----
server.registerTool(
  "list_folders",
  {
    description: readAllowlistActive
      ? "List folders in Apple Notes (filtered to the configured read allowlist for this session)"
      : "List all folders in Apple Notes",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const folders = await applescript.listFolders();
      const visible = filterFoldersByReadPolicy(writePolicy, folders);
      return { content: [{ type: "text", text: JSON.stringify(visible, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- create_folder ----
server.registerTool(
  "create_folder",
  {
    description: "Create a new folder in Apple Notes",
    inputSchema: z.object({
      name: z.string().describe("Name of the folder to create"),
    }),
  },
  async ({ name }) => {
    const denial = policyDenial("create_folder", { folderName: name });
    if (denial) return denial;
    try {
      const result = await applescript.createFolder(name);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- list_notes ----
server.registerTool(
  "list_notes",
  {
    description: "List all notes in a specified Apple Notes folder",
    inputSchema: z.object({
      folder: z.string().describe("Name of the folder to list notes from"),
    }),
  },
  async ({ folder }) => {
    const denial = readDenial(folder);
    if (denial) return denial;
    try {
      const notes = await applescript.listNotes(folder);
      return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- get_note ----
server.registerTool(
  "get_note",
  {
    description: "Get the full content of a specific note by title",
    inputSchema: z.object({
      title: z.string().describe("Title of the note to retrieve"),
      folder: z.string().optional().describe("Folder to search in (searches all folders if omitted)"),
    }),
  },
  async ({ title, folder }) => {
    const denial = readDenial(folder);
    if (denial) return denial;
    try {
      const note = await applescript.getNote(title, folder);
      return { content: [{ type: "text", text: JSON.stringify(note, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- create_note ----
server.registerTool(
  "create_note",
  {
    description: "Create a new note in a specified Apple Notes folder",
    inputSchema: z.object({
      title: z.string().describe("Title of the new note"),
      body: z.string().describe("HTML body content of the note"),
      folder: z.string().describe("Folder to create the note in"),
    }),
  },
  async ({ title, body, folder }) => {
    const denial = policyDenial("create_note", { title, folder });
    if (denial) return denial;
    try {
      const result = await applescript.createNote(title, body, folder);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- update_note ----
server.registerTool(
  "update_note",
  {
    description: "Update the body of an existing note",
    inputSchema: z.object({
      title: z.string().describe("Title of the note to update"),
      body: z.string().describe("New HTML body content for the note"),
      folder: z.string().optional().describe("Folder the note is in (searches all folders if omitted)"),
    }),
  },
  async ({ title, body, folder }) => {
    const denial = policyDenial("update_note", { title, folder });
    if (denial) return denial;
    try {
      const result = await applescript.updateNote(title, body, folder);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

if (!readOnly) {
  // ---- delete_note ----
  server.registerTool(
    "delete_note",
    {
      description: "Delete a note from Apple Notes",
      inputSchema: z.object({
        title: z.string().describe("Title of the note to delete"),
        folder: z.string().optional().describe("Folder the note is in (searches all folders if omitted)"),
        ...(confirmDestructive ? { confirm: z.boolean().optional().describe("Set to true to confirm this destructive action") } : {}),
      }),
    },
    async ({ title, folder, confirm }: { title: string; folder?: string; confirm?: unknown }) => {
      const denial = policyDenial("delete_note", { title, folder });
      if (denial) return denial;
      if (confirmDestructive && !confirm) {
        return { content: [{ type: "text", text: "This will permanently delete the note. Please confirm with the user, then call again with confirm: true." }] };
      }
      try {
        const result = await applescript.deleteNote(title, folder);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ---- delete_folder ----
  server.registerTool(
    "delete_folder",
    {
      description: "Delete a folder and all its notes from Apple Notes",
      inputSchema: z.object({
        name: z.string().describe("Name of the folder to delete"),
        ...(confirmDestructive ? { confirm: z.boolean().optional().describe("Set to true to confirm this destructive action") } : {}),
      }),
    },
    async ({ name, confirm }: { name: string; confirm?: unknown }) => {
      const denial = policyDenial("delete_folder", { folderName: name });
      if (denial) return denial;
      if (confirmDestructive && !confirm) {
        return { content: [{ type: "text", text: "This will permanently delete the folder and all notes inside it. Please confirm with the user, then call again with confirm: true." }] };
      }
      try {
        const result = await applescript.deleteFolder(name);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

// ---- move_note ----
server.registerTool(
  "move_note",
  {
    description: "Move a note from one folder to another",
    inputSchema: z.object({
      title: z.string().describe("Title of the note to move"),
      from_folder: z.string().describe("Source folder name"),
      to_folder: z.string().describe("Destination folder name"),
    }),
  },
  async ({ title, from_folder, to_folder }) => {
    const denial = policyDenial("move_note", { title, fromFolder: from_folder, toFolder: to_folder });
    if (denial) return denial;
    try {
      const result = await applescript.moveNote(title, from_folder, to_folder);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- append_to_note ----
server.registerTool(
  "append_to_note",
  {
    description: "Append HTML content to an existing note without replacing its body",
    inputSchema: z.object({
      title: z.string().describe("Title of the note to append to"),
      content: z.string().describe("HTML content to append to the note"),
      folder: z.string().optional().describe("Folder the note is in (searches all folders if omitted)"),
    }),
  },
  async ({ title, content, folder }) => {
    const denial = policyDenial("append_to_note", { title, folder });
    if (denial) return denial;
    try {
      const result = await applescript.appendToNote(title, content, folder);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- search_notes ----
server.registerTool(
  "search_notes",
  {
    description: "Search notes by keyword across all folders or within a specific folder. Searches both titles and body content.",
    inputSchema: z.object({
      query: z.string().describe("Search keyword to match against note titles and body content"),
      folder: z.string().optional().describe("Folder to search in (searches all folders if omitted)"),
    }),
  },
  async ({ query, folder }) => {
    const denial = readDenial(folder);
    if (denial) return denial;
    try {
      const results = await applescript.searchNotes(query, folder);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- Start server ----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const writeDesc = policyActive
    ? `write-policy: folder='${writePolicy.writeFolder}' prefix='${writePolicy.writePrefix}'`
    : "write-policy: OFF";
  const readDesc = readAllowlistActive
    ? `read-allowlist: [${writePolicy.readAllowlist!.join(", ")}]`
    : "read-allowlist: OFF (unrestricted)";
  console.error(`Apple Notes MCP server running on stdio (${writeDesc}; ${readDesc})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
