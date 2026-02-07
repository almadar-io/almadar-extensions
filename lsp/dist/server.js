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
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
var TS_PREFIX = `import type { OrbitalSchema } from '@almadar/core';
const _orbital: OrbitalSchema = `;
var TS_SUFFIX = `;
`;
var WRAPPER_LINE_OFFSET = 1;
var WRAPPER_COL_OFFSET = 32;
var connection = createConnection(ProposedFeatures.all);
var documents = new TextDocuments(TextDocument);
var virtualFiles = /* @__PURE__ */ new Map();
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
function findMonorepoRoot(startPath) {
  if (workspaceRoot) {
    const coreAtRoot = path.join(workspaceRoot, "node_modules", "@almadar", "core");
    if (fs.existsSync(coreAtRoot)) {
      return workspaceRoot;
    }
  }
  let dir = path.dirname(startPath);
  for (let i = 0; i < 20; i++) {
    const corePath = path.join(dir, "node_modules", "@almadar", "core");
    if (fs.existsSync(corePath)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return workspaceRoot ?? path.dirname(startPath);
}
function createLanguageService2(rootDir) {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    baseUrl: rootDir,
    rootDir
  };
  const host = {
    getScriptFileNames: () => [...virtualFiles.keys()],
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const content = virtualFiles.get(fileName);
      if (content !== void 0) {
        return ts.ScriptSnapshot.fromString(content);
      }
      try {
        const text = ts.sys.readFile(fileName);
        if (text !== void 0) {
          return ts.ScriptSnapshot.fromString(text);
        }
      } catch {
      }
      return void 0;
    },
    getCurrentDirectory: () => rootDir,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => {
      if (virtualFiles.has(fileName)) return true;
      return ts.sys.fileExists(fileName);
    },
    readFile: (fileName) => {
      const content = virtualFiles.get(fileName);
      if (content !== void 0) return content;
      return ts.sys.readFile(fileName);
    },
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}
var languageService = null;
var resolvedRoot = null;
function getLanguageService(orbFilePath) {
  const root = findMonorepoRoot(orbFilePath);
  if (!languageService || resolvedRoot !== root) {
    resolvedRoot = root;
    languageService = createLanguageService2(root);
    connection.console.log(`OrbLSP: TS LanguageService rooted at ${root}`);
  }
  return languageService;
}
function getVirtualPath(orbUri) {
  const filePath = orbUri.startsWith("file://") ? decodeURIComponent(orbUri.slice(7)) : orbUri;
  return filePath + ".ts";
}
function isDiagnosticInWrapper(diag) {
  if (diag.start === void 0) return false;
  const msg = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
  if (msg.includes("Cannot find module '@almadar/core'")) return true;
  if (diag.code === 2307) return true;
  return false;
}
function validateOrbDocument(document) {
  const orbContent = document.getText();
  if (!orbContent.trim()) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }
  const virtualPath = getVirtualPath(document.uri);
  const virtualContent = TS_PREFIX + orbContent + TS_SUFFIX;
  virtualFiles.set(virtualPath, virtualContent);
  const service = getLanguageService(virtualPath);
  const semanticDiags = service.getSemanticDiagnostics(virtualPath);
  const syntacticDiags = service.getSyntacticDiagnostics(virtualPath);
  const allDiags = [...syntacticDiags, ...semanticDiags];
  const diagnostics = [];
  for (const diag of allDiags) {
    if (diag.start === void 0 || diag.length === void 0) continue;
    if (isDiagnosticInWrapper(diag)) continue;
    const sourceFile = service.getProgram()?.getSourceFile(virtualPath);
    if (!sourceFile) continue;
    const startPos = ts.getLineAndCharacterOfPosition(sourceFile, diag.start);
    const endPos = ts.getLineAndCharacterOfPosition(
      sourceFile,
      diag.start + diag.length
    );
    if (startPos.line < WRAPPER_LINE_OFFSET) continue;
    const orbStartLine = startPos.line - WRAPPER_LINE_OFFSET;
    const orbStartChar = orbStartLine === 0 ? Math.max(0, startPos.character - WRAPPER_COL_OFFSET) : startPos.character;
    const orbEndLine = endPos.line - WRAPPER_LINE_OFFSET;
    const orbEndChar = orbEndLine === 0 ? Math.max(0, endPos.character - WRAPPER_COL_OFFSET) : endPos.character;
    const message = ts.flattenDiagnosticMessageText(
      diag.messageText,
      "\n"
    ).replace(/_orbital/g, ".orb file");
    const severity = diag.category === ts.DiagnosticCategory.Error ? DiagnosticSeverity.Error : diag.category === ts.DiagnosticCategory.Warning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Information;
    diagnostics.push({
      range: {
        start: { line: Math.max(0, orbStartLine), character: Math.max(0, orbStartChar) },
        end: { line: Math.max(0, orbEndLine), character: Math.max(0, orbEndChar) }
      },
      message,
      severity,
      source: "almadar-orb",
      code: diag.code
    });
  }
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
documents.onDidChangeContent((change) => {
  validateOrbDocument(change.document);
});
documents.onDidClose((event) => {
  const virtualPath = getVirtualPath(event.document.uri);
  virtualFiles.delete(virtualPath);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
documents.listen(connection);
connection.listen();
connection.console.log("Almadar OrbLSP started");
//# sourceMappingURL=server.js.map