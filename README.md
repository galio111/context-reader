# Context Reader

Context Reader is a local Next.js MVP for reading English articles and clicking words to get Chinese context-aware explanations from the DeepSeek API.

## Features

- Paste an English article and enter reading mode.
- Click English words without sending the full article to AI.
- Explain only `word`, `sentence`, `previousSentence`, and `nextSentence`.
- Cache explanations in `localStorage` by `word + sentence`.
- Save vocabulary entries in `localStorage`.
- Export vocabulary as CSV for future Anki import.

## Setup

```bash
npm install
```

Create `.env.local` from the example:

```bash
cp .env.local.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

Then fill in:

```env
DEEPSEEK_API_KEY=your_real_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

Do not commit `.env.local`.

## Development

```bash
npm run dev
```

Open the URL printed by Next.js, usually `http://localhost:3000`.

## API Test

With the dev server running, send a POST request to `/api/explain-word`:

```json
{
  "word": "addressed",
  "sentence": "He addressed the issue carefully.",
  "previousSentence": "The team found several problems.",
  "nextSentence": "Their solution worked well."
}
```

If the API key is missing, the route returns a clear error instead of exposing secrets to the browser.

## Future Anki Merge

Vocabulary data is isolated in `lib/vocabulary.ts` and uses stable fields that can map directly to Anki note fields. A future Anki module can read saved entries, export CSV, or sync them through AnkiConnect without changing the reader or tokenizer layers.
