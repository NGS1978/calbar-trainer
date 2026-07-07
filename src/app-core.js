/* =====================================================================
   CalBar Trainer — core: state, FSRS-4.5 scheduler, i18n, utilities
   (window.DECKS is injected by build.js before this file)
   ===================================================================== */
"use strict";

/* ---------- deck / card indices ---------- */
const DECK_ORDER = ["civpro","conlaw","contracts","crimlaw","evidence","realprop","torts",
                    "busassoc","commprop","profresp","remedies","trusts","wills","glossary"];
const DECKS = (window.DECKS || []).slice().sort(
  (a, b) => DECK_ORDER.indexOf(a.subject) - DECK_ORDER.indexOf(b.subject));
const CARD = {};   // id -> card object (with .deck backref)
const DECK = {};   // subject -> deck
for (const d of DECKS) {
  DECK[d.subject] = d;
  for (const c of d.cards) { c.deck = d.subject; CARD[c.id] = c; }
}
const ALL_IDS = DECKS.flatMap(d => d.cards.map(c => c.id));

/* ---------- persistent state ---------- */
const LS_KEY = "cbt1";
const DEFAULT_SETTINGS = {
  lang: "zh", examDate: "2027-02-23", newPerDay: 20, dailyGoal: 60,
  retention: 0.9, theme: "auto", zhFirst: false, quizN: 10, deckOff: {},
  sound: true, intake: "smart", hideDiag: false
};
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings);
      s.cards = s.cards || {}; s.days = s.days || {}; s.xp = s.xp || 0;
      s.topics = s.topics || {}; s.diag = s.diag || {}; s.badges = s.badges || {}; s.flags = s.flags || {};
      for (const k of Object.keys(s.days)) {          // older/hand-edited backups may lack fields
        const v = s.days[k] || {};
        s.days[k] = { r: v.r || 0, ok: v.ok || 0, n: v.n || 0, q: v.q || 0, ms: v.ms || 0, xp: v.xp || 0 };
      }
      if (!s.flags.sndOn2) { s.flags.sndOn2 = 1; s.settings.sound = true; }   // one-time: v1.4 turns feedback sounds on
      return s;
    }
  } catch (e) { console.warn("state load failed", e); }
  return { v: 1, cards: {}, days: {}, xp: 0, topics: {}, diag: {}, badges: {}, flags: {}, settings: Object.assign({}, DEFAULT_SETTINGS) };
}
let saveT = null, storageOk = true;
function flushSave() {
  clearTimeout(saveT); saveT = null;
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); storageOk = true; }
  catch (e) {
    storageOk = false; console.warn("save failed", e);
    if (!flushSave.warned) { flushSave.warned = true; try { toast(t("toast.storage")); } catch (_) {} }
  }
}
function save(immediate) {
  clearTimeout(saveT);
  if (immediate) return flushSave();
  saveT = setTimeout(flushSave, 250);
}

/* ---------- time helpers ---------- */
const DAY = 86400000;
const now = () => Date.now();
function ymd(t) {
  const d = new Date(t === undefined ? now() : t);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function dayStart(t) { const d = new Date(t === undefined ? now() : t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function tomorrow0() { return dayStart() + DAY; }
function daysToExam() {
  const ex = new Date(S.settings.examDate + "T09:00:00");
  if (isNaN(ex.getTime())) return 365;            // invalid/cleared date must never poison scheduling
  return Math.max(0, Math.ceil((ex.getTime() - now()) / DAY));
}
function today() { const k = ymd(); if (!S.days[k]) S.days[k] = { r: 0, ok: 0, n: 0, q: 0, ms: 0, xp: 0 }; return S.days[k]; }

/* ---------- FSRS-4.5 ---------- */
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
           1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5, FCT = Math.pow(0.9, 1 / DECAY) - 1;   // 19/81
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
const retrievability = (tDays, s) => Math.pow(1 + FCT * tDays / Math.max(s, 0.01), DECAY);
const initS = g => Math.max(W[g - 1], 0.1);
const initD = g => clamp(W[4] - (g - 3) * W[5], 1, 10);
function nextD(d, g) {
  const nd = d - W[6] * (g - 3);
  return clamp(W[7] * initD(4) + (1 - W[7]) * nd, 1, 10);
}
function sRecall(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * Math.expm1((1 - r) * W[10]) * hard * easy);
}
function sForget(d, s, r) {
  return Math.min(W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]), s);
}
function maxIvl() { return clamp(daysToExam() - 2, 1, 365); }
function ivlDays(s, fuzz) {
  let i = Math.round(s / FCT * (Math.pow(S.settings.retention, 1 / DECAY) - 1));
  i = clamp(i, 1, maxIvl());
  if (fuzz && i > 2) i = Math.max(2, Math.round(i * (0.95 + Math.random() * 0.1)));
  return i;
}

