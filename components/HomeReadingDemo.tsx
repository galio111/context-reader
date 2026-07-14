export function HomeReadingDemo() {
  return (
    <div className="relative mx-auto w-full max-w-[610px]" aria-label="Context Reader 语境查词演示">
      <div className="absolute -inset-3 -z-10 rounded-[24px] bg-[#dce9df]/70 blur-2xl" aria-hidden="true" />
      <div className="overflow-hidden rounded-[18px] bg-white ring-1 ring-[#183f34]/12">
        <div className="flex h-11 items-center justify-between border-b border-[#183f34]/10 px-4">
          <div className="flex gap-1.5" aria-hidden="true"><span className="h-2 w-2 rounded-full bg-[#cfd8d2]" /><span className="h-2 w-2 rounded-full bg-[#cfd8d2]" /><span className="h-2 w-2 rounded-full bg-[#cfd8d2]" /></div>
          <span className="text-[11px] font-medium text-[#718078]">READING VIEW</span>
          <span className="h-2 w-10 rounded-full bg-[#e7ece8]" aria-hidden="true" />
        </div>
        <div className="grid min-h-[330px] md:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-[#183f34]/10 px-5 py-6 md:border-b-0 md:border-r md:px-7 md:py-8">
            <span className="text-[11px] font-medium text-[#718078]">THE ATLANTIC · 6 MIN READ</span>
            <h2 className="mt-3 max-w-[16ch] font-serif text-[23px] font-semibold leading-[1.2] text-[#17221d]">Why attention needs room to wander</h2>
            <div className="mt-5 space-y-3 font-serif text-[14px] leading-[1.8] text-[#3c4842]">
              <p>Deep reading asks the mind to slow down. It creates space for ideas to connect and for difficult arguments to become clear.</p>
              <p>That kind of attention is increasingly <span className="home-demo-highlight rounded-[4px] bg-[#c9e3d4] px-1 py-0.5 font-semibold text-[#174d3b]">elusive</span> in a world of constant alerts.</p>
            </div>
          </div>
          <aside className="home-demo-panel bg-[#f7f9f7] px-5 py-6 md:px-6 md:py-8">
            <div className="flex items-center justify-between gap-3"><span className="text-lg font-semibold text-[#183f34]">elusive</span><span className="rounded-full bg-[#e1eae4] px-2 py-1 text-[10px] font-medium text-[#53625b]">adjective</span></div>
            <p className="mt-1 text-xs text-[#718078]">/ɪˈluːsɪv/</p>
            <div className="mt-5">
              <p className="text-xs font-medium text-[#637169]">在这句话里</p>
              <p className="mt-1.5 text-[15px] font-medium leading-6 text-[#1c2b24]">难以获得或维持的</p>
              <p className="mt-3 text-xs leading-5 text-[#637169]">这里形容专注力越来越难以持续，不是“逃脱的”字面意思。</p>
            </div>
            <span className="mt-6 inline-flex h-9 items-center rounded-full border border-[#2d765e]/30 bg-white px-3 text-xs font-semibold text-[#285143]">＋ 保存到生词本</span>
          </aside>
        </div>
      </div>
      <div className="absolute -bottom-3 left-5 rounded-full bg-[#183f34] px-3 py-1.5 text-[11px] font-medium text-white md:left-auto md:right-5">点词，理解，然后继续读</div>
    </div>
  );
}
