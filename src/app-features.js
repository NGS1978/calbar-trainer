/* =====================================================================
   CalBar Trainer — features: level assessment & adaptation + character
   (loaded after app-core.js, before app-ui.js)
   ===================================================================== */
"use strict";

/* ---------------- per-topic performance stats (弱项雷达 data) ----------------
   S.topics["deck/topic"] = {a: attempts, ok: correct}. Exponential forgetting:
   once a topic passes 40 attempts both counters halve, so recent form dominates. */
function topicKey(id) { const c = CARD[id]; return c.deck + "/" + c.topic; }
function recordTopic(id, correct) {
  if (!S.topics) S.topics = {};
  const k = topicKey(id);
  const t = S.topics[k] || (S.topics[k] = { a: 0, ok: 0 });
  t.a++; if (correct) t.ok++;
  if (t.a > 40) { t.a = Math.round(t.a / 2); t.ok = Math.round(t.ok / 2); }
}
function topicStats() {
  const out = [];
  for (const [k, v] of Object.entries(S.topics || {})) {
    if (v.a < 6) continue;                        // not enough signal yet
    const [deck, ...rest] = k.split("/");
    if (!DECK[deck]) continue;
    const topic = rest.join("/");
    const card = DECK[deck].cards.find(c => c.topic === topic);
    if (!card) continue;                          // topic renamed/removed in a later content build
    out.push({ deck, topic, topicZh: card.topicZh, acc: v.ok / v.a, n: v.a });
  }
  out.sort((x, y) => x.acc - y.acc);
  return out;
}
function deckWeakness(subj) {                     // 0 strong … 1 weak, 0.5 = unknown
  let a = 0, ok = 0;
  for (const [k, v] of Object.entries(S.topics || {})) {
    if (k.startsWith(subj + "/")) { a += v.a; ok += v.ok; }
  }
  const dg = (S.diag || {})[subj];
  if (dg) { a += dg.total; ok += dg.score; }
  if (a < 6) return 0.5;
  return clamp(1 - ok / a, 0, 1);
}

/* ---------------- seeding (placement & triage write card states) ----------------
   Seed a card as established "review" material with stability s days and a due
   date staggered across the interval so bulk seeds don't spike one day. */
function seedCard(id, sDays, grade4) {
  const c = cs(id);
  c.st = 2;
  c.s = sDays; c.d = initD(grade4 ? 4 : 3);
  c.last = now();
  c.due = now() + Math.round((1 + Math.random() * Math.max(1, sDays - 1)) * DAY);
  c.reps = (c.reps || 0) + 1;
}

/* ---------------- A. 摸底测试 placement diagnostic ---------------- */
const DIAG_N = 12;
function diagDone(subj) { return !!(S.diag && S.diag[subj]); }
function buildDiag(subj) {
  /* stratified: walk topics in order, take MCQs round-robin until DIAG_N */
  const byTopic = {};
  for (const c of DECK[subj].cards) {
    if (c.type !== "mcq" || isSusp(c.id)) continue;
    (byTopic[c.topic] = byTopic[c.topic] || []).push(c.id);
  }
  const groups = Object.values(byTopic);
  groups.forEach(shuffleArr);
  const ids = [];
  let i = 0;
  while (ids.length < DIAG_N && groups.some(g => g.length)) {
    const g = groups[i % groups.length]; i++;
    if (g.length) ids.push(g.shift());
  }
  return shuffleArr(ids);
}
/* apply results: seeds this subject's new cards by score + missed topics */
function applyDiag(subj, rightIds, wrongIds) {
  if (!S.diag) S.diag = {};
  const total = rightIds.length + wrongIds.length;
  const p = total ? rightIds.length / total : 0;
  const missedTopics = new Set(wrongIds.map(id => CARD[id].topic));
  let seeded = 0;
  if (p >= 0.5) {
    const strong = p >= 0.75;
    const sDays = p >= 0.9 ? 25 : strong ? 15 : 10;
    for (const c of DECK[subj].cards) {
      const st = peek(c.id);
      if (st && st.st !== 0) continue;            // already in learning/review
      if (isSusp(c.id)) continue;
      if (!strong && missedTopics.has(c.topic)) continue;   // weak topics stay new
      if (wrongIds.includes(c.id)) continue;
      seedCard(c.id, sDays, p >= 0.9);
      seeded++;
    }
  }
  /* the sampled cards themselves: misses become due-now learning */
  for (const id of wrongIds) {
    const c = cs(id);
    if (c.st === 0) { c.st = 1; c.step = 0; c.s = initS(1); c.d = initD(1); c.due = now(); c.last = now(); }
  }
  for (const id of rightIds) recordTopic(id, true);
  for (const id of wrongIds) recordTopic(id, false);
  S.diag[subj] = { score: rightIds.length, total, p: Math.round(p * 100), date: ymd(), seeded };
  save(true);
  return { p: Math.round(p * 100), seeded, weak: [...missedTopics] };
}