/* card scheduling state:
   st: 0 new | 1 learning | 2 review | 3 relearning
   s stability(days), d difficulty, due(ms), last(ms), reps, lapses, step, susp, flag */
const LEARN_STEPS = [1, 10];               // minutes
function cs(id) {
  if (!S.cards[id]) S.cards[id] = { st: 0, s: 0, d: 0, due: 0, last: 0, reps: 0, lapses: 0, step: 0 };
  return S.cards[id];
}
function peek(id) { return S.cards[id]; }   // may be undefined (= new, untouched)

/* preview the 4 next-intervals for the grade buttons */
function previewIvls(id) {
  const c = peek(id), L = t("u.min"), D = t("u.day");
  if (!c || c.st === 0) {
    return ["1" + L, "5" + L, "10" + L, fmtIvl(ivlDays(initS(4)))];
  }
  if (c.st === 1) {
    const grad = fmtIvl(ivlDays(Math.max(c.s, initS(3))));
    return ["1" + L, LEARN_STEPS[c.step] + L,
            c.step + 1 >= LEARN_STEPS.length ? grad : LEARN_STEPS[c.step + 1] + L,
            fmtIvl(ivlDays(Math.max(c.s, initS(4))))];
  }
  if (c.st === 3) {
    return ["10" + L, "15" + L, fmtIvl(ivlDays(c.s)), fmtIvl(ivlDays(Math.max(c.s, sRecall(c.d, c.s, 0.9, 4))))];
  }
  const el = Math.max(0, (now() - c.last) / DAY);
  const r = retrievability(el, c.s);
  return ["10" + L,
          fmtIvl(ivlDays(sRecall(c.d, c.s, r, 2))),
          fmtIvl(ivlDays(sRecall(c.d, c.s, r, 3))),
          fmtIvl(ivlDays(sRecall(c.d, c.s, r, 4)))];
}

