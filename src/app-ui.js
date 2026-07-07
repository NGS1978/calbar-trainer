/* =====================================================================
   CalBar Trainer — UI: router, views, study & quiz flows
   ===================================================================== */
"use strict";

const $ = sel => document.querySelector(sel);
let session = null;   // {mode:'review'|'new', queue:[], initTotal, done, ok, xp0, revealed, snap, shuffle}
let quiz = null;      // {ids:[], idx, right, wrong, answered, choice, shuffle}

/* ---------- theme ---------- */
function applyTheme() {
  const s = S.settings.theme;
  const dark = s === "dark" || (s === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

/* ---------- router ---------- */
const routes = { home: vHome, study: vStudy, quiz: vQuiz, browse: vBrowse, deck: vDeck, stats: vStats, settings: vSettings, method: vMethod, guide: vGuide, triage: vTriage };
function nav(h) { location.hash = "#" + h; }
function route() {
  const h = (location.hash || "#home").slice(1);
  const [name, arg] = h.split("/");
  const fn = routes[name] || vHome;
  const m = document.getElementById("modalbg"); if (m) m.remove();
  tickTime();
  $("#view").innerHTML = fn(arg) || "";
  const tab = { home: "home", study: "home", quiz: "home", browse: "browse", deck: "browse", triage: "browse", stats: "stats", settings: "set", method: "set", guide: "set" }[name] || "home";
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  renderTopbar();
  window.scrollTo(0, 0);
  if (name === "study") bindStudy();
  if (name === "quiz") bindQuiz();
}
window.addEventListener("hashchange", route);

function renderTopbar() {
  const r = rank();
  $("#pill-streak").textContent = "🔥 " + streak();
  $("#pill-rank").textContent = r.emoji + " " + r.name;
}

/* ============================ HOME ============================ */
function vHome() {
  const due = dueList().length;
  const quota = newQuotaLeft();
  const newAvail = Math.min(quota, buildNewQueue(quota).length);
  const d = today();
  const doneToday = d.r + d.n + d.q;
  const goal = S.settings.dailyGoal;
  const pct = Math.min(1, doneToday / goal);
  const pace = paceInfo();
  const tot = totals();
  const fresh = !Object.keys(S.cards).length && doneToday === 0;

  const freshBadges = evaluateBadges();
  setTimeout(() => announceBadges(freshBadges), 500);

  const ringR = 34, circ = 2 * Math.PI * ringR;
  let h = `
  <div class="hero">
    <div class="bearwrap">${bearSVG(streak() > 0 || doneToday > 0 ? "greet" : "doze", 86)}</div>
    <h2>${esc(t("home.exam"))}</h2>
    <div class="count"><b>${daysToExam()}</b><span>${esc(t("home.days"))} · ${esc(S.settings.examDate)}</span></div>
    <div class="sub">California Bar Exam · 加州律师执照考试</div>
    <div class="bubble">💬 ${esc(greetLine())}</div>
  </div>`;

  if (fresh) h += `
  <div class="panel" style="border-left:4px solid var(--poppy)">
    <h3>👋 ${S.settings.lang === "zh" ? "Ron，欢迎！" : "Welcome, Ron!"}</h3>
    <div style="font-size:.9rem" class="muted">${S.settings.lang === "zh"
      ? `这是为你定制的加州律考记忆训练器：${tot.total} 张中英双语卡片，覆盖全部 13 个考试科目 + 法律英语词汇。间隔重复算法（FSRS）会安排每一张卡片的最佳复习时机。先从「学习新卡」开始，建议每天 20 张新卡起步。学习前先花两分钟读一读<a href="#method">高效学习方法</a>，各功能的用法见<a href="#guide">功能指南</a>。`
      : `A bilingual California Bar trainer built for you: ${tot.total} cards across all 13 tested subjects plus legal English. The FSRS spaced-repetition engine schedules each card at the optimal moment. Start with "Learn New" — 20 cards/day is a good opening pace. Read <a href="#method">the method guide</a> first (2 min); every feature is explained in <a href="#guide">the user guide</a>.`}</div>
  </div>`;

  h += `
  <div class="cta-row">
    <button class="cta main" id="cta-review" ${due ? "" : "disabled"}>
      <span class="n">${due}<span class="unit">${esc(t("u.cards"))}</span></span>
      <span class="t">⚖️ ${esc(t("home.review"))}</span>
      <span class="d">${due ? esc(t("court.due")) : esc(t("court.clear"))}</span>
    </button>
    <button class="cta" id="cta-new" ${newAvail ? "" : "disabled"}>
      <span class="n">${newAvail}</span>
      <span class="t">＋ ${esc(t("home.new"))}</span>
      <span class="d">${esc(t("home.newleft"))}</span>
    </button>
    <button class="cta" id="cta-quiz">
      <span class="n">🎯</span>
      <span class="t">${esc(t("home.quiz"))}</span>
      <span class="d">${esc(t("home.quizd"))}</span>
    </button>
  </div>

  ${diagPanel()}

  <div class="panel">
    <div class="goalrow">
      <div class="ring">
        <svg width="84" height="84">
          <circle cx="42" cy="42" r="${ringR}" fill="none" stroke="var(--chip)" stroke-width="8"/>
          <circle cx="42" cy="42" r="${ringR}" fill="none" stroke="var(--poppy)" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}"/>
        </svg>
        <div class="mid">${doneToday}<small>/ ${goal}</small></div>
      </div>
      <div class="info">
        <b>${esc(t("home.goal"))}</b> · ${Math.round(pct * 100)}% ${esc(t("home.done"))}<br>
        🔥 <b>${streak()}</b> ${esc(t("home.streakd"))}<br>
        <span class="tiny">${esc(t("home.pace"))}: ${pace.remaining} ${esc(t("pace.remaining"))} · ${esc(t("pace.suggest"))} <b>${pace.suggested}</b></span><br>
        <span class="tiny" style="color:${pace.onTrack ? "var(--jade)" : "var(--amber)"}">${esc(pace.onTrack ? t("pace.ontrack") : t("pace.behind"))}</span>
      </div>
    </div>
  </div>

  ${radarPanel()}

  <div class="panel"><h3>🌉 ${esc(t("bridge.title"))}<span class="sub">${Math.round(journeyP() * 100)}%</span></h3>
    ${bridgeSVG()}
    <div class="tiny" style="margin-top:8px;text-align:center">${esc(t("bridge.crossed"))} ${Math.round(journeyP() * 100)}%${retention30() !== null ? ` · ${esc(t("bridge.fog"))} ${Math.round(retention30() * 100)}% — ${esc(t("bridge.fogline"))}` : ""}</div>
  </div>

  <div class="panel"><h3>📚 ${esc(t("home.subjects"))}<span class="sub">${tot.studied}/${tot.total}</span></h3>`;
  for (const d2 of DECKS) {
    const st = deckStats(d2.subject);
    h += `
    <div class="subj" onclick="nav('deck/${d2.subject}')" style="cursor:pointer">
      <span class="em">${d2.emoji}</span>
      <div class="nm"><b>${esc(deckName(d2))}${d2.mcqTested ? `<span class="badge">MCQ</span>` : ""}${deckNewOff(d2.subject) ? " ⏸" : ""}</b>
        <span>${st.rev + st.learn}/${st.total} · ${st.due} ${esc(t("state.due"))}</span></div>
      <div class="bar"><i style="width:${Math.round(st.mastery * 100)}%"></i></div>
      <span class="pc">${Math.round(st.mastery * 100)}%</span>
    </div>`;
  }
  h += `</div>`;
  setTimeout(() => {
    const r1 = $("#cta-review"), r2 = $("#cta-new"), r3 = $("#cta-quiz");
    if (r1) r1.onclick = () => startReview();
    if (r2) r2.onclick = () => startNew();
    if (r3) r3.onclick = () => quizSetup();
  });
  return h;
}

/* ============== home sub-panels: diagnostic + radar ============== */
function diagPanel() {
  if (S.settings.hideDiag) return "";
  const undone = DECKS.filter(d => !diagDone(d.subject) && quizPool(d.subject).length >= 8);
  const done = DECKS.filter(d => diagDone(d.subject));
  if (!undone.length) return "";
  let h = `<div class="panel"><h3>🧪 ${esc(t("diag.title"))}<span class="sub" style="cursor:pointer" onclick="setOpt('hideDiag',true)">${esc(t("diag.hide"))} ✕</span></h3>
    <div class="tiny" style="margin-bottom:8px">${esc(t("diag.desc"))}</div>
    <div class="diagchips">`;
  for (const d of undone) h += `<button class="btn" style="padding:6px 10px" onclick="startDiag('${d.subject}')">${d.emoji} ${esc(deckName(d))} · ${esc(t("diag.start"))}</button>`;
  h += `</div>`;
  if (done.length) h += `<div class="tiny" style="margin-top:8px">✓ ${done.map(d => `${esc(deckName(d))} ${Number(S.diag[d.subject].p) || 0}%`).join(" · ")}</div>`;
  return h + `</div>`;
}
let radarCache = [];
function radarPanel() {
  const weak = topicStats().slice(0, 3);
  radarCache = weak;
  let h = `<div class="panel"><h3>📡 ${esc(t("radar.title"))}</h3>`;
  if (!weak.length) return h + `<div class="tiny">${esc(t("radar.empty"))}</div></div>`;
  weak.forEach((w, i) => {
    const label = S.settings.lang === "zh" ? w.topicZh : w.topic;
    h += `
    <div class="subj">
      <span class="em">${DECK[w.deck].emoji}</span>
      <div class="nm"><b>${esc(label)}</b><span>${esc(deckName(DECK[w.deck]))} · ${w.n} ${esc(t("stats.reviews"))}</span></div>
      <div class="bar"><i style="width:${Math.round(w.acc * 100)}%;background:${w.acc < 0.6 ? "var(--red)" : "var(--amber)"}"></i></div>
      <span class="pc">${Math.round(w.acc * 100)}%</span>
      <button class="btn" style="padding:4px 12px;flex:none" onclick="startDrillIdx(${i})">${esc(t("radar.drill"))}</button>
    </div>`;
  });
  return h + `</div>`;
}
window.startDrillIdx = (i) => { const w = radarCache[i]; if (w) startDrill(w.deck, w.topic); };
window.startDrill = (deck, topic) => {
  const q = buildTopicDrill(deck, topic, 12);
  if (q.length < 3) { toast(t("radar.empty")); return; }
  session = { mode: "drill", queue: q, initTotal: q.length, done: 0, ok: 0, att: 0, xp0: S.xp, revealed: false, snap: null, zh: S.settings.zhFirst };
  nav("study");
};

/* ============== A. diagnostic flow (rides the quiz view) ============== */
window.startDiag = (subj) => {
  const ids = buildDiag(subj);
  if (ids.length < 8) { toast(t("quiz.notready")); return; }
  quiz = { mode: "diag", subject: subj, ids, idx: 0, right: 0, rightIds: [], wrongIds: [], answered: false, pick: null, shuffle: shuffleArr([0, 1, 2, 3]), xp0: S.xp, zh: false };
  nav("quiz");
};
function diagResults() {
  if (!quiz.applied) {
    quiz.applied = applyDiag(quiz.subject, quiz.rightIds, quiz.wrongIds);
    addXP(30); save();
    const fresh = evaluateBadges();
    setTimeout(() => announceBadges(fresh), 700);
  }
  const r = quiz.applied, d = DECK[quiz.subject];
  const zh = S.settings.lang === "zh";
  const weakList = r.weak.map(tp => {
    const card = d.cards.find(c => c.topic === tp);
    return esc(zh && card ? card.topicZh : tp);
  }).join("、");
  const h = `
  <div class="summary">
    <div class="big">🧪</div>
    <h2>${d.emoji} ${esc(deckName(d))} · ${esc(t("diag.result"))}</h2>
    <div class="sumgrid">
      <div class="cell"><b>${quiz.right}/${quiz.ids.length}</b><span>${esc(t("sum.correct"))}</span></div>
      <div class="cell"><b>${r.seeded}</b><span>${esc(t("diag.seeded"))}</span></div>
      <div class="cell"><b>${r.p}%</b><span>${esc(t("diag.title"))}</span></div>
    </div>
    ${r.seeded ? "" : `<p class="tiny">${esc(t("diag.fresh"))}</p>`}
    ${r.weak.length ? `<p class="tiny">🎯 ${esc(t("diag.weakt"))}: ${weakList}</p>` : ""}
    <button class="btn primary" style="width:100%;padding:14px" onclick="exitQuiz()">${esc(t("sum.back"))}</button>
  </div>`;
  setTimeout(confetti, 150);
  return h;
}

/* ============== B. fast triage ============== */
let tri = null;
function vTriage(subj) {
  const d = DECK[subj];
  if (!d) { setTimeout(() => nav("browse")); return ""; }
  if (!tri || tri.subj !== subj) {
    const ids = d.cards.map(c => c.id).filter(id => { const s = peek(id); return (!s || s.st === 0) && !isSusp(id); });
    tri = { subj, ids, idx: 0, known: 0, learn: 0, zh: S.settings.zhFirst, last: null };
  }
  if (tri.idx >= tri.ids.length) {
    const h = `
    <div class="summary">
      <div class="big">🗂</div>
      <h2>${d.emoji} ${esc(t("triage.title"))}</h2>
      <div class="sumgrid" style="grid-template-columns:1fr 1fr">
        <div class="cell"><b>${tri.known}</b><span>✅ ${esc(t("triage.sumKnown"))}</span></div>
        <div class="cell"><b>${tri.learn}</b><span>📖 ${esc(t("triage.sumLearn"))}</span></div>
      </div>
      <button class="btn primary" style="width:100%;padding:14px" onclick="tri=null;nav('deck/${subj}')">${esc(t("sum.back"))}</button>
    </div>`;
    return h;
  }
  const c = CARD[tri.ids[tri.idx]];
  return `
  <div class="study-top">
    <button onclick="exitTriage()" title="${esc(t("triage.exit"))}">✕</button>
    <div class="prog"><i style="width:${Math.round(100 * tri.idx / tri.ids.length)}%"></i></div>
    <span class="cnt">${tri.idx + 1} / ${tri.ids.length}</span>
    <button onclick="triUndo()" title="${esc(t("triage.undo"))}">↩︎</button>
  </div>
  <div class="qcard">
    <div class="chips">
      <span class="chip">${DECK[c.deck].emoji} ${esc(deckName(DECK[c.deck]))}</span>
      <span class="chip">${esc(S.settings.lang === "zh" ? c.topicZh : c.topic)}</span>
      <span class="chip">🗂 ${esc(t("triage.title"))}</span>
    </div>
    <div class="qtext">${c.type === "cloze" ? clozeQ(c.q, true) : esc(c.q)}</div>
    ${tri.zh ? `<div class="zh-hint">${esc(c.qZh)}</div>` : ""}
    <button class="hintbtn" onclick="triZh()">${tri.zh ? esc(t("study.zhHide")) : "🀄 " + esc(t("study.zhHint"))}</button>
  </div>
  <div class="actionbar"><div class="tri-btns">
    <button class="tri-known" onclick="triMark(true)">✅ ${esc(t("triage.known"))}<small>${S.settings.lang === "zh" ? "进入复习轨道" : "onto the review track"}</small></button>
    <button class="tri-learn" onclick="triMark(false)">📖 ${esc(t("triage.learn"))}<small>${S.settings.lang === "zh" ? "保持为新卡" : "stays a new card"}</small></button>
  </div></div>
  <div class="kbd-hint">1 = ${esc(t("triage.known"))} · 2 = ${esc(t("triage.learn"))}</div>`;
}
window.triZh = () => { tri.zh = !tri.zh; route(); };
window.triMark = (known) => {
  if (!tri || tri.idx >= tri.ids.length) return;
  const id = tri.ids[tri.idx];
  const st0 = peek(id);
  if (st0 && st0.st !== 0) {           // studied since the list was built — never clobber live state
    tri.idx++; tri.last = null; route(); return;
  }
  tri.last = { id, known, prev: st0 ? JSON.parse(JSON.stringify(st0)) : undefined };
  if (known) { seedCard(id, 15, false); addXP(2); tri.known++; }
  else tri.learn++;
  tri.idx++;
  save();
  route();
};
window.triUndo = () => {
  if (!tri || !tri.last || tri.idx === 0) return;
  tri.idx--;
  if (tri.last.known) {
    if (tri.last.prev) S.cards[tri.last.id] = tri.last.prev;   // restore e.g. a flagged-but-new entry
    else delete S.cards[tri.last.id];
    tri.known--; S.xp = Math.max(0, S.xp - 2);
  } else tri.learn--;
  tri.last = null;
  save(); route();
};
window.exitTriage = () => { const s = tri ? tri.subj : null; tri = null; nav(s ? "deck/" + s : "browse"); };
window.startTriage = (subj) => { tri = null; nav("triage/" + subj); };

/* ============================ STUDY ============================ */
function startReview(subject) {
  const q = buildReviewQueue(subject);
  if (!q.length) { toast(t("study.empty")); return; }
  session = { mode: "review", queue: q, initTotal: q.length, done: 0, ok: 0, att: 0, xp0: S.xp, revealed: false, snap: null, zh: S.settings.zhFirst };
  nav("study");
}
function startNew() {
  const quota = newQuotaLeft();
  if (!quota) { toast(t("toast.nonew")); return; }
  const q = buildNewQueue(quota);
  if (!q.length) { toast(t("toast.nonew")); return; }
  session = { mode: "new", queue: q, initTotal: q.length, done: 0, ok: 0, att: 0, xp0: S.xp, revealed: false, snap: null, zh: S.settings.zhFirst };
  nav("study");
}
function currentId() {
  if (!session || !session.queue.length) return null;
  const t0 = now();
  let best = 0;
  for (let i = 0; i < session.queue.length; i++) {
    const c = peek(session.queue[i]);
    if (!c || c.due <= t0) return session.queue[i];
    if ((peek(session.queue[best]) || { due: 0 }).due > c.due) best = i;
  }
  return session.queue[best];   // all future-due (short learning steps) → earliest
}
function vStudy() {
  if (!session) { setTimeout(() => nav("home")); return ""; }
  if (!session.queue.length) return studySummary();
  /* pin the shown card: an idle user must never grade a card that silently
     became "current" while they weren't looking */
  const id = session.cur && session.queue.includes(session.cur) ? session.cur : (session.cur = currentId());
  const c = CARD[id];
  const st = peek(id);
  const stateChip = !st || st.st === 0 ? `<span class="chip state-new">✦ ${esc(t("state.new"))}</span>`
    : st.st === 3 ? `<span class="chip state-lapse">↻ ${esc(t("state.learn"))}</span>`
    : st.st === 1 ? `<span class="chip">${esc(t("state.learn"))}</span>` : "";
  const remaining = session.queue.length;
  const pct = Math.round(100 * (1 - remaining / Math.max(session.initTotal, 1)));
  const flagged = st && st.flag;

  /* bear reaction survives the MCQ shuffle re-render (bindStudy) via _bear */
  let bearState = "idle";
  if (session.lastG) { bearState = session.lastG >= 3 ? "nod" : "wince"; session._bear = bearState; session.lastG = null; }
  else if (session._bear) { bearState = session._bear; session._bear = null; }
  let h = `
  <div class="study-top">
    <button onclick="exitStudy()" title="${esc(t("study.exit"))}">✕</button>
    <span class="bearmini">${bearSVG(bearState, 26)}</span>
    <div class="prog"><i style="width:${pct}%"></i></div>
    <span class="cnt">${remaining}</span>
    <button onclick="undoLast()" title="${esc(t("study.undo"))}">↩︎</button>
    <button onclick="toggleFlag('${id}')" title="${esc(t("study.edit"))}" style="${flagged ? "color:var(--amber)" : ""}">⚑</button>
  </div>
  <div class="qcard" id="qcard">
    <div class="chips">
      <span class="chip">${DECK[c.deck].emoji} ${esc(deckName(DECK[c.deck]))}</span>
      <span class="chip">${esc(S.settings.lang === "zh" ? c.topicZh : c.topic)}</span>
      ${stateChip}
      ${c.caNote ? `<span class="chip ca">🐻 CA</span>` : ""}
    </div>
    ${cardFace(c, session.revealed, session.zh, session.shuffle)}
  </div>
  <div class="actionbar" id="actionbar">${actionBar(id)}</div>
  <div class="kbd-hint">${esc(t("study.kbd"))}</div>`;
  return h;
}
function cardFace(c, revealed, zh, shuffle) {
  let h = "";
  if (c.type === "cloze") {
    h += `<div class="qtext">${clozeQ(c.q, revealed)}</div>`;
  } else {
    h += `<div class="qtext">${esc(c.q)}</div>`;
  }
  if (zh) h += `<div class="zh-hint">${esc(c.qZh)}</div>`;
  h += `<button class="hintbtn" onclick="toggleZh()">${zh ? esc(t("study.zhHide")) : "🀄 " + esc(t("study.zhHint"))}</button>`;

  if (c.type === "mcq") {
    const map = shuffle || [0, 1, 2, 3];
    h += `<div class="opts">`;
    map.forEach((orig, i) => {
      let cls = "opt", extra = "";
      if (revealed) {
        if (orig === c.answer) cls += session && session.mcqPick === orig ? " sel-right" : " reveal-right";
        else if (session && session.mcqPick === orig) cls += " sel-wrong";
        extra = "disabled";
      }
      h += `<button class="${cls}" ${extra} onclick="pickOpt(${orig})"><span class="k">${"ABCD"[i]}</span><span>${esc(c.choices[orig])}</span></button>`;
    });
    h += `</div>`;
  }
  if (revealed) {
    h += `<div class="answer">`;
    if (c.type === "basic") h += `<div class="a-en">${esc(c.a)}</div><div class="a-zh">${esc(c.aZh)}</div>`;
    if (c.type === "cloze") h += `<div class="a-en">${esc(c.a)}</div><div class="a-zh">${esc(c.aZh)}</div>`;
    if (c.type === "mcq" && c.explain) h += `<div class="a-en" style="font-size:.95rem">${esc(c.explain)}</div>`;
    if (c.explainZh) h += `<div class="box explain"><span class="bt">📘 ${esc(t("box.explain"))}</span>${esc(c.explainZh)}</div>`;
    if (c.caNote) h += `<div class="box ca"><span class="bt">🐻 ${esc(t("box.ca"))}</span>${esc(c.caNote)}<br><span class="muted">${esc(c.caNoteZh || "")}</span></div>`;
    if (c.mnemonic) h += `<div class="box mn"><span class="bt">💡 ${esc(t("box.mn"))}</span>${esc(c.mnemonic)}</div>`;
    h += `</div>`;
  }
  return h;
}
function actionBar(id) {
  const c = CARD[id];
  if (!session.revealed) {
    if (c.type === "mcq") return "";   // picking an option reveals
    return `<button class="revealbtn" onclick="reveal()">${esc(t("study.reveal"))}</button>`;
  }
  const iv = previewIvls(id);
  const names = [t("study.again"), t("study.hard"), t("study.good"), t("study.easy")];
  const sugg = session.mcqPick != null ? (session.mcqRight ? 3 : 1) : 0;
  return `<div class="grades">` + [1, 2, 3, 4].map(g =>
    `<button class="grade g${g}${g === sugg ? " suggest" : ""}" onclick="doGrade(${g})">${esc(names[g - 1])}<small>${esc(iv[g - 1])}</small></button>`).join("") + `</div>`;
}
function bindStudy() {
  const id = session && session.cur;
  if (id && CARD[id].type === "mcq" && !session.shuffle) {
    session.shuffle = shuffleArr([0, 1, 2, 3]);
    rerenderStudy();
  }
}
function rerenderStudy() { $("#view").innerHTML = vStudy(); bindStudy(); }
window.toggleZh = () => { session.zh = !session.zh; rerenderStudy(); };
window.reveal = () => { session.revealed = true; sfx("flip"); rerenderStudy(); };
window.pickOpt = (orig) => {
  if (session.revealed) return;
  const id = session.cur || currentId(), c = CARD[id];
  session.mcqPick = orig; session.revealed = true;
  session.mcqRight = orig === c.answer;
  rerenderStudy();
};
window.doGrade = (g) => {
  const id = session.cur || currentId();
  if (!id) return;
  const before = today().r + today().n + today().q;
  const prevSess = { att: session.att, ok: session.ok, done: session.done };
  session.snap = grade(id, g);
  session.snap.sess = prevSess;
  tickTime();
  session.att++;
  if (g >= 3) session.ok++;
  /* remove from queue; re-insert if it comes back soon (learning/relearning) */
  const i = session.queue.indexOf(id);
  session.queue.splice(i, 1);
  const st = peek(id);
  if (st.st === 1 || st.st === 3) {
    const pos = Math.min(session.queue.length, 6 + ((Math.random() * 3) | 0));
    session.queue.splice(pos, 0, id);
  } else session.done++;
  session.revealed = false; session.mcqPick = null; session.shuffle = null; session.cur = null;
  session.lastG = g;
  const after = today().r + today().n + today().q;
  if (before < S.settings.dailyGoal && after >= S.settings.dailyGoal) { confetti(); toast(t("toast.goalhit")); sfx("chime"); }
  rerenderStudy();
};
window.undoLast = () => {
  if (!session || !session.snap) return;
  undoGrade(session.snap);
  const id = session.snap.id;
  if (!session.queue.includes(id)) session.queue.unshift(id);
  if (session.snap.sess) { session.att = session.snap.sess.att; session.ok = session.snap.sess.ok; session.done = session.snap.sess.done; }
  session.snap = null; session.revealed = false; session.shuffle = null; session.cur = id;
  toast(t("toast.undone"));
  rerenderStudy();
};
window.exitStudy = () => { session = null; save(true); nav("home"); };
window.toggleFlag = (id) => {
  const c = cs(id); c.flag = !c.flag; save();
  toast(t(c.flag ? "toast.flagged" : "toast.unflagged"));
  rerenderStudy();
};
function studySummary() {
  save(true);
  const fresh = evaluateBadges();
  const acc = session.att ? Math.round(100 * session.ok / session.att) : 0;
  const xp = S.xp - session.xp0;
  const line = personaLine(acc >= 80 ? "doneHi" : acc >= 55 ? "doneMid" : "doneLow");
  const h = `
  <div class="summary">
    <div class="adjourn-bear">${bearSVG("adjourn", 96)}</div>
    <h2 class="adjourn">🔨 ${esc(t("court.adjourn"))}</h2>
    <div class="seal-wrap"><div class="seal"><span>今日</span><span>已结</span></div></div>
    <p class="tiny persona-line">💬 ${esc(line)}</p>
    <div class="sumgrid">
      <div class="cell"><b>${session.done}</b><span>${esc(t("sum.reviewed"))}</span></div>
      <div class="cell"><b>${acc}%</b><span>${esc(t("sum.correct"))}</span></div>
      <div class="cell"><b>+${xp}</b><span>${esc(t("sum.xp"))}</span></div>
    </div>
    <button class="btn primary" style="width:100%;padding:14px" onclick="exitStudy()">${esc(t("sum.back"))}</button>
    <div style="height:8px"></div>
    ${dueList().length ? `<button class="btn" style="width:100%;padding:12px" onclick="startReview()">${esc(t("sum.more"))} (${dueList().length})</button>` : ""}
  </div>`;
  setTimeout(() => { confetti(); sfx("gavel"); setTimeout(() => sfx("stamp"), 500); announceBadges(fresh); }, 200);
  return h;
}

/* ============================ QUIZ ============================ */
function quizSetup() {
  const opts = DECKS.filter(d => quizPool(d.subject).length >= 4)
    .map(d => `<option value="${d.subject}">${d.emoji} ${esc(deckName(d))}</option>`).join("");
  showModal(`
    <h3 style="margin-bottom:12px">🎯 ${esc(t("quiz.title"))}</h3>
    <div class="setrow"><span class="lab">${esc(t("quiz.n"))}</span>
      <select id="qz-n"><option>10</option><option>20</option><option>30</option></select></div>
    <div class="setrow"><span class="lab">${esc(t("quiz.scope"))}</span>
      <select id="qz-s"><option value="">${esc(t("quiz.all"))}</option>${opts}</select></div>
    <div class="rowbtns">
      <button class="btn primary" style="flex:1;padding:12px" onclick="startQuiz()">${esc(t("quiz.start"))}</button>
    </div>`);
}
window.startQuiz = () => {
  const n = parseInt($("#qz-n").value, 10) || 10;
  const subj = $("#qz-s").value || null;
  closeModal();
  const ids = buildQuiz(n, subj);
  if (ids.length < 3) { toast(t("quiz.notready")); return; }
  quiz = { ids, idx: 0, right: 0, wrongIds: [], answered: false, pick: null, shuffle: shuffleArr([0, 1, 2, 3]), xp0: S.xp };
  nav("quiz");
};
function vQuiz() {
  if (!quiz) { setTimeout(() => nav("home")); return ""; }
  if (quiz.idx >= quiz.ids.length) return quiz.mode === "diag" ? diagResults() : quizResults();
  const id = quiz.ids[quiz.idx], c = CARD[id];
  const pct = Math.round(100 * quiz.idx / quiz.ids.length);
  let h = `
  <div class="study-top">
    <button onclick="exitQuiz()">✕</button>
    <div class="prog"><i style="width:${pct}%"></i></div>
    <span class="cnt">${quiz.idx + 1} / ${quiz.ids.length}</span>
  </div>
  <div class="qcard">
    <div class="chips">
      <span class="chip">${DECK[c.deck].emoji} ${esc(deckName(DECK[c.deck]))}</span>
      <span class="chip">${esc(S.settings.lang === "zh" ? c.topicZh : c.topic)}</span>
      ${quiz.mode === "diag" ? `<span class="chip" style="color:var(--sky)">🧪 ${esc(t("diag.chip"))}</span>` : ""}
    </div>
    <div class="qtext">${esc(c.q)}</div>
    ${quiz.zh ? `<div class="zh-hint">${esc(c.qZh)}</div>` : ""}
    <button class="hintbtn" onclick="quizZh()">${quiz.zh ? esc(t("study.zhHide")) : "🀄 " + esc(t("study.zhHint"))}</button>
    <div class="opts">`;
  quiz.shuffle.forEach((orig, i) => {
    let cls = "opt", dis = "";
    if (quiz.answered) {
      dis = "disabled";
      if (orig === c.answer) cls += quiz.pick === orig ? " sel-right" : " reveal-right";
      else if (quiz.pick === orig) cls += " sel-wrong";
    }
    h += `<button class="${cls}" ${dis} onclick="quizPick(${orig})"><span class="k">${"ABCD"[i]}</span><span>${esc(c.choices[orig])}</span></button>`;
  });
  h += `</div>`;
  if (quiz.answered) {
    h += `<div class="answer">`;
    if (c.explain) h += `<div class="a-en" style="font-size:.95rem">${esc(c.explain)}</div>`;
    if (c.explainZh) h += `<div class="box explain"><span class="bt">📘 ${esc(t("box.explain"))}</span>${esc(c.explainZh)}</div>`;
    if (c.caNote) h += `<div class="box ca"><span class="bt">🐻 ${esc(t("box.ca"))}</span>${esc(c.caNote)}<br><span class="muted">${esc(c.caNoteZh || "")}</span></div>`;
    h += `</div>`;
  }
  h += `</div>`;
  if (quiz.answered) h += `<div class="actionbar"><button class="revealbtn" onclick="quizNext()">${esc(quiz.idx + 1 >= quiz.ids.length ? t("quiz.finish") : t("quiz.next"))} →</button></div>`;
  return h;
}
function bindQuiz() {}
window.quizZh = () => { quiz.zh = !quiz.zh; $("#view").innerHTML = vQuiz(); };
window.quizPick = (orig) => {
  if (!quiz || quiz.answered || quiz.idx >= quiz.ids.length) return;
  const id = quiz.ids[quiz.idx], c = CARD[id];
  if (!c) return;
  quiz.pick = orig; quiz.answered = true;
  tickTime();
  const correct = orig === c.answer;
  if (quiz.mode === "diag") {
    /* diagnostic: no scheduling side-effects mid-run — applyDiag settles everything at the end */
    if (correct) { quiz.right++; quiz.rightIds.push(id); } else quiz.wrongIds.push(id);
    sfx(correct ? "chime" : "stamp");
    $("#view").innerHTML = vQuiz();
    return;
  }
  let graded = false;
  if (correct) { quiz.right++; graded = quizHit(id); }
  else { quiz.wrongIds.push(id); graded = quizMiss(id); }
  if (!graded) { today().q++; addXP(correct ? 12 : 2); }   // count once: either as a grade or as a quiz answer
  save();
  $("#view").innerHTML = vQuiz();
};
window.quizNext = () => {
  quiz.idx++; quiz.answered = false; quiz.pick = null; quiz.zh = false;
  quiz.shuffle = shuffleArr([0, 1, 2, 3]);
  $("#view").innerHTML = vQuiz();
  window.scrollTo(0, 0);
};
window.exitQuiz = () => { quiz = null; save(true); nav("home"); };
function quizResults() {
  const n = quiz.ids.length, sc = Math.round(100 * quiz.right / n);
  const xp = S.xp - quiz.xp0;
  if (quiz.right === n && n >= 10 && !(S.flags && S.flags.perfectQuiz)) { S.flags = S.flags || {}; S.flags.perfectQuiz = ymd(); save(); }
  const fresh = evaluateBadges();
  const line = personaLine(sc >= 80 ? "doneHi" : sc >= 55 ? "doneMid" : "doneLow");
  const h = `
  <div class="summary">
    <div class="big">${sc >= 80 ? "🏆" : sc >= 60 ? "🎯" : "📖"}</div>
    <h2>⚖️ ${esc(t("court.verdict"))}: ${quiz.right} / ${n}</h2>
    <p class="tiny persona-line">💬 ${esc(line)}</p>
    <div class="sumgrid">
      <div class="cell"><b>${sc}%</b><span>${esc(t("sum.correct"))}</span></div>
      <div class="cell"><b>${quiz.wrongIds.length}</b><span>${esc(t("quiz.wrong"))}</span></div>
      <div class="cell"><b>+${xp}</b><span>${esc(t("sum.xp"))}</span></div>
    </div>
    ${quiz.wrongIds.length ? `<p class="tiny">📥 ${esc(t("quiz.wrongAdded"))}</p>` : ""}
    <button class="btn primary" style="width:100%;padding:14px" onclick="exitQuiz()">${esc(t("sum.back"))}</button>
  </div>`;
  if (sc >= 80) setTimeout(() => { confetti(); sfx("gavel"); }, 150);
  setTimeout(() => announceBadges(fresh), 600);
  return h;
}

/* ============================ BROWSE ============================ */
function vBrowse() {
  let h = `<input class="search" id="srch" placeholder="${esc(t("browse.search"))}" oninput="doSearch(this.value)">
  <div id="srchout"></div><div id="decklist">`;
  for (const d of DECKS) {
    const st = deckStats(d.subject);
    h += `
    <div class="panel" style="padding:12px 14px;cursor:pointer" onclick="nav('deck/${d.subject}')">
      <div class="subj" style="border:none;padding:2px 0">
        <span class="em">${d.emoji}</span>
        <div class="nm"><b>${esc(deckName(d))} <span class="muted" style="font-weight:500">· ${esc(S.settings.lang === "zh" ? d.nameEn : d.nameZh)}</span></b>
          <span>${st.total} ${esc(t("browse.total"))} · ${esc(t("state.new"))} ${st.neu} · ${esc(t("state.rev"))} ${st.rev}${st.susp ? " · ⏸ " + st.susp : ""}</span></div>
        <div class="bar"><i style="width:${Math.round(st.mastery * 100)}%"></i></div>
        <span class="pc">${Math.round(st.mastery * 100)}%</span>
      </div>
    </div>`;
  }
  h += `</div>`;
  return h;
}
window.doSearch = (q) => {
  const out = $("#srchout"), list = $("#decklist");
  q = q.trim().toLowerCase();
  if (!q) { out.innerHTML = ""; list.style.display = ""; return; }
  list.style.display = "none";
  const hits = [];
  for (const id of ALL_IDS) {
    const c = CARD[id];
    if ((c.q + " " + (c.a || "") + " " + c.qZh + " " + (c.aZh || "") + " " + c.topic + c.topicZh).toLowerCase().includes(q)) {
      hits.push(id);
      if (hits.length >= 60) break;
    }
  }
  out.innerHTML = `<div class="panel">` + (hits.length ? hits.map(cardRow).join("") : `<span class="muted">— 0 —</span>`) + `</div>`;
};
function cardRow(id) {
  const c = CARD[id], st = peek(id);
  const chip = st && st.susp ? `<span class="st susp">${esc(t("state.susp"))}</span>`
    : !st || st.st === 0 ? `<span class="st new">${esc(t("state.new"))}</span>`
    : st.st === 2 && st.due < tomorrow0() ? `<span class="st due">${esc(t("state.due"))}</span>`
    : st.st === 2 ? `<span class="st">${fmtIvl((st.due - now()) / DAY)}</span>`
    : `<span class="st">${esc(t("state.learn"))}</span>`;
  const flag = st && st.flag ? "⚑ " : "";
  return `<div class="cardrow" style="cursor:pointer" onclick="openCard('${id}')">
    <span class="q">${flag}${esc(c.q.replace(/\{\{c::([^}]+)\}\}/, "[$1]"))}</span>${chip}</div>`;
}
function vDeck(subj) {
  const d = DECK[subj];
  if (!d) { setTimeout(() => nav("browse")); return ""; }
  const st = deckStats(subj);
  const off = deckNewOff(subj);
  let h = `<button class="backlink" onclick="nav('browse')">← ${esc(t("nav.browse"))}</button>
  <div class="panel">
    <h3>${d.emoji} ${esc(deckName(d))}<span class="sub">${st.total} ${esc(t("browse.total"))} · ${Math.round(st.mastery * 100)}%</span></h3>
    <div class="rowbtns" style="margin:2px 0 8px">
      ${st.due ? `<button class="btn primary" onclick="deckReview('${subj}')">▶ ${esc(t("deck.review"))} (${st.due})</button>` : ""}
      ${!diagDone(subj) && quizPool(subj).length >= 8 ? `<button class="btn" onclick="startDiag('${subj}')">🧪 ${esc(t("diag.title"))}</button>` : ""}
      ${st.neu > 0 ? `<button class="btn" onclick="startTriage('${subj}')">🗂 ${esc(t("triage.title"))} (${st.neu})</button>` : ""}
      <button class="btn" onclick="deckToggleNew('${subj}')">${esc(off ? t("deck.resume") : t("deck.pause"))}</button>
    </div>
    ${diagDone(subj) ? `<div class="tiny" style="margin-bottom:6px">🧪 ${esc(t("diag.done"))}: ${Number(S.diag[subj].p) || 0}% · ${esc(String(S.diag[subj].date || ""))}</div>` : ""}`;
  const byTopic = {};
  for (const c of d.cards) { (byTopic[S.settings.lang === "zh" ? c.topicZh : c.topic] = byTopic[S.settings.lang === "zh" ? c.topicZh : c.topic] || []).push(c.id); }
  for (const [topic, ids] of Object.entries(byTopic)) {
    h += `<div style="margin:10px 0 2px;font-size:.78rem;font-weight:800;color:var(--ink-faint)">${esc(topic)} · ${ids.length}</div>`;
    h += ids.map(cardRow).join("");
  }
  h += `</div>`;
  return h;
}
window.openCard = (id) => {
  const c = CARD[id], st = peek(id);
  const susp = st && st.susp, flag = st && st.flag;
  let info = "";
  if (st && st.st > 0) {
    info = `<div class="tiny" style="margin-top:8px">S=${st.s.toFixed(1)}d · D=${st.d.toFixed(1)} · ${st.reps} ${esc(t("stats.reviews"))} · ${esc(t("card.lapses"))} ${st.lapses} · ${esc(t("state.due"))}: ${ymd(st.due)}</div>`;
  }
  showModal(`
    <div class="chips" style="margin-bottom:10px">
      <span class="chip">${DECK[c.deck].emoji} ${esc(deckName(DECK[c.deck]))}</span>
      <span class="chip">${esc(S.settings.lang === "zh" ? c.topicZh : c.topic)}</span>
      <span class="chip">${c.type}</span>
    </div>
    <div class="qtext" style="font-size:1.02rem">${c.type === "cloze" ? clozeQ(c.q, true) : esc(c.q)}</div>
    <div class="zh-hint">${esc(c.qZh)}</div>
    ${c.type === "mcq"
      ? `<div class="opts">` + c.choices.map((ch, i) => `<div class="opt ${i === c.answer ? "reveal-right" : ""}" style="cursor:default"><span class="k">${"ABCD"[i]}</span><span>${esc(ch)}</span></div>`).join("") + `</div>`
      : `<div class="answer"><div class="a-en">${esc(c.a)}</div><div class="a-zh">${esc(c.aZh)}</div></div>`}
    ${c.explainZh ? `<div class="box explain"><span class="bt">📘 ${esc(t("box.explain"))}</span>${esc(c.explainZh)}</div>` : ""}
    ${c.caNote ? `<div class="box ca"><span class="bt">🐻 ${esc(t("box.ca"))}</span>${esc(c.caNote)}<br><span class="muted">${esc(c.caNoteZh || "")}</span></div>` : ""}
    ${c.mnemonic ? `<div class="box mn"><span class="bt">💡 ${esc(t("box.mn"))}</span>${esc(c.mnemonic)}</div>` : ""}
    ${info}
    <div class="rowbtns">
      <button class="btn" onclick="modSusp('${id}')">${esc(susp ? t("card.unsuspend") : t("card.suspend"))}</button>
      <button class="btn" onclick="modFlag('${id}')">${esc(flag ? t("card.unflag") : t("card.flag"))}</button>
      <button class="btn danger" onclick="modReset('${id}')">${esc(t("card.reset"))}</button>
      <button class="btn" onclick="closeModal()">${esc(t("card.close"))}</button>
    </div>`);
};
window.deckReview = (subj) => startReview(subj);
window.deckToggleNew = (subj) => {
  if (!S.settings.deckOff) S.settings.deckOff = {};
  S.settings.deckOff[subj] = !S.settings.deckOff[subj];
  if (!S.settings.deckOff[subj]) delete S.settings.deckOff[subj];
  save(); toast(t(deckNewOff(subj) ? "toast.deckoff" : "toast.deckon")); route();
};
/* re-render current view but keep search text + scroll position (modal card actions) */
function refreshInPlace() {
  const srch = document.getElementById("srch");
  const q = srch ? srch.value : null;
  const y = window.scrollY;
  route();
  if (q) { const s2 = document.getElementById("srch"); if (s2) { s2.value = q; doSearch(q); } }
  window.scrollTo(0, y);
}
window.modSusp = (id) => { const c = cs(id); c.susp = !c.susp; save(); toast(t(c.susp ? "toast.suspended" : "toast.unsuspended")); closeModal(); refreshInPlace(); };
window.modFlag = (id) => { const c = cs(id); c.flag = !c.flag; save(); toast(t(c.flag ? "toast.flagged" : "toast.unflagged")); closeModal(); refreshInPlace(); };
window.modReset = (id) => { delete S.cards[id]; save(); toast(t("toast.reset")); closeModal(); refreshInPlace(); };

/* ============================ STATS ============================ */
function vStats() {
  const d = today();
  let w = { c: 0, ms: 0 }, all = { c: 0, ms: 0 };
  for (const [k, v] of Object.entries(S.days)) {
    const cnt = v.r + v.n + v.q;
    all.c += cnt; all.ms += v.ms;
    if (now() - new Date(k + "T00:00:00").getTime() < 7 * DAY) { w.c += cnt; w.ms += v.ms; }
  }
  const ret = retention30();
  const tot = totals();
  const r = rank();
  const nextXp = r.next ? r.next[0] - S.xp : 0;

  /* heatmap: 18 weeks, columns=weeks, aligned to weekday */
  const weeks = 18, cells = [];
  const end = dayStart();
  const endDow = new Date(end).getDay();                    // 0=Sun
  const start = end - ((weeks - 1) * 7 + endDow) * DAY;     // begin on a Sunday
  for (let ti = start; ti <= end; ti += DAY) {
    const v = S.days[ymd(ti)];
    const cnt = v ? v.r + v.n + v.q : 0;
    const lvl = cnt === 0 ? 0 : cnt < 15 ? 1 : cnt < 35 ? 2 : cnt < 70 ? 3 : 4;
    cells.push(`<i class="${lvl ? "l" + lvl : ""}" title="${ymd(ti)}: ${cnt}"></i>`);
  }
  /* daily bars: 14 days */
  let maxC = 1; const barVals = [];
  for (let i = 13; i >= 0; i--) { const v = S.days[ymd(now() - i * DAY)]; const c = v ? v.r + v.n + v.q : 0; barVals.push(c); maxC = Math.max(maxC, c); }

  return `
  <div class="panel" style="display:flex;align-items:center;gap:12px">
    <span class="statbear">${bearSVG("idle", 54)}</span>
    <div style="flex:1"><b>${r.emoji} ${esc(r.name)}</b><br>
      <span class="tiny">${S.xp} XP${r.next ? ` · ${nextXp} XP → ${esc(S.settings.lang === "zh" ? r.next[1] : r.next[2])}` : " · MAX"}</span></div>
    <span class="pill streak">🔥 ${streak()}</span>
  </div>
  ${cabinetPanel()}
  <div class="statgrid">
    <div class="cell"><b>${d.r + d.n + d.q}</b><span>${esc(t("stats.today"))} · ${Math.round(d.ms / 60000)} ${esc(t("stats.time"))}</span></div>
    <div class="cell"><b>${w.c}</b><span>${esc(t("stats.week"))} · ${Math.round(w.ms / 60000)} ${esc(t("stats.time"))}</span></div>
    <div class="cell"><b>${all.c}</b><span>${esc(t("stats.all"))} · ${Math.round(all.ms / 3600000 * 10) / 10} h</span></div>
    <div class="cell"><b>${ret === null ? "—" : Math.round(ret * 100) + "%"}</b><span>${esc(t("stats.retention"))}</span></div>
    <div class="cell"><b>${Math.round(tot.mastery * 100)}%</b><span>${esc(t("stats.mastery"))}</span></div>
    <div class="cell"><b>${tot.studied}/${tot.total}</b><span>${esc(t("home.subjects"))}</span></div>
  </div>
  <div class="panel"><h3>📅 ${esc(t("stats.heat"))}</h3><div class="heat">${cells.join("")}</div></div>
  <div class="panel"><h3>📊 ${esc(t("stats.daily"))}</h3>
    <div class="minibars">${barVals.map(v => `<i style="height:${Math.max(3, Math.round(100 * v / maxC))}%" title="${v}"></i>`).join("")}</div>
  </div>`;
}

/* ============== 判例徽章 cabinet ============== */
function cabinetPanel() {
  const fresh = evaluateBadges();
  if (fresh.length) setTimeout(() => announceBadges(fresh), 400);
  const zh = S.settings.lang === "zh";
  const earned = Object.keys(S.badges || {}).length;
  let h = `<div class="panel"><h3>🏅 ${esc(t("cab.title"))}<span class="sub">${earned}/${BADGES.length}</span></h3>
  <div class="tiny" style="margin-bottom:8px">${esc(t("cab.sub"))}</div><div class="cabinet">`;
  for (const b of BADGES) {
    const got = (S.badges || {})[b[0]];
    h += `<button class="medal ${b[7] === "stamp" ? "stampstyle" : ""} ${got ? "" : "locked"}" onclick="openBadge('${b[0]}')">
      <span class="mico">${got ? b[1] : "🔒"}</span><span class="mname">${esc(zh ? b[2] : b[3])}</span>
    </button>`;
  }
  return h + `</div></div>`;
}
window.openBadge = (id) => {
  const b = BADGES.find(x => x[0] === id); if (!b) return;
  const zh = S.settings.lang === "zh";
  const got = (S.badges || {})[id];
  showModal(`
    <div style="text-align:center;padding:6px 0">
      <div style="font-size:3rem">${got ? b[1] : "🔒"}</div>
      <h3 style="justify-content:center;margin:6px 0">${esc(zh ? b[2] : b[3])}</h3>
      ${b[4] !== "—" ? `<div style="font-family:var(--font-serif);font-weight:700">${esc(b[4])}</div>` : ""}
      <div class="muted" style="font-size:.9rem;margin-top:4px">${esc(zh ? b[5] : b[6])}</div>
      <div class="tiny" style="margin-top:8px">${got ? "✓ " + esc(got) : esc(t("cab.locked"))}</div>
      <div class="rowbtns" style="justify-content:center"><button class="btn" onclick="closeModal()">${esc(t("card.close"))}</button></div>
    </div>`);
};

/* ============================ SETTINGS ============================ */
function vSettings() {
  const s = S.settings;
  return `
  <div class="panel">
    <div class="setrow"><span class="lab">🀄 ${esc(t("set.lang"))}</span>
      <span class="seg">
        <button class="${s.lang === "zh" ? "on" : ""}" onclick="setLang('zh')">中文</button>
        <button class="${s.lang === "en" ? "on" : ""}" onclick="setLang('en')">EN</button>
      </span></div>
    <div class="setrow"><span class="lab">📅 ${esc(t("set.exam"))}</span>
      <input type="date" value="${esc(s.examDate)}" onchange="setExam(this.value)"></div>
    <div class="setrow"><span class="lab">＋ ${esc(t("set.newperday"))}</span>
      <input type="number" min="0" max="80" value="${s.newPerDay}" onchange="setOpt('newPerDay',Math.max(0,Math.min(80,parseInt(this.value,10)||0)))"></div>
    <div class="setrow"><span class="lab">🎯 ${esc(t("set.goal"))}</span>
      <input type="number" min="10" max="400" value="${s.dailyGoal}" onchange="setOpt('dailyGoal',Math.max(10,Math.min(400,parseInt(this.value,10)||60)))"></div>
    <div class="setrow"><span class="lab">🧠 ${esc(t("set.retention"))}<small>${esc(t("set.retentiond"))}</small></span>
      <select onchange="setOpt('retention',parseFloat(this.value))">
        ${[0.85, 0.88, 0.9, 0.92, 0.95].map(v => `<option value="${v}" ${Math.abs(s.retention - v) < 0.001 ? "selected" : ""}>${Math.round(v * 100)}%</option>`).join("")}
      </select></div>
    <div class="setrow"><span class="lab">🎨 ${esc(t("set.theme"))}</span>
      <span class="seg">
        ${["auto", "light", "dark"].map(v => `<button class="${s.theme === v ? "on" : ""}" onclick="setOpt('theme','${v}')">${esc(t("set.theme." + v))}</button>`).join("")}
      </span></div>
    <div class="setrow"><span class="lab">🀄 ${esc(t("set.zhfirst"))}<small>${esc(t("set.zhfirstd"))}</small></span>
      <span class="seg">
        <button class="${s.zhFirst ? "on" : ""}" onclick="setOpt('zhFirst',true)">ON</button>
        <button class="${!s.zhFirst ? "on" : ""}" onclick="setOpt('zhFirst',false)">OFF</button>
      </span></div>
    <div class="setrow"><span class="lab">🎲 ${esc(t("set.intake"))}</span>
      <span class="seg">
        <button class="${s.intake !== "even" ? "on" : ""}" onclick="setOpt('intake','smart')">${esc(t("set.intake.smart"))}</button>
        <button class="${s.intake === "even" ? "on" : ""}" onclick="setOpt('intake','even')">${esc(t("set.intake.even"))}</button>
      </span></div>
    <div class="setrow"><span class="lab">🔊 ${esc(t("set.sound"))}<small>${esc(t("set.soundd"))}</small></span>
      <span class="seg">
        <button class="${s.sound ? "on" : ""}" onclick="setOpt('sound',true);sfx('gavel')">ON</button>
        <button class="${!s.sound ? "on" : ""}" onclick="setOpt('sound',false)">OFF</button>
      </span></div>
  </div>
  <div class="panel">
    <div class="setrow" style="cursor:pointer" onclick="nav('guide')"><span class="lab">📖 ${esc(t("set.guide"))}</span><span>→</span></div>
    <div class="setrow" style="cursor:pointer" onclick="nav('method')"><span class="lab">🎓 ${esc(t("set.method"))}</span><span>→</span></div>
    <div class="setrow" style="cursor:pointer" onclick="doExport()"><span class="lab">📤 ${esc(t("set.export"))}</span><span>→</span></div>
    <div class="setrow" style="cursor:pointer" onclick="document.getElementById('impfile').click()"><span class="lab">📥 ${esc(t("set.import"))}</span><span>→</span>
      <input type="file" id="impfile" accept=".json" style="display:none" onchange="doImport(this)"></div>
    <div class="setrow" style="cursor:pointer;color:var(--red)" onclick="doReset()"><span class="lab">🗑 ${esc(t("set.reset"))}</span><span>→</span></div>
  </div>
  <div class="panel tiny">
    <b>Ron 的加州律考通 · Ron's CalBar Trainer</b> · v1.2 · ${ALL_IDS.length} cards<br><br>
    内容由 AI 辅助编写，供复习记忆使用；规则表述以官方资料及你的课程讲义为准，发现疑问请用 ⚑ 标记并查证。<br>
    Content is AI-assisted and for memorization practice; verify anything doubtful against official sources (flag with ⚑).<br><br>
    进度保存在本机浏览器 (localStorage)。换设备或清缓存前请先「导出学习进度」。<br>
    Progress lives in this browser's localStorage — export a backup before switching devices or clearing site data.
  </div>`;
}
window.setLang = (v) => { S.settings.lang = v; save(); route(); };
window.setOpt = (k, v) => { S.settings[k] = v; save(); applyTheme(); route(); };
window.setExam = (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setOpt("examDate", v); else route(); };
window.doExport = () => {
  download("calbar-progress-" + ymd() + ".json", JSON.stringify(S));
  toast(t("set.exportd"));
};
window.doImport = (inp) => {
  const f = inp.files && inp.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result);
      if (!s || typeof s !== "object" || !s.cards) throw new Error("bad file");
      s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings);
      s.days = s.days || {}; s.xp = s.xp || 0; s.v = s.v || 1;
      S = s; save(true); toast(t("set.imported"));
      setTimeout(() => location.reload(), 700);     // clean re-init with the imported state
    } catch (e) { toast("⚠️ " + e.message); }
  };
  rd.readAsText(f);
};
window.doReset = () => {
  if (!confirm(t("set.resetc"))) return;
  S = { v: 1, cards: {}, days: {}, xp: 0, settings: S.settings };
  save(); toast(t("toast.reset")); route();
};