/* ---------------- C. weakness-weighted new-card intake ---------------- */
function buildNewQueueWeighted(n) {
  const byDeck = newRemainingByDeck(), queue = [];
  const subjects = DECKS.map(d => d.subject).filter(s => byDeck[s].length);
  if (!subjects.length) return queue;
  subjects.sort((a, b) => deckWeakness(b) - deckWeakness(a));   // literally weakest-first; no ordering starvation
  /* slots per cycle: weak 2 · neutral 1 · diagnosed-strong 1 every 2nd cycle */
  let cycle = 0;
  while (queue.length < n && subjects.some(s => byDeck[s].length)) {
    cycle++;
    for (const s of subjects) {
      if (!byDeck[s].length || queue.length >= n) continue;
      const w = deckWeakness(s);
      const slots = w > 0.55 ? 2 : w < 0.3 ? (cycle % 2 ? 1 : 0) : 1;
      for (let k = 0; k < slots && byDeck[s].length && queue.length < n; k++) queue.push(byDeck[s].shift());
    }
    if (cycle > 500) break;
  }
  return queue;
}

/* ---------------- D. 弱项雷达 drill queue ---------------- */
function buildTopicDrill(deck, topic, cap) {
  const pool = DECK[deck].cards.filter(c => c.topic === topic && !isSusp(c.id))
    .map(c => c.id).filter(id => { const s = peek(id); return s && s.st > 0; });
  pool.sort((a, b) => {
    const ra = cardR(a), rb = cardR(b);
    return ra - rb;
  });
  return pool.slice(0, cap || 12);
}
function cardR(id) {
  const c = peek(id);
  if (!c || c.st === 0) return 0;
  if (c.st !== 2) return 0.3;
  return retrievability(Math.max(0, (now() - c.last) / DAY), c.s);
}

/* ---------------- 2+5. badges & stamps (判例徽章 + 印章) ----------------
   Mastery badges need real, demonstrated work — not a lucky diagnostic:
   ≥85% modeled mastery AND ≥40 graded attempts recorded in that deck. */
function deckAttempts(subj) {
  let a = 0;
  for (const [k, v] of Object.entries(S.topics || {})) if (k.startsWith(subj + "/")) a += v.a;
  return a;
}
function masteryBadge(subj) { return deckStats(subj).mastery >= 0.85 && deckAttempts(subj) >= 40; }