/* apply a grade (1-4). Returns undo snapshot. */
function grade(id, g) {
  const c = cs(id);
  const snap = { id, card: JSON.parse(JSON.stringify(c)), day: JSON.parse(JSON.stringify(today())), xp: S.xp };
  const t0 = now();
  const isReviewState = c.st === 2;
  if (c.st === 0) {                                   // first sighting
    c.s = initS(g); c.d = initD(g);
    if (g === 4) { c.st = 2; c.due = t0 + ivlDays(c.s, 1) * DAY; }
    else if (g === 3) { c.st = 1; c.step = 1; c.due = t0 + LEARN_STEPS[1] * 60000; }
    else if (g === 2) { c.st = 1; c.step = 0; c.due = t0 + 5 * 60000; }
    else { c.st = 1; c.step = 0; c.due = t0 + LEARN_STEPS[0] * 60000; }
    today().n++; addXP(15);
  } else if (c.st === 1) {                            // learning
    if (g === 1) { c.step = 0; c.due = t0 + LEARN_STEPS[0] * 60000; }
    else if (g === 2) { c.due = t0 + LEARN_STEPS[c.step] * 60000; }
    else if (g === 3) {
      c.step++;
      if (c.step >= LEARN_STEPS.length) { c.st = 2; c.s = Math.max(c.s, initS(3)); c.due = t0 + ivlDays(c.s, 1) * DAY; }
      else c.due = t0 + LEARN_STEPS[c.step] * 60000;
    } else { c.st = 2; c.s = Math.max(c.s, initS(4)); c.due = t0 + ivlDays(c.s, 1) * DAY; }
    addXP(5);
  } else if (c.st === 3) {                            // relearning
    if (g === 1) { c.due = t0 + 10 * 60000; }
    else if (g === 2) { c.due = t0 + 15 * 60000; }
    else { c.st = 2; if (g === 4) c.s = Math.max(c.s, sRecall(c.d, c.s, 0.9, 4)); c.due = t0 + ivlDays(c.s, 1) * DAY; }
    addXP(5);
  } else {                                            // review
    const el = Math.max(0, (t0 - c.last) / DAY);
    const r = retrievability(el, c.s);
    if (g === 1) {
      c.lapses++; c.s = sForget(c.d, c.s, r); c.d = nextD(c.d, 1);
      c.st = 3; c.due = t0 + 10 * 60000;
    } else {
      c.s = sRecall(c.d, c.s, r, g); c.d = nextD(c.d, g);
      c.due = t0 + ivlDays(c.s, 1) * DAY;
    }
    today().r++; if (g >= 2) today().ok++;
    addXP(g === 1 ? 2 : 10);
    if (typeof recordTopic === "function") recordTopic(id, g >= 2);   // 弱项雷达 signal
  }
  if (!isFinite(c.due)) c.due = t0 + DAY;             // belt-and-braces: never persist NaN scheduling
  c.last = t0; c.reps++;
  save();
  return Object.assign(snap, { wasReview: isReviewState, dayKey: ymd() });
}
function undoGrade(snap) {
  if (!snap) return;
  S.cards[snap.id] = snap.card;
  S.days[snap.dayKey || ymd()] = snap.day;
  S.xp = snap.xp;
  save();
}
function addXP(n) { S.xp += n; today().xp += n; }

/* ---------- queues ---------- */
function isSusp(id) { const c = peek(id); return !!(c && c.susp); }
/* when is the next review batch due? (for the all-clear home state) */
function nextDueIn() {
  const t0 = now();
  let min = Infinity;
  for (const id of ALL_IDS) {
    const c = peek(id);
    if (!c || c.susp || c.st !== 2 || c.due <= t0) continue;
    if (c.due < min) min = c.due;
  }
  if (!isFinite(min)) return null;
  const h = (min - t0) / 3600000;
  if (h >= 20) return t("home.tmrwShort");
  if (h >= 1) return Math.ceil(h) + t("u.hour");
  return Math.max(1, Math.ceil(h * 60)) + t("u.min");
}
function dueList() {
  const t0 = now(), t1 = tomorrow0(), out = [];
  for (const id of ALL_IDS) {
    const c = peek(id);
    if (!c || c.susp || c.st === 0) continue;
    if (c.st === 2 ? c.due < t1 : c.due <= t0 + 20 * 60000) out.push(id);
  }
  return out;
}
function buildReviewQueue(subject) {
  let list = dueList();
  if (subject) list = list.filter(id => CARD[id].deck === subject);
  /* overdue first, then shuffle-within-day for interleaving (shuffle + stable sort) */
  const key = id => { const c = peek(id); return Math.floor((c.due - dayStart()) / DAY); };
  shuffleArr(list);
  list.sort((a, b) => key(a) - key(b));
  /* greedy de-cluster: avoid same deck twice in a row where possible */
  for (let i = 1; i < list.length - 1; i++) {
    if (CARD[list[i]].deck === CARD[list[i - 1]].deck) {
      for (let j = i + 1; j < list.length; j++) {
        if (CARD[list[j]].deck !== CARD[list[i - 1]].deck) { [list[i], list[j]] = [list[j], list[i]]; break; }
      }
    }
  }
  return list;
}
function deckNewOff(subj) { return !!(S.settings.deckOff && S.settings.deckOff[subj]); }
function newRemainingByDeck() {
  const m = {};
  for (const d of DECKS) m[d.subject] = deckNewOff(d.subject) ? [] :
    d.cards.filter(c => { const s = peek(c.id); return (!s || s.st === 0) && !isSusp(c.id); }).map(c => c.id);
  return m;
}
function newQuotaLeft() { return Math.max(0, S.settings.newPerDay - today().n); }
function buildNewQueue(n) {
  if (S.settings.intake !== "even" && typeof buildNewQueueWeighted === "function") return buildNewQueueWeighted(n);
  const byDeck = newRemainingByDeck(), queue = [];
  const order = DECKS.map(d => d.subject).filter(s => byDeck[s].length);
  let i = 0;
  while (queue.length < n && order.some(s => byDeck[s].length)) {
    const s = order[i % order.length]; i++;
    if (byDeck[s].length) queue.push(byDeck[s].shift());
  }
  return queue;
}
function quizPool(subject) {
  return ALL_IDS.filter(id => {
    const c = CARD[id];
    return c.type === "mcq" && !isSusp(id) && (!subject || c.deck === subject);
  });
}
function buildQuiz(nQ, subject) {
  const pool = quizPool(subject);
  const scored = pool.map(id => {
    const c = peek(id);
    const r = c && c.st === 2 ? retrievability(Math.max(0, (now() - c.last) / DAY), c.s) : (c && c.st > 0 ? 0.55 : 0.35);
    return { id, k: r + Math.random() * 0.3 };
  });
  scored.sort((a, b) => a.k - b.k);
  return scored.slice(0, nQ).map(x => x.id);
}
/* a wrong quiz answer pulls the card's schedule forward; both return true if they
   already counted the action via grade()/intro (so the quiz must not count it again) */