/* ============================ METHOD ============================ */
function vMethod() {
  const zh = S.settings.lang === "zh";
  const body = zh ? `
    <h4>为什么是「间隔重复」？</h4>
    <p>人脑遵循遗忘曲线：刚学的内容几天内就会流失大半。对抗遗忘最有效的办法，是在<b>快要忘记的临界点</b>刚好复习一次——每次成功回忆都会让记忆曲线变得更平缓。本应用的 FSRS 算法（Anki 最新一代排程算法）会为每张卡片单独建模，自动算出这个临界点。你只需要做一件事：<b>每天回来，清空到期队列</b>。</p>
    <h4>主动回忆，而不是重读</h4>
    <p>看到问题后，<b>先在心里给出完整答案，再点「显示答案」</b>。研究反复证明：提取练习（testing effect）远胜于重复阅读。哪怕想错了也有价值——错误后的纠正记忆更牢。</p>
    <h4>诚实评分是算法的燃料</h4>
    <ul>
      <li><b>重来</b>：完全没想起来，或想错了</li>
      <li><b>困难</b>：想起来了，但很吃力或不完整</li>
      <li><b>记得</b>：想起来了，速度正常 —— 大多数时候按这个</li>
      <li><b>轻松</b>：秒答，毫无迟疑</li>
    </ul>
    <p>评分宽松只会骗过算法、坑了考场上的自己。</p>
    <h4>交叉练习 + 中文锚点</h4>
    <p>复习队列会自动混合科目（interleaving），这比按科目刷更累、但记得更牢。每张卡都有中文解析——先用中文建立概念锚点，再用英文表述巩固，最后要做到<b>只看英文就能作答</b>，因为考场语言是英文。「加州区别」金框是加州考试的得分点，务必单独留意。</p>
    <h4>到 2027 年 2 月的节奏</h4>
    <ul>
      <li><b>现在 → 11月</b>：每天 15-25 张新卡 + 清空复习。首页的「进度规划」会告诉你按当前速度何时学完。</li>
      <li><b>12月 → 1月中</b>：新卡清零，纯复习 + 每天一轮考题演练；配合你的 MBE 题目书刷题。</li>
      <li><b>最后 6 周</b>：算法会自动缩短间隔，保证每张卡在考前再见一面。重点清理「困难卡」(⚑ 和多次遗忘的卡)。</li>
    </ul>
    <h4>小习惯，大复利</h4>
    <p>连续学习天数 (🔥) 和每日目标环只是提醒你：<b>每天 30 分钟，胜过周末 4 小时</b>。通勤、排队、睡前都是好时机——手机浏览器打开即用。</p>` : `
    <h4>Why spaced repetition?</h4>
    <p>Memory decays on a forgetting curve. The most efficient counter is to review each fact <b>right before you'd forget it</b> — every successful recall flattens the curve. The FSRS scheduler (the modern Anki algorithm) models each card individually and finds that moment. Your only job: <b>come back daily and clear the due queue</b>.</p>
    <h4>Active recall, not re-reading</h4>
    <p>Before revealing, <b>answer fully in your head</b>. Retrieval practice beats re-reading by a wide margin — even failed attempts strengthen the correction.</p>
    <h4>Grade honestly</h4>
    <ul><li><b>Again</b> — blank or wrong</li><li><b>Hard</b> — recalled with real effort</li><li><b>Good</b> — normal recall (your default)</li><li><b>Easy</b> — instant, effortless</li></ul>
    <h4>Interleaving + bilingual anchoring</h4>
    <p>The queue mixes subjects deliberately — harder, but stickier. Use the Chinese explanations to anchor concepts, then wean onto English-only recall: the exam is in English. Gold "California distinction" boxes are where CA exam points hide.</p>
    <h4>Pacing to February 2027</h4>
    <ul><li><b>Now → Nov</b>: 15-25 new cards/day + clear reviews.</li><li><b>Dec → mid-Jan</b>: no new cards; pure review + daily quiz rounds alongside your MBE question books.</li><li><b>Final 6 weeks</b>: the scheduler automatically compresses intervals so every card is seen again before exam day. Hunt down leeches (⚑, high-lapse cards).</li></ul>
    <h4>Small habit, big compounding</h4>
    <p>30 minutes daily beats 4 hours on Sunday. Commutes, queues, bedtime — the app works offline in your phone browser.</p>`;
  return `<button class="backlink" onclick="nav('settings')">← ${esc(t("nav.set"))}</button>
  <div class="panel article"><h3>🎓 ${esc(t("method.title"))}</h3>${body}
  <p class="tiny" style="margin-top:14px">→ <a href="#guide">${esc(t("set.guide"))}</a></p></div>`;
}

/* ============================ GUIDE ============================ */
function vGuide() {
  const zh = S.settings.lang === "zh";
  const body = zh ? `
    <h4>🏠 首页看什么</h4>
    <ul>
      <li><b>倒计时</b>：距 2027 年 2 月考试的天数（日期可在设置修改）。</li>
      <li><b>目标环</b>：今日已完成卡数 / 每日目标（复习+新卡+演练都计入）。</li>
      <li><b>🔥 连续天数</b>：任意学习一张即算打卡当天。</li>
      <li><b>进度规划</b>：按剩余新卡和考试日期，建议每日新卡量——目标是考前留约两个月纯复习期。</li>
      <li><b>科目掌握度</b>：算法估计的当前记忆强度；点击任一科目可进入该科页面。</li>
    </ul>
    <h4>📚 三种学习模式</h4>
    <ul>
      <li><b>开始复习</b>：清空到期卡。多科目自动混合（交叉练习记得更牢）。</li>
      <li><b>学习新卡</b>:按每日额度引入新卡，各科轮流；额度在设置里调。</li>
      <li><b>考题演练</b>：模拟选择题（可选科目与题数）。<b>答错的卡自动进复习队列</b>，答对的算完成当天到期复习。</li>
    </ul>
    <h4>🃏 卡片怎么用</h4>
    <ul>
      <li>三种卡型：<b>问答</b>（先心里作答再点「显示答案」）、<b>挖空</b>（补出［？］处）、<b>选择题</b>（直接点选项）。</li>
      <li><b>🀄 显示中文</b>：题面下方按钮，随时切换中文翻译；设置里可改为默认显示。</li>
      <li>答案区的框：<b>📘 解析</b>=中文要点与记忆法；<b>🐻 加州区别</b>=加州与联邦/多数规则不同之处（<b>加州考试的得分点，重点记</b>）；<b>💡 记忆钩</b>=助记口诀。</li>
      <li><b>⚑ 标记</b>：对内容存疑时标记，之后在题库里核对讲义；<b>⏸ 暂停</b>（卡片详情里）：这张卡不再出现；<b>↩︎ 撤销</b>：撤回上一次评分。</li>
    </ul>
    <h4>🎯 四个评分键（核心！）</h4>
    <ul>
      <li><b>重来</b>=没想起来 · <b>困难</b>=很吃力 · <b>记得</b>=正常想起（大多数按这个）· <b>轻松</b>=秒答。</li>
      <li>按键下方的数字 = 这样评分后<b>下次出现的间隔</b>。选择题答完会用光圈提示建议评分，空格键直接确认。</li>
      <li>评分是算法的输入——诚实评分，间隔才准。</li>
    </ul>
    <h4>🗂 题库</h4>
    <ul>
      <li>顶部搜索框支持中英文全文检索；点科目看每张卡与状态。</li>
      <li>科目页两个按钮：<b>复习本科到期卡</b>（想单科集中时用）；<b>暂停本科新卡</b>（想跟着课程进度、暂不开某科时用——已学卡片仍会正常复习）。</li>
    </ul>
    <h4>📈 统计页数字含义</h4>
    <ul>
      <li><b>记忆保持率</b>：近 30 天复习的答对比例，健康值≈设置里的目标保持率（默认 90%）。明显偏低=评分太宽或新卡太多。</li>
      <li><b>热力图</b>：每天学习量，颜色越深越多。</li>
      <li>卡片详情里的 <b>S</b>=稳定度（记忆半衰期天数），<b>D</b>=难度（1-10）。</li>
    </ul>
    <h4>⚙️ 设置要点</h4>
    <ul>
      <li><b>考试日期</b>：算法据此压缩考前间隔，保证每张卡考前再见一面。</li>
      <li><b>目标保持率</b>：调高=复习更频繁更保险；备考后期可调到 92-95%。</li>
    </ul>
    <h4>🧪 考过的人从这里开始：摸底与分拣</h4>
    <ul>
      <li><b>摸底测试</b>（首页或科目页）：每科 12 题。答得好（≥50%），该科大部分卡直接按「已会」进入复习轨道，错题所在专题保留为新卡重学——不用从零刷 1108 张。</li>
      <li><b>快速分拣</b>（科目页）：只看题面，按「已掌握 / 要学」秒分。已掌握的卡片直接排进复习；判断权完全在你。</li>
      <li><b>弱项优先</b>：默认设置下，新卡自动多发弱科目、少发强科目（设置里可改回均衡轮换）。</li>
    </ul>
    <h4>📡 弱项雷达</h4>
    <p>系统按<b>专题</b>（不只科目）统计你的复习与演练正确率，首页列出当前最弱的三个专题，点「练」立即针对性加练一轮。做过摸底、复习越多，雷达越准。</p>
    <h4>🐻 金熊法官、徽章与金门大桥</h4>
    <ul>
      <li><b>金熊法官</b>坐在首页陪你——随你的段位升级法袍，答对点头、答错也只是心疼一下。</li>
      <li><b>判例徽章</b>（统计页）：里程碑以你正在学的著名判例命名——收集徽章本身就是复习。</li>
      <li><b>金门大桥</b>随总进度一段段建成，记忆保持率越高、桥上的雾越散。走到对岸 = 应试就绪。</li>
      <li>完成一轮 = <b>休庭</b>盖章仪式；音效默认关闭，设置里可开。</li>
    </ul>
    <h4>💾 进度备份与离线使用</h4>
    <ul>
      <li>进度只存<b>本机浏览器</b>。请每周「导出学习进度」备份一次；换设备/换浏览器用「导入」。</li>
      <li>整个应用是一个 HTML 文件：网页打不开时，把文件存到手机/电脑双击即用，功能完全一样（注意：文件版与网页版进度各自独立，用导出/导入衔接）。</li>
      <li>不要同时开两个标签页学习，进度会互相覆盖。</li>
    </ul>
    <h4>⌨️ 快捷键（电脑）</h4>
    <p>空格/回车 = 显示答案或确认 · 数字 1-4 = 评分（答案已显示时）或选择选项。</p>` : `
    <h4>🏠 Home screen</h4>
    <ul>
      <li><b>Countdown</b> to the Feb 2027 exam (date editable in Settings).</li>
      <li><b>Goal ring</b>: today's cards vs daily goal (reviews + new + quiz all count).</li>
      <li><b>🔥 Streak</b>: any studying counts the day.</li>
      <li><b>Pacing</b>: suggested new-cards/day so everything is learned with a ~2-month pure-review runway.</li>
      <li><b>Subject mastery</b>: the scheduler's live estimate of memory strength; tap a subject to open it.</li>
    </ul>
    <h4>📚 Three study modes</h4>
    <ul>
      <li><b>Review</b>: clear due cards, subjects deliberately interleaved.</li>
      <li><b>Learn New</b>: introduces the daily quota, rotating across subjects.</li>
      <li><b>Quiz</b>: bar-style MCQs (pick scope & count). <b>Misses feed back into the review queue</b>; hits count as that card's due review.</li>
    </ul>
    <h4>🃏 Cards</h4>
    <ul>
      <li>Types: <b>recall</b> (answer in your head, then reveal), <b>cloze</b> (fill the ［？］), <b>MCQ</b> (tap an option).</li>
      <li><b>🀄 中文</b> button toggles the Chinese rendering; Settings can make it default-on.</li>
      <li>Answer boxes: <b>📘 解析</b> = key points & memory hooks; <b>🐻 California distinction</b> = where CA differs (this is where CA exam points live); <b>💡 mnemonic</b>.</li>
      <li><b>⚑ Flag</b> doubtful content to verify later; <b>⏸ Suspend</b> (card detail) removes a card from rotation; <b>↩︎ Undo</b> reverses the last grade.</li>
    </ul>
    <h4>🎯 The four grade buttons (the core!)</h4>
    <ul>
      <li><b>Again</b> = blank · <b>Hard</b> = real effort · <b>Good</b> = normal recall (your default) · <b>Easy</b> = instant.</li>
      <li>The small number under each button = the <b>next interval</b> that grade produces. After an MCQ, the suggested grade glows; Space confirms it.</li>
      <li>Honest grading is what makes the intervals right.</li>
    </ul>
    <h4>🗂 Browse</h4>
    <ul>
      <li>Full-text search (English & Chinese). Open a deck for every card and its state.</li>
      <li>Per-deck buttons: <b>Review due in this deck</b> (single-subject focus) and <b>Pause new cards</b> (follow your course order — already-learned cards keep reviewing).</li>
    </ul>
    <h4>📈 Stats</h4>
    <ul>
      <li><b>30-day retention</b>: share of reviews answered correctly; healthy ≈ your target retention (default 90%).</li>
      <li><b>Heatmap</b>: daily volume. Card detail shows <b>S</b> = stability (memory half-life, days) and <b>D</b> = difficulty (1-10).</li>
    </ul>
    <h4>⚙️ Settings that matter</h4>
    <ul>
      <li><b>Exam date</b> drives the interval cap — every card is guaranteed a final pre-exam appearance.</li>
      <li><b>Target retention</b>: higher = more frequent reviews; consider 92-95% in the final months.</li>
    </ul>
    <h4>🧪 Repeat takers start here: diagnostic & triage</h4>
    <ul>
      <li><b>Placement diagnostic</b> (home or deck page): 12 questions per subject. Score ≥50% and most of that deck is pre-scheduled as known review material — missed topics stay as new cards. No grinding through 1,108 cards you already know.</li>
      <li><b>Fast triage</b> (deck page): question-only, snap "know / learn" sorting — you keep full control.</li>
      <li><b>Weakest-first intake</b>: by default new cards flow faster from your weak subjects (Settings can restore even rotation).</li>
    </ul>
    <h4>📡 Weakness radar</h4>
    <p>Accuracy is tracked per <b>topic</b>, not just per subject. The home screen names your three weakest topics with a one-tap Drill. The more you review (and diagnose), the sharper it gets.</p>
    <h4>🐻 Judge Bear, badges & the bridge</h4>
    <ul>
      <li><b>Judge Bear</b> keeps you company — his robes upgrade with your rank; he nods at good recalls and merely winces at lapses.</li>
      <li><b>Case badges</b> (Stats): milestones named after landmark cases you're literally studying — collecting them is revising.</li>
      <li><b>The Golden Gate</b> builds span by span with your progress; higher retention lifts the fog. Reaching the far shore = exam-ready.</li>
      <li>Every finished session gets a <b>Court adjourned</b> seal ceremony; sounds are off by default (Settings).</li>
    </ul>
    <h4>💾 Backup & offline</h4>
    <ul>
      <li>Progress lives in <b>this browser only</b>. Export weekly; import on a new device.</li>
      <li>The app is a single HTML file — save it locally and it works identically offline (file and web progress are separate; bridge with export/import).</li>
      <li>Don't study in two tabs at once — they overwrite each other.</li>
    </ul>
    <h4>⌨️ Keyboard</h4>
    <p>Space/Enter = reveal or confirm · 1-4 = grade (after reveal) or pick an option.</p>`;
  return `<button class="backlink" onclick="nav('settings')">← ${esc(t("nav.set"))}</button>
  <div class="panel article"><h3>📖 ${esc(t("guide.title"))}</h3>${body}
  <p class="tiny" style="margin-top:14px">→ <a href="#method">${esc(t("set.method"))}</a></p></div>`;
}

