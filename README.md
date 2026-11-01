# Personal Knowledge MCP Server

> Connect your personal notes to any AI assistant — search, retrieve, and summarize your entire knowledge base through natural language.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

---

## The Problem

You've spent years writing notes — in Obsidian, Notion, or plain Markdown files. But when you're working with an AI assistant, it has no idea any of that exists. You're stuck copy-pasting context into every chat, remembering exact filenames, or switching apps mid-thought.

Your knowledge is trapped in files. This server sets it free.

---

## What It Does

**Personal Knowledge MCP Server** exposes your Markdown notes as live MCP resources and tools. Any MCP-compatible client (Bob, Claude Desktop, etc.) can search, read, and summarize your notes on demand — directly from natural language prompts.

```
You: "Summarize my notes on async architecture"
  → MCP server searches your vault
  → Finds the right note
  → AI summarizes it inline
```

No copy-paste. No app switching. No forgetting you wrote something six months ago.

---

## Who Benefits

| Role | How they use it |
|---|---|
| **Knowledge workers** | Surface forgotten notes and decisions without leaving your AI workflow |
| **Engineers & architects** | Query your ADRs, design notes, and tech spike write-ups mid-conversation |
| **Product managers** | Pull up sprint notes, OKR drafts, or stakeholder summaries on demand |
| **Researchers & writers** | Let your AI cross-reference your private research while drafting |
| **Students** | Ask your AI to summarize or connect concepts across your study notes |
| **Anyone with an Obsidian vault or Notion export** | Turn a static archive into a queryable second brain |

---

## Features

| Capability | Details |
|---|---|
| **`notes-index` resource** | Browse all notes as a `note:///` URI listing |
| **`note` resource template** | Read any individual note by URI |
| **`search_notes` tool** | Full-text search across your entire vault with line-level snippets |
| **`get_note` tool** | Fetch a note by exact URI or fuzzy filename — feeds content to the LLM for summarization |

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

Pass a `note:///` URI **or** a partial filename (e.g. `"sprint planning"`) to retrieve the full note content. The LLM summarizes it inline.

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

The LLM never touches your filesystem directly. The MCP server is the only process that reads files, and it only exposes what's inside `NOTES_DIR`. **Your notes never leave your machine.**

---

## Development

```bash
npm run dev   # watch mode — rebuilds on file changes
npm run build # single production build
```

## Project Structure

```
src/
  index.ts      # Server entry point — tools, resources, helpers
build/          # Compiled output (generated — do not edit)
package.json
tsconfig.json
README.md
```

---

## License

ISC — free to use, modify, and distribute.