function quizMiss(id) {
  const c = peek(id);
  if (c && c.st === 2) { grade(id, 1); return true; }          // lapse it into relearning
  if (!c || c.st === 0) {
    const s = cs(id); s.st = 1; s.step = 0; s.s = initS(1); s.d = initD(1); s.due = now(); s.last = now();
    today().n++; addXP(5); save(); return true;
  }
  return false;
}
function quizHit(id) {
  const c = peek(id);
  if (c && c.st === 2 && c.due < tomorrow0()) { grade(id, 3); return true; }   // counts as its due review
  return false;
}

/* ---------- stats ---------- */
function deckStats(subj) {
  const d = DECK[subj];
  let neu = 0, learn = 0, rev = 0, due = 0, rSum = 0, seen = 0, susp = 0;
  const t1 = tomorrow0();
  for (const c of d.cards) {
    const s = peek(c.id);
    if (s && s.susp) { susp++; continue; }
    if (!s || s.st === 0) { neu++; continue; }
    seen++;
    if (s.st === 1 || s.st === 3) { learn++; due++; rSum += 0.4; continue; }
    rev++;
    if (s.due < t1) due++;
    rSum += retrievability(Math.max(0, (now() - s.last) / DAY), s.s);
  }
  const total = d.cards.length;
  return { total, neu, learn, rev, due, susp, mastery: total ? rSum / total : 0, coverage: total ? seen / total : 0 };
}
function totals() {
  let studied = 0, mSum = 0, total = 0;
  for (const d of DECKS) { const st = deckStats(d.subject); studied += st.rev + st.learn; mSum += st.mastery * st.total; total += st.total; }
  return { studied, total, mastery: total ? mSum / total : 0 };
}
function streak() {
  let n = 0, t = dayStart();
  const active = k => S.days[k] && (S.days[k].r + S.days[k].n + S.days[k].q) > 0;
  if (!active(ymd(t))) t -= DAY;                 // today not yet studied → count up to yesterday
  while (active(ymd(t))) { n++; t -= DAY; }
  return n;
}
function retention30() {
  let r = 0, ok = 0;
  for (let i = 0; i < 30; i++) { const d = S.days[ymd(now() - i * DAY)]; if (d) { r += d.r; ok += d.ok; } }
  return r ? ok / r : null;
}
function paceInfo() {
  const remaining = Object.values(newRemainingByDeck()).reduce((n, a) => n + a.length, 0);
  const dLeft = daysToExam();
  const reviewWindow = 60;                        // aim: all cards seen ≥60d before exam
  const daysForNew = Math.max(14, dLeft - reviewWindow);
  const suggested = Math.min(60, Math.max(5, Math.ceil(remaining / daysForNew)));
  const finishDays = Math.ceil(remaining / Math.max(1, S.settings.newPerDay));
  return { remaining, dLeft, suggested, finishDays, onTrack: finishDays <= daysForNew };
}