const BADGES = [
  /* id, icon, nameZh, nameEn, caseName, holdZh, holdEn, kind, test(S)->bool */
  ["pennoyer", "📜", "初审出庭", "First Appearance", "Pennoyer v. Neff (1878)", "属人管辖的起点", "Where personal jurisdiction began", "case", () => studiedCount() >= 100],
  ["erie", "🚂", "七日连胜", "7-Day Streak", "Erie R.R. v. Tompkins (1938)", "联邦法院适用州实体法", "Federal courts apply state substantive law", "case", () => streak() >= 7],
  ["marbury", "🏛️", "三十日坚持", "30-Day Streak", "Marbury v. Madison (1803)", "司法审查权确立", "Judicial review established", "case", () => streak() >= 30],
  ["gideon", "✊", "百日不辍", "100-Day Streak", "Gideon v. Wainwright (1963)", "手写申诉改变历史——坚持的力量", "A handwritten petition that changed history — persistence", "case", () => streak() >= 100],
  ["palsgraf", "🚆", "单日百案", "Century Session", "Palsgraf v. Long Island R.R. (1928)", "近因：责任止于可预见范围", "Proximate cause limits liability to the foreseeable", "case", () => maxDayCount() >= 100],
  ["hadley", "🏭", "满分裁决", "Perfect Verdict", "Hadley v. Baxendale (1854)", "可预见性规则", "The foreseeability rule", "case", () => !!(S.flags && S.flags.perfectQuiz)],
  ["daubert", "🧪", "首次摸底", "First Diagnostic", "Daubert v. Merrell Dow (1993)", "以检验为据", "Reliability through testing", "case", () => Object.keys(S.diag || {}).length >= 1],
  ["intlshoe", "👞", "民诉大师", "Civ Pro Master", "International Shoe v. Washington (1945)", "最低联系标准", "Minimum contacts", "case", () => masteryBadge("civpro")],
  ["crawford", "🔍", "证据大师", "Evidence Master", "Crawford v. Washington (2004)", "对质条款重生", "The Confrontation Clause reborn", "case", () => masteryBadge("evidence")],
  ["lucy", "🥂", "合同大师", "Contracts Master", "Lucy v. Zehmer (1954)", "合同看客观表示", "Objective theory of contract", "case", () => masteryBadge("contracts")],
  ["miranda", "🚔", "刑法大师", "Crim Master", "Miranda v. Arizona (1966)", "你有权保持沉默", "You have the right to remain silent", "case", () => masteryBadge("crimlaw")],
  ["pierson", "🦊", "财产大师", "Property Master", "Pierson v. Post (1805)", "先占取得狐狸", "First possession takes the fox", "case", () => masteryBadge("realprop")],
  ["rowland", "🩹", "侵权大师", "Torts Master", "Rowland v. Christian (1968)", "加州统一注意义务", "California's unified duty of care", "case", () => masteryBadge("torts")],
  ["brandenburg", "🗽", "宪法大师", "Con Law Master", "Brandenburg v. Ohio (1969)", "煽动标准", "The incitement standard", "case", () => masteryBadge("conlaw")],
  ["meinhard", "🏢", "商组大师", "Bus Assoc Master", "Meinhard v. Salmon (1928)", "最敏感的忠实义务", "The punctilio of an honor the most sensitive", "case", () => masteryBadge("busassoc")],
  ["pereira", "💍", "共产大师", "Comm Prop Master", "Pereira v. Pereira (1909)", "个人努力的增值归属", "Apportioning the fruits of personal effort", "case", () => masteryBadge("commprop")],
  ["baird", "🧭", "职责大师", "PR Master", "Baird v. State Bar (1971)", "品格与操守", "Character and fitness", "case", () => masteryBadge("profresp")],
  ["lumley", "🎭", "救济大师", "Remedies Master", "Lumley v. Wagner (1852)", "歌唱家与消极禁令", "The singer and the negative injunction", "case", () => masteryBadge("remedies")],
  ["claflin", "🔐", "信托大师", "Trusts Master", "Claflin v. Claflin (1889)", "信托的实质目的", "A trust's material purpose", "case", () => masteryBadge("trusts")],
  ["duke", "✍️", "遗嘱大师", "Wills Master", "Estate of Duke (2015)", "加州允许更正遗嘱", "California reforms wills for proven mistake", "case", () => masteryBadge("wills")],
  ["blacks", "📖", "词汇大师", "Lexicon Master", "Black's Law Dictionary", "法律英语的地基", "The bedrock of legal English", "case", () => masteryBadge("glossary")],
  ["fulldocket", "🎓", "满卷在手", "Full Docket", "—", "全部卡片均已开卷", "Every card introduced", "case", () => ALL_IDS.filter(id => { const s = peek(id); return (!s || s.st === 0) && !isSusp(id); }).length === 0],
  /* stamps (印章/邮票风格): bridge + countdown milestones */
  ["span50", "🌉", "半桥已渡", "Halfway Span", "—", "总进度过半", "Half the bridge built", "stamp", () => journeyP() >= 0.5],
  ["span100", "🌁", "跨越金门", "Bridge Crossed", "—", "大桥贯通 — 应试就绪", "The bridge is complete — exam ready", "stamp", () => journeyP() >= 0.97],
  ["d200", "🗓️", "倒计时 200", "200 Days", "—", "距考试 200 天", "200 days out", "stamp", () => daysToExam() <= 200],
  ["d150", "📮", "倒计时 150", "150 Days", "—", "距考试 150 天", "150 days out", "stamp", () => daysToExam() <= 150],
  ["d100", "⏳", "倒计时 100", "100 Days", "—", "距考试 100 天", "100 days out", "stamp", () => daysToExam() <= 100],
  ["d50", "🔔", "倒计时 50", "50 Days", "—", "冲刺阶段", "The sprint begins", "stamp", () => daysToExam() <= 50],
  ["d7", "🌟", "最后一周", "Final Week", "—", "候审最后一周——你准备好了", "One week — you are ready", "stamp", () => daysToExam() <= 7]
];
function studiedCount() { let n = 0; for (const d of DECKS) { const s = deckStats(d.subject); n += s.rev + s.learn; } return n; }
function maxDayCount() { let m = 0; for (const v of Object.values(S.days || {})) m = Math.max(m, v.r + v.n + v.q); return m; }
function evaluateBadges() {
  if (!S.badges) S.badges = {};
  const fresh = [];
  for (const b of BADGES) {
    if (S.badges[b[0]]) continue;
    let hit = false;
    try { hit = b[8](); } catch (_) {}
    if (hit) { S.badges[b[0]] = ymd(); fresh.push(b); }
  }
  if (fresh.length) save();
  return fresh;
}
function announceBadges(fresh) {
  if (!fresh || !fresh.length) return;
  const b = fresh[0];
  const zh = S.settings.lang === "zh";
  toast(`🏅 ${b[1]} ${zh ? "获得徽章：" + b[2] : "Badge earned: " + b[3]}`);
  try { sfx("chime"); } catch (_) {}
}

