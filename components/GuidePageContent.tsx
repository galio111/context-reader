import Link from "next/link";
import { GuideAnkiSetup } from "@/components/GuideAnkiSetup";
import { PUBLIC_CONTACT } from "@/lib/publicContact";
import styles from "./GuidePageContent.module.css";

const START_READING_HREF = "/?start=paste";
const guideNav = [
  ["#start", "3 分钟开始"], ["#features", "核心功能"], ["#reading-tools", "阅读时怎么用"],
  ["#anki", "Anki 详细用法"], ["#account-data", "账号、同步与离线"], ["#faq", "常见问题"], ["#updates", "更新记录"],
] as const;

const quickSteps = [
  ["选一篇真的想读的文章", "从精选外刊开始，或粘贴正文、输入公开网址。第一次建议选一篇 5 到 15 分钟能读完的内容。"],
  ["先读，卡住时再查", "点击单词或划选短语，解释会结合当前句子给出这里真正使用的含义。手机上下滑动始终用于阅读。"],
  ["只留下值得再见的词", "把反复遇到、影响理解或想主动使用的表达加入生词本。需要长期复习时，再从电脑端导入 Anki。"],
] as const;

const featureGroups = [
  ["找到读得下去的外刊", "首页持续收录不同来源和主题的英文文章。你可以按分类浏览，也可以设置阅读水平与兴趣，让“推荐”优先出现更适合你的内容。", ["不同来源与主题", "按难度与兴趣排序", "保留原文结构与图片"], "aqua"],
  ["在原句里把难点问清楚", "单词和短语解释会读取当前句子，而不是只抛出一串词典义项。解释仍不够时，可以继续向 AI 追问用法、语气、语法或上下文关系。", ["语境释义", "音标、词性与搭配", "AI 继续提问"], "blue"],
  ["需要时再看更大的图景", "全文翻译、文章总结和逐段理解都在阅读旁边按需启动。它们帮助你跨过真正的障碍，但不会把英文正文挤出阅读中心。", ["全文翻译", "文章总结", "保留英文阅读主线"], "violet"],
  ["把一次阅读变成长期积累", "生词本会保存当时的原句、语境含义、音标和学习补充。登录后，文章、生词与阅读位置可以同步；想做间隔复习时，再免费导入 Anki。", ["语境完整的生词", "跨设备继续阅读", "Anki 间隔复习"], "peach"],
] as const;

const readingTools = [
  ["查一个词或短语", "点击单词，或横向划选一段短语。解释面板会区分当前含义、基础释义、搭配和例句。"],
  ["继续向 AI 提问", "在解释结果里追问“这里为什么用这个时态”“这个表达语气强吗”等具体问题。问题越贴近原句，答案越有用。"],
  ["翻译整篇文章", "只有你点击全文翻译侧栏后才会开始。已完成的段落会保留，切换工具不会自动取消或重新生成。"],
  ["保存文章与进度", "登录后可以保存文章。再次打开时会尽量回到上次稳定停留的位置，而不是从第一页重新开始。"],
  ["管理生词", "在生词本里搜索、查看完整语境、跳回原文、复制或导出 CSV。保存少量高价值词，比把整篇文章抄进去更容易复习。"],
] as const;

const faqGroups = [
  ["阅读与查词", [
    ["我应该每个生词都查吗？", "不建议。先判断它是否阻碍主旨理解、是否反复出现，或者你是否想主动使用。查得太密会把阅读变成逐词翻译。"],
    ["精选外刊和自己导入有什么区别？", "精选外刊已经过整理，适合直接开始；粘贴正文和网址导入适合你已有明确阅读目标时使用。进入 Reader 后，核心查词、翻译和生词流程相同。"],
    ["一定要注册账号吗？", "不需要。游客可以直接阅读，并按上海自然日试用查词与导入。保存文章、生词本、Anki、私有全文翻译和总结需要登录。"],
  ]],
  ["Anki", [
    ["不用 Anki，可以只用 Context Reader 吗？", "可以。Anki 不是使用网站的前置条件。阅读、语境解释和站内生词本可以独立使用。"],
    ["为什么必须打开桌面版 Anki？", "Context Reader 通过 AnkiConnect 与你电脑上正在运行的 Anki 通信。桌面软件未打开时，本地接口不会运行。"],
    ["手机上能直接导入吗？", "目前不能。请在电脑浏览器完成导入，再通过 Anki 的同步功能在手机复习。CSV 导出可以作为备用方式。"],
    ["连接失败先检查什么？", "先确认桌面版 Anki 已打开、AnkiConnect 已安装，再进入生词本的 Anki 设置检测连接。仍失败时，按本页安装助手给出的提示检查权限和地址。"],
  ]],
  ["数据与离线", [
    ["文章和生词保存在哪里？", "数据会先保存在当前浏览器。登录后，文章、生词和阅读状态会同步到账号云端，便于换设备继续。"],
    ["账号服务暂时连接不上怎么办？", "网站会进入明确的受限离线状态。当前账号留在这台浏览器里的文章、生词和缓存仍可使用；同步和服务器授权功能需要恢复联网。"],
  ]],
] as const;

