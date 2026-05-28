"use client";

import { DEFAULT_ANKI_DECK, DEFAULT_ANKI_ENDPOINT } from "@/lib/ankiTemplates";
import type { AnkiSettings } from "@/types/anki";

interface AnkiSettingsPanelProps {
  settings: AnkiSettings;
  status: string;
  checking: boolean;
  onChange: (settings: AnkiSettings) => void;
  onCheck: () => void;
}

export function defaultAnkiSettings(): AnkiSettings {
  return {
    endpoint: DEFAULT_ANKI_ENDPOINT,
    deckName: DEFAULT_ANKI_DECK,
  };
}

export function AnkiSettingsPanel({
  settings,
  status,
  checking,
  onChange,
  onCheck,
}: AnkiSettingsPanelProps) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-4 shadow-xl">
      <h2 className="text-sm font-semibold text-gray-950">Anki 设置</h2>
      <div className="mt-3 grid gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">AnkiConnect 地址</span>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
            value={settings.endpoint}
            onChange={(event) => onChange({ ...settings, endpoint: event.target.value })}
            placeholder={DEFAULT_ANKI_ENDPOINT}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Deck</span>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-950 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
            value={settings.deckName}
            onChange={(event) => onChange({ ...settings, deckName: event.target.value })}
            placeholder={DEFAULT_ANKI_DECK}
          />
        </label>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
          onClick={onCheck}
          disabled={checking}
        >
          {checking ? "检测中" : "检测连接"}
        </button>
      </div>
      {status && <p className="mt-3 text-sm leading-6 text-gray-700">{status}</p>}
    </section>
  );
}
