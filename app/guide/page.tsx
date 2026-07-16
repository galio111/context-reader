import type { Metadata } from "next";
import Link from "next/link";
import { GuideAnkiSetup } from "@/components/GuideAnkiSetup";

export const metadata: Metadata = {
  title: "使用说明 | Context Reader",
  description: "了解如何用 Context Reader 阅读英文长文、查词、保存词汇并连接 Anki。",
};

const basicSteps = [
  ["带入文章", "粘贴英文文本，或导入一篇公开网页。文章会进入专注阅读界面。"],
  ["理解当前语境", "点击单词或划选短语，查看它在当前句子里的中文含义。"],
  ["按需辅助理解", "遇到结构复杂的文章时，再启动全文翻译。查词和全文翻译互不打断。"],
  ["留下重要表达", "把值得复习的词和短语保存到生词本，之后导出 CSV 或导入 Anki。"],
] as const;

const faqs = [
  {
    question: "为什么 Anki 连接失败？",
    answer: "请先确认桌面版 Anki 正在运行，AnkiConnect 已安装并在重启后生效，默认地址是 http://127.0.0.1:8765。线上网站还可能需要浏览器授权访问本地网络，并在 AnkiConnect 配置中允许当前网站来源。",
  },
  {
    question: "为什么必须打开 Anki？",
    answer: "Context Reader 通过 AnkiConnect 与你电脑上正在运行的 Anki 通信。Anki 没有打开时，本地接口不会运行，网页也就无法创建卡片。",
  },
  {
    question: "手机上可以直接导入 Anki 吗？",
    answer: "目前不可以直接导入。AnkiConnect 运行在桌面版 Anki 中，建议在电脑浏览器完成导入，再使用 Anki 的同步功能在手机上复习。CSV 导出仍可作为备用方式。",
  },
  {
    question: "导入后在哪里看到卡片？",
    answer: "卡片会进入你在阅读页 Anki 设置中选择的 Deck。Context Reader 会在导入时创建或更新自己的 note type，并保留语境含义、源句和卡片字段。",
  },
  {
    question: "卡片会自动播放音频吗？",
    answer: "Context Reader 会尽量关闭目标 Deck 的音频自动播放。卡片背面提供 Anki 原生的美式和英式 TTS 播放控件，默认由你点击后播放。",
  },
  {
    question: "Context Reader 会下载发音文件吗？",
    answer: "不会。当前方案使用 Anki 自带的 TTS 能力，不下载也不保存音频媒体文件。实际可用声音取决于你的系统和 Anki 环境。",
  },
  {
    question: "文章和词汇保存在哪里？",
    answer: "目前主要保存在当前浏览器的本地存储中。清理网站数据、更换浏览器或更换设备前，建议先导出重要词汇。",
  },
] as const;

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
      <path d="M6 14 14 6m-6 0h6v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-[#f3f5f2] text-[#18211d]">
      <header className="border-b border-[#18211d]/10 bg-[#f3f5f2]/95">
        <div className="mx-auto flex h-16 max-w-[1080px] items-center justify-between px-4 sm:px-6">
          <Link className="group flex items-center" href="/">
            <span>
              <span className="block text-[15px] font-semibold leading-5">Context Reader</span>
              <span className="hidden text-xs text-[#5d6b65] sm:block">使用说明</span>
            </span>
          </Link>
          <Link className="inline-flex h-10 items-center rounded-full border border-[#183f34]/20 bg-white px-4 text-sm font-medium text-[#183f34] transition-colors hover:border-[#183f34]/40 hover:bg-[#f8faf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href="/">
            返回阅读首页
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1080px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <section className="grid items-end gap-8 border-b border-[#18211d]/15 pb-10 lg:grid-cols-[1fr_0.72fr] lg:gap-14 lg:pb-14">
          <div>
            <p className="text-sm font-semibold text-[#2d765e]">从一篇真实文章开始</p>
            <h1 className="mt-3 max-w-[14ch] text-balance text-[38px] font-semibold leading-[1.12] tracking-[-0.035em] text-[#14231d] sm:text-[48px]">
              少切换几次，把英文继续读下去
            </h1>
            <p className="mt-5 max-w-[64ch] text-pretty text-base leading-7 text-[#53625b] sm:text-[17px]">
              词典会给出许多义项，阅读时你真正需要的是当前句子的含义。Context Reader 把语境解释、生词保存和 Anki 导入放在同一条阅读路径里。
            </p>
          </div>
          <nav aria-label="使用说明目录" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
            {[
              ["#start", "基础流程"],
              ["#reading-tools", "阅读辅助"],
              ["#anki-setup", "Anki 设置"],
              ["#faq", "常见问题"],
            ].map(([href, label]) => (
              <a key={href} className="rounded-full bg-white px-4 py-2.5 text-sm font-medium text-[#43524b] transition-colors hover:bg-[#e6ece8] hover:text-[#18211d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href={href}>{label}</a>
            ))}
          </nav>
        </section>

        <section id="start" className="scroll-mt-8 py-14 sm:py-16" aria-labelledby="start-title">
          <div className="grid gap-9 lg:grid-cols-[0.68fr_1.32fr] lg:gap-16">
            <div>
              <h2 id="start-title" className="text-3xl font-semibold tracking-[-0.03em]">第一次使用</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[#5b6962]">先完成一次完整阅读，不必在开始前配置所有功能。</p>
              <Link className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#1769aa] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#125b94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href="/">
                粘贴文章开始阅读
                <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ol className="divide-y divide-[#18211d]/12 border-y border-[#18211d]/12">
              {basicSteps.map(([title, copy], index) => (
                <li key={title} className="grid gap-3 py-5 sm:grid-cols-[2.5rem_10rem_1fr] sm:items-start sm:gap-5">
                  <span className="font-mono text-xs text-[#2d765e]">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="font-semibold text-[#24352d]">{title}</h3>
                  <p className="max-w-[60ch] text-sm leading-6 text-[#5b6962]">{copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="reading-tools" className="scroll-mt-8 border-y border-[#18211d]/12 py-14 sm:py-16" aria-labelledby="tools-title">
          <div className="max-w-2xl">
            <h2 id="tools-title" className="text-3xl font-semibold tracking-[-0.03em]">两种辅助，各自解决一种问题</h2>
            <p className="mt-3 text-sm leading-6 text-[#5b6962]">查词适合保持原文阅读，全文翻译适合梳理复杂段落。它们是独立任务，不会因为切换侧栏而互相取消。</p>
          </div>
          <div className="mt-9 grid gap-5 md:grid-cols-2">
            <article className="rounded-[14px] bg-white p-6">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl font-semibold tracking-[-0.02em]">语境查词</h3>
                <span className="rounded-full bg-[#e4f1e9] px-3 py-1 text-xs font-medium text-[#285143]">默认选择</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-[#53625b]">点击单词或划选短语，只解释它在当前句子里的用法。适合大多数阅读时刻，信息更少，返回原文更快。</p>
              <ul className="mt-5 space-y-2 text-sm text-[#34443c]">
                <li>• 当前语境含义与自然句子翻译</li>
                <li>• 音标、搭配、用法和例句</li>
                <li>• 一键保存到本地生词本</li>
              </ul>
            </article>
            <article className="rounded-[14px] bg-[#e8edeb] p-6">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl font-semibold tracking-[-0.02em]">全文翻译</h3>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#52625a]">按需启动</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-[#53625b]">在阅读页右侧工具栏主动启动，适合检查文章结构、代词关系或难段。进入翻译侧栏不会自动消耗请求。</p>
              <ul className="mt-5 space-y-2 text-sm text-[#34443c]">
                <li>• 按文章段落逐步显示结果</li>
                <li>• 已完成的段落会在本地复用</li>
                <li>• 切回查词时翻译继续进行</li>
              </ul>
            </article>
          </div>

          <div className="mt-8 grid gap-6 rounded-[14px] bg-[#183f34] p-6 text-white sm:grid-cols-[0.72fr_1.28fr] sm:p-8">
            <div>
              <h3 className="text-xl font-semibold">生词本是长期学习资料</h3>
              <p className="mt-2 text-sm leading-6 text-[#cbd9d3]">保存的不只是一个中文释义，而是这个词出现时的阅读现场。</p>
            </div>
            <div className="flex flex-wrap content-start gap-2 text-sm text-[#e4eee9]">
              {["单词或短语", "IPA 音标", "当前语境含义", "源句", "例句", "Anki 字段"].map((field) => (
                <span key={field} className="rounded-full bg-white/10 px-3 py-2">{field}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="anki-setup" className="scroll-mt-8 py-14 sm:py-16" aria-labelledby="anki-title">
          <div className="grid gap-8 lg:grid-cols-[0.68fr_1.32fr] lg:gap-16">
            <div>
              <h2 id="anki-title" className="text-3xl font-semibold tracking-[-0.03em]">把阅读中的词带进 Anki</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[#5b6962]">Anki 是间隔重复记忆软件。Context Reader 负责整理语境卡片，桌面版 Anki 负责保存和复习。</p>
              <a className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#1769aa] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#125b94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer">
                下载桌面版 Anki
                <ArrowUpRightIcon />
              </a>
            </div>
            <ol className="grid gap-4 sm:grid-cols-2">
              {[
                ["下载桌面版 Anki", "根据 Windows、macOS 或 Linux 选择安装包。"],
                ["安装 AnkiConnect", "在 Anki 插件窗口输入代码 2055492159。"],
                ["重启并保持 Anki 打开", "网页只能连接正在运行的桌面版 Anki。"],
                ["回到阅读页导入", "先测试连接，再选择 Deck 并导入词汇。"],
              ].map(([title, copy], index) => (
                <li key={title} className="flex gap-4 rounded-[12px] bg-white p-5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e4f1e9] font-mono text-xs font-semibold text-[#285143]">{index + 1}</span>
                  <div><h3 className="font-semibold text-[#24352d]">{title}</h3><p className="mt-1 text-sm leading-6 text-[#5b6962]">{copy}</p></div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-10 rounded-[16px] bg-[#e8edeb] p-5 sm:p-8">
            <GuideAnkiSetup />
          </div>
        </section>

        <section id="faq" className="scroll-mt-8 border-t border-[#18211d]/12 pt-14 sm:pt-16" aria-labelledby="faq-title">
          <div className="grid gap-8 lg:grid-cols-[0.68fr_1.32fr] lg:gap-16">
            <div>
              <h2 id="faq-title" className="text-3xl font-semibold tracking-[-0.03em]">常见问题</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[#5b6962]">连接问题通常来自桌面 Anki、插件配置或浏览器本地网络权限。</p>
            </div>
            <div className="divide-y divide-[#18211d]/12 border-y border-[#18211d]/12">
              {faqs.map((item) => (
                <details key={item.question} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-4 font-semibold text-[#24352d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa] [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-lg font-normal text-[#53625b] transition-transform duration-200 group-open:rotate-45">+</span>
                  </summary>
                  <p className="max-w-[68ch] pb-5 pr-10 text-sm leading-6 text-[#5b6962]">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <footer className="mt-16 flex flex-col gap-5 border-t border-[#18211d]/12 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold">准备好后，从一篇你真想读的文章开始。</p><p className="mt-1 text-sm text-[#637169]">其余设置可以在需要时再完成。</p></div>
          <Link className="inline-flex h-11 w-fit items-center rounded-full bg-[#183f34] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#123229] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#183f34]" href="/">返回首页开始阅读</Link>
        </footer>
      </div>
    </main>
  );
}
