import { createRequire } from "module"; const require = createRequire(import.meta.url);

// src/server.ts
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  DiagnosticSeverity
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";

// src/json-path.ts
function jsonPathToPosition(jsonText, jsonPath) {
  if (!jsonPath) return { line: 0, character: 0 };
  const segments = jsonPath.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cursor = 0;
  for (const seg of segments) {
    const isIndex = /^\d+$/.test(seg);
    if (isIndex) {
      const idx = parseInt(seg, 10);
      const bracketPos = jsonText.indexOf("[", cursor);
      if (bracketPos === -1) break;
      cursor = bracketPos + 1;
      let depth = 0;
      let count = 0;
      for (let i = cursor; i < jsonText.length; i++) {
        const ch = jsonText[i];
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
          if (depth === 0) break;
          depth--;
        } else if (ch === "," && depth === 0) {
          count++;
          if (count === idx) {
            cursor = i + 1;
            while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
            break;
          }
        }
      }
      if (count < idx && idx > 0) break;
      if (idx === 0) {
        while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
      }
    } else {
      const keyPattern = new RegExp(`"${escapeRegex(seg)}"\\s*:`);
      const match = keyPattern.exec(jsonText.slice(cursor));
      if (!match) break;
      cursor += match.index;
    }
  }
  return offsetToPosition(jsonText, cursor);
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function offsetToPosition(text, offset) {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

// src/server.ts
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
var DEBOUNCE_MS = 500;
var connection = createConnection(ProposedFeatures.all);
var documents = new TextDocuments(TextDocument);
var debounceTimers = /* @__PURE__ */ new Map();
var workspaceRoot = null;
connection.onInitialize((params) => {
  if (params.rootUri) {
    workspaceRoot = decodeURIComponent(params.rootUri.replace("file://", ""));
  } else if (params.rootPath) {
    workspaceRoot = params.rootPath;
  }
  connection.console.log(`OrbLSP initialized. Workspace root: ${workspaceRoot}`);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full
    }
  };
});
function runValidate(filePath) {
  return new Promise((resolve) => {
    const npxPath = "npx";
    execFile(npxPath, ["-y", "@almadar/cli", "validate", "--json", filePath], {
      cwd: workspaceRoot ?? path.dirname(filePath),
      timeout: 3e4,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch {
        connection.console.error(
          `OrbLSP: almadar validate failed: ${error?.message ?? stderr}`
        );
        resolve({
          success: false,
          valid: false,
          errors: [{
            code: "CLI_ERROR",
            path: "",
            message: `Validation CLI error: ${error?.message ?? "unknown error"}`
          }]
        });
      }
    });
  });
}
async function validateOrbDocument(document) {
  const orbContent = document.getText();
  if (!orbContent.trim()) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `orb-lsp-${process.pid}-${Date.now()}.orb`);
  try {
    fs.writeFileSync(tmpFile, orbContent, "utf-8");
    const result = await runValidate(tmpFile);
    const diagnostics = [];
    if (result.errors) {
      for (const err of result.errors) {
        diagnostics.push(makeDiagnostic(
          orbContent,
          err,
          DiagnosticSeverity.Error
        ));
      }
    }
    if (result.warnings) {
      for (const warn of result.warnings) {
        diagnostics.push(makeDiagnostic(
          orbContent,
          warn,
          DiagnosticSeverity.Warning
        ));
      }
    }
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
    }
  }
}
function makeDiagnostic(orbContent, item, severity) {
  const pos = jsonPathToPosition(orbContent, item.path);
  const lines = orbContent.split("\n");
  const lineText = lines[pos.line] ?? "";
  const endChar = lineText.length;
  let message = item.message;
  if (item.suggestion) {
    message += `
\u{1F4A1} ${item.suggestion}`;
  }
  return {
    range: {
      start: { line: pos.line, character: pos.character },
      end: { line: pos.line, character: endChar }
    },
    message,
    severity,
    source: "almadar",
    code: item.code
  };
}
documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  const existing = debounceTimers.get(uri);
  if (existing) clearTimeout(existing);
  debounceTimers.set(uri, setTimeout(() => {
    debounceTimers.delete(uri);
    validateOrbDocument(change.document);
  }, DEBOUNCE_MS));
});
documents.onDidClose((event) => {
  const timer = debounceTimers.get(event.document.uri);
  if (timer) clearTimeout(timer);
  debounceTimers.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
documents.listen(connection);
connection.listen();
connection.console.log("Almadar OrbLSP started (CLI mode)");
//# sourceMappingURL=server.js.map