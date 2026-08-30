import Link from "next/link";
import { GuideAnkiSetup } from "@/components/GuideAnkiSetup";
import { PUBLIC_CONTACT } from "@/lib/publicContact";
import styles from "./GuidePageContent.module.css";

const guideNav = [
  ["#developer", "开发者的话"], ["#start", "3 分钟开始"], ["#features", "核心功能"],
  ["#reading-tools", "阅读操作"], ["#anki", "Anki 使用方法"], ["#faq", "常见问题"], ["#updates", "更新记录"],
] as const;

const quickSteps = [
  ["选一篇想读的文章", "从精选外刊开始，或粘贴正文、输入公开网址。第一次可以先选一篇 5 到 15 分钟能读完的内容。"],
  ["先读，卡住时再查", "点击单词或划选短语，解释会结合当前句子，优先告诉你它在这里表达的意思。"],
  ["留下值得复习的词", "把反复遇到、影响理解或想主动使用的表达加入生词本，之后可以随时搜索、回看或导出。"],
] as const;

const featureGroups = [
  ["找到适合自己的外刊", "首页持续整理不同来源和主题的英文文章。你可以按分类浏览，也可以设置阅读水平与兴趣，让推荐更贴近自己。", ["不同来源与主题", "按难度与兴趣排序", "保留原文结构与图片"], "aqua"],
  ["在原句里查清难点", "解释会读取当前句子，而不是只列出一长串词典释义。还有疑问时，可以继续向 AI 追问语法、语气和上下文。", ["语境释义", "音标、词性与搭配", "AI 继续提问"], "blue"],
  ["快速理解整篇文章", "遇到真正影响理解的长句或段落时，可以按需使用全文翻译和文章总结，同时保留英文正文作为阅读主线。", ["全文翻译", "文章总结", "保留英文阅读主线"], "violet"],
  ["把阅读变成长期积累", "生词本保存当时的原句、语境含义和学习补充。登录后可以跨设备继续阅读，定期回看真正值得记住的表达。", ["语境完整的生词", "跨设备继续阅读", "按需回看与导出"], "peach"],
] as const;

type ReadingTool = { title: string; copy: string; demo?: { src: string; alt: string } };

// 用户提供操作录屏后，将对应文件转为 GIF/WebP 并填写 demo，即可在展开项中直接显示。
const readingTools: ReadingTool[] = [
  { title: "查一个词或短语", copy: "点击单词，或横向划选一段短语。解释面板会区分当前含义、基础释义、搭配和例句。" },
  { title: "继续向 AI 提问", copy: "在解释结果里追问“这里为什么用这个时态”“这个表达语气强吗”等具体问题。问题越贴近原句，答案越有用。" },
  { title: "翻译整篇文章", copy: "只有你点击全文翻译侧栏后才会开始。已完成的段落会保留，切换工具不会自动取消或重新生成。" },
  { title: "保存文章与进度", copy: "登录后可以保存文章。再次打开时会尽量回到上次稳定停留的位置。" },
  { title: "管理生词", copy: "在生词本里搜索、查看完整语境、跳回原文、复制或导出 CSV。" },
];

const faqGroups = [
  ["阅读与查词", [
    ["我应该每个生词都查吗？", "不建议。先判断它是否阻碍主旨理解、是否反复出现，或者你是否想主动使用。查得太密会把阅读变成逐词翻译。"],
    ["精选外刊和自己导入有什么区别？", "精选外刊已经过整理，适合直接开始；粘贴正文和网址导入适合你已有明确阅读目标时使用。进入 Reader 后，查词、翻译和生词流程相同。"],
    ["一定要注册账号吗？", "不需要。游客可以直接阅读并试用查词与导入；保存文章、生词本、私有全文翻译和总结需要登录。"],
  ]],
  ["Anki", [
    ["不用 Anki，可以只用 Context Reader 吗？", "可以。Anki 不是使用网站的前置条件，阅读、语境解释和站内生词本都可以独立使用。"],
    ["为什么必须打开桌面版 Anki？", "Context Reader 通过 AnkiConnect 与你电脑上正在运行的 Anki 通信。桌面软件未打开时，本地接口不会运行。"],
    ["手机上能直接导入吗？", "目前不能。请在电脑浏览器完成导入，再通过 Anki 的同步功能在手机复习；CSV 导出可以作为备用方式。"],
    ["连接失败先检查什么？", "先确认桌面版 Anki 已打开、AnkiConnect 已安装并重启，再进入生词本的 Anki 设置检测连接。"],
  ]],
] as const;