/* ============================ modal & boot ============================ */
function showModal(inner) {
  closeModal();
  const bg = document.createElement("div");
  bg.className = "modal-bg"; bg.id = "modalbg";
  bg.innerHTML = `<div class="modal">${inner}</div>`;
  bg.addEventListener("click", e => { if (e.target === bg) closeModal(); });
  document.body.appendChild(bg);
}
window.closeModal = () => { const m = $("#modalbg"); if (m) m.remove(); };
window.nav = nav;

document.addEventListener("keydown", e => {
  if (e.repeat) return;                                    // held key must not machine-gun grades
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  const h = (location.hash || "#home").slice(1);
  if (h.startsWith("triage/") && tri) {
    if (e.key === "1") triMark(true);
    else if (e.key === "2") triMark(false);
    return;
  }
  if (h === "study" && session) {
    const id = session.cur || currentId(); if (!id) return;
    const c = CARD[id];
    if (!session.revealed) {
      if ((e.key === " " || e.key === "Enter") && c.type !== "mcq") { e.preventDefault(); reveal(); }
      else if (c.type === "mcq" && "1234".includes(e.key)) { pickOpt(session.shuffle ? session.shuffle["1234".indexOf(e.key)] : parseInt(e.key, 10) - 1); }
    } else if ("1234".includes(e.key)) doGrade(parseInt(e.key, 10));
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); doGrade(session.mcqPick != null ? (session.mcqRight ? 3 : 1) : 3); }
  } else if (h === "quiz" && quiz && quiz.idx < quiz.ids.length) {
    if (!quiz.answered && "1234".includes(e.key)) quizPick(quiz.shuffle["1234".indexOf(e.key)]);
    else if (quiz.answered && (e.key === " " || e.key === "Enter")) { e.preventDefault(); quizNext(); }
  }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) { tickTime(); save(true); } });
window.addEventListener("pagehide", () => { tickTime(); save(true); });
/* another tab wrote newer state → adopt it instead of clobbering it later */
window.addEventListener("storage", e => {
  if (e.key === LS_KEY && e.newValue) { S = load(); applyTheme(); route(); window.dispatchEvent(new Event("i18nchange")); }
});

applyTheme();
route();
setTimeout(() => { if (!storageOk) toast(t("toast.storage")); }, 1200);