/* ---------------- 3. Golden Gate journey ---------------- */
function journeyP() { const tt = totals(); return clamp(0.5 * (tt.total ? studiedCount() / tt.total : 0) + 0.5 * tt.mastery, 0, 1); }
function bridgeSVG() {
  const p = journeyP();
  const ret = retention30();
  const fog = ret === null ? 0.42 : clamp(1 - ret, 0.04, 0.6);
  const W = 620, H = 150, deckY = 92;
  const towerH = clamp(p / 0.35, 0, 1);                 // towers rise 0-35%
  const deckP = clamp((p - 0.35) / 0.40, 0, 1);         // deck extends 35-75%
  const cableP = clamp((p - 0.75) / 0.24, 0, 1);        // cables drape 75-99%
  const t1x = 170, t2x = 450, tTop = 22, tBase = deckY + 34;
  const th = (tBase - tTop) * towerH;
  const deckEnd = 30 + (W - 60) * deckP;
  const walkerX = 30 + (W - 70) * clamp(studiedCount() / Math.max(ALL_IDS.length, 1), 0, 1);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img">`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="var(--sky-bg,#dbeaf5)"/>`;
  s += `<rect x="0" y="${deckY + 22}" width="${W}" height="${H - deckY - 22}" fill="var(--water,#9fc4d8)" opacity=".85"/>`;
  s += `<path d="M0 ${deckY + 26} q 40 -6 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0" stroke="var(--water,#7fb0c9)" fill="none" stroke-width="2" opacity=".6"/>`;
  /* far shorelines */
  s += `<path d="M0 ${deckY + 24} L 46 ${deckY + 6} L 92 ${deckY + 24} Z" fill="#b9a77f" opacity=".85"/>`;
  s += `<path d="M${W - 96} ${deckY + 24} L ${W - 40} ${deckY + 2} L ${W} ${deckY + 24} Z" fill="#a99464" opacity=".9"/>`;
  /* towers */
  for (const tx of [t1x, t2x]) {
    if (th > 2) {
      s += `<rect x="${tx - 7}" y="${tBase - th}" width="14" height="${th}" rx="3" fill="#c4462e"/>`;
      if (towerH > 0.55) s += `<rect x="${tx - 11}" y="${tBase - th}" width="22" height="5" rx="2" fill="#c4462e"/>`;
      if (towerH > 0.85) s += `<rect x="${tx - 9}" y="${tBase - th + Math.min(26, th * 0.3)}" width="18" height="4" rx="2" fill="#c4462e"/>`;
    }
  }
  /* deck */
  if (deckP > 0.02) s += `<rect x="30" y="${deckY}" width="${deckEnd - 30}" height="6" rx="3" fill="#b03d28"/>`;
  /* cables */
  if (cableP > 0.02) {
    const sag = 46 * cableP;
    s += `<path d="M30 ${deckY} Q ${(30 + t1x) / 2} ${deckY - 8}, ${t1x} ${tTop + 4} Q ${(t1x + t2x) / 2} ${tTop + 4 + sag}, ${t2x} ${tTop + 4} Q ${(t2x + W - 30) / 2} ${deckY - 8}, ${W - 30} ${deckY}" stroke="#8c2f1d" stroke-width="3.5" fill="none" opacity="${0.35 + 0.65 * cableP}"/>`;
    if (cableP > 0.5) for (let x = 60; x < W - 50; x += 34) s += `<line x1="${x}" y1="${deckY}" x2="${x}" y2="${deckY - 18 - 14 * Math.sin((x / W) * Math.PI)}" stroke="#8c2f1d" stroke-width="1" opacity=".5"/>`;
  }
  /* walker (Ron) */
  if (deckP > 0.03) s += `<g transform="translate(${Math.min(walkerX, deckEnd - 6)} ${deckY - 7})"><circle cx="0" cy="-4" r="2.6" fill="#26282f"/><rect x="-1.7" y="-2" width="3.4" height="6" rx="1.6" fill="#26282f"/></g>`;
  if (p >= 0.999) s += `<g transform="translate(${W - 44} ${tTop - 4})"><line x1="0" y1="0" x2="0" y2="16" stroke="#555" stroke-width="1.6"/><path d="M0 1 L 13 4.5 L 0 8 Z" fill="var(--jade)"/></g>`;
  /* fog */
  s += `<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="var(--fogc,#e8ecef)" opacity="${fog}" class="fogband"/>`;
  s += `</svg>`;
  return s;
}

/* ---------------- 1. Judge Bear 金熊法官 ---------------- */
function robeTier() {
  let i = 0; for (let k = 0; k < RANKS.length; k++) if (S.xp >= RANKS[k][0]) i = k;
  return i >= 10 ? 3 : i >= 7 ? 2 : i >= 4 ? 1 : 0;   // 0 clerk → 3 chief justice
}
function bearSVG(state, size) {
  const tier = robeTier();
  const robe = ["#8d99ae", "#4a5568", "#2f3a56", "#3b2f63"][tier];
  const trim = ["#c9c9c9", "#c9c9c9", "#e6e6e6", "#d4af37"][tier];
  const px = size || 84;
  return `
  <svg viewBox="0 0 100 110" style="width:${px}px;height:${px * 1.1}px" class="bear ${state || "idle"}" aria-label="Judge Bear">
    <g class="bear-body">
      <path d="M22 108 Q 20 74 50 72 Q 80 74 78 108 Z" fill="${robe}"/>
      <path d="M40 78 L 50 92 L 60 78 Q 55 74 50 74 Q 45 74 40 78 Z" fill="${trim}"/>
      ${tier >= 2 ? `<rect x="46" y="80" width="8" height="14" rx="2" fill="${trim}"/>` : ""}
      <g class="bear-head">
        <circle cx="31" cy="30" r="9" fill="#d99a3d"/><circle cx="69" cy="30" r="9" fill="#d99a3d"/>
        <circle cx="31" cy="30" r="4.5" fill="#b47a24"/><circle cx="69" cy="30" r="4.5" fill="#b47a24"/>
        <ellipse cx="50" cy="45" rx="27" ry="24" fill="#e2a848"/>
        <ellipse cx="50" cy="54" rx="13" ry="10" fill="#f3d6a0"/>
        <ellipse cx="50" cy="50" rx="4.6" ry="3.6" fill="#3d2d1c"/>
        <path d="M50 53 Q 50 58 45 59 M50 53 Q 50 58 55 59" stroke="#3d2d1c" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <g class="bear-eyes">
          <circle class="eye" cx="40" cy="40" r="3.1" fill="#26282f"/>
          <circle class="eye" cx="60" cy="40" r="3.1" fill="#26282f"/>
          <path class="lid" d="M36 40 q 4 3 8 0" stroke="#26282f" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0"/>
          <path class="lid" d="M56 40 q 4 3 8 0" stroke="#26282f" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0"/>
        </g>
        <g opacity=".92"><circle cx="40" cy="40" r="6.4" fill="none" stroke="#6b5330" stroke-width="1.4"/><circle cx="60" cy="40" r="6.4" fill="none" stroke="#6b5330" stroke-width="1.4"/><line x1="46.4" y1="40" x2="53.6" y2="40" stroke="#6b5330" stroke-width="1.4"/></g>
        ${tier >= 3 ? `<path d="M36 20 L 40 12 L 46 18 L 50 10 L 54 18 L 60 12 L 64 20 Q 50 15 36 20 Z" fill="#d4af37"/>` : ""}
      </g>
      <g class="bear-arm">
        <rect x="70" y="76" width="7" height="20" rx="3.5" fill="${robe}" transform="rotate(-18 73 78)"/>
        <g class="gavel" transform="rotate(-18 73 78)"><rect x="66" y="70" width="16" height="7" rx="2.5" fill="#8a5a2b"/><rect x="72" y="64" width="4" height="10" rx="1.5" fill="#6d451f"/></g>
      </g>
      <g class="zzz" opacity="0"><text x="80" y="18" font-size="11" fill="var(--ink-faint)" font-weight="700">z</text><text x="87" y="10" font-size="8" fill="var(--ink-faint)" font-weight="700">z</text></g>
    </g>
  </svg>`;
}

/* ---------------- 7. persona voice ---------------- */
const PERSONA = {
  greetZh: [
    "开庭前，先深呼吸。今天也稳稳推进。",
    "对价：中国法不要它，加州要，你也得要。",
    "传闻规则第一问：这句话是谁、在哪儿说的？",
    "像 Gideon 一样固执——他用铅笔改写了历史。",
    "每天 30 分钟，胜过周末苦读 4 小时。",
    "先清到期卡，再学新卡——法官也讲究先来后到。",
    "记不住的卡不是敌人，是路标。",
    "加州区别 🐻 出现时，多看两眼——那是得分点。",
    "Palsgraf 夫人都没放弃，你也不会。",
    "今天的一小步，二月的一大步。",
    "衡平法格言：勤勉者得救济，睡在权利上者不得。",
    "本庭对'明天再学'的抗辩不予采纳。"
  ],
  greetEn: [
    "Deep breath, counsel. Steady progress today.",
    "Consideration: PRC law skips it; California doesn't. Neither can you.",
    "Hearsay question one: who said it, and where?",
    "Be as stubborn as Gideon — he rewrote history in pencil.",
    "Thirty minutes daily beats four hours on Sunday.",
    "Clear the due queue first — even judges respect the docket order.",
    "A hard card isn't an enemy. It's a signpost.",
    "When the 🐻 appears, look twice — that's where points live.",
    "Equity aids the vigilant, not those who sleep on their rights.",
    "This court overrules the objection of 'I'll study tomorrow.'"
  ],
  doneHiZh: ["休庭！本庭对你的表现表示满意。", "干净利落——书记员都看呆了。", "这个正确率，可以直接去 One Prime 庆祝。", "本庭裁定：今日复习，全部维持原判。"],
  doneHiEn: ["Court adjourned — and the bench is impressed.", "Clean work. The clerk is speechless.", "Affirmed on all counts."],
  doneMidZh: ["休庭。错的卡都会回来找你——这正是算法的用意。", "稳住，节奏比完美重要。", "今天的'重来'，是二月的'记得'。"],
  doneMidEn: ["Adjourned. The misses will be back — that's the algorithm working.", "Steady beats perfect.", "Today's 'Again' is February's 'Good.'"],
  doneLowZh: ["难的日子才涨功力。明天这些卡会温柔一点。", "Hadley 也是败诉方——照样名垂法史。", "本庭注意到你没有放弃。这很重要。"],
  doneLowEn: ["Hard days build the muscle. These cards will be gentler tomorrow.", "Hadley lost his case — and made legal history anyway.", "The court notes, approvingly, that you did not quit."],
  comebackZh: ["几日不见。卡片们想你了——先来一轮短的。", "回来就好。连续天数可以重建，记忆也是。"],
  comebackEn: ["The docket missed you. Start with a short round.", "Good to have you back. Streaks rebuild; so does memory."]
};
function personaLine(kind) {
  const zh = S.settings.lang === "zh";
  const bank = PERSONA[kind + (zh ? "Zh" : "En")] || PERSONA[kind + "Zh"];
  const seed = ymd().split("-").reduce((a, x) => a + parseInt(x, 10), 0);
  return bank[(seed + (kind === "greet" ? streak() : 0) + bank.length) % bank.length];
}
function greetLine() {
  /* comeback if 3+ idle days — but only for someone with actual history */
  const hasHistory = Object.values(S.days || {}).some(v => (v.r + v.n + v.q) > 0);
  let idle = 0;
  for (let i = 1; i <= 5; i++) { const v = S.days[ymd(now() - i * DAY)]; if (!v || !(v.r + v.n + v.q)) idle++; else break; }
  return personaLine(hasHistory && idle >= 3 ? "comeback" : "greet");
}

/* ---------------- typed-recall scoring (键入模式) ----------------
   The written bar is production, not recognition: graders award points for
   stating each rule ELEMENT. We score a typed answer by coverage of the model
   answer's load-bearing terms (fuzzy-matched for typos/stems), then suggest an
   FSRS grade the learner can override. Legally critical little words (not,
   must, may, only, unless…) are deliberately NOT stopwords.                  */
const TYPED_STOP = new Set(("the a an of to and or in for that with by be as on at it its is are was were this these those " +
  "there which who whom whose from into then than but when where after before during under over between both each any all " +
  "such other same more most also very can could would should will shall does do did done has have had having he she they " +
  "them their his her him we you your i s t d ll re ve about against because while what how why through per via due so out own").split(" "));
TYPED_STOP.delete("will");   // "will" is a noun of art in the Wills deck — must stay scoreable
function typedTokens(s) {
  /* len ≥2 keeps legal Latin (de novo, per se, ex parte); stopwords catch the junk.
     Hyphens are separators so "long-arm" credits "long arm" and vice versa. */
  return (String(s).toLowerCase().match(/[a-z][a-z']*|\d+(?:\.\d+)?/g) || [])
    .map(w => w.replace(/^'+|'+$/g, ""))
    .filter(w => w && !TYPED_STOP.has(w) && (w.length >= 2 || /^\d/.test(w)));
}
/* light derivational stemmer so "avail itself" credits "availment", "arises"≈"arise" */
function stemW(w) {
  const s = w.replace(/(ations|ation|ments|ment|tions|tion|ities|ity|ingly|ing|edly|ied|ed|ies|ily|ly|es|s|al)$/, "");
  return s.length >= 4 ? s : w;
}
function levLe(a, b, max) {                      // bounded Levenshtein: true if distance ≤ max
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}
function fuzzyEq(a, b) {
  if (a === b) return true;
  const sa = stemW(a), sb = stemW(b);
  if (sa === sb && sa.length >= 4) return true;  // availment/avail, arising/arise, contacts/contact
  const n = Math.max(a.length, b.length);
  if (n < 5) return false;                       // short words must otherwise match exactly
  return levLe(a, b, n >= 9 ? 2 : 1) || (sa.length >= 5 && sb.length >= 5 && levLe(sa, sb, 1));
}
function hasCJK(s) { return (String(s).match(/[一-鿿]/g) || []).length >= 2; }
function scoreTyped(model, input) {
  const uniq = [...new Set(typedTokens(model))];
  const ut = [...new Set(typedTokens(input))].slice(0, 150);   // paste-bomb guard
  if (!uniq.length) {                            // degenerate model — whole-string fuzzy fallback
    const a = String(model).toLowerCase().trim(), b = String(input).toLowerCase().trim();
    const ok = a === b || (a.length >= 5 && levLe(a, b, Math.ceil(a.length / 5)));
    return { pct: ok ? 1 : 0, tier: ok ? "sharp" : "wrong", sugg: ok ? 3 : 1, matched: ok ? new Set(typedTokens(model)) : new Set(), missedTop: [] };
  }
  let totalW = 0, hitW = 0;
  const matched = new Set(), missed = [];
  for (const w of uniq) {
    const wgt = /^\d/.test(w) ? 1.6 : w.length >= 8 ? 1.5 : 1;
    totalW += wgt;
    if (ut.some(u => fuzzyEq(u, w))) { hitW += wgt; matched.add(w); }
    else missed.push({ w, wgt });
  }
  const pct = totalW ? hitW / totalW : 0;
  missed.sort((x, y) => y.wgt - x.wgt || y.w.length - x.w.length);
  let tier, sugg;                                 // sugg = FSRS grade suggestion (Easy stays manual)
  if (pct >= 0.92) { tier = "sharp"; sugg = 3; }
  else if (pct >= 0.75) { tier = "good"; sugg = 3; }
  else if (pct >= 0.45) { tier = "pass"; sugg = 2; }
  else { tier = "wrong"; sugg = 1; }
  return { pct, tier, sugg, matched, missedTop: missed.slice(0, 8).map(m => m.w) };
}
/* rebuild the model answer with hits green / misses amber (escaping-safe) */
function highlightModel(model, matched) {
  let out = "", last = 0, m;
  const re = /[A-Za-z][A-Za-z']*|\d+(?:\.\d+)?/g;      // hyphen = separator, mirrors typedTokens
  while ((m = re.exec(model))) {
    out += esc(model.slice(last, m.index));
    const tok = m[0], lw = tok.toLowerCase().replace(/^'+|'+$/g, "");
    const scoreable = lw && !TYPED_STOP.has(lw) && (lw.length >= 2 || /^\d/.test(lw));
    if (!scoreable) out += esc(tok);                    // unscoreable tokens stay neutral, never "missed"
    else if (matched.has(lw)) out += `<mark class="hit">${esc(tok)}</mark>`;
    else out += `<mark class="miss">${esc(tok)}</mark>`;
    last = m.index + tok.length;
  }
  return out + esc(model.slice(last));
}

/* ---------------- haptics (Android; silently no-op elsewhere) ---------------- */
function buzz(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {} }

/* ---------------- 8. sound design (off by default) ---------------- */
let AC = null;
function sfx(kind) {
  if (!S.settings.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state !== "running") { AC.resume().catch(() => {}); return; }   // don't queue tones outside a gesture (iOS)
    const t = AC.currentTime;
    const g = AC.createGain(); g.connect(AC.destination);
    if (kind === "flip") {
      const buf = AC.createBuffer(1, AC.sampleRate * 0.06, AC.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
      const src = AC.createBufferSource(); src.buffer = buf;
      const f = AC.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1400;
      src.connect(f); f.connect(g); g.gain.setValueAtTime(0.18, t);
      src.start(t);
    } else if (kind === "gavel") {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(96, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.11);
      o.connect(g); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.24);
      const buf = AC.createBuffer(1, AC.sampleRate * 0.03, AC.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = AC.createBufferSource(); src.buffer = buf;
      const g2 = AC.createGain(); g2.gain.value = 0.22; src.connect(g2); g2.connect(AC.destination);
      src.start(t);
    } else if (kind === "stamp") {
      const o = AC.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
      o.connect(g); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    } else if (kind === "chime") {
      [659.3, 880].forEach((hz, i) => {
        const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = hz;
        const gg = AC.createGain(); o.connect(gg); gg.connect(AC.destination);
        gg.gain.setValueAtTime(0.0001, t + i * 0.12);
        gg.gain.exponentialRampToValueAtTime(0.22, t + i * 0.12 + 0.02);
        gg.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.5);
        o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.55);
      });
    } else if (kind === "right") {
      /* bright, brief two-note major blip — satisfying, not game-show */
      [[880, 0], [1174.7, 0.075]].forEach(([hz, dt]) => {
        const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = hz;
        const gg = AC.createGain(); o.connect(gg); gg.connect(AC.destination);
        gg.gain.setValueAtTime(0.0001, t + dt);
        gg.gain.exponentialRampToValueAtTime(0.17, t + dt + 0.015);
        gg.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.16);
        o.start(t + dt); o.stop(t + dt + 0.18);
      });
    } else if (kind === "wrong") {
      /* soft low descending thud — informative, never punishing */
      const o = AC.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.16);
      o.connect(g); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.24);
    } else if (kind === "tick") {
      /* tiny self-graded "got it" tick */
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = 1320;
      o.connect(g); g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.start(t); o.stop(t + 0.06);
    }
  } catch (_) {}
}
