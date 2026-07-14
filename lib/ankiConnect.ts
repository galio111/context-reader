import type { AnkiCardMode } from "@/types/anki";
import type { VocabularyEntry } from "@/types/vocabulary";
import {
  DEFAULT_ANKI_DECK,
  DEFAULT_ANKI_ENDPOINT,
  fieldsForEntry,
  modelDefinition,
  modelNameForMode,
} from "@/lib/ankiTemplates";

interface AnkiConnectResponse<T> {
  result: T;
  error: string | null;
}

export class AnkiConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkiConnectError";
  }
}

function validatedAnkiEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AnkiConnectError("AnkiConnect 地址格式不正确。");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(hostname) ||
    (url.port && url.port !== "8765") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new AnkiConnectError("出于安全原因，AnkiConnect 只允许使用本机 127.0.0.1:8765。");
  }
  url.hostname = "127.0.0.1";
  url.port = "8765";
  url.pathname = "/";
  return url.toString();
}

function friendlyNetworkError(endpoint: string): string {
  return `无法连接 AnkiConnect。请确认 Anki 已打开、AnkiConnect 插件已安装，并且地址 ${endpoint} 可以访问。`;
}

export async function invokeAnkiConnect<T>(
  action: string,
  params: Record<string, unknown> = {},
  endpoint = DEFAULT_ANKI_ENDPOINT,
): Promise<T> {
  const safeEndpoint = validatedAnkiEndpoint(endpoint);
  let response: Response;
  try {
    response = await fetch(safeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AnkiConnectError(
      `无法连接 AnkiConnect。请确认 Anki 已打开、AnkiConnect 插件已安装，并且地址 ${safeEndpoint} 可以访问。如果你正在使用线上网站，请在 AnkiConnect 配置的 webCorsOriginList 中允许 https://context-reader-ten.vercel.app。`,
    );
  }

  if (!response.ok) {
    throw new AnkiConnectError(`AnkiConnect 返回 HTTP ${response.status}，请检查地址是否正确。`);
  }

  const data = (await response.json().catch(() => null)) as AnkiConnectResponse<T> | null;
  if (!data || !("result" in data) || !("error" in data)) {
    throw new AnkiConnectError("AnkiConnect 返回格式异常，请确认插件版本正常。");
  }
  if (data.error) {
    throw new AnkiConnectError(data.error);
  }
  return data.result;
}

export async function checkAnki(endpoint?: string): Promise<number> {
  return invokeAnkiConnect<number>("version", {}, endpoint);
}

export async function getDeckNames(endpoint?: string): Promise<string[]> {
  return invokeAnkiConnect<string[]>("deckNames", {}, endpoint);
}

export async function createDeck(deckName = DEFAULT_ANKI_DECK, endpoint?: string): Promise<number> {
  return invokeAnkiConnect<number>("createDeck", { deck: deckName }, endpoint);
}

async function disableDeckAudioAutoplay(deckName: string, endpoint?: string): Promise<void> {
  try {
    const config = await invokeAnkiConnect<Record<string, unknown>>(
      "getDeckConfig",
      { deck: deckName },
      endpoint,
    );

    await invokeAnkiConnect(
      "saveDeckConfig",
      {
        config: {
          ...config,
          autoplay: false,
        },
      },
      endpoint,
    );
  } catch {
    // Older AnkiConnect/Anki combinations may not expose deck config writes.
    // Note import should still work; users can disable audio autoplay in Anki deck options.
  }
}

export async function getModelNames(endpoint?: string): Promise<string[]> {
  return invokeAnkiConnect<string[]>("modelNames", {}, endpoint);
}

export async function getModelFieldNames(modelName: string, endpoint?: string): Promise<string[]> {
  return invokeAnkiConnect<string[]>("modelFieldNames", { modelName }, endpoint);
}

async function ensureModelFields(
  modelName: string,
  expectedFields: string[],
  endpoint?: string,
): Promise<void> {
  const existingFields = await getModelFieldNames(modelName, endpoint);

  for (const fieldName of expectedFields) {
    if (existingFields.includes(fieldName)) {
      continue;
    }

    await invokeAnkiConnect(
      "modelFieldAdd",
      {
        modelName,
        fieldName,
        index: expectedFields.indexOf(fieldName),
      },
      endpoint,
    );
    existingFields.push(fieldName);
  }
}

export async function ensureModel(mode: AnkiCardMode, endpoint?: string): Promise<string> {
  const modelName = modelNameForMode(mode);
  const definition = modelDefinition(mode);
  const names = await getModelNames(endpoint);
  if (names.includes(modelName)) {
    await ensureModelFields(modelName, definition.inOrderFields, endpoint);
    await invokeAnkiConnect(
      "updateModelTemplates",
      {
        model: {
          name: modelName,
          templates: Object.fromEntries(
            definition.cardTemplates.map((template) => [
              template.Name,
              {
                Front: template.Front,
                Back: template.Back,
              },
            ]),
          ),
        },
      },
      endpoint,
    );
    await invokeAnkiConnect(
      "updateModelStyling",
      {
        model: {
          name: modelName,
          css: definition.css,
        },
      },
      endpoint,
    );
    return modelName;
  }

  await invokeAnkiConnect("createModel", definition, endpoint);
  return modelName;
}

export async function addVocabularyNote(
  entry: VocabularyEntry,
  deckName = DEFAULT_ANKI_DECK,
  endpoint?: string,
): Promise<number> {
  if (entry.anki.ankiNoteId) {
    throw new AnkiConnectError("这个词条已经导入过 Anki，不会重复导入。");
  }

  await createDeck(deckName, endpoint);
  await disableDeckAudioAutoplay(deckName, endpoint);
  const modelName = await ensureModel(entry.anki.cardMode, endpoint);
  const result = await invokeAnkiConnect<number>(
    "addNote",
    {
      note: {
        deckName,
        modelName,
        fields: fieldsForEntry(entry),
        options: { allowDuplicate: true },
        tags: ["context-reader", entry.anki.cardMode],
      },
    },
    endpoint,
  );
  return Number(result);
}
