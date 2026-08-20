"use client";

import { DEFAULT_ANKI_DECK, DEFAULT_ANKI_ENDPOINT } from "@/lib/ankiTemplates";
import ClearableField from "@/components/ClearableField";
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
    <section className="rounded-[18px] border border-[#e0e0e0] bg-white p-4">
      <h2 className="text-sm font-semibold tracking-[-0.224px] text-[#1d1d1f]">Anki 设置</h2>
      <div className="mt-3 grid gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold tracking-[-0.224px] text-[#333333]">AnkiConnect 地址</span>
          <ClearableField value={settings.endpoint} onClear={() => onChange({ ...settings, endpoint: "" })} label="清空 AnkiConnect 地址">
            <input
              className="h-11 w-full rounded-full border border-black/10 px-4 text-sm tracking-[-0.224px] text-[#1d1d1f] outline-none focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
              value={settings.endpoint}
              onChange={(event) => onChange({ ...settings, endpoint: event.target.value })}
              placeholder={DEFAULT_ANKI_ENDPOINT}
            />
          </ClearableField>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold tracking-[-0.224px] text-[#333333]">Deck</span>
          <ClearableField value={settings.deckName} onClear={() => onChange({ ...settings, deckName: "" })} label="清空 Deck 名称">
            <input
              className="h-11 w-full rounded-full border border-black/10 px-4 text-sm tracking-[-0.224px] text-[#1d1d1f] outline-none focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
              value={settings.deckName}
              onChange={(event) => onChange({ ...settings, deckName: event.target.value })}
              placeholder={DEFAULT_ANKI_DECK}
            />
          </ClearableField>
        </label>
        <button
          type="button"
          className="h-10 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95 disabled:border-[#d2d2d7] disabled:text-[#7a7a7a]"
          onClick={onCheck}
          disabled={checking}
        >
          {checking ? "检测中" : "检测连接"}
        </button>
      </div>
      {status && <p className="mt-3 text-sm leading-6 tracking-[-0.224px] text-[#333333]">{status}</p>}
      <p className="mt-3 text-xs leading-5 tracking-[-0.12px] text-[#6e6e73]">
        以后从生词本成功导入的新卡片会自动附带相同的美音和英音；桌面 Anki 同步后，手机会随 AnkiWeb 媒体同步取得音频。
      </p>
    </section>
  );
}