const releaseNotes = [
  ["2026-08-25", "阅读工具面板更独立", "桌面查词、生词本和我的文章不再互相挤占位置，打开与关闭更接近各自独立的工具。"],
  ["2026-08-13", "长文章更快进入", "推荐文章在打开动效开始时并行读取正文；长文首屏不再一次生成全部交互节点。"],
  ["2026-08-09", "大陆站点成为正式入口", "Context Reader 切换到中国大陆服务器与 context-reader.com，旧环境保留为回退来源。"],
] as const;

function ArrowIcon() { return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>; }
function SectionHeading({ title, copy }: { title: string; copy?: string }) { return <header className={styles.sectionHeading}><h2>{title}</h2>{copy && <p>{copy}</p>}</header>; }
function ToolDemo({ demo }: { demo?: ReadingTool["demo"] }) { return demo ? <figure className={styles.toolDemo}><img src={demo.src} alt={demo.alt} loading="lazy" /></figure> : null; }

export function GuidePageContent({ embedded = false, onOpenFeedback }: { embedded?: boolean; onOpenFeedback?: () => void }) {
  return <main className={styles.guide} data-embedded={embedded || undefined}>
    <header className={styles.topbar}><Link className={styles.brand} href="/"><strong>Context Reader</strong><span>使用说明</span></Link></header>
    <div className={styles.mobileDirectory}><nav aria-label="使用说明目录" data-local-scroll-surface>{guideNav.map(([href, label]) => <a href={href} key={href} data-mobile-hide-anki={href === "#anki" || undefined}>{label}</a>)}</nav></div>
    <div className={styles.shell}>
      <aside className={styles.directory}><nav aria-label="使用说明目录" data-local-scroll-surface><p>本页目录</p>{guideNav.map(([href, label]) => <a href={href} key={href}>{label}</a>)}<div className={styles.directoryNote}><strong>第一次使用？</strong>先完成一次阅读，Anki 和其他设置都可以稍后再做。</div></nav></aside>
      <article className={styles.content}>
        <section id="developer" className={styles.intro} aria-labelledby="guide-title"><p className={styles.introLabel}>为什么做这个网站</p><h1 id="guide-title">开发者的话</h1><div className={styles.developerCopy}><p>我做 Context Reader，是因为自己在读外刊和长文章时，也经常被密集的生词劝退。把词一个个复制到词典里很慢，同一个词又会列出很多意思，读完一篇文章常常要花很久。我希望阅读可以简单一点：直接在原句里看懂这个词此刻表达什么，继续把文章读下去；遇到真正值得积累的词，就连同原句和语境保存下来，形成阅读、理解和复习的闭环。</p><p>网站也会持续整理我精选的英文外刊，满足日常阅读需要。你也可以复制自己的文章，或输入网址直接阅读。希望它能让大家少一点查词的消耗，更轻松地学英语，更顺畅地读完真正想读的内容。</p></div></section>

        <section id="start" className={styles.section}><SectionHeading title="3 分钟完成第一次阅读" copy="不必先研究所有按钮。完成一篇短文章和一次查词，你就已经走完了最重要的流程。" /><ol className={styles.quickSteps}>{quickSteps.map(([title, copy], index) => <li key={title}><span>{index + 1}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol><div className={styles.softNote}><strong>手机提示</strong><span>上下滑动只负责阅读；选择短语时请长按，或进行明确的横向划动。</span></div></section>

        <section id="features" className={styles.section}><SectionHeading title="你能用它做什么" copy="从找到文章到理解、保存和复习，所有功能都围绕真实阅读展开。" /><div className={styles.featureList}>{featureGroups.map(([title, copy, points, tone], index) => <section key={title} data-tone={tone}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{copy}</p></div><ul>{points.map((point) => <li key={point}>{point}</li>)}</ul></section>)}</div></section>

        <section id="reading-tools" className={styles.section}><SectionHeading title="阅读时怎么操作" copy="点击加号查看说明。你提供操作录屏后，这里会直接显示相应的动图演示。" /><div className={styles.toolList}>{readingTools.map((tool) => <details key={tool.title}><summary><span>{tool.title}</span><i aria-hidden="true">＋</i></summary><div className={styles.toolAnswer}><p>{tool.copy}</p><ToolDemo demo={tool.demo} /></div></details>)}</div><div className={styles.readingRhythm}><strong>一个容易坚持的节奏</strong><ol><li><b>读</b><span>先连续读一小段</span></li><li><b>查</b><span>只解决真实阻碍</span></li><li><b>留</b><span>每次保存少量表达</span></li><li><b>回</b><span>用生词本定期回看</span></li></ol></div></section>

        <section id="anki" className={styles.section}><SectionHeading title="用 Anki 复习阅读中留下的词" copy="Anki 是一款用间隔重复安排复习的记忆卡软件。Context Reader 负责保留阅读语境，Anki 负责在合适的时间让这些词再次出现。" /><ol className={styles.ankiFlow}><li><span>1</span><div><strong>在文章里理解</strong><p>查清单词在当前句子里的含义，不必从很多无关释义里猜。</p></div></li><li><span>2</span><div><strong>保存词和语境</strong><p>把单词、原句、翻译、音标和学习补充一起留在生词本。</p></div></li><li><span>3</span><div><strong>导入 Anki 复习</strong><p>在电脑端批量导入，之后由 Anki 按记忆情况安排下一次复习。</p></div></li></ol><div className={styles.ankiTerms}><div><strong>Deck</strong><span>卡组，把同一类卡片放在一起复习。</span></div><div><strong>Card</strong><span>卡片，正面提出问题，背面显示答案和语境。</span></div><div><strong>Review</strong><span>复习，看答案后告诉 Anki 自己记得怎么样。</span></div></div><div className={styles.ankiSetup}><GuideAnkiSetup /></div><div className={styles.ankiAfterImport}><div><h3>一张卡片会保留什么</h3><p>模板由 Context Reader 自动建立，你不需要手工添加字段。</p></div><ul>{["单词与音标", "当前语境含义", "原句与翻译", "常见搭配与例句", "美式与英式发音"].map((item) => <li key={item}>{item}</li>)}</ul><a href="https://docs.ankiweb.net/getting-started.html" target="_blank" rel="noreferrer">查看 Anki 官方入门说明 <ArrowIcon /></a></div></section>

        <section id="faq" className={styles.section}><SectionHeading title="常见问题" copy="按问题所属阶段查找。Anki 连接问题可以返回上方安装助手逐项检查。" /><div className={styles.faqGroups}>{faqGroups.map(([group, items]) => <section key={group}><h3>{group}</h3><div>{items.map(([question, answer]) => <details key={question}><summary><span>{question}</span><i aria-hidden="true">＋</i></summary><p>{answer}</p></details>)}</div></section>)}</div></section>

        <section id="updates" className={styles.section}><SectionHeading title="更新记录" /><ol className={styles.releaseNotes}>{releaseNotes.map(([date, title, copy]) => <li key={date}><time dateTime={date}>{date}</time><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></section>

        <footer className={styles.guideFooter}><div><h2>还有疑问，直接告诉我。</h2><p>如果某个解释不够准确、文章难以导入，或者你想分享真实的英文阅读体验，欢迎提交意见。</p><span>{PUBLIC_CONTACT.email} · 微信 {PUBLIC_CONTACT.wechat}</span></div>{onOpenFeedback ? <button type="button" onClick={onOpenFeedback}>意见反馈 <ArrowIcon /></button> : <a href={`mailto:${PUBLIC_CONTACT.email}?subject=Context%20Reader%20意见反馈`}>意见反馈 <ArrowIcon /></a>}</footer>
      </article>
    </div>
  </main>;
}
