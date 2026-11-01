// Quick security regression check for the read paths.
// Usage: npm run build && npm run security-check
// Builds a throwaway vault in a temp folder, tries to read things it should not,
// and checks that normal reads still work.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "..", "build", "index.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pk-mcp-"));
const vault = path.join(root, "vault");

fs.mkdirSync(path.join(vault, "sub"), { recursive: true });
fs.mkdirSync(path.join(root, "outside"));
fs.mkdirSync(path.join(root, "vault-evil"));
fs.writeFileSync(path.join(root, "outside", "secret.md"), "OUTSIDE-SECRET");
fs.writeFileSync(path.join(root, "vault-evil", "x.md"), "PREFIX-SIBLING-SECRET");
fs.writeFileSync(path.join(vault, ".env"), "HIDDEN-SECRET");
fs.writeFileSync(path.join(vault, "sub", "data.txt"), "NOT-MARKDOWN");
fs.writeFileSync(path.join(vault, "sub", "ok.md"), "# Fine\nhello note");
fs.symlinkSync(path.join(root, "outside", "secret.md"), path.join(vault, "link.md"));

const checks = [
  { name: "normal note is readable", uri: "note:///sub/ok.md", mustContain: "hello note" },
  { name: "../ traversal blocked", uri: "note:///../outside/secret.md", mustNotContain: "OUTSIDE-SECRET" },
  { name: "prefix-sibling folder blocked", uri: "note:///../vault-evil/x.md", mustNotContain: "PREFIX-SIBLING-SECRET" },
  { name: "symlink out of the vault blocked", uri: "note:///link.md", mustNotContain: "OUTSIDE-SECRET" },
  { name: "hidden file blocked", uri: "note:///.env", mustNotContain: "HIDDEN-SECRET" },
  { name: "non-.md file blocked", uri: "note:///sub/data.txt", mustNotContain: "NOT-MARKDOWN" },
];

const child = spawn("node", [server], { env: { ...process.env, NOTES_DIR: vault } });
let buf = "";
child.stdout.on("data", (d) => (buf += d));
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "check", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
checks.forEach((c, i) =>
  send({ jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "get_note", arguments: { identifier: c.uri } } })
);

setTimeout(() => {
  const replies = {};
  for (const line of buf.split("\n").filter(Boolean)) {
    try { const j = JSON.parse(line); if (j.id >= 100) replies[j.id] = JSON.stringify(j); } catch {}
  }
  let failed = 0;
  checks.forEach((c, i) => {
    const r = replies[100 + i] ?? "";
    const ok = c.mustContain ? r.includes(c.mustContain) : r !== "" && !r.includes(c.mustNotContain);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  });
  child.kill();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}, 2500);