/* ---------- i18n ---------- */
const I18N = {
  zh: {
    "nav.home": "首页", "nav.study": "学习", "nav.browse": "题库", "nav.stats": "统计", "nav.set": "设置",
    "u.min": "分", "u.day": "天", "u.week": "周", "u.month": "月", "u.cards": "张",
    "home.exam": "距加州律师执照考试", "home.days": "天", "home.examdate": "考试日期",
    "home.review": "开始复习", "home.due": "张卡片到期", "home.nodue": "今日复习已清空 ✓",
    "home.new": "学习新卡", "home.newleft": "今日剩余额度", "home.quiz": "考题演练", "home.quizd": "MCQ 模拟选择题",
    "home.goal": "今日目标", "home.done": "已完成", "home.subjects": "科目掌握度", "home.mcqbadge": "选择题科目",
    "home.pace": "进度规划", "home.streakd": "天连续学习",
    "study.reveal": "显示答案", "study.again": "重来", "study.hard": "困难", "study.good": "记得", "study.easy": "轻松",
    "study.zhHint": "显示中文", "study.zhHide": "隐藏中文", "study.edit": "标记", "study.undo": "撤销",
    "study.empty": "没有到期的卡片", "study.exit": "退出",
    "study.kbd": "快捷键：空格=显示答案 · 1-4=评分",
    "sum.title": "本轮完成！", "sum.reviewed": "复习", "sum.correct": "正确率", "sum.xp": "经验值",
    "sum.back": "返回首页", "sum.more": "再来一轮",
    "quiz.title": "考题演练", "quiz.n": "题数", "quiz.scope": "范围", "quiz.all": "全部科目", "quiz.start": "开始",
    "quiz.next": "下一题", "quiz.finish": "查看成绩", "quiz.score": "得分", "quiz.wrongAdded": "答错的卡片已加入复习队列",
    "quiz.notready": "该范围的选择题不足", "study.suggest": "建议",
    "deck.pause": "⏸ 暂停本科新卡", "deck.resume": "▶ 恢复本科新卡", "deck.review": "复习本科到期卡",
    "toast.deckoff": "本科新卡已暂停（已学卡片仍会复习）", "toast.deckon": "本科新卡已恢复",
    "browse.search": "搜索卡片…", "browse.total": "张卡片", "browse.flagged": "已标记", "browse.susp": "已暂停",
    "card.suspend": "暂停此卡", "card.unsuspend": "恢复此卡", "card.flag": "标记待查", "card.unflag": "取消标记",
    "card.reset": "重置进度", "card.close": "关闭",
    "stats.today": "今日", "stats.week": "近7天", "stats.all": "累计", "stats.time": "分钟",
    "stats.retention": "近30天记忆保持率", "stats.heat": "学习热力图", "stats.daily": "近14天每日卡片量",
    "stats.beststreak": "最长连续", "stats.mastery": "总体掌握度", "stats.reviews": "次复习",
    "set.lang": "界面语言", "set.exam": "考试日期", "set.newperday": "每日新卡数量", "set.goal": "每日目标(张)",
    "set.retention": "目标记忆保持率", "set.retentiond": "越高复习越频繁 (0.85-0.95)",
    "set.theme": "主题", "set.theme.auto": "自动", "set.theme.light": "浅色", "set.theme.dark": "深色",
    "set.zhfirst": "默认显示中文提示", "set.zhfirstd": "题面自动附中文翻译",
    "set.export": "导出学习进度", "set.import": "导入学习进度", "set.reset": "清空全部进度",
    "set.resetc": "确定要清空全部学习进度吗？此操作不可恢复！", "set.imported": "进度已导入 ✓", "set.exportd": "已下载备份文件",
    "set.method": "高效学习方法", "set.guide": "功能指南", "set.about": "关于",
    "guide.title": "功能指南 — 每个功能怎么用",
    "toast.suspended": "已暂停", "toast.unsuspended": "已恢复", "toast.flagged": "已标记", "toast.unflagged": "已取消标记",
    "toast.reset": "已重置", "toast.undone": "已撤销", "toast.goalhit": "今日目标达成！🎉", "toast.nonew": "今日新卡额度已用完",
    "toast.storage": "⚠️ 无法保存进度（浏览器存储不可用）",
    "box.explain": "解析", "box.ca": "CALIFORNIA 加州区别", "box.mn": "MNEMONIC 记忆钩", "card.lapses": "遗忘",
    "court.due": "宗案卷待审", "court.clear": "今日庭审已毕 ✓", "court.adjourn": "休庭 · COURT ADJOURNED", "court.verdict": "陪审团裁决",
    "home.nextdue": "下一批", "home.tmrwShort": "明天", "u.hour": "小时", "home.quotatmrw": "明日恢复新卡额度",
    "home.alldone": "今日任务完成！", "home.alldoned": "复习与新卡都已清空——想加练就来一轮考题演练",
    "diag.title": "摸底测试", "diag.desc": "考过几次？每科 12 题摸个底——答得好的科目，卡片直接按'已会'排期，不用从零学。",
    "diag.start": "测", "diag.done": "已摸底", "diag.hide": "不再显示", "diag.chip": "摸底",
    "diag.result": "摸底结果", "diag.seeded": "张卡已按你的水平预排期", "diag.weakt": "待补强专题", "diag.fresh": "该科将从新卡正常学起",
    "triage.title": "快速分拣", "triage.known": "已掌握", "triage.learn": "要学", "triage.undo": "撤销",
    "triage.desc": "只看题面，秒判'会/不会'——已掌握的卡直接进入复习轨道。",
    "triage.sumKnown": "已掌握", "triage.sumLearn": "待学", "triage.exit": "结束分拣",
    "radar.title": "弱项雷达", "radar.drill": "练", "radar.empty": "信号积累中——先做些复习、演练或摸底测试",
    "bridge.title": "通往金门", "bridge.crossed": "已跨越", "bridge.fog": "记忆保持率", "bridge.fogline": "雾正在散去",
    "cab.title": "判例徽章", "cab.sub": "里程碑即判例——收集即复习", "cab.locked": "未解锁",
    "set.sound": "音效", "set.soundd": "翻卡、对错反馈与法槌（可随时关闭）",
    "set.intake": "新卡顺序", "set.intake.smart": "弱项优先", "set.intake.even": "均衡轮换",
    "pace.remaining": "未学新卡", "pace.finish": "按当前速度学完还需", "pace.suggest": "建议每日新卡",
    "pace.ontrack": "进度良好 — 考前将有充足纯复习期", "pace.behind": "偏慢 — 建议提高每日新卡量",
    "method.title": "如何用好这个应用",
    "state.new": "新卡", "state.learn": "学习中", "state.rev": "复习", "state.due": "到期", "state.susp": "暂停",
    "quiz.right": "答对", "quiz.wrong": "答错"
  },
  en: {
    "nav.home": "Home", "nav.study": "Study", "nav.browse": "Browse", "nav.stats": "Stats", "nav.set": "Settings",
    "u.min": "m", "u.day": "d", "u.week": "w", "u.month": "mo", "u.cards": "",
    "home.exam": "California Bar Exam in", "home.days": "days", "home.examdate": "Exam date",
    "home.review": "Start Review", "home.due": "cards due", "home.nodue": "All reviews done ✓",
    "home.new": "Learn New", "home.newleft": "left today", "home.quiz": "Quiz Mode", "home.quizd": "MCQ practice",
    "home.goal": "Daily Goal", "home.done": "done", "home.subjects": "Subject Mastery", "home.mcqbadge": "MCQ subject",
    "home.pace": "Pacing", "home.streakd": "day streak",
    "study.reveal": "Show Answer", "study.again": "Again", "study.hard": "Hard", "study.good": "Good", "study.easy": "Easy",
    "study.zhHint": "中文", "study.zhHide": "Hide 中文", "study.edit": "Flag", "study.undo": "Undo",
    "study.empty": "No cards due", "study.exit": "Exit",
    "study.kbd": "Keys: Space = reveal · 1-4 = grade",
    "sum.title": "Session complete!", "sum.reviewed": "Reviewed", "sum.correct": "Accuracy", "sum.xp": "XP",
    "sum.back": "Home", "sum.more": "One more round",
    "quiz.title": "Quiz Mode", "quiz.n": "Questions", "quiz.scope": "Scope", "quiz.all": "All subjects", "quiz.start": "Start",
    "quiz.next": "Next", "quiz.finish": "Results", "quiz.score": "Score", "quiz.wrongAdded": "Missed cards added to review queue",
    "quiz.notready": "Not enough MCQs in this scope", "study.suggest": "suggested",
    "deck.pause": "⏸ Pause new cards", "deck.resume": "▶ Resume new cards", "deck.review": "Review due in this deck",
    "toast.deckoff": "New cards paused for this deck (reviews continue)", "toast.deckon": "New cards resumed",
    "browse.search": "Search cards…", "browse.total": "cards", "browse.flagged": "Flagged", "browse.susp": "Suspended",
    "card.suspend": "Suspend", "card.unsuspend": "Unsuspend", "card.flag": "Flag", "card.unflag": "Unflag",
    "card.reset": "Reset progress", "card.close": "Close",
    "stats.today": "Today", "stats.week": "7 days", "stats.all": "All time", "stats.time": "min",
    "stats.retention": "30-day retention", "stats.heat": "Activity heatmap", "stats.daily": "Cards per day (14d)",
    "stats.beststreak": "Best streak", "stats.mastery": "Overall mastery", "stats.reviews": "reviews",
    "set.lang": "Language", "set.exam": "Exam date", "set.newperday": "New cards / day", "set.goal": "Daily goal (cards)",
    "set.retention": "Target retention", "set.retentiond": "Higher = more frequent reviews (0.85-0.95)",
    "set.theme": "Theme", "set.theme.auto": "Auto", "set.theme.light": "Light", "set.theme.dark": "Dark",
    "set.zhfirst": "Show 中文 hint by default", "set.zhfirstd": "Chinese translation shown automatically",
    "set.export": "Export progress", "set.import": "Import progress", "set.reset": "Reset all progress",
    "set.resetc": "Really erase ALL progress? This cannot be undone!", "set.imported": "Progress imported ✓", "set.exportd": "Backup downloaded",
    "set.method": "Learning method", "set.guide": "User guide", "set.about": "About",
    "guide.title": "User Guide — how everything works",
    "toast.suspended": "Suspended", "toast.unsuspended": "Restored", "toast.flagged": "Flagged", "toast.unflagged": "Unflagged",
    "toast.reset": "Reset", "toast.undone": "Undone", "toast.goalhit": "Daily goal reached! 🎉", "toast.nonew": "New-card quota used up for today",
    "toast.storage": "⚠️ Cannot save progress (browser storage unavailable)",
    "box.explain": "EXPLANATION", "box.ca": "CALIFORNIA RULE", "box.mn": "MNEMONIC", "card.lapses": "lapses",
    "court.due": "case files on the docket", "court.clear": "Docket clear ✓", "court.adjourn": "COURT ADJOURNED", "court.verdict": "Jury Verdict",
    "home.nextdue": "next batch", "home.tmrwShort": "tomorrow", "u.hour": "h", "home.quotatmrw": "quota resets tomorrow",
    "home.alldone": "All done for today!", "home.alldoned": "Reviews and new cards are clear — fancy a quiz round?",
    "diag.title": "Placement Diagnostic", "diag.desc": "Sat it before? Take 12 questions per subject — strong subjects get pre-scheduled as known instead of starting from zero.",
    "diag.start": "Test", "diag.done": "Diagnosed", "diag.hide": "Hide this", "diag.chip": "Diagnostic",
    "diag.result": "Diagnostic Result", "diag.seeded": "cards pre-scheduled to your level", "diag.weakt": "Topics to rebuild", "diag.fresh": "This subject starts fresh as new cards",
    "triage.title": "Fast Triage", "triage.known": "I know this", "triage.learn": "Need to learn", "triage.undo": "Undo",
    "triage.desc": "Question-only, snap judgment — cards you know go straight onto the review track.",
    "triage.sumKnown": "known", "triage.sumLearn": "to learn", "triage.exit": "Finish triage",
    "radar.title": "Weakness Radar", "radar.drill": "Drill", "radar.empty": "Gathering signal — do some reviews, a quiz, or a diagnostic first",
    "bridge.title": "Road to the Golden Gate", "bridge.crossed": "crossed", "bridge.fog": "retention", "bridge.fogline": "the fog is lifting",
    "cab.title": "Case Badges", "cab.sub": "Milestones as landmark cases — collecting is revising", "cab.locked": "Locked",
    "set.sound": "Sounds", "set.soundd": "Card flips, right/wrong feedback & gavel (toggle any time)",
    "set.intake": "New-card order", "set.intake.smart": "Weakest first", "set.intake.even": "Even rotation",
    "pace.remaining": "unseen cards", "pace.finish": "days to finish at current pace", "pace.suggest": "suggested new/day",
    "pace.ontrack": "On track — ample pure-review runway before the exam", "pace.behind": "Behind — consider raising new cards per day",
    "method.title": "How to use this app well",
    "state.new": "New", "state.learn": "Learning", "state.rev": "Review", "state.due": "Due", "state.susp": "Susp.",
    "quiz.right": "Correct", "quiz.wrong": "Wrong"
  }
};
function t(k) { const L = I18N[S.settings.lang] || I18N.zh; return L[k] !== undefined ? L[k] : (I18N.zh[k] !== undefined ? I18N.zh[k] : k); }
function fmtIvl(days) {
  if (days < 1) return "<1" + t("u.day");
  if (days <= 21) return Math.round(days) + t("u.day");
  if (days < 84) return Math.round(days / 7) + t("u.week");
  return (days / 30.4).toFixed(1).replace(/\.0$/, "") + t("u.month");
}

