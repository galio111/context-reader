import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function runtimeImports(path: string): string[] {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return file.statements.filter(ts.isImportDeclaration).filter(statement => {
    const clause = statement.importClause;
    if (clause?.isTypeOnly) return false;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      && !clause.name && clause.namedBindings.elements.every(item => item.isTypeOnly)) return false;
    return true;
  }).map(statement => (statement.moduleSpecifier as ts.StringLiteral).text);
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
    ["components/useReaderTranslationSession.ts", ["react", "@/lib/accountEvents", "@/lib/learningStorage", "@/lib/cache", "@/lib/articleTranslationJobs", "@/lib/accountStorageTransition"]],
  ]);
  for (const [path, imports] of allowed) {
    for (const dependency of runtimeImports(path)) assert.ok(imports.includes(dependency), `${path} must not acquire undocumented dependency ${dependency}`);
  }
});

test("domain/runtime modules do not import UI components or server adapters", () => {
  for (const path of ["lib/readerDocumentModel.ts", "lib/articleTranslationProgress.ts", "lib/articleTranslationTransport.ts", "lib/translationCacheRepository.ts", "lib/articleTranslationJobs.ts"]) {
    for (const dependency of runtimeImports(path)) {
      assert.doesNotMatch(dependency, /(?:^react(?:\/|$)|components\/|app\/|server-only|supabase|deepseek)/, `${path} acquired a UI/server dependency`);
    }
  }
});
