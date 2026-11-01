#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";

// ---------------------------------------------------------------------------
// Configuration
// Set NOTES_DIR env var to point at your vault / Notion export directory.
// Falls back to ~/Documents/notes
// ---------------------------------------------------------------------------
const NOTES_DIR = process.env.NOTES_DIR
  ? path.resolve(process.env.NOTES_DIR)
  : path.join(process.env.HOME ?? ".", "Documents", "notes");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .md files under a directory. */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // skip hidden files/dirs
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/** Convert an absolute file path to a stable resource URI. */
function fileToUri(filePath: string): string {
  const rel = path.relative(NOTES_DIR, filePath);
  return `note:///${rel.replace(/\\/g, "/")}`;
}

/** Convert a resource URI back to an absolute file path. */
function uriToFile(uri: string): string {
  const rel = uri.replace(/^note:\/\/\//, "");
  return path.join(NOTES_DIR, rel);
}

/** Read a single note, returning its content as a string. */
async function readNote(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}

/** Extract a title from front-matter or the first heading, falling back to filename. */
function extractTitle(content: string, filePath: string): string {
  const fmMatch = content.match(/^---[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m);
  if (fmMatch) return fmMatch[1].trim();
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return path.basename(filePath, ".md");
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "personal-knowledge-mcp-server",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Resource: notes index (static URI)
// ---------------------------------------------------------------------------
server.resource(
  "notes-index",
  "note:///",
  {
    description: "Lists all Markdown notes in your knowledge base.",
    mimeType: "text/plain",
  },
  async (_uri) => {
    const files = await collectMarkdownFiles(NOTES_DIR);
    if (files.length === 0) {
      return {
        contents: [
          {
            uri: "note:///",
            text: `No notes found in ${NOTES_DIR}. Set the NOTES_DIR environment variable to your vault path.`,
            mimeType: "text/plain",
          },
        ],
      };
    }
    const lines = files.map((f) => {
      const uri = fileToUri(f);
      const rel = path.relative(NOTES_DIR, f);
      return `${uri}  (${rel})`;
    });
    return {
      contents: [
        {
          uri: "note:///",
          text: lines.join("\n"),
          mimeType: "text/plain",
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Resource template: read an individual note by URI pattern
// ---------------------------------------------------------------------------
server.resource(
  "note",
  new ResourceTemplate("note:///{notePath}", { list: undefined }),
  {
    description: "Read the full content of a single note by its URI.",
    mimeType: "text/markdown",
  },
  async (uri, _variables) => {
    const filePath = uriToFile(uri.href);
    try {
      const content = await readNote(filePath);
      return {
        contents: [
          { uri: uri.href, text: content, mimeType: "text/markdown" },
        ],
      };
    } catch {
      return {
        contents: [
          {
            uri: uri.href,
            text: `Note not found: ${uri.href}`,
            mimeType: "text/plain",
          },
        ],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: search_notes — full-text search across all notes
// ---------------------------------------------------------------------------
server.tool(
  "search_notes",
  "Full-text search across all Markdown notes. Returns matching titles, URIs, and the lines containing the query.",
  {
    query: z.string().describe("Search term or phrase"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of matching notes to return (default 10, max 50)"),
  },
  async ({ query, max_results }) => {
    const files = await collectMarkdownFiles(NOTES_DIR);
    if (files.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No notes found in ${NOTES_DIR}. Set NOTES_DIR to your vault path.`,
          },
        ],
      };
    }

    const lowerQuery = query.toLowerCase();
    const matches: { uri: string; title: string; snippets: string[] }[] = [];

    for (const file of files) {
      if (matches.length >= max_results) break;
      try {
        const content = await readNote(file);
        const lines = content.split("\n");
        const matchingLines = lines
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => line.toLowerCase().includes(lowerQuery))
          .slice(0, 3)
          .map(({ line, i }) => `  L${i + 1}: ${line.trim()}`);

        if (matchingLines.length > 0) {
          matches.push({
            uri: fileToUri(file),
            title: extractTitle(content, file),
            snippets: matchingLines,
          });
        }
      } catch {
        // skip unreadable files
      }
    }

    if (matches.length === 0) {
      return {
        content: [{ type: "text", text: `No notes matched "${query}".` }],
      };
    }

    const output = matches
      .map((m) => `## ${m.title}\nURI: ${m.uri}\n${m.snippets.join("\n")}`)
      .join("\n\n");

    return { content: [{ type: "text", text: output }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_note — retrieve full note content by URI or fuzzy filename match
// ---------------------------------------------------------------------------
server.tool(
  "get_note",
  "Retrieve the full content of a note by URI (note:///path.md) or by a partial filename/title match. Use this before asking to summarize a note.",
  {
    identifier: z
      .string()
      .describe(
        "A note URI (note:///path/to/file.md) OR a partial filename or title to fuzzy-match"
      ),
  },
  async ({ identifier }) => {
    let filePath: string;

    if (identifier.startsWith("note:///")) {
      filePath = uriToFile(identifier);
    } else {
      const files = await collectMarkdownFiles(NOTES_DIR);
      const lower = identifier.toLowerCase();
      const matched = files.find((f) =>
        path.basename(f, ".md").toLowerCase().includes(lower)
      );
      if (!matched) {
        return {
          content: [
            {
              type: "text",
              text: `No note found matching "${identifier}". Use search_notes to find the correct URI.`,
            },
          ],
          isError: true,
        };
      }
      filePath = matched;
    }

    try {
      const content = await readNote(filePath);
      const title = extractTitle(content, filePath);
      return {
        content: [
          {
            type: "text",
            text: `# ${title}\nURI: ${fileToUri(filePath)}\n\n${content}`,
          },
        ],
      };
    } catch {
      return {
        content: [
          { type: "text", text: `Could not read note at path: ${filePath}` },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `personal-knowledge-mcp-server running (NOTES_DIR=${NOTES_DIR})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
