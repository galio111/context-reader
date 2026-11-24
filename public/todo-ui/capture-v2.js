(() => {
  "use strict";
  const parser = window.todoCaptureParser;
  const sessions = new WeakMap();
  let activeForm;
  const datePattern = /^\d{4}-\d\d-\d\d$/;
  const validDate = (d) => typeof d === "string" && datePattern.test(d) && parser.validDate(...d.split("-").map(Number)) === d;
  const validTime = (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const monthTitle = (d) => Number(d.slice(0, 4)) + " 年 " + Number(d.slice(5, 7)) + " 月";
  const shortDate = (d) => Number(d.slice(5, 7)) + "月" + Number(d.slice(8)) + "日";
  const n = (tag, cls = "", value) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const btn = (cls, label, run) => {
    const node = n("button", cls, label);
    node.type = "button";
    node.addEventListener("click", run);
    return node;
  };
  const labelled = (title, control) => {
    const node = n("label", "tc-field");
    node.append(n("span", "", title), control);
    return node;
  };
  const opt = (value, name) => {
    const node = n("option", "", name);
    node.value = value;
    return node;
  };
  function listSelect(options, current, update) {
    const node = n("select");
    node.append(...options.map(([value, name]) => opt(value, name)));
    node.value = current;
    node.addEventListener("change", () => update(node.value));
    return node;
  }

  function mount() {
    const form = document.getElementById("quick-form");
    if (!form || sessions.has(form)) return;
    if (activeForm) destroy();
    const input = document.getElementById("task-input");
    const dialog = document.getElementById("capture-dialog");
    const status = document.getElementById("record-status");
    const app = window.todoApp;
    if (!input || !dialog || !status || !app || !parser) return;
    activeForm = form;
    const lifecycle = new AbortController();
    const listen = (node, type, listener) => node?.addEventListener(type, listener, {signal: lifecycle.signal});
    let items = [], selected = 0, revision = 0, touched = false, saving = false, period = "", stageNote = "", errorText = "", savedSource = "";
    let calMonth = "", alwaysCalendar = false, assistController = null;
    let editor, itemNav, notes, mainTitle, saveButton;
    const categories = () => app.categories().filter((x) => typeof x === "string" && x);
    const today = () => app.today();
    const settings = () => app.getSettings() || {};
    const dirty = () => { touched = true; };
    const active = () => items[selected];
    const wrap = (obj) => ({...obj, id: crypto.randomUUID(), chosen: true, dateAnswer: Boolean(obj.explicitlyUndated || (obj.date && !obj.needsDate)), timeAnswer: !obj.timeAmbiguous, expanded: Boolean(obj.lead)});
    const shortTiming = (item) => {
      const date = item.date ? shortDate(item.date) : item.dateAnswer ? "先不定" : "待选日期";
      return [item.daily ? "每天" : "", date, item.time].filter(Boolean).join(" · ");
    };

    function updateNotes() {
      if (!notes) return;
      notes.textContent = errorText || stageNote;
      notes.classList.toggle("tc-error", Boolean(errorText));
      notes.hidden = !notes.textContent;
    }
    function updateCard() {
      mainTitle.textContent = items.length > 1 ? "核对 " + items.length + " 项待办" : "记下这件事";
      const count = items.filter((t) => t.chosen).length;
      saveButton.textContent = saving ? "正在保存…" : count > 1 ? "记下 " + count + " 项" : "记下";
      saveButton.disabled = saving || !count;
      itemNav.hidden = items.length < 2;
      itemNav.replaceChildren();
      if (items.length < 2) return;
      for (const [index, item] of items.entries()) {
        const entry = n("div", "tc-item" + (index === selected ? " tc-current" : ""));
        const choose = n("input");
        choose.type = "checkbox";
        choose.checked = item.chosen;
        choose.setAttribute("aria-label", "记下第 " + (index + 1) + " 项");
        choose.addEventListener("change", () => {
          dirty(); item.chosen = choose.checked; updateCard();
          itemNav.children[index]?.querySelector("input")?.focus({preventScroll: true});
        });
        const select = btn("tc-item-select", "", () => {
          dirty(); selected = index; errorText = ""; initializeCalendar(); paint();
          itemNav.children[index]?.querySelector("button")?.focus({preventScroll: true});
        });
        select.setAttribute("aria-current", index === selected ? "true" : "false");
        select.append(n("span", "", item.title || "未填写标题"), n("small", "", shortTiming(item)));
        entry.append(choose, select); itemNav.append(entry);
      }
    }

    function initializeCalendar() {
      const date = active().date || today();
      calMonth = date.slice(0, 7) + "-01";
      alwaysCalendar = !active().dateAnswer;
      period = "";
    }
    function setDate(date) {
      const item = active();
      dirty();
      item.date = date; item.dateAnswer = true;
      if (!date) { item.time = ""; item.lead = 0; item.timeAnswer = true; }
      errorText = ""; initializeCalendar(); paint(); saveButton.focus({preventScroll:true});
    }
    function calendar(owner) {
      const item = active(), current = today();
      const pane = n("div", "tc-calendar");
      const weekBeginning = parser.shift(current, -parser.weekday(current));
      const heading = n("div", "tc-calendar-head");
      heading.append(n("strong", "", period === "week" ? "本周" : monthTitle(calMonth)));
      if (period !== "week") {
        const jump = (step) => {
          const d = new Date(calMonth + "T12:00:00Z");
          d.setUTCMonth(d.getUTCMonth() + step);
          calMonth = d.toISOString().slice(0, 10);
          paint();
          editor.querySelector(step < 0 ? '[aria-label="上个月"]' : '[aria-label="下个月"]')?.focus({preventScroll:true});
        };
        for (const [label, name, step] of [["‹","上个月",-1],["›","下个月",1]]) {
          const move = btn("tc-icon", label, () => jump(step));
          move.setAttribute("aria-label", name); heading.append(move);
        }
      }
      const grid = n("div", "tc-calendar-grid");
      for (const day of "一二三四五六日") grid.append(n("span", "tc-weekday", day));
      const first = period === "week" ? weekBeginning : parser.shift(calMonth, -parser.weekday(calMonth));
      for (let i = 0; i < (period === "week" ? 7 : 42); i++) {
        const date = parser.shift(first, i);
        const cell = btn("tc-date-cell", String(Number(date.slice(8))), () => setDate(date));
        cell.classList.toggle("tc-outside", period !== "week" && !date.startsWith(calMonth.slice(0, 7)));
        cell.classList.toggle("tc-today", date === current);
        cell.setAttribute("aria-pressed", String(date === item.date));
        cell.setAttribute("aria-label", date + (date === current ? " 今天" : ""));
        grid.append(cell);
      }
      pane.append(heading, grid); owner.append(pane);
    }

    function showCategoryAddition(owner, select) {
      if (owner.querySelector(".tc-add-category")) return;
      const field = n("input");
      field.type = "text"; field.maxLength = 32;
      field.setAttribute("aria-label", "新分类名称");
      field.placeholder = "新分类名称";
      const group = n("div", "tc-add-category");
      const item = active(), ticket = revision;
      const add = btn("tc-secondary", "添加", async () => {
        const name = field.value.trim();
        if (!name) { field.focus(); return; }
        dirty();
        add.disabled = true;
        try {
          await app.addCategory(name);
          if (ticket !== revision || !dialog.open || !items.includes(item)) return;
          item.category = name; item.categoryReason = ""; errorText = "";
          paint();
        } catch {
          if (ticket !== revision) return;
          errorText = "分类未能保存。名称已保留，可以重试。"; updateNotes();
        } finally { add.disabled = false; }
      });
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault(); event.stopPropagation(); add.click();
        }
      });
      group.append(field, add, btn("tc-link", "取消", () => { group.remove(); select.focus(); }));
      owner.append(group); field.focus();
    }

    function paint() {
      updateCard(); updateNotes(); editor.replaceChildren();
      const item = active(), current = today();
      const name = n("input"); name.type = "text"; name.value = item.title; name.maxLength = 500;
      name.addEventListener("input", () => { dirty(); item.title = name.value; updateCard(); });
      editor.append(labelled("要做的事", name));
      const when = n("section", "tc-when");
      const dateHead = n("div", "tc-label-row");
      dateHead.append(n("strong", "", item.daily ? "从哪天开始" : "哪天截止"));
      dateHead.append(n("span", "tc-timing", shortTiming(item)));
      when.append(dateHead);
      if (item.timingReason && (!item.dateAnswer || !item.timeAnswer)) when.append(n("small", "tc-hint", item.timingReason));
      const quick = n("div", "tc-options");
      const todayButton = btn("tc-chip", "今天", () => setDate(current));
      todayButton.setAttribute("aria-pressed", String(item.dateAnswer && item.date === current));
      const weekButton = btn("tc-chip", "本周", () => { dirty(); period = "week"; alwaysCalendar = true; paint(); });
      weekButton.setAttribute("aria-pressed", String(period === "week"));
      const monthButton = btn("tc-chip", "选日期", () => { dirty(); alwaysCalendar = !alwaysCalendar || period === "week" || !item.dateAnswer; period = ""; paint(); });
      monthButton.setAttribute("aria-expanded", String(alwaysCalendar && period !== "week"));
      quick.append(todayButton, weekButton, monthButton);
      if (!item.daily) {
        const none = btn("tc-chip", "先不定", () => setDate(""));
        none.setAttribute("aria-pressed", String(!item.date && item.dateAnswer));
        quick.append(none);
      }
      when.append(quick);
      if (alwaysCalendar) calendar(when);
      const time = n("input"); time.type = "time"; time.value = item.time;
      time.addEventListener("input", () => {
        dirty(); item.time = time.value;
        if (item.time) item.timeAnswer = true;
        if (item.time && !item.date) { item.dateAnswer = false; alwaysCalendar = true; paint(); }
        else { dateHead.lastElementChild.textContent = shortTiming(item); updateCard(); }
      });
      const timeRow = n("div", "tc-time-row");
      timeRow.append(labelled("具体时间", time));
      if (item.time || !item.timeAnswer) timeRow.append(btn("tc-link", item.time ? "改为全天" : "保留全天", () => {
        dirty(); item.time = ""; item.timeAnswer = true; errorText = ""; paint(); saveButton.focus({preventScroll:true});
      }));
      when.append(timeRow); editor.append(when);

      const options = n("div", "tc-basics");
      const cats = categories();
      const category = listSelect([["","未分类"], ...cats.map((x) => [x,x])], item.category, (v) => {
        dirty(); item.category = v; item.categoryReason = ""; paint(); editor.querySelector("[data-tc-category]")?.focus({preventScroll:true});
      });
      category.dataset.tcCategory = "yes";
      const catGroup = n("div", "tc-category");
      catGroup.append(labelled("分类", category), btn("tc-link", "新建分类", () => showCategoryAddition(catGroup, category)));
      if (item.categoryReason) catGroup.append(n("small", "tc-category-reason", item.categoryReason));
      options.append(catGroup);
      const priorities = [["","不设置"],["high","高"],["normal","普通"],["low","低"]];
      const priorityField = labelled("优先级", listSelect(priorities, item.priority, (v) => {
        dirty(); item.priority = v; item.priorityReason = ""; priorityField.querySelector("small")?.remove();
      }));
      if (item.priorityReason) priorityField.append(n("small", "tc-hint", item.priorityReason));
      options.append(priorityField);
      editor.append(options);

      const details = n("details", "tc-details"); details.open = item.expanded || item.daily;
      const summary = n("summary", "", item.daily ? "每日任务" : "开工与重复");
      details.append(summary);
      details.addEventListener("toggle", () => { if (details.isConnected) item.expanded = details.open; });
      const extra = n("div", "tc-extra");
      if (!item.daily) {
        const lead = n("input"); lead.type = "number"; lead.min = 0; lead.max = 365; lead.step = 1; lead.placeholder = "不提前";
        lead.value = item.lead ? String(item.lead) : "";
        lead.disabled = !item.date;
        const start = n("small", "tc-hint");
        const updateLead = () => {
          if (!item.date) start.textContent = "选定截止日期后可安排开工日。";
          else if (item.lead) start.textContent = shortDate(parser.shift(item.date, -item.lead)) + " 开始";
          else start.textContent = "";
        };
        lead.addEventListener("input", () => {
          dirty(); item.lead = Math.min(365, Math.max(0, Math.floor(Number(lead.value) || 0))); updateLead();
        });
        updateLead(); extra.append(labelled("提前几天开工", lead), start);
      }
      const daily = n("input"); daily.type = "checkbox"; daily.checked = item.daily;
      daily.addEventListener("change", () => {
        dirty(); item.daily = daily.checked; item.expanded = true;
        if (item.daily) { if (!item.date) item.date = current; item.dateAnswer = true; item.lead = 0; }
        initializeCalendar(); paint();
      });
      const dailyLabel = n("label", "tc-check");
      dailyLabel.append(daily, document.createTextNode("每天重复"));
      extra.append(dailyLabel);
      if (item.daily) {
        extra.append(labelled("当天漏做时", listSelect([["skip","跳过当天，明天照常"],["carry","保留待补办"]], item.missed,
          (v) => { dirty(); item.missed = v; })));
      }
      details.append(extra); editor.append(details);
    }

    function close() { if (!saving && dialog.open) dialog.close(); }
    function stopAssist() { assistController?.abort(); assistController = null; }
    async function save() {
      if (saving || !items.some((item) => item.chosen)) return;
      const missing = items.findIndex((item) => item.chosen && (!item.title.trim() || !item.dateAnswer || !item.timeAnswer));
      if (missing >= 0) {
        touched = true; selected = missing; initializeCalendar();
        errorText = !active().title.trim() ? "请填一下这件事的名称。" : !active().dateAnswer ? "给这件事选一天，也可以点「先不定」。" : "请选一个具体时间，也可以点「保留全天」。";
        paint(); editor.querySelector(!active().title.trim() ? 'input[type="text"]' : !active().dateAnswer ? ".tc-chip" : 'input[type="time"]')?.focus({preventScroll:true}); return;
      }
      saving = true; touched = true; stopAssist(); stageNote = ""; errorText = ""; updateCard(); updateNotes();
      dialog.dataset.saving = "true";
      editor.inert = true; itemNav.inert = true;
      const records = items.filter((item) => item.chosen).map((item) => ({
        id: item.id, title: item.title.trim(), category: item.category, date: item.date, time: item.time, lead: item.lead,
        daily: item.daily, missed: item.missed, priority: item.priority,
      }));
      const ticket = revision;
      try {
        await app.saveTasks(records);
        if (ticket !== revision || !dialog.isConnected) return;
        if (input.value.trim() === savedSource) input.value = "";
        status.textContent = records.length === 1 ? "已记下「" + records[0].title + "」。" : "已记下 " + records.length + " 项待办。";
        saving = false; close();
      } catch {
        if (ticket !== revision) return;
        errorText = "保存未确认。修改仍在这里，可再次尝试。"; updateNotes();
      } finally {
        if (ticket === revision) { saving = false; delete dialog.dataset.saving; editor.inert = false; itemNav.inert = false; updateCard(); }
      }
    }

    function buildDialog() {
      dialog.replaceChildren();
      dialog.classList.add("tc-dialog"); dialog.setAttribute("aria-labelledby","todo-capture-title");
      const frame = n("div", "tc-frame");
      const head = n("header", "tc-header");
      mainTitle = n("h2"); mainTitle.id = "todo-capture-title";
      const back = btn("tc-back", "返回原文", close);
      head.append(mainTitle, back);
      notes = n("p", "tc-note"); notes.setAttribute("role","status");
      itemNav = n("div", "tc-items");
      editor = n("div", "tc-editor");
      const body = n("div", "tc-body"); body.append(notes, itemNav, editor);
      const foot = n("footer", "tc-footer");
      saveButton = btn("tc-save", "记下", save);
      foot.append(saveButton);
      frame.append(head, body, foot); dialog.append(frame);
    }

    function combine(result, fallback) {
      const cats = categories(), choices = result.items;
      if (!Array.isArray(choices) || !choices.length) return [];
      return choices.map((fromAi, index) => {
        if (!fromAi || typeof fromAi.title !== "string" || !fromAi.title.trim()) return null;
        const fragment = typeof fromAi.source === "string" && fromAi.source.trim() && savedSource.includes(fromAi.source.trim()) ? fromAi.source.trim() : "";
        const local = (fragment ? fallback.find((candidate) => candidate.source === fragment) || parser.parse(fragment, {
          today: today(), categories: cats, defaultMissed: settings().defaultMissed,
        })[0] : null) || (fallback.length === choices.length ? fallback[index] : null);
        const date = local?.explicitlyUndated || local?.dateAmbiguous ? "" : local?.date || (validDate(fromAi.date) ? fromAi.date : "");
        const time = local?.timeAmbiguous || local?.explicitlyUndated ? "" : local?.time || (validTime(fromAi.time) ? fromAi.time : "");
        const category = cats.includes(fromAi.category) ? fromAi.category : local?.category || "";
        const daily = Boolean(local?.daily || fromAi.daily === true);
        return wrap({title: fromAi.title.trim().slice(0,500), category, date: date || (daily ? today() : ""), time, daily,
          source: local?.source || savedSource, explicitlyUndated: Boolean(local?.explicitlyUndated), lead: local?.leadExplicit && !daily ? local.lead : 0,
          timeAmbiguous: Boolean(local?.timeAmbiguous), timingReason: local?.timingReason || (typeof fromAi.reason === "string" ? fromAi.reason.slice(0,160) : ""),
          priority: ["high","normal","low"].includes(fromAi.priority) ? fromAi.priority : "",
          priorityReason: ["high","normal","low"].includes(fromAi.priority) ? "建议优先级，可手动调整" : "",
          categoryReason: category ? (category === local?.category ? local.categoryReason : "从原文推测，可更改") : "",
          missed: settings().defaultMissed === "carry" ? "carry" : "skip",
          needsDate: daily ? false : !date || (local?.date ? false : fromAi.needsDate !== false)});
      }).filter(Boolean);
    }

    async function launch(event) {
      event?.preventDefault();
      if (dialog.open || saving) return;
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      const opts = settings();
      const candidates = parser.parse(text, {today: today(), categories: categories(), defaultMissed: opts.defaultMissed,
        suggestCategory: opts.learnDefaults && app.suggestCategory ? (value) => app.suggestCategory(value) : null});
      if (!candidates.length) { status.textContent = "先写下要做的事。"; input.focus(); return; }
      savedSource = text; selected = 0; touched = false; saving = false; items = candidates.map(wrap);
      stageNote = ""; errorText = ""; const ticket = ++revision;
      const complex = candidates.length > 1 || candidates.some((c) => !c.category || c.needsDate || c.timeAmbiguous) || /[，,；;。\n]|然后|还有|并且|之前|截止|开始|紧急|优先/.test(text);
      const assist = typeof app.parseCapture === "function" && complex;
      if (assist) stageNote = "正在核对安排，可以先修改。";
      buildDialog(); initializeCalendar(); paint(); dialog.showModal();
      (items.length === 1 && !active().needsDate ? saveButton : editor.querySelector(".tc-chip"))?.focus({preventScroll: true});
      if (!assist) return;
      stopAssist(); const controller = new AbortController(); assistController = controller;
      try {
        const result = await app.parseCapture(text, {signal: controller.signal});
        if (ticket !== revision || !dialog.open || controller.signal.aborted || saving) return;
        stageNote = result?.source === "local" ? "已用本地规则提取，可逐项修改。" : "";
        if (["deepseek", "ai"].includes(result?.source) && !touched) {
          const combined = combine(result, candidates);
          if (combined.length) { items = combined; selected = 0; initializeCalendar(); paint(); }
        }
        updateNotes();
      } catch {
        if (ticket !== revision || !dialog.open || controller.signal.aborted || saving) return;
        stageNote = "已用本地规则提取，可继续记下。"; updateNotes();
      }
    }

    listen(form, "submit", launch);
    listen(input, "keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); form.requestSubmit();
    });
    listen(dialog, "cancel", (e) => { if (saving) e.preventDefault(); });
    listen(dialog, "pointerdown", dirty);
    listen(dialog, "compositionstart", dirty);
    listen(dialog, "close", () => { revision++; stopAssist(); saving = false; input.focus(); });
    listen(dialog, "keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (e.target.closest("button,select,summary") || e.target.type === "checkbox" || e.target.type === "time") return;
      e.preventDefault(); void save();
    });
    listen(document.getElementById("sample-batch"), "click", () => {
      if (input.value.trim()) { status.textContent = "已保留原文。清空后可以试填示例。"; input.focus(); return; }
      input.value = "明天下午三点取快递，周五交课程报告；每天读十五分钟英文";
      input.dispatchEvent(new Event("input", {bubbles:true})); input.focus();
    });
    sessions.set(form, () => {
      revision++; stopAssist(); lifecycle.abort(); saving = false;
      if (dialog.open) dialog.close(); dialog.replaceChildren();
    });
  }
  function destroy() {
    if (!activeForm) return;
    sessions.get(activeForm)?.();
    sessions.delete(activeForm); activeForm = null;
  }
  window.PrivateTodoCapture = {mount, destroy};
})();