/* ---------- ranks ---------- */
const RANKS = [
  [0, "见习书记员", "Law Clerk", "🪶"], [300, "律师助理", "Paralegal", "📎"],
  [800, "法学院 1L", "1L Student", "📗"], [1600, "法学院 2L", "2L Student", "📘"],
  [2800, "法学院 3L", "3L Student", "📙"], [4500, "实习律师", "Legal Intern", "🖊️"],
  [7000, "初级律师", "Associate", "💼"], [10500, "资深律师", "Senior Associate", "📑"],
  [15000, "合伙人", "Partner", "🏛️"], [21000, "高级合伙人", "Senior Partner", "⚜️"],
  [29000, "法官", "Judge", "🧑‍⚖️"], [40000, "首席大法官", "Chief Justice", "👑"]
];
function rank() {
  let r = RANKS[0], next = null;
  for (let i = 0; i < RANKS.length; i++) { if (S.xp >= RANKS[i][0]) r = RANKS[i]; else { next = RANKS[i]; break; } }
  return { name: S.settings.lang === "zh" ? r[1] : r[2], emoji: r[3], next, xp: S.xp };
}

/* ---------- misc utils ---------- */
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function clozeQ(q, filled) {
  const m = q.match(/^(.*?)\{\{c::([^}]+)\}\}(.*)$/s);
  if (!m) return esc(q);
  return esc(m[1]) + '<span class="cloze' + (filled ? " filled" : "") + '">' + (filled ? esc(m[2]) : "［ ？ ］") + "</span>" + esc(m[3]);
}
function deckName(d) { return S.settings.lang === "zh" ? d.nameZh : d.nameEn; }
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
let toastT = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200);
}
/* session time tracking */
let lastAct = now();
function tickTime() { const d = Math.min(now() - lastAct, 60000); if (d > 400) today().ms += d; lastAct = now(); }

/* confetti */
function confetti() {
  const cv = document.getElementById("confetti"); if (!cv) return;
  const ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#e8710a", "#f5a623", "#2f8f4e", "#2f6fb3", "#c9a227", "#d95757"];
  const ps = Array.from({ length: 110 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.4,
    vy: 2.2 + Math.random() * 3.2, vx: -1.4 + Math.random() * 2.8,
    s: 4 + Math.random() * 5, c: cols[(Math.random() * cols.length) | 0], r: Math.random() * Math.PI
  }));
  let f = 0;
  (function loop() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.r += 0.09;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (++f < 130) requestAnimationFrame(loop); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}
