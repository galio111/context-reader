import type { Metadata } from "next";
import Link from "next/link";
import { GuideAnkiSetup } from "@/components/GuideAnkiSetup";

export const metadata: Metadata = {
  title: "新手使用指南 | Context Reader",
  description: "从第一次语境阅读到 Anki 复习，完整了解 Context Reader 的使用方式。",
};

const guideNav = [
  ["#understand", "这个网站做什么"],
  ["#first-reading", "第一次怎么用"],
  ["#context-learning", "为什么用语境背词"],
  ["#anki", "认识并连接 Anki"],
  ["#daily-workflow", "日常使用建议"],
  ["#faq", "常见问题"],
] as const;

const firstReadingSteps = [
  {
    title: "带入一篇你真的想读的文章",
    copy: "在首页粘贴英文内容，或输入公开文章网址。第一次建议选一篇不太长、你本来就感兴趣的文章。",
    hint: "入口：首页的“粘贴文章”或“输入网址”",
  },
  {
    title: "先读原文，遇到阻碍再查",
    copy: "点击一个单词，或横向划选一段短语。解释会结合当前句子，只告诉你这里真正用到的意思。",
    hint: "手机端：上下滑动只负责阅读，长按或横向划动才会选词",
  },
  {
    title: "只保存值得再见一次的词",
    copy: "把影响理解、反复遇到或你想主动使用的表达加入生词本。普通专有名词和一次性信息可以跳过。",
    hint: "保存内容会带上音标、语境含义、原句与例句",
  },
  {
    title: "需要长期记忆时，再交给 Anki",
    copy: "你可以先只用生词本。准备开始间隔复习后，再在电脑端连接 Anki，把选中的词汇导入卡组。",
    hint: "Anki 不是使用网站的前置条件",
  },
] as const;

const comparisonRows = [
  ["看到的材料", "孤立的单词、词表或统一例句", "你刚刚读过的原句和文章场景"],
  ["记住的意思", "常见中文释义，容易把多个义项混在一起", "这个词在当前句子里的词性、含义和作用"],
  ["回忆线索", "单词与中文的一对一对应", "原句、上下文、搭配和当时的阅读内容"],
  ["筛选依据", "按考试范围或别人整理的高频表", "按你真实阅读时的理解阻碍和兴趣"],
  ["适合解决", "快速扩大基础词汇覆盖面", "把“认识词义”推进到“能在真实句子里认出来”"],
] as const;

const dailySteps = [
  ["读", "先连续读一小段，不要求每个词都查。"],
  ["查", "只查阻碍理解或反复出现的词和短语。"],
  ["留", "每天保存少量真正有价值的表达。"],
  ["复习", "用生词本回看，或让 Anki 安排下一次出现。"],
] as const;

const faqGroups = [
  {
    title: "关于阅读与查词",
    items: [
      {
        question: "我应该每个生词都查吗？",
        answer: "不建议。先判断它是否阻碍主旨理解、是否重复出现、或者你是否想主动使用。查得太密会把阅读变成逐词翻译，反而失去语境学习的优势。",
      },
      {
        question: "语境查词和全文翻译有什么区别？",
        answer: "语境查词解决“这个词或短语在本句是什么意思”，适合维持英文阅读。全文翻译解决“这段或整篇文章的结构我仍然看不懂”，需要时再从阅读页侧栏主动启动。",
      },
      {
        question: "一定要注册账号才能用吗？",
        answer: "不需要。游客可以直接开始阅读，并按上海自然日试用 10 次单词或短语查询。保存、生词本、Anki、私有全文翻译、总结和图片识别等功能需要登录。",
      },
    ],
  },
  {
    title: "关于 Anki",
    items: [
      {
        question: "不用 Anki，可以只用 Context Reader 吗？",
        answer: "可以。阅读、语境解释和站内生词本可以独立使用。Anki 适合希望把重要词汇长期保留下来，并愿意每天进行少量复习的人。",
      },
      {
        question: "为什么连接时必须打开桌面版 Anki？",
        answer: "Context Reader 通过 AnkiConnect 与你电脑上正在运行的 Anki 通信。Anki 没有打开时，本地接口不会运行，网页也就无法读取卡组或创建卡片。",
      },
      {
        question: "为什么不能在网页里真正一键安装 Anki？",
        answer: "浏览器不能静默安装电脑软件，也不能在插件尚未安装时控制 Anki。这是操作系统和浏览器的安全边界。本站已经把流程压缩为打开官方下载页、复制一次插件代码、点击一次连接检测。",
      },
      {
        question: "手机上可以直接导入 Anki 吗？",
        answer: "目前不可以直接导入。AnkiConnect 运行在桌面版 Anki 中，请在电脑浏览器完成导入，再使用 Anki 同步在手机上复习。CSV 导出可以作为备用方式。",
      },
      {
        question: "导入后，卡片会出现在哪里？",
        answer: "卡片会进入你导入时选择的 Deck（卡组）。Context Reader 会自动创建或更新自己的卡片模板，并写入单词、音标、语境含义、源句、例句和复习提示。",
      },
      {
        question: "卡片会自动播放发音吗？",
        answer: "Context Reader 会尽量关闭目标卡组的音频自动播放。卡片背面提供 Anki 原生的美式和英式 TTS 控件，通常由你点击后播放，不会下载额外音频文件。",
      },
    ],
  },
  {
    title: "关于数据",
    items: [
      {
        question: "文章、生词和解释保存在哪里？",
        answer: "网站会先把数据保存在当前浏览器中。登录后，文章、词汇和相关学习数据还会同步到账号云端，便于跨设备继续使用。清理浏览器网站数据或更换设备前，仍建议导出重要词汇作为备份。",
      },
      {
        question: "清理浏览器缓存会丢失内容吗？",
        answer: "清理普通临时缓存通常不会影响数据，但如果同时清除了本站的“网站数据”或“本地存储”，游客数据可能丢失。登录用户应先确认同步完成，重要词汇可以额外导出 CSV。",
      },
    ],
  },
] as const;

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
      <path d="M6 14 14 6m-6 0h6v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
      <path d="m5 10.5 3.1 3.1L15 6.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function SectionHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="max-w-[720px]">
      <h2 className="text-balance text-[30px] font-semibold leading-[1.16] tracking-[-0.03em] text-[#17231e] sm:text-[36px]">{title}</h2>
      <p className="mt-4 max-w-[68ch] text-pretty text-[15px] leading-7 text-[#526159] sm:text-base">{copy}</p>
    </div>
  );
}

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-[#f4f6f3] text-[#18211d]">
      <header className="sticky top-0 z-30 border-b border-[#18211d]/10 bg-[#f4f6f3]/95 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1180px] items-center justify-between gap-5 px-4 sm:px-6">
          <Link className="group flex min-w-0 items-center" href="/">
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold leading-5">Context Reader</span>
              <span className="block truncate text-xs text-[#607068]">新手使用指南</span>
            </span>
          </Link>
          <Link className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#1769aa] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#125b94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href="/">
            <span className="hidden sm:inline">带一篇文章开始阅读</span>
            <span className="sm:hidden">开始阅读</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <section className="overflow-hidden rounded-[16px] bg-[#183f34] text-white">
          <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
            <div className="px-6 py-9 sm:px-10 sm:py-12 lg:px-14 lg:py-16">
              <p className="text-sm font-semibold text-[#a9d5c4]">第一次来，先看这里</p>
              <h1 className="mt-4 max-w-[15ch] text-balance text-[38px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[50px]">
                边读英文，边把真正不懂的词学会
              </h1>
              <p className="mt-6 max-w-[63ch] text-pretty text-base leading-7 text-[#d5e2dc] sm:text-[17px]">
                Context Reader 是一个面向中文学习者的英文阅读工具。你带入真实文章，点击单词或划选短语，网站会结合当前句子解释它的意思，并把值得复习的内容整理进生词本。
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#183f34] transition-colors hover:bg-[#edf3ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" href="/">
                  立即开始一次阅读
                  <span aria-hidden="true">→</span>
                </Link>
                <a className="inline-flex h-11 items-center rounded-full border border-white/25 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" href="#first-reading">
                  先看 4 步流程
                </a>
              </div>
              <p className="mt-5 flex items-center gap-2 text-sm text-[#b9ccc4]"><CheckIcon /> 不安装 Anki 也可以先阅读和查词</p>
            </div>

            <div className="border-t border-white/12 bg-[#102f27] px-6 py-8 sm:px-10 lg:border-l lg:border-t-0 lg:px-12 lg:py-14">
              <p className="text-sm font-semibold text-[#a9d5c4]">一条完整的学习路径</p>
              <ol className="mt-6 divide-y divide-white/12 border-y border-white/12">
                {[
                  ["01", "阅读文章", "保持原文是注意力中心"],
                  ["02", "理解语境", "查清本句真正用到的意思"],
                  ["03", "保存表达", "留下原句和学习线索"],
                  ["04", "安排复习", "需要时交给 Anki"],
                ].map(([number, title, copy]) => (
                  <li className="grid grid-cols-[2.5rem_7.5rem_1fr] gap-3 py-4" key={number}>
                    <span className="font-mono text-xs text-[#80b6a2]">{number}</span>
                    <strong className="text-sm font-semibold text-white">{title}</strong>
                    <span className="text-sm leading-6 text-[#b9ccc4]">{copy}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 text-sm leading-6 text-[#aabeb6]">Context Reader 负责把真实阅读变成可复习的材料，Anki 负责决定什么时候让这些材料再次出现。</p>
            </div>
          </div>
        </section>

        <div className="mt-10 grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <aside className="hidden lg:block">
            <nav aria-label="使用指南目录" className="sticky top-[96px] border-t border-[#18211d]/15 pt-4">
              <p className="mb-3 text-xs font-semibold text-[#66736d]">本页目录</p>
              <ul className="space-y-1">
                {guideNav.map(([href, label]) => (
                  <li key={href}>
                    <a className="block rounded-[8px] px-3 py-2.5 text-sm font-medium text-[#526159] transition-colors hover:bg-white hover:text-[#183f34] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href={href}>{label}</a>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-[12px] bg-[#e6ece8] p-4 text-sm leading-6 text-[#526159]">
                <strong className="block text-[#25382f]">只想快速上手？</strong>
                先完成一次阅读，Anki 和其他设置都可以稍后再做。
              </div>
            </nav>
          </aside>

          <div className="min-w-0">
            <nav aria-label="移动端使用指南目录" className="mb-12 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:hidden">
              {guideNav.map(([href, label]) => (
                <a className="rounded-[10px] bg-white px-3 py-3 text-center text-sm font-medium text-[#43524b] transition-colors hover:bg-[#e6ece8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href={href} key={href}>{label}</a>
              ))}
            </nav>

            <section id="understand" className="scroll-mt-24 border-b border-[#18211d]/12 pb-16" aria-labelledby="understand-title">
              <div className="max-w-[720px]">
                <h2 id="understand-title" className="text-balance text-[30px] font-semibold leading-[1.16] tracking-[-0.03em] text-[#17231e] sm:text-[36px]">先弄明白：这个网站做什么</h2>
                <p className="mt-4 max-w-[68ch] text-pretty text-[15px] leading-7 text-[#526159] sm:text-base">它不是另一份背词表，而是一张铺在真实文章上的学习层。你仍然阅读英文，只在需要时获得解释，并把真正影响理解的内容留下来。</p>
              </div>
              <div className="mt-9 grid gap-px overflow-hidden rounded-[14px] bg-[#cfd8d2] md:grid-cols-2">
                <div className="bg-white p-6 sm:p-7">
                  <h3 className="text-lg font-semibold text-[#183f34]">它会帮你</h3>
                  <ul className="mt-5 space-y-3 text-sm leading-6 text-[#46554d]">
                    {["导入并保持一篇英文文章的阅读结构", "解释单词或短语在当前句子里的意思", "补充音标、词性、搭配、用法和例句", "保存语境完整的生词，并按需导入 Anki", "在确实需要时提供全文翻译与文章总结"].map((item) => (
                      <li className="flex gap-3" key={item}><span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e4f1e9] text-[#285143]"><CheckIcon /></span><span>{item}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="bg-[#e9eeeb] p-6 sm:p-7">
                  <h3 className="text-lg font-semibold text-[#33443b]">它不会替你</h3>
                  <ul className="mt-5 space-y-3 text-sm leading-6 text-[#526159]">
                    {["把整篇英文自动变成只看中文的阅读", "要求你查完、保存文章里的每一个生词", "承诺只靠上下文看一次就能永久记住", "强迫你安装 Anki 后才能使用网站", "用一个精确数字判断你的词汇量"].map((item) => (
                      <li className="flex gap-3" key={item}><span className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#718078]" /><span>{item}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section id="first-reading" className="scroll-mt-24 border-b border-[#18211d]/12 py-16" aria-labelledby="first-reading-title">
              <SectionHeading title="第一次使用，只完成这 4 步" copy="先建立一次完整体验，再决定要不要配置更多功能。最容易坚持的起点不是研究所有按钮，而是读完一篇短文章。" />
              <ol className="mt-9 divide-y divide-[#18211d]/12 border-y border-[#18211d]/12">
                {firstReadingSteps.map((step, index) => (
                  <li className="grid gap-3 py-6 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-5" key={step.title}>
                    <span className="font-mono text-xs font-semibold text-[#2d765e]">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3 className="text-lg font-semibold tracking-[-0.015em] text-[#24352d]">{step.title}</h3>
                      <p className="mt-2 max-w-[68ch] text-sm leading-6 text-[#526159]">{step.copy}</p>
                      <p className="mt-3 w-fit rounded-full bg-[#e6ece8] px-3 py-1.5 text-xs font-medium text-[#4c5f55]">{step.hint}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="context-learning" className="scroll-mt-24 border-b border-[#18211d]/12 py-16" aria-labelledby="context-learning-title">
              <SectionHeading title="语境背词，比普通背词多了什么" copy="普通词表擅长快速覆盖基础词汇，语境学习擅长把词放回真实用法。它们不是互相排斥，但当你的目标是读懂文章时，语境提供的线索更接近你以后再次遇到这个词的场景。" />
              <div className="mt-9 overflow-x-auto rounded-[14px] bg-white">
                <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-[#e6ece8] text-[#2e4137]">
                      <th className="w-[19%] px-5 py-4 font-semibold">比较维度</th>
                      <th className="w-[40.5%] px-5 py-4 font-semibold">普通词表式背词</th>
                      <th className="w-[40.5%] px-5 py-4 font-semibold">Context Reader 语境学习</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#18211d]/10">
                    {comparisonRows.map(([label, traditional, contextual]) => (
                      <tr className="align-top" key={label}>
                        <th className="px-5 py-4 font-semibold text-[#304239]">{label}</th>
                        <td className="px-5 py-4 leading-6 text-[#5a6861]">{traditional}</td>
                        <td className="px-5 py-4 leading-6 text-[#2f493d]">{contextual}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 rounded-[14px] bg-[#183f34] p-6 text-white sm:p-7">
                <h3 className="text-lg font-semibold">语境负责“学得更具体”，复习负责“记得更久”</h3>
                <p className="mt-3 max-w-[68ch] text-sm leading-6 text-[#d1dfd8]">看懂一次不等于以后还能想起。Context Reader 保留高质量的语境材料，站内生词本或 Anki 负责让这些材料再次出现。两部分配合，才是一条完整的记忆路径。</p>
              </div>
            </section>

            <section id="anki" className="scroll-mt-24 border-b border-[#18211d]/12 py-16" aria-labelledby="anki-title">
              <SectionHeading title="Anki 是什么，为什么这里会用到它" copy="Anki 是一款间隔重复记忆软件。你完成一次复习后，它会根据你的记忆情况安排下次出现时间，把更多时间留给难记内容。它不是词典，也不负责寻找学习材料。" />

              <div className="mt-9 grid gap-px overflow-hidden rounded-[14px] bg-[#cfd8d2] sm:grid-cols-3">
                {[
                  ["Deck（卡组）", "一组放在一起复习的卡片，例如“英语阅读生词”。"],
                  ["Card（卡片）", "正面提出问题，背面给出答案和完整语境。"],
                  ["Review（复习）", "看答案后评价记忆程度，Anki 据此安排下次出现。"],
                ].map(([title, copy]) => (
                  <div className="bg-white p-5 sm:p-6" key={title}>
                    <h3 className="font-semibold text-[#24352d]">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#5a6861]">{copy}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-[1fr_auto_1fr] md:items-center">
                <div className="rounded-[14px] bg-[#e4f1e9] p-6">
                  <p className="text-xs font-semibold text-[#427360]">Context Reader 负责</p>
                  <h3 className="mt-2 text-lg font-semibold text-[#1f3d31]">从阅读中制作好卡片材料</h3>
                  <p className="mt-2 text-sm leading-6 text-[#476257]">单词、音标、当前含义、原句、翻译、搭配、用法和例句。</p>
                </div>
                <span aria-hidden="true" className="grid h-10 w-10 place-items-center justify-self-center rounded-full bg-[#1769aa] text-white md:rotate-0">→</span>
                <div className="rounded-[14px] bg-[#e9eeeb] p-6">
                  <p className="text-xs font-semibold text-[#65736c]">Anki 负责</p>
                  <h3 className="mt-2 text-lg font-semibold text-[#2e3d36]">安排什么时候再复习</h3>
                  <p className="mt-2 text-sm leading-6 text-[#526159]">你只需要每天打开卡组，回答并评价自己是否记得。</p>
                </div>
              </div>

              <div className="mt-10">
                <GuideAnkiSetup />
              </div>

              <div className="mt-8 rounded-[14px] bg-white p-6 sm:p-7">
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div className="max-w-[520px]">
                    <h3 className="text-lg font-semibold text-[#24352d]">导入后，一张语境卡片里有什么</h3>
                    <p className="mt-2 text-sm leading-6 text-[#5a6861]">Context Reader 会创建或更新自己的卡片模板。你不需要先在 Anki 里手工建立字段。</p>
                  </div>
                  <a className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#1769aa] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href="https://docs.ankiweb.net/getting-started.html" target="_blank" rel="noreferrer">
                    查看 Anki 官方入门说明
                    <ArrowUpRightIcon />
                  </a>
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  {["单词或短语", "IPA 音标", "当前语境含义", "原句与自然翻译", "常见搭配", "双语例句", "美式与英式 TTS"].map((field) => (
                    <span className="rounded-full bg-[#edf1ee] px-3 py-2 text-sm text-[#43534b]" key={field}>{field}</span>
                  ))}
                </div>
              </div>
            </section>

            <section id="daily-workflow" className="scroll-mt-24 border-b border-[#18211d]/12 py-16" aria-labelledby="daily-workflow-title">
              <SectionHeading title="日常使用，保持一个轻量循环" copy="重点不是每天保存很多词，而是让阅读可以继续，并让少量高价值表达真正回来。下面是一种不容易把阅读做成任务清单的节奏。" />
              <ol className="mt-9 grid gap-px overflow-hidden rounded-[14px] bg-[#cfd8d2] sm:grid-cols-2 xl:grid-cols-4">
                {dailySteps.map(([title, copy], index) => (
                  <li className="bg-white p-5 sm:p-6" key={title}>
                    <span className="font-mono text-xs font-semibold text-[#2d765e]">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="mt-3 text-xl font-semibold text-[#24352d]">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#5a6861]">{copy}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-sm leading-6 text-[#5a6861]">一个实用起点：每次阅读 15 到 30 分钟，只保存 3 到 8 个最值得复习的表达。数量不是目标，能继续阅读并愿意再次复习才是。</p>
            </section>

            <section id="faq" className="scroll-mt-24 pt-16" aria-labelledby="faq-title">
              <SectionHeading title="常见问题" copy="先从问题所属的阶段查找。连接失败时，优先回到上面的 Anki 安装助手重新检测，它会给出更具体的下一步。" />
              <div className="mt-9 space-y-9">
                {faqGroups.map((group) => (
                  <div key={group.title}>
                    <h3 className="text-lg font-semibold text-[#304239]">{group.title}</h3>
                    <div className="mt-3 divide-y divide-[#18211d]/12 border-y border-[#18211d]/12">
                      {group.items.map((item) => (
                        <details className="group" key={item.question}>
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-4 font-semibold text-[#24352d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa] [&::-webkit-details-marker]:hidden">
                            <span>{item.question}</span>
                            <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-lg font-normal text-[#53625b] transition-transform duration-200 group-open:rotate-45">+</span>
                          </summary>
                          <p className="max-w-[70ch] pb-5 pr-8 text-sm leading-6 text-[#5a6861]">{item.answer}</p>
                        </details>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="mt-20 flex flex-col gap-6 rounded-[16px] bg-[#e6ece8] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-lg font-semibold text-[#24352d]">现在，带一篇你本来就想读的文章开始。</p>
            <p className="mt-2 text-sm leading-6 text-[#5a6861]">第一次只完成阅读和一次查词，其他设置都可以稍后再做。</p>
          </div>
          <Link className="inline-flex h-11 w-fit shrink-0 items-center gap-2 rounded-full bg-[#183f34] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#123229] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#183f34]" href="/">
            返回首页开始阅读
            <span aria-hidden="true">→</span>
          </Link>
        </footer>
      </div>
    </main>
  );
}
