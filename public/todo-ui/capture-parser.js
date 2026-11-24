(() => {
  "use strict";
  const dayMs = 86400000;
  const shift = (iso, days) => new Date(Date.parse(iso + "T12:00:00Z") + dayMs * days).toISOString().slice(0, 10);
  const weekday = (iso) => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;
  const number = (word) => {
    if (/^\d+$/.test(word)) return Number(word);
    const digit = (ch) => ch === "两" ? 2 : "零一二三四五六七八九".indexOf(ch);
    if (word.includes("十")) {
      const [a, b] = word.split("十");
      return (a ? digit(a) : 1) * 10 + (b ? digit(b) : 0);
    }
    return digit(word);
  };
  function validDate(year, month, day) {
    if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return "";
    const iso = [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
    const utc = new Date(iso + "T12:00:00Z");
    return Number.isFinite(utc.getTime()) && utc.toISOString().startsWith(iso) ? iso : "";
  }
  const digits = "[0-9零一二两三四五六七八九十]+";
  const calendarWord = new RegExp("(?:(\\d{4})年)?(" + digits + ")月(" + digits + ")(?:号|日)?");
  const timeWord = new RegExp("(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间)?\\s*(" + digits + ")(?:(?:[:：])([0-5]\\d)|(?:点|时)(半|一刻|三刻|[0-5]?\\d分?|[零一二三四五六七八九十]{1,3}分)?)");
  function readDate(text, today) {
    let hit = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(text);
    if (hit) return {token: hit[0], date: validDate(+hit[1], +hit[2], +hit[3])};
    hit = calendarWord.exec(text);
    if (hit) {
      const month = number(hit[2]), day = number(hit[3]);
      const year = hit[1] ? +hit[1] : +today.slice(0, 4);
      let date = validDate(year, month, day);
      if (date && !hit[1] && date < today) date = validDate(year + 1, month, day);
      return {token: hit[0], date};
    }
    hit = /(大后天|后天|明天|今天|今日|明早|明晚|今晚|今早)/.exec(text);
    if (hit) return {token: hit[0], date: shift(today, {"大后天":3,"后天":2,"明天":1,"今天":0,"今日":0,"明早":1,"明晚":1,"今晚":0,"今早":0}[hit[0]])};
    hit = new RegExp("(" + digits + ")天(?:后|以后)").exec(text);
    if (hit && number(hit[1]) >= 0 && number(hit[1]) <= 365) return {token: hit[0], date: shift(today, number(hit[1]))};
    hit = /(下下|下个?|本|这(?:个)?|上个?)?(?:周|星期|礼拜)([一二三四五六日天1-7])/.exec(text);
    if (hit) {
      const target = /[1-7]/.test(hit[2]) ? +hit[2] - 1 : hit[2] === "天" ? 6 : "一二三四五六日".indexOf(hit[2]);
      const offset = target - weekday(today);
      const week = hit[1] === "下下" ? 2 : hit[1]?.startsWith("下") ? 1 : hit[1]?.startsWith("上") ? -1 : !hit[1] && offset < 0 ? 1 : 0;
      return {token: hit[0], date: shift(today, 7 * week + offset)};
    }
    return {token: "", date: ""};
  }
  function readTime(text, dateToken) {
    const hit = timeWord.exec(text);
    if (!hit) return {token:"", time:""};
    const period = hit[1] || (["明晚","今晚"].includes(dateToken) ? "晚上" : "");
    let hr = number(hit[2]);
    const raw = hit[3] || hit[4] || "0";
    const min = raw === "半" ? 30 : raw === "一刻" ? 15 : raw === "三刻" ? 45 : number(raw.replace("分", ""));
    if (/下午|傍晚|晚上|晚间/.test(period) && hr < 12) hr += 12;
    if (period === "中午" && hr >= 1 && hr <= 5) hr += 12;
    if (["凌晨","清晨"].includes(period) && hr === 12) hr = 0;
    if (hr < 0 || hr > 23 || min < 0 || min > 59) return {token:"",time:""};
    return {token: hit[0], time: String(hr).padStart(2, "0") + ":" + String(min).padStart(2, "0")};
  }
  function split(text) {
    const first = text.replace(/(?:先不定日期|暂不定日期|暂不设日期|不设截止日期)[，,、]\s*/g, (s) => s.replace(/[，,、]/, " ")).replace(/(?:然后还要|另外还要|另外还得|另外要|另外|此外|还需要|还有一件事(?:是)?)[，,、：:\s]*/g, "\n");
    // Keep noun lists, explanatory clauses and punctuation inside titles.
    const nextAction = /(?:[，,。]|然后|并且|还要)\s*(?=(?:另外)?(?:大后天|今天|今日|明天|明晚|明早|后天|今晚|每天|每日|(?:本|这|下下|下个?)?(?:周|星期|礼拜)[一二三四五六日天]|(?:早上|上午|中午|下午|晚上)[0-9一二两三四五六七八九十]|(?:记得|要|得)?(?:去|买|交|寄|取|开会|参加|复习|整理|背单词|写|完成|提交|预约|还书|提醒我)))/g;
    return first.replace(nextAction, "\n").split(/[\n;；]+/).map((part) => part.trim().replace(/^[，,。\s]+|[，,。\s]+$/g,"")).filter(Boolean);
  }
  function parse(text, {today, categories = [], suggestCategory, defaultMissed = "skip"}) {
    let previousDate = "";
    return split(text).map((source) => {
      const normalized = source.replace(/[０-９]/g, (n) => String.fromCharCode(n.charCodeAt(0) - 65248));
      const rec = /每天|每日|天天/.exec(normalized);
      const noDate = /先不定日期|暂不定日期|暂不设日期|不设截止日期/.exec(normalized);
      const date = readDate(normalized, today);
      const clock = readTime(normalized, date.token);
      const relOrWeek = "(?:今天|明天|后天|[本下这]?(?:周|星期)[一二三四五六日天]|[\\d一二三四五六七八九十]+[月号日])";
      const dateInstead = new RegExp("(?:或者|或|还是|到|至)\\s*" + relOrWeek).test(normalized);
      const afterClock = clock.token ? normalized.slice(normalized.indexOf(clock.token) + clock.token.length) : "";
      const beforeClock = clock.token ? normalized.slice(0, normalized.indexOf(clock.token)) : "";
      const approxClock = Boolean(clock.time && (/^\s*(?:左右|前后|上下|(?:或(?:者)?|至|到|[～~–-])\s*(?:上午|下午|晚上)?[\d一二两三四五六七八九十])/.test(afterClock) || /(?:大约|大概|差不多|约)(?:在)?\s*$/.test(beforeClock)));
      const leadWord = new RegExp("提前\\s*(" + digits + ")\\s*天\\s*(?:开工|开始(?:动手|准备)?|动手|着手|准备)").exec(normalized);
      const lead = leadWord ? Math.min(365, Math.max(0, number(leadWord[1]))) : 0;
      const title = [date.date && !dateInstead ? date.token : "", !approxClock ? clock.token : "", rec?.[0], noDate?.[0], leadWord?.[0]].filter(Boolean)
        .reduce((rest, word) => rest.replace(word, " "), normalized)
        .replace(/^(?:[，,、\s]*(?:之前|以前|前(?=交|提交|完成)|截止|提醒我|记得|我要|我得|还要|还得|然后))+/,"")
        .replace(/^[，,、\s]+|[，,、\s]+$/g,"").replace(/\s+/g, " ").trim() || source;
      const dateValue = dateInstead ? "" : date.date || (!date.token && clock.time && previousDate ? previousDate : "");
      if (date.date && !dateInstead) previousDate = date.date;
      const suggestion = suggestCategory?.(source);
      const direct = categories.find((cat) => cat && normalized.includes(cat));
      const rules = [
        ["班级事务", /班级|班会|团支书|团费|班干部|班委/], ["学习", /课程|课后|作业|写报告|复习|上课|考试|单词|英文|读书|论文|读文献/],
        ["生活", /快递|买菜|取件|水果|洗衣|牛奶|看牙|挂号|缴费|水电/], ["个人项目", /网站|灵感|开发|原型/],
      ];
      const matched = rules.find(([category, re]) => categories.includes(category) && re.test(normalized));
      const category = direct || (categories.includes(suggestion?.category) ? suggestion.category : "") || matched?.[0] || "";
      return {source, title, date: dateValue || (rec ? today : ""), time: approxClock ? "" : clock.time, daily: Boolean(rec), lead: rec ? 0 : lead,
        category, categoryReason: direct ? "原文提到分类" : category === suggestion?.category ? String(suggestion.reason || "根据之前的选择") : matched ? "按原文关键词" : "",
        dateAmbiguous: dateInstead, timeAmbiguous: approxClock, leadExplicit: Boolean(leadWord), timingReason: dateInstead ? "原文里有多个可能的日期，请点选一天。" : approxClock ? "原文中的时间有范围。可选一个具体时间，或保留全天。" : "",
        missed: defaultMissed === "carry" ? "carry" : "skip", priority: "", explicitlyUndated: Boolean(noDate && !dateValue && !clock.time), needsDate: !dateValue && !rec && !noDate};
    });
  }
  window.todoCaptureParser = {parse, shift, weekday, validDate};
})();