const releaseNotes = [
  ["2026-08-25", "阅读工具面板更独立", "桌面查词、生词本和我的文章不再互相挤占位置，打开与关闭更接近各自独立的工具。"],
  ["2026-08-13", "长文章更快进入", "推荐文章在打开动效开始时并行读取正文；长文首屏不再一次生成全部交互节点。"],
  ["2026-08-09", "大陆站点成为正式入口", "Context Reader 切换到中国大陆服务器与 context-reader.com，旧环境保留为回退来源。"],
] as const;

function ArrowIcon() { return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>; }
function SectionHeading({ title, copy }: { title: string; copy: string }) { return <header className={styles.sectionHeading}><h2>{title}</h2><p>{copy}</p></header>; }

export function GuidePageContent({ embedded = false }: { embedded?: boolean }) {
  return <main className={styles.guide} data-embedded={embedded || undefined}>
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/"><strong>Context Reader</strong><span>使用说明</span></Link>
      <Link className={styles.startButton} href={START_READING_HREF}>开始阅读 <ArrowIcon /></Link>
    </header>
    <div className={styles.mobileDirectory}><nav aria-label="使用说明目录" data-local-scroll-surface>{guideNav.map(([href, label]) => <a href={href} key={href}>{label}</a>)}</nav></div>
    <div className={styles.shell}>
      <aside className={styles.directory}><nav aria-label="使用说明目录" data-local-scroll-surface><p>本页目录</p>{guideNav.map(([href, label]) => <a href={href} key={href}>{label}</a>)}<div className={styles.directoryNote}><strong>第一次使用？</strong>先完成一次阅读。Anki 和其他设置都可以稍后再做。</div></nav></aside>
      <article className={styles.content}>
        <section className={styles.intro} aria-labelledby="guide-title"><div><p className={styles.introLabel}>从这里开始</p><h1 id="guide-title">把注意力留给文章，<br />把困难交给工具。</h1><p>Context Reader 为中文学习者整理适合阅读的英文外刊，也让你带入自己的文章。遇到难点时查清语境，仍有疑问就继续问 AI，值得留下的词再进入生词本和 Anki。</p><div className={styles.introActions}><Link href={START_READING_HREF}>带一篇文章开始 <ArrowIcon /></Link><a href="#features">先了解核心功能</a></div></div><aside className={styles.introAside}><span>最短路径</span><ol><li>选文章</li><li>在语境里查</li><li>保存值得复习的词</li></ol><p>Anki 不是前置条件。</p></aside></section>
        <section id="start" className={styles.section}><SectionHeading title="3 分钟完成第一次阅读" copy="不必先研究所有按钮。完成一篇短文章和一次查词，你就已经走完了最重要的流程。" /><ol className={styles.quickSteps}>{quickSteps.map(([title, copy], index) => <li key={title}><span>{index + 1}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol><div className={styles.softNote}><strong>手机提示</strong><span>上下滑动只负责阅读；选择短语时请长按，或进行明确的横向划动。</span></div></section>
        <section id="features" className={styles.section}><SectionHeading title="你能用它做什么" copy="功能都围绕同一件事：找到愿意读的内容，在不打断阅读的前提下解决问题，并把真正有价值的内容留下来。" /><div className={styles.featureList}>{featureGroups.map(([title, copy, points, tone], index) => <section key={title} data-tone={tone}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{copy}</p></div><ul>{points.map((point) => <li key={point}>{point}</li>)}</ul></section>)}</div></section>
        <section id="reading-tools" className={styles.section}><SectionHeading title="阅读时怎么用" copy="先保持英文正文是视觉中心。只有遇到具体障碍时，才打开对应工具。" /><div className={styles.toolList}>{readingTools.map(([title, copy]) => <details key={title}><summary><span>{title}</span><i aria-hidden="true">＋</i></summary><p>{copy}</p></details>)}</div><div className={styles.readingRhythm}><strong>一个容易坚持的节奏</strong><ol><li><b>读</b><span>先连续读一小段</span></li><li><b>查</b><span>只解决真实阻碍</span></li><li><b>留</b><span>每次保存少量表达</span></li><li><b>回</b><span>用生词本或 Anki 复习</span></li></ol></div></section>
        <section id="anki" className={styles.section}><SectionHeading title="Anki 是什么，怎么和 Context Reader 一起用" copy="Anki 是一款间隔重复记忆软件。Context Reader 准备来自真实阅读的卡片材料，Anki 根据你的记忆情况安排下一次复习。" /><div className={styles.ankiRoles}><div><span>Context Reader</span><strong>准备学习材料</strong><p>单词、音标、当前语境含义、原句、翻译、搭配、用法和例句。</p></div><i aria-hidden="true">→</i><div><span>Anki</span><strong>安排复习时间</strong><p>你回答后评价记忆程度，Anki 决定这张卡片什么时候再次出现。</p></div></div><div className={styles.ankiTerms}><div><strong>Deck</strong><span>卡组，一组放在一起复习的卡片。</span></div><div><strong>Card</strong><span>卡片，正面提出问题，背面给出答案和语境。</span></div><div><strong>Review</strong><span>复习，看答案后评价自己是否记得。</span></div></div><div className={styles.ankiSetup}><GuideAnkiSetup /></div><div className={styles.ankiAfterImport}><div><h3>导入后会得到什么</h3><p>Context Reader 会自动创建或更新自己的卡片模板，无需手工建立字段。</p></div><ul>{["单词或短语", "IPA 音标", "当前语境含义", "原句与自然翻译", "常见搭配", "双语例句", "美式与英式发音"].map((item) => <li key={item}>{item}</li>)}</ul><a href="https://docs.ankiweb.net/getting-started.html" target="_blank" rel="noreferrer">查看 Anki 官方入门说明 <ArrowIcon /></a></div></section>
        <section id="account-data" className={styles.section}><SectionHeading title="账号、同步与离线" copy="网站优先保护你的阅读数据。登录后云端同步是权威来源，但不会因为登录或短暂断网清空这台设备已有的内容。" /><div className={styles.dataRows}><div><strong>游客</strong><p>可以直接阅读并试用查词与导入。游客内容主要保存在当前浏览器，清除网站数据前请先导出重要内容。</p></div><div><strong>登录后</strong><p>文章、生词和阅读状态会同步到账号云端，便于跨设备继续。保存、Anki、私有翻译与总结需要登录。</p></div><div><strong>受限离线</strong><p>账号服务暂时不可用时，网站会明确说明。本机已有文章、生词与缓存仍可用，服务器授权能力等待重连。</p></div></div></section>
        <section id="faq" className={styles.section}><SectionHeading title="常见问题" copy="按问题所属阶段查找。Anki 连接问题可直接返回上方安装助手逐项检查。" /><div className={styles.faqGroups}>{faqGroups.map(([group, items]) => <section key={group}><h3>{group}</h3><div>{items.map(([question, answer]) => <details key={question}><summary><span>{question}</span><i aria-hidden="true">＋</i></summary><p>{answer}</p></details>)}</div></section>)}</div></section>
        <section id="updates" className={styles.section}><SectionHeading title="更新记录" copy="这里只记录已经完成并经过验证的变化，尚未上线的设计不会提前写成承诺。" /><ol className={styles.releaseNotes}>{releaseNotes.map(([date, title, copy]) => <li key={date}><time dateTime={date}>{date}</time><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></section>
        <footer className={styles.guideFooter}><div><h2>还有疑问，直接告诉我。</h2><p>如果某个解释不够准确、文章难以导入，或你想分享真实的英文阅读体验，都可以联系开发者。</p><span>{PUBLIC_CONTACT.email} · 微信 {PUBLIC_CONTACT.wechat}</span></div><Link href={START_READING_HREF}>返回首页开始阅读 <ArrowIcon /></Link></footer>
      </article>
    </div>
  </main>;
}
