# Personal Knowledge MCP Server

> A small learning project: an MCP server that lets an AI assistant search and read a folder of Markdown notes. Built to understand the Model Context Protocol by making something real with it.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

---

## Why I Built This

I picked the simplest useful idea I could think of: let an AI assistant search and read a folder of Markdown notes. It is small enough to finish and real enough to run into the interesting problems, especially around what happens when you give an AI read access to files.

This is a personal learning project built with IBM Bob. The views here are my own, and it has not been audited. Please read the [Security](#security) section before pointing it at anything you care about.

---

## What It Does

The server exposes Markdown notes as MCP resources and tools. Any MCP-compatible client (Bob, Claude Desktop, etc.) can search and read them from a natural language prompt.

```
You: "Summarize my notes on async architecture"
  -> the model calls search_notes / get_note
  -> the server returns the matching note text
  -> the model writes the summary
```

The server only finds and returns text. The summarising is done by the model on the client side.

---

## Features

| Capability | Details |
|---|---|
| **`notes-index` resource** | Browse all notes as a `note:///` URI listing |
| **`note` resource template** | Read any individual note by URI |
| **`search_notes` tool** | Full-text search across your entire vault with line-level snippets |
| **`get_note` tool** | Fetch a note by exact URI or fuzzy filename; the full text goes into the model's context |

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/alihabbache/Personal-Knowledge-MCP-Server.git
cd Personal-Knowledge-MCP-Server

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Test it immediately with a raw JSON-RPC call
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_notes","arguments":{"query":"your keyword"}}}' \
| NOTES_DIR="/path/to/your/notes" node build/index.js 2>/dev/null
```

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `NOTES_DIR` | `~/Documents/notes` | Absolute path to your Markdown notes directory |

> **Obsidian:** Point `NOTES_DIR` directly at your vault folder.
> **Notion export:** Export your workspace as "Markdown & CSV", unzip it, point `NOTES_DIR` at the folder.
> **Any Markdown folder:** Works out of the box — subfolders are discovered recursively.

---

## Register with an MCP Client (e.g. Bob)

Add to your global `~/.bob/settings/mcp.json` or workspace `.bob/mcp.json`:

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/Personal-Knowledge-MCP-Server/build/index.js"],
      "env": {
        "NOTES_DIR": "/absolute/path/to/your/notes"
      }
    }
  }
}
```

Then talk to it naturally:
- *"List all my notes"*
- *"Search my notes for 'system design'"*
- *"Summarize my note on async architecture"*
- *"What have I written about product strategy?"*

---

## Tools Reference

### `search_notes`

```
search_notes(query: string, max_results?: number) → text
```

Full-text search across all `.md` files. Returns titles, URIs, and up to 3 matching line snippets per note. Default `max_results` is 10, maximum is 50.

### `get_note`

```
get_note(identifier: string) → text
```

Pass a `note:///` URI **or** a partial filename (e.g. `"sprint planning"`) to retrieve the full note content. The fuzzy match returns the first file whose name contains the text, so use `search_notes` for the exact URI when names are similar.

---

## Resources Reference

### `note:///` — Notes Index

Lists all discovered `.md` files with their URIs and relative paths. Subfolders are included automatically.

### `note:///{path}` — Note Template

Reads a specific note by URI. Example: `note:///Work/sprint-planning.md`

---

## How It Works

```
Your Prompt
    ↓
MCP Client (Bob / Claude Desktop)
    ↓  JSON-RPC 2.0 over stdio
Personal Knowledge MCP Server
    ↓  fs.readFile() — read only
Your Notes (Markdown files on disk)
```

The model never touches your filesystem directly. The MCP server is the only process that reads files, and it only exposes what is inside `NOTES_DIR`. The server itself makes no network connections, but anything it returns goes into the model's context. See the trade-off below.

---

## Security

Giving an AI read access to a folder creates an attack surface, even in a toy project. Thinking this through was the most useful part of the exercise. This section describes what the code does and what I actually tested, not a guarantee.

### What it does

| Property | Detail |
|---|---|
| **Read-only** | The server only reads (`fs.readFile`, `fs.readdir`, `fs.realpath`). There is no write, delete, or execute operation. |
| **Path traversal check** | Every URI is resolved to an absolute path and must sit inside `NOTES_DIR`. The check includes a trailing path separator, so a sibling folder like `notes-evil` does not pass for `notes`. |
| **Real-path check** | Before a direct read, symlinks are resolved and the real file must still be inside `NOTES_DIR`. |
| **Hidden files and non-Markdown files blocked** | Direct reads of any path with a segment starting with `.` (such as `.env` or `.ssh/`), and of anything that is not `.md`, are rejected. The vault walker applies the same rules when listing and searching. |
| **No network listener** | It runs over stdio. There is no open port or HTTP server. Only the process that spawned it can talk to it. |
| **No credentials handled** | The server needs no API keys or tokens. Your note contents do pass through it by design. |
| **No shell execution** | No `eval`, `exec`, `spawn` or `child_process` usage in the code. |

### What testing found

I tried to break the first version. The `../` and sibling-prefix attacks were blocked as intended, but three things were not:

| Problem found | Result in the first version | Fix |
|---|---|---|
| A symlink inside the vault pointing outside it | Content outside `NOTES_DIR` was readable via `get_note` | Resolve with `realpath` and re-check the boundary |
| `note:///.env` requested directly | Read successfully, even though the vault walker skips dotfiles | Reject hidden path segments on direct reads |
| `note:///sub/data.txt` requested directly | Non-Markdown files were readable | Reject anything that is not `.md` on direct reads |

The earlier version of this README claimed hidden files were "never touched". That was only true for listing and search, not for direct reads. It is fixed now.

Reproduce the checks yourself:

```bash
npm run build
npm run security-check
```

The script builds a throwaway vault in a temp folder, attempts each of the reads above, and prints PASS or FAIL. These are a handful of hand-written regression checks, not a full test suite.

### What I have not verified

- Behaviour on very large vaults. Search reads every file on every query and has no index.
- Windows paths and case-insensitive filesystems.
- Hostile content inside notes. A note can contain text written to manipulate the model that reads it (prompt injection). The server does not and cannot filter this.
- Race conditions between the `realpath` check and the read.
- Anything an independent reviewer would find that I have not.

### One design trade-off to be aware of

When `get_note` or `search_notes` returns note content, it is passed to the LLM in your MCP client's context. If you are using a **cloud-hosted LLM** (Claude, GPT-4, etc.), that content leaves your machine and is processed by the provider. The *server* is local, but the *LLM* may not be. Use a local model (for example via Ollama) if your notes are sensitive and you want end-to-end local processing.

---

## Development

```bash
npm run dev   # watch mode — rebuilds on file changes
npm run build # single production build
npm run security-check # run the read-path security checks (build first)
```

## Project Structure

```
src/
  index.ts      # Server entry point — tools, resources, helpers
scripts/
  security-check.mjs  # Read-path security checks
build/          # Compiled output (generated — do not edit)
package.json
tsconfig.json
README.md
```

---

## Ideas for Next

- Semantic search with local embeddings
- Tag and front-matter filtering
- Backlink traversal for Obsidian vaults
- A `create_note` tool (write access means revisiting everything in the Security section)

---

## License

ISC — free to use, modify, and distribute.
