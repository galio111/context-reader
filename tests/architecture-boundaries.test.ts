import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

function runtimeImports(path: string): string[] {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return file.statements.flatMap(statement => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) return [];
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        && !clause.name && clause.namedBindings.elements.every(item => item.isTypeOnly)) return [];
      return [statement.moduleSpecifier.text];
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.every(item => item.isTypeOnly)) return [];
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function localTarget(file: string, specifier: string): string | null {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const root = process.cwd();
  const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(root, dirname(file), specifier);
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + suffix)) return relative(root, base + suffix).replaceAll("\\", "/");
  }
  return null;
}

test("reading runtime layers keep their documented import boundaries", () => {
  // A dependency change is an explicit architecture decision. Add behavior tests
  // and update the boundary contract when intentionally adding a new edge.
  const allowed = new Map<string, string[]>([
    ["lib/readerDocumentModel.ts", ["@/lib/readerBlockTokens", "@/lib/readerTokenIdentity", "@/lib/sourceMatching"]],
    ["lib/articleTranslationProgress.ts", []],
    ["lib/articleTranslationTransport.ts", []],
    ["lib/accountStorageTransition.ts", []],
    ["lib/translationCacheRepository.ts", ["@/lib/learningStorage", "@/lib/articleTranslationIdentity"]],
    ["lib/vocabularyRepository.ts", ["@/lib/learningStorage", "@/lib/ankiData", "lz-string", "@/lib/accountEvents", "@/lib/vocabularyMerge", "@/lib/dictionaryResultSnapshot"]],
    ["components/useReaderTranslationSession.ts", ["react", "@/lib/accountEvents", "@/lib/learningStorage", "@/lib/cache", "@/lib/articleTranslationJobs", "@/lib/accountStorageTransition"]],
  ]);
  for (const [path, imports] of allowed) {
    for (const dependency of runtimeImports(path)) assert.ok(imports.includes(dependency), `${path} must not acquire undocumented dependency ${dependency}`);
  }
});

test("domain/runtime modules do not import UI components or server adapters", () => {
  for (const path of ["lib/readerDocumentModel.ts", "lib/articleTranslationProgress.ts", "lib/articleTranslationTransport.ts", "lib/translationCacheRepository.ts", "lib/vocabularyRepository.ts", "lib/articleTranslationJobs.ts"]) {
    for (const dependency of runtimeImports(path)) {
      assert.doesNotMatch(dependency, /(?:^react(?:\/|$)|components\/|app\/|server-only|supabase|deepseek)/, `${path} acquired a UI/server dependency`);
    }
  }
  for (const path of ["lib/readerDocumentModel.ts", "lib/articleTranslationProgress.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:window|document|localStorage|sessionStorage|fetch)\s*[.(]/, `${path} remains pure without browser, storage or network effects`);
  }
});

test("reading runtime dependency graph has no cycles or reverse edges into Reader and routes", () => {
  const roots = ["lib/readerDocumentModel.ts", "lib/articleTranslationProgress.ts", "lib/articleTranslationTransport.ts", "lib/translationCacheRepository.ts", "lib/vocabularyRepository.ts", "lib/articleTranslationJobs.ts", "components/useReaderTranslationSession.ts"];
  const completed = new Set<string>();
  const active: string[] = [];
  function visit(file: string) {
    assert.ok(!active.includes(file), "runtime dependency cycle: " + [...active, file].join(" -> "));
    if (completed.has(file)) return;
    active.push(file);
    for (const specifier of runtimeImports(file)) {
      const target = localTarget(file, specifier);
      if (!target) continue;
      assert.ok(target !== "components/ReaderView.tsx" && !target.startsWith("app/"), `${file} must not reach Reader/route orchestration from lower layers`);
      visit(target);
    }
    active.pop();
    completed.add(file);
  }
  roots.forEach(visit);
  assert.ok(completed.size >= roots.length);
});
