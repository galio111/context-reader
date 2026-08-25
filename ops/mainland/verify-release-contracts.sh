#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 RELEASE_DIR" >&2
  exit 64
fi

release_dir="$(readlink -f "$1")"
release_root="/opt/context-reader-releases"

if [[ "$release_dir" != "$release_root"/* || ! -d "$release_dir" ]]; then
  echo "unexpected release contract target: $release_dir" >&2
  exit 65
fi

require_text() {
  local file="$1"
  local text="$2"
  if ! grep -Fq -- "$text" "$release_dir/$file"; then
    echo "protected release contract missing in $file: $text" >&2
    exit 1
  fi
}

require_text "ops/mainland/deploy-release.sh" "RELEASE_GUARD_VERSION=1"
require_text "ops/mainland/deploy-release.sh" "context-reader-deploy.lock"
require_text "ops/mainland/deploy-release.sh" "parent release mismatch"
require_text "ops/mainland/deploy-release.sh" 'data.get("backendMode") != "mainland_internal"'
require_text "ops/mainland/start-mainland-app.mjs" 'process.env.CONTEXT_READER_RUNTIME_MODE !== "mainland"'
require_text "ops/mainland/start-mainland-app.mjs" 'process.env.SUPABASE_URL !== EXPECTED_INTERNAL_API'
require_text "ops/mainland/compose.yml" "CONTEXT_READER_RUNTIME_MODE: mainland"
require_text "ops/mainland/compose.yml" "SUPABASE_URL: http://supabase-api:8000"
require_text "app/api/connectivity/route.ts" "mainland_internal"
require_text "scripts/new-task-worktree.ps1" "git worktree add"
require_text "scripts/new-task-worktree.ps1" 'codex/$TaskName'
require_text "package.json" "verify:release-contracts"
require_text "lib/pronunciation.ts" "currentFormPhonetic"
require_text "types/reader.ts" "phoneticFor?: string"
require_text "types/dictionary.ts" "phoneticFor?: string"
require_text "types/vocabulary.ts" "phoneticFor?: string"
require_text "lib/deepseek.ts" "phoneticFor"
require_text "lib/deepseekDictionary.ts" "phoneticFor"
require_text "lib/dictionaryStream.ts" "pronunciationTargetMatches"
require_text "lib/dictionarySpelling.ts" "normalizePhoneticOwnership"
require_text "lib/dictionaryStreamServer.ts" "normalizeDictionaryStreamLine"
require_text "app/api/dictionary-stream/route.ts" "normalizeDictionaryStreamLine"
require_text "app/api/dictionary-stream/route.ts" "phoneticFor"
require_text "app/api/explain-word-stream/route.ts" "当前词音标归属"
require_text "lib/explanationDisplay.ts" "currentFormPhonetic"
require_text "lib/cache.ts" "currentFormPhonetic"
require_text "lib/standaloneDictionaryCache.ts" "standalone-dictionary-cache:v2"
require_text "lib/standaloneDictionary.ts" "phoneticFor"
require_text "lib/vocabulary.ts" "phoneticFor"
require_text "lib/vocabularyMerge.ts" '"phoneticFor"'
require_text "lib/csv.ts" "currentFormPhonetic"
require_text "lib/ankiTemplates.ts" "currentFormPhonetic"
require_text "components/BookDictionary.tsx" "原型：{result.lemma}"
require_text "components/BookDictionary.tsx" "当前词音标"
require_text "components/BookDictionary.tsx" "PronunciationButtons text={result.query}"
require_text "components/ExplanationPanel.tsx" "当前词音标："
require_text "components/ExplanationPanel.tsx" "PronunciationButtons text={selectedContext?.word"
require_text "components/AnkiPreviewModal.tsx" "currentFormPhonetic"
require_text "components/VocabularyPanel.tsx" "currentFormPhonetic"
require_text "components/HomeOptionMenu.tsx" "currentFormPhonetic"
require_text "components/BookHome.tsx" "currentFormPhonetic"
require_text "components/ArticleInput.tsx" "currentFormPhonetic"
require_text "components/ReaderView.tsx" "currentFormPhonetic"
require_text "app/api/import-url/route.ts" "localizeImportedArticleImages"
require_text "lib/publicArticleCovers.ts" "images.weserv.nl"
require_text "lib/publicArticleCovers.ts" "article-images/"
require_text "lib/publicArticleCovers.ts" "withArticleImageDownloadSlot"
require_text "app/api/admin/saved-article-images/route.ts" "repairExternalSavedArticleImages"
require_text "components/HomeClient.tsx" "/api/article-images/localize"

echo "protected release contracts present"
