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
/* certification trial: same stratified topic walk, up to TRIAL_N questions.
   Small decks (remedies/trusts: 14 MCQs) just use the whole pool — the pass
   bar stays a ratio, so every subject is certifiable. */
const TRIAL_N = 20, TRIAL_PASS = 0.85;
function buildTrial(subj) {
  const byTopic = {};
  for (const c of DECK[subj].cards) {
    if (c.type !== "mcq" || isSusp(c.id)) continue;
    (byTopic[c.topic] = byTopic[c.topic] || []).push(c.id);
  }
  const groups = Object.values(byTopic);
  groups.forEach(shuffleArr);
  const ids = [];
  let i = 0;
  while (ids.length < TRIAL_N && groups.some(g => g.length)) {
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

/* ---------------- hardest cards (lapse-ranked leeches) ----------------
   Real forgetting only: ranked by lapses recorded at grading time, low
   stability breaking ties. A diagnostic or triage can't put a card here. */
function hardestList(minLapses = 2) {
  const out = [];
  for (const [id, st] of Object.entries(S.cards)) {
    if (!CARD[id] || st.susp || (st.lapses || 0) < minLapses || !st.reps) continue;
    out.push({ id, lapses: st.lapses, s: st.s || 0 });
  }
  out.sort((a, b) => b.lapses - a.lapses || a.s - b.s);
  return out;
}

/* ---------------- essay issue triggers (论述题触发词) ----------------
   Half of essay scoring is recognizing which issues the facts raise. Cues are
   bilingual for reading speed; issues stay in English — the exam is written in
   English and these strings are what Ron should be able to produce. Stable
   doctrine only; law current through the July 2026 sweep. */
const ESSAY_TRIGGERS = [
  { s: "profresp", items: [
    { c: "Any fee arrangement appears", z: "出现任何收费安排", i: "Fees: CA writing required >$1k; contingency writings + terms; CA 'unconscionable' vs ABA 'unreasonable'; fee splitting needs client consent (CA: no proportionality requirement); referral fees" },
    { c: "Lawyer holds client money or property", z: "律师保管客户钱款或财物", i: "Client trust account: no commingling; prompt notice + delivery; disputed portion stays in trust; records" },
    { c: "Two current clients, interests may collide", z: "两个现有客户利益可能冲突", i: "Current-client conflict: directly adverse / significant risk; informed WRITTEN consent (CA requires it even for potential conflicts); reasonable-belief screen; organization as the client" },
    { c: "Old client's matter resurfaces against them", z: "昔日客户的案件反过来找上门", i: "Former-client conflict: substantial relationship test; confidential info presumption; imputation + ethical screens; government lawyer rules" },
    { c: "Client reveals plan to harm or defraud", z: "客户透露将要伤人或欺诈", i: "Confidentiality exceptions: ABA 1.6(b) list vs CA's SINGLE exception (death/substantial bodily harm, + B&P 6068(e) counsel-first steps) — CA has NO financial-fraud disclosure; flag the split" },
    { c: "Client insists on lying or fake evidence", z: "客户坚持作伪证或使用假证据", i: "Candor 3.3: remonstrate → seek withdrawal → disclose (ABA); CA criminal defendant: narrative approach; physical evidence of crime: may examine, must not conceal/destroy; turn over instrumentalities" },
    { c: "Lawyer contacts the other side or witnesses", z: "律师接触对方当事人或证人", i: "No-contact rule (represented persons, org employees); unrepresented persons: no advice except to get counsel; inadvertent documents; trial publicity" },
    { c: "Lawyer's own interests enter the deal", z: "律师自身利益卷入交易", i: "Business transaction with client: fair terms + written disclosure + advised to seek independent counsel + written consent; no substantial gifts (drafting); media rights; CA sexual relations rule" },
    { c: "Missed deadlines, botched work", z: "错过期限、办砸案件", i: "Competence (CA: intentional/reckless/repeated/gross negligence standard), diligence, communication; discipline vs malpractice distinction" },
    { c: "Lawyer wants out of the case", z: "律师想退出代理", i: "Withdrawal: mandatory (violation, discharge) vs permissive grounds; court permission; protect client — notice, papers (CA: must release entire file), unearned fees" },
    { c: "Getting clients: ads, letters, live pitches", z: "招揽客户：广告、信函、当面推销", i: "Advertising 7.1-7.2 (no false/misleading, labeling) vs solicitation 7.3 (live person-to-person for money barred; CA overlays: vulnerable-state ban, 'Advertisement' label, runners/cappers crime, 7.3(f) DVRO pre-service ban)" },
    { c: "Junior lawyer told to cut corners; misconduct seen", z: "上级要求走捷径；目睹同行违规", i: "Supervisory/subordinate duties 5.1-5.3; 'clear' ethical duty not excused by orders; reporting misconduct: ABA 8.3 vs CA rule 8.3 (2023 — report reasonable knowledge of credible evidence of serious violations)" },
  ]},
  { s: "commprop", items: [
    { c: "ALWAYS open with the general presumptions", z: "开头永远先写总推定", i: "CA is a community property state: property acquired during marriage by labor = CP; before marriage / by gift, bequest, devise, descent = SP; earnings after separation = SP; characterize each asset via source + tracing + presumptions + agreements" },
    { c: "Couple moved to California with property", z: "夫妻携财产迁入加州", i: "Quasi-CP: would have been CP if acquired in CA; treated as CP at divorce/death (acquiring spouse's death: survivor gets ½)" },
    { c: "Title changed form or sits in one name", z: "产权变更形式或登记在一方名下", i: "Transmutation: post-1985 needs express written declaration by adversely affected spouse (gifts of insubstantial personal items excepted); form of title ≠ transmutation; at divorce, joint-title = CP with §2640 SP-contribution reimbursement" },
    { c: "SP business grew during the marriage", z: "婚前个人企业婚内增值", i: "Pereira (personal skill drives growth: SP gets fair return, rest CP) vs Van Camp (market/capital drives: CP gets fair salary − family expenses, rest SP); court picks whichever achieves substantial justice" },
    { c: "House bought before marriage, mortgage paid with CP", z: "婚前购房、婚内共同财产还贷", i: "Moore/Marsden: CP gets pro-tanto ownership share = principal reduction + proportionate appreciation; improvements to SP with CP funds → reimbursement" },
    { c: "One bank account, everything mixed", z: "一个账户、存款混同", i: "Commingling: burden on SP proponent; exhaustion method (family expenses presumed paid from CP first) or direct tracing; recitals insufficient" },
    { c: "Pension, stock options, injury award, degree, goodwill", z: "养老金、期权、人身赔偿、学位、商誉", i: "Special assets: pensions — time rule; options — Hug/Nelson formulas; personal injury — CP if cause of action during marriage but awarded to injured spouse at divorce (absent offset); education — SP + §2641 reimbursement for CP contributions; professional goodwill = divisible CP" },
    { c: "Spouse sold or gave away property alone", z: "一方擅自出售或赠与财产", i: "Equal management; gifts of CP without written consent: void in life (recover ½ after death); real property: both must join (1-year voidability for BFP transfers); fiduciary duty between spouses (presumption of undue influence on advantaged transactions)" },
    { c: "Creditor comes after the couple", z: "债权人追索夫妻财产", i: "CP liable for either spouse's pre- and during-marriage debts; SP liable only for own debts + necessaries; earnings shield for premarital debts (separate account); tort debt order depends on activity for community benefit; reimbursement rights" },
    { c: "Prenup or side agreement", z: "婚前协议或婚内约定", i: "Premarital agreement: writing + signed; voluntariness (independent counsel or informed waiver, 7-day rule, no duress); spousal-support limits need independent counsel + not unconscionable at enforcement; child support can't be waived" },
    { c: "Death, not divorce", z: "以死亡而非离婚收场", i: "At death: decedent disposes of ½ CP + all SP by will; survivor owns other ½; widow's election if will tries to give away survivor's half; quasi-CP protections; putative spouse (good-faith belief) gets quasi-marital property; Marvin contract claims for unmarried partners" },
    { c: "When did the marriage really end?", z: "婚姻究竟何时结束？", i: "Date of separation (§70): complete and final break — intent to end + conduct consistent; post-separation earnings SP; living apart not required/decisive" },
  ]},
  { s: "remedies", items: [
    { c: "Money damages requested", z: "请求金钱赔偿", i: "Compensatory: contract expectation vs tort make-whole; certainty, foreseeability (Hadley), causation, unavoidability (mitigation); nominal; punitive (tort only, ratio limits)" },
    { c: "Money won't do / the thing is unique", z: "金钱难以弥补／标的物独一无二", i: "Specific performance: valid K + definite terms + all conditions satisfied + inadequate legal remedy (land presumed unique; UCC 2-716) + mutuality of remedy + feasibility of enforcement + no defenses (laches, unclean hands, BFP)" },
    { c: "Stop them before/at trial", z: "要求立即制止对方行为", i: "Injunctions: TRO (ex parte possible, short) → preliminary (likely success + irreparable harm + balance of hardships + public interest; bond) → permanent (four-factor); enforcement by contempt (civil vs criminal)" },
    { c: "Defendant profited from the wrong", z: "被告因不当行为获利", i: "Restitution/unjust enrichment: benefit conferred + unjust to retain; quasi-contract at law; disgorgement of profits; waiver of tort" },
    { c: "Trace the money into new assets / D insolvent", z: "钱款流入新资产／被告破产", i: "Constructive trust (title to traceable RES + captures appreciation) vs equitable lien (security interest on improved/commingled asset; deficiency judgment possible); both defeat unsecured creditors, lose to BFP; lowest intermediate balance for commingled accounts" },
    { c: "Deal infected by mistake, fraud, duress", z: "交易因错误、欺诈、胁迫而成立", i: "Rescission (avoid K, restore status quo; grounds: fraud, material mistake, duress, undue influence, failure of consideration) vs reformation (writing ≠ actual agreement: mutual mistake or unilateral + fraud/inequitable conduct); election of remedies; defenses" },
    { c: "Contract sets its own damages number", z: "合同自带违约金条款", i: "Liquidated damages valid if damages difficult to estimate at formation + reasonable forecast; penalty unenforceable; CA: consumer/residential default rules stricter" },
    { c: "Ongoing trespass or nuisance", z: "持续侵入或滋扰", i: "Damages vs injunction balancing (relative hardship; Boomer permanent damages); ejectment for possession; self-help limits" },
    { c: "Personal-services promise broken", z: "人身服务合同被违反", i: "No specific performance (involuntary servitude / supervision); negative injunction against competing (Lumley) if unique services + express/implied negative covenant; CA: employee non-competes VOID (B&P 16600) — injunction against working for a rival generally unavailable" },
    { c: "Equity-specific defenses raised", z: "衡平法上的抗辩", i: "Laches (unreasonable delay + prejudice), unclean hands (misconduct in same transaction), estoppel, hardship/balance, freedom of speech limits on injunctions (prior restraint)" },
  ]},
  { s: "busassoc", items: [
    { c: "Someone signs or deals 'for' someone else", z: "有人'代表'他人签约交易", i: "Agency: actual (express/implied) vs apparent authority (principal's manifestations to third party), ratification; undisclosed/partially disclosed principal — agent also liable; agent fiduciary duties" },
    { c: "Two people run a venture, no filings", z: "二人合伙经营、未作登记", i: "General partnership by conduct: profit-sharing presumption; every partner an agent — apparent authority for ordinary course; joint & several liability; partnership by estoppel" },
    { c: "Partner quits, dies, or is squeezed", z: "合伙人退出、死亡或被排挤", i: "Dissociation vs dissolution; wrongful dissociation damages; winding up vs buyout; lingering apparent authority + notice; fiduciary duties among partners (Meinhard candor)" },
    { c: "Board decides quickly, no diligence", z: "董事会仓促决策、未尽调查", i: "Duty of care: informed, good-faith decision; business judgment rule presumption; gross-negligence process review (Van Gorkom); exculpation clauses cover care, never loyalty/bad faith; oversight duty (Caremark)" },
    { c: "Director/officer on both sides or takes the deal", z: "董监高自我交易或攫取机会", i: "Duty of loyalty: interested-director transaction — cleanse by informed disinterested directors OR shareholders OR entire fairness; corporate opportunity doctrine (line of business/interest-expectancy; capacity to take); no BJR shield" },
    { c: "Controlling shareholder deals with the company", z: "控股股东与公司交易", i: "Controller fiduciary duties to minority; freeze-out/parent-subsidiary merger → entire fairness (fair dealing + fair price) unless MFW-style dual protections; sale of control + looting" },
    { c: "Shareholder sues over company's injury", z: "股东就公司所受损害起诉", i: "Derivative vs direct; contemporaneous ownership; demand on board or futility; special litigation committee; recovery to corporation; inspection rights for proper purpose" },
    { c: "Trades on nonpublic information", z: "利用未公开信息交易", i: "10b-5: material misstatement/omission + scienter + reliance (fraud-on-the-market) + purchase/sale + loss causation; insider trading — classical (insiders, constructive insiders) vs misappropriation; tipper personal benefit (Dirks) + tippee knowledge; §16(b) short-swing strict disgorgement (10% owners, D&Os)" },
    { c: "Shell company, unpaid creditors", z: "空壳公司、债权人求偿无门", i: "Piercing the veil: unity of interest (alter ego, commingling, no formalities) + injustice/undercapitalization; contract vs tort claimants; enterprise liability" },
    { c: "Contracts made before incorporation", z: "公司成立前签订的合同", i: "Promoter liable until novation; corporation liable on adoption; de facto corporation + corporation by estoppel (good-faith attempt)" },
    { c: "Merger, big asset sale, charter change", z: "并购、重大资产出售、章程变更", i: "Fundamental changes: board resolution + shareholder vote; dissenters' appraisal rights; short-form mergers; de facto merger doctrine; successor liability" },
    { c: "LLC members fall out", z: "有限责任公司成员内讧", i: "LLC: operating agreement controls; default fiduciary duties (care/loyalty, good faith); member vs manager managed authority; charging orders; veil piercing applies" },
  ]},
  { s: "wills", items: [
    { c: "No will (or will fails)", z: "没有遗嘱（或遗嘱无效）", i: "CA intestacy: surviving spouse takes ALL CP + SP share (all if no issue/parents/siblings; ½ with one child or parents/siblings' issue; ⅓ with 2+ children); issue take by modern per stirpes (§240); 120-hour survival for intestacy; advancement needs a writing" },
    { c: "Will signed — but something was off", z: "遗嘱签了——但程序有瑕疵", i: "Attested will: writing, signed by testator (or at direction), two witnesses present at same time seeing signing/acknowledgment who understand it's a will; CA harmless error §6110(c)(2): clear and convincing evidence of testamentary intent cures witnessing defects; interested witness → presumption of undue influence (not invalidity)" },
    { c: "Handwritten document disposing of property", z: "手写的财产处分文件", i: "Holographic will: signature + MATERIAL PROVISIONS in testator's handwriting; no witnesses needed; testamentary intent (extrinsic evidence + printed form words OK); undated holographs lose to inconsistent wills" },
    { c: "New will, codicil, tearing, divorce", z: "新遗嘱、修改附录、撕毁、离婚", i: "Revocation: by instrument (express/inconsistent), by physical act (act + intent; duplicates; presumption from lost will last in testator's possession), by operation of law (divorce revokes gifts/fiduciary roles + nonprobate §5040); DRR conditional revocation; revival rules" },
    { c: "Will points to outside papers or future acts", z: "遗嘱指向外部文件或未来行为", i: "Integration; incorporation by reference (existing writing, intent, identification); acts of independent significance; CA §6132 tangible-personalty list (≤$5k/item, $25k total); pour-over to trust (UTATA)" },
    { c: "Gifted property sold, changed, or mortgaged", z: "遗赠财产被出售、变形或抵押", i: "Ademption by extinction (CA: intent-tested, tracing to proceeds in some cases — conservator sales, unpaid insurance); ademption by satisfaction (writing); abatement order; no exoneration in CA (liens pass with gift); securities accessions (splits yes)" },
    { c: "Beneficiary died before testator", z: "受益人先于立遗嘱人死亡", i: "Lapse; CA anti-lapse: saves gifts to KINDRED of testator (or of current/former spouse) → issue take, unless contrary intention; class gifts (survivors split; anti-lapse still applies to dead kindred member); simultaneous death (120-hour for intestacy, clear-and-convincing for wills)" },
    { c: "Weak, confused, or pressured testator", z: "立遗嘱人虚弱、糊涂或受操控", i: "Capacity (18+, understand nature/property/relations); insane delusion causation; undue influence — common law factors + CA statutory presumption (§21380: drafter, care custodian, fiduciary transcriber); fraud (execution/inducement); remedy: constructive trust; no-contest clauses enforced only for direct contests without probable cause" },
    { c: "Spouse or child missing from the will", z: "配偶或子女未列入遗嘱", i: "Omitted spouse/child (marriage/birth AFTER execution): statutory share (intestate share, capped ½ SP for spouse) unless intentional omission on face, other provision, or (spouse) valid waiver; testator can only dispose of ½ CP" },
    { c: "Assets passing outside the will", z: "遗嘱之外传递的财产", i: "Nonprobate: revocable inter vivos trusts, POD/TOD accounts + CA revocable TOD deed, joint tenancy, life insurance; will can't override beneficiary designations; creditors and elective mechanics" },
    { c: "Who actually inherits: kids, adoptees, half-bloods", z: "谁有继承资格：养子女、半血缘、非婚生", i: "Parent-child: adoption (severs natural except stepparent adoption), equitable adoption, halfbloods equal, posthumous children; killers barred (slayer rule); disclaimer relates back" },
  ]},
  { s: "trusts", items: [
    { c: "Property set aside for another to manage", z: "财产交由他人为受益人管理", i: "Express trust: intent (precatory words insufficient), trust res, ascertainable beneficiaries, proper purpose; trustee never fails for want of trustee; delivery for inter vivos; writing for land (SoF)" },
    { c: "Trust for vague 'friends' or a purpose", z: "为'朋友们'或某种目的设立信托", i: "Ascertainable beneficiaries required (friends too indefinite; class OK); exceptions: charitable trusts (indefinite fine), honorary/purpose trusts (pets, graves — CA statutory pet trusts); unenforceable purpose → resulting trust" },
    { c: "Beneficiary's creditors circle", z: "受益人的债权人环伺", i: "Spendthrift protection; exceptions: child/spousal support, government claims, (CA) stations-in-life limits; discretionary vs mandatory distributions; settlor's own creditors ALWAYS reach revocable trust + self-settled spendthrift void" },
    { c: "Settlor wants changes / beneficiaries want out", z: "委托人想改；受益人想终止", i: "CA default: trusts REVOCABLE unless stated irrevocable (flip of common law); modification/termination: settlor+all beneficiaries; beneficiaries alone need Claflin material-purpose test; equitable deviation for unanticipated circumstances; trust decanting" },
    { c: "Trustee invests, sells, hires, favors one side", z: "受托人投资、出售、雇人、偏袒一方", i: "Duties: loyalty (self-dealing = no-further-inquiry, per se breach), prudent investor (portfolio theory, diversify, delegate investment prudently), impartiality income/principal, earmark/segregate, inform & account; remedies: surcharge, tracing, constructive trust, removal; exculpation can't cover bad faith" },
    { c: "Trust assets sold to trustee's cousin / BFP", z: "信托财产流向关联方或善意购买人", i: "Third-party liability: BFP for value without notice cuts off beneficiaries; knowing participants take subject to trust; tracing into products" },
    { c: "Charity trust can't do what it said", z: "慈善信托目的落空", i: "Charitable trusts: charitable purpose, indefinite beneficiaries, no RAP; cy pres (general charitable intent → near-as-possible); Attorney General enforcement" },
    { c: "Who takes when interests are unclear", z: "利益归属不明", i: "Resulting trust (purchase-money, failed trust) back to settlor; constructive trust as fraud remedy; semi-secret vs secret trusts" },
    { c: "Power to appoint property among people", z: "指定财产归属的权力", i: "Powers of appointment: general vs special; exercise by residuary clause (CA: general power only if instrument shows intent); creditors reach exercised general powers; takers in default" },
    { c: "Income beneficiary vs remainderman fight", z: "收益受益人与剩余权人之争", i: "Principal & income allocation; trustee power to adjust for impartiality; unitrust conversion" },
  ]},
  { s: "civpro", items: [
    { c: "Out-of-state defendant objects to the court", z: "州外被告抗辩'不该在这告我'", i: "PJ: traditional bases (presence/tag — Burnham, domicile, consent) → long-arm → minimum contacts (purposeful availment; arise out of/RELATE TO — Ford) → fair play factors; general jurisdiction: at home (Daimler); waiver by litigation conduct" },
    { c: "Which court system: state or federal?", z: "该進州法院还是联邦法院？", i: "SMJ: diversity (complete diversity at filing; >$75k good-faith; domicile; corporation dual citizenship — nerve center); federal question (well-pleaded complaint); supplemental §1367 (same case/controversy; 1367(b) carve-outs in diversity); never waivable" },
    { c: "Defendant wants OUT of plaintiff's forum", z: "被告想换战场", i: "Removal (all defendants join, 30 days, no in-state defendant for diversity, 1-year diversity limit) + remand; transfer §1404 (convenience, valid original venue) vs §1406 (cure); forum non conveniens (adequate alternative forum, private/public factors); forum-selection clauses via §1404 (Atlantic Marine)" },
    { c: "Diversity case: whose law on this issue?", z: "异籍案件适用谁的法？", i: "Erie: FRCP/statute on point + valid (REA: arguably procedural, no substantive right abridged) → federal wins (Hanna; Berk v. Choy 2026 — state affidavit-of-merit rules yield to Rule 8); no federal rule → outcome-determinative in light of twin aims (forum shopping, inequitable administration) + byrd interests; SoL, tolling, choice of law = state" },
    { c: "Service, notice, or default problems", z: "送达、通知或缺席判决问题", i: "Service Rule 4 (methods, state-law borrow, waiver); constitutional notice (Mullane reasonably calculated); default + set-aside (good cause / 60(b)); CA: substituted service diligence" },
    { c: "Complaint attacked at the door", z: "起诉状开局被攻击", i: "12(b) defenses (waivable 2-5 in first response); Twombly/Iqbal plausibility; amendments + relation back (same T/O; new party: mistake + notice within 90 days); Rule 11 sanctions (safe harbor)" },
    { c: "More parties, more claims, insurers, funds", z: "多方当事人、多项请求", i: "Joinder: 18/20; compulsory vs permissive counterclaims; crossclaims; impleader 14; required parties 19 (feasible? indispensable?); intervention 24; interpleader (statutory vs rule); class 23 (numerosity/commonality/typicality/adequacy + 23(b) type; predominance; CAFA)" },
    { c: "Discovery fights and destroyed evidence", z: "证据开示之争与证据灭失", i: "Scope: relevant + proportional, not privileged; work product (substantial need/undue hardship for ordinary; opinion nearly absolute); experts; protective orders; 37 sanctions ladder; ESI spoliation 37(e) intent for adverse inference; initial disclosures" },
    { c: "Case ends without a jury verdict", z: "案件未经陪审团即告终结", i: "12(b)(6)/12(c); summary judgment 56 (no genuine dispute of material fact; movant burdens — Celotex); JMOL (close of opponent's evidence) + renewed JMOL (must have moved first); new trial 59; relief from judgment 60(b)" },
    { c: "Jury demanded; legal + equitable mix", z: "要求陪审团；法律与衡平请求并存", i: "7th Am (federal): historical test; legal claims tried FIRST to jury (Beacon Theatres); demand within 14 days; jury selection/challenges; CA: no 7th Am incorporation — state constitutional right differs" },
    { c: "Second lawsuit smells like the first", z: "第二起诉讼似曾相识", i: "Claim preclusion (same claim — T/O test vs CA PRIMARY RIGHTS; final, on the merits, same parties/privies); issue preclusion (actually litigated + decided, essential, full & fair opportunity); nonmutual offensive (Parklane fairness); interjurisdictional preclusion (rendering court's law)" },
    { c: "Appeal timing and what's appealable", z: "上诉时机与可上诉性", i: "Final judgment rule §1291; exceptions: collateral order, 54(b) certification, §1292 injunctions/certified questions, class-cert 23(f), mandamus; standards of review (de novo / clear error / abuse of discretion); CA: writ practice" },
  ]},
  { s: "conlaw", items: [
    { c: "Plaintiff sues government — can the court hear it?", z: "起诉政府——法院能否受理", i: "Justiciability FIRST: standing (injury in fact, causation, redressability; no generalized grievances; organizational/third-party limits), ripeness, mootness (capable of repetition; voluntary cessation), political question (Baker; Rucho partisan gerrymanders); 11th Am + Ex parte Young; state action requirement" },
    { c: "Congress passes a sweeping law", z: "国会通过一部大手笔立法", i: "Enumerated powers: commerce (channels/instrumentalities/substantial effects; aggregation limits — noneconomic Lopez/Morrison; no inactivity mandates NFIB); tax (some revenue) + spend (conditions: unambiguous, related, not coercive — Dole/NFIB); §5 congruence & proportionality; necessary & proper; no commandeering (Printz/Murphy)" },
    { c: "President acts alone / officials fired", z: "总统单独行动／官员被免职", i: "Youngstown zones; appointment (principal vs inferior) and removal — at-will removal now the rule, Humphrey's Executor OVERRULED (Trump v. Slaughter 2026; Fed carve-out suggested); executive privilege/immunity (Trump v. US 2024); major questions doctrine (WV v. EPA; Learning Resources 2026 — tariffs); pardons; foreign affairs" },
    { c: "State law touches interstate commerce or outsiders", z: "州法波及州际贸易或外州人", i: "Dormant commerce: discrimination (virtually per se invalid; exceptions: quarantine, market participant, traditional government function) vs Pike undue-burden balancing; Art. IV P&I (fundamental rights/livelihood, no corporations); preemption (express — read the clause; field; conflict/obstacle)" },
    { c: "Government treats classes of people differently", z: "政府对不同群体区别对待", i: "EP: classification → tier: race/national origin/alienage = strict (racial gerrymandering — Shaw/Callais 2026; affirmative action — SFFA); sex = intermediate+ (exceedingly persuasive); rational basis + animus (Cleburne/Romer); fundamental-rights strand (voting, travel, access to courts)" },
    { c: "Liberty or property taken by procedure-less action", z: "未经程序剥夺自由或财产", i: "Procedural DP: protected interest (entitlement)? what process due (Mathews: private interest, error risk, government burden)? neutral decisionmaker; post- vs pre-deprivation" },
    { c: "Deeply personal choices regulated", z: "规制高度私人的生活选择", i: "SDP: fundamental rights (marriage, family living, child-rearing, contraception, travel) → strict scrutiny via Glucksberg history test; abortion → rational basis post-Dobbs; incorporation doctrine; the Barbara (2026) birthright-citizenship rule for Citizenship Clause questions" },
    { c: "Speech restricted, speaker punished, permit denied", z: "限制言论、处罚表达、拒发许可", i: "Speech: content-based (strict; viewpoint worst — includes professional/talk-therapy speech, Chiles 2026) vs content-neutral TPM (narrow tailoring + open channels); forum doctrine; unprotected categories (incitement, true threats, obscenity, fighting words); overbreadth, vagueness, prior restraint; commercial speech (Central Hudson); campaign finance: party coordinated-expenditure limits struck (2026); compelled speech; public employees (Pickering/Garcetti)" },
    { c: "Religion helped or burdened", z: "宗教受助或受限", i: "Free exercise: neutral + generally applicable (Smith) → rational basis, but exceptions/comparators trigger strict (Tandon/Fulton); ministerial exception; Establishment: history & tradition (Kennedy), no coercion; funding: can't exclude religious schools from generally available benefits (Carson)" },
    { c: "Property taken, regulated to death, or conditioned", z: "财产被征收、管制殆尽或附条件", i: "Takings: physical/per se (incl. Cedar Point access); regulatory — total wipeout (Lucas) or Penn Central factors; exactions (Nollan/Dolan nexus + rough proportionality); just compensation; public use (Kelo)" },
    { c: "Guns restricted", z: "枪支管制", i: "2A: plain text covers conduct → presumptively protected; government must show consistency with historical tradition (Bruen), relevantly similar analogues (Rahimi); 2026: private-property-open-to-public default carry ban struck (Wolford); §922(g)(3) as-applied limits (Hemani)" },
    { c: "Retroactive laws, contracts impaired, bills of attainder", z: "溯及立法、合同受损、剥夺公权法案", i: "Contracts Clause (substantial impairment → reasonable & necessary for public purpose; stricter for state's own contracts); ex post facto (criminal); bills of attainder; due-process retroactivity" },
  ]},
  { s: "evidence", items: [
    { c: "ANY out-of-court statement offered", z: "任何庭外陈述被提出", i: "Hearsay ladder: (1) statement? (2) offered for truth? (not-for-truth: effect on listener, verbal acts, state of mind shown) (3) 801(d) exemptions — party-opponent (+ vicarious), prior statements of testifying witness (801(d)(1)(A) amended eff. Dec 1 2026: ANY prior inconsistent statement substantive) (4) exceptions by availability (5) CEC structural differences + 1235-1238" },
    { c: "Criminal trial + absent declarant's statement", z: "刑事庭审＋未到庭陈述人", i: "Confrontation overlay: testimonial? (primary purpose; ongoing emergency nontestimonial — Davis/Bryant); forensic reports/substitute analysts (Melendez-Diaz, Smith v. Arizona); forfeiture by wrongdoing (intent to silence); Bruton limited-admissibility problem" },
    { c: "Defendant's past crimes or bad acts offered", z: "提出被告的前科劣迹", i: "Character 404(a) bans propensity (criminal D may open the door — pertinent trait; V's character; homicide-victim exception); 404(b) MIMIC non-propensity routes + notice; habit 406; 403/352 balancing ALWAYS; CA criminal: raise Prop 8 (relevant evidence admissible, subject to 352 + surviving statutory rules) in every essay" },
    { c: "Sexual assault / domestic violence case", z: "性侵或家暴案件", i: "Propensity exceptions: FRE 413-415; CEC 1108 (sex offenses), 1109 (DV/elder/child abuse) — subject to 352; rape shield (victim's behavior; exceptions differ civil/criminal)" },
    { c: "Repairs, settlements, medical payments, pleas, insurance", z: "事后维修、和解、垫付医药费、认罪磋商、保险", i: "Policy exclusions: 407 subsequent measures (CA 1151 — but CA allows in strict products liability), 408 compromise (CA: also excludes for impeachment via mediation confidentiality), 409 medical payments (CA 1152 broader — admissions during offer covered), 410 pleas, 411 insurance; permitted purposes (bias, ownership, feasibility)" },
    { c: "Expert takes the stand", z: "专家证人出庭", i: "Qualification; helpfulness; sufficient facts/data — may rely on inadmissible if reasonably relied upon, but disclosure limits (703; CA Sanchez: case-specific hearsay barred); reliability: Daubert/702 (incl. 2023 amendments) vs CA Sargon + Kelly for novel science; ultimate issue limits (704(b) mental state)" },
    { c: "Witness attacked or shored up", z: "攻击或修复证人", i: "Impeachment: PIS (613 foundation; substantive use — see amended 801(d)(1)(A); CEC 770/1235), bias (always), sensory/capacity, convictions (609 balance; CA Prop 8: felonies + moral-turpitude crimes incl. conduct), specific untruthful acts (608(b) no extrinsic; CA criminal via Prop 8), contradiction; rehabilitation: 801(d)(1)(B) prior consistent (pre-motive), character for truthfulness after attack" },
    { c: "A document, photo, or recording is offered", z: "提出文件、照片或录音", i: "Authentication (witness, handwriting, circumstantial, distinctive characteristics; self-authenticating incl. certified ESI 902(13)-(14)); best evidence rule when contents at issue (originals, duplicates; CA 'secondary evidence rule'); summaries 1006; completeness 106" },
    { c: "Doctor, lawyer, spouse, priest heard it", z: "医生、律师、配偶、神父听到了", i: "Privileges: ACP (legal advice purpose; corporate — Upjohn; crime-fraud; waiver incl. inadvertent 502), work product; psychotherapist; spousal testimonial (criminal, witness holds) vs marital communications (both hold, survives divorce); CA extras: physician-patient (no federal), counselor-victim; clergy" },
    { c: "Judge lets in borderline or half-admissible proof", z: "边缘证据或'半可采'证据", i: "Relevance 401 low bar; 403 (CA 352) unfair prejudice/confusion/waste; limited admissibility + instructions; conditional relevance 104(b); judicial notice (adjudicative facts; CA mandatory categories); presumptions (Thayer bursting bubble vs CA shifting by policy); burdens" },
    { c: "Declarant unavailable", z: "陈述人无法到庭", i: "Unavailability-required exceptions: former testimony (opportunity + similar motive; CA broader in civil), dying declaration (homicide/civil; CA: any case, must actually die? — CA: all criminal+civil, belief of imminent death), statement against interest (against penal interest needs corroboration; collateral statements trimmed), forfeiture" },
    { c: "Fresh outburst, diary, medical visit, business file", z: "现场惊呼、日记、就诊、业务档案", i: "Availability-immaterial exceptions: present sense impression (CA: contemporaneous-conduct narrower), excited utterance (1240), then-existing state of mind (Hillmon forward-looking), medical diagnosis/treatment (CA narrower: minors' abuse), recorded recollection, business records (regular practice, knowledge; opinions/diagnoses — CA stricter), public records (police reports vs criminal defendant), absence of entry" },
  ]},
  { s: "contracts", items: [
    { c: "What law governs — goods or services?", z: "先定适用法：货物还是服务", i: "UCC Art. 2 for goods (predominant-purpose for hybrids); merchants get special rules (2-201, 2-205 firm offers, 2-207); common law otherwise — SAY THIS FIRST in every contracts essay" },
    { c: "Ad, catalog, quote, auction, reward", z: "广告、报价单、拍卖、悬赏", i: "Offer: intent + definite terms + communicated; ads generally invitations (exception: specific + 'first come'); rewards = unilateral offers; auctions with/without reserve; UCC quantity essential (output/requirements OK)" },
    { c: "Reply adds or changes terms; forms fly", z: "回复加改条款；格式合同互掷", i: "Common law mirror image + last shot vs UCC 2-207: definite acceptance despite additional terms; between merchants additional terms IN unless offer limits, material alteration, objection; different terms — knockout; conduct-based contract (2-207(3))" },
    { c: "Promise looks one-sided or after the fact", z: "承诺显得单方或事后作出", i: "Consideration: bargained-for exchange; past consideration void (exception: material benefit + subsequent promise); illusory promises (satisfaction/requirements saved by good faith); pre-existing duty (CL) vs UCC good-faith modification (no consideration needed); promissory estoppel fallback; option contracts (UCC firm offer: merchant + signed writing, ≤3 months no consideration)" },
    { c: "Oral deal for land, year+, goods ≥$500, suretyship", z: "口头约定：土地、一年以上、货物≥500美元、保证", i: "Statute of frauds: within it? satisfied (writing + signature; UCC: quantity; merchant confirmation 2-201(2))? exceptions: part performance (land), full performance (services), specially manufactured, judicial admission, promissory estoppel; main-purpose rule (suretyship)" },
    { c: "Signed writing vs earlier promises", z: "签署文本与先前口头承诺打架", i: "Parol evidence rule: integration (merger clause weight); complete vs partial; ALWAYS admissible: formation defects/fraud (CA Riverisland: fraud exception broad, even contradicting terms), conditions precedent, interpretation of ambiguity (CA liberal — PG&E), consistent additional terms (partial), course of dealing/usage/performance (UCC hierarchy)" },
    { c: "'Subject to,' 'on condition that,' cooperation blocked", z: "'以……为条件'；一方阻挠条件成就", i: "Conditions: precedent/subsequent/concurrent; express (strict compliance) vs constructive (substantial performance); excuse: waiver, estoppel, prevention/bad-faith interference, forfeiture avoidance" },
    { c: "Performance goes wrong mid-stream", z: "履行中途出岔子", i: "Breach: material vs minor (CL factors) → suspend vs sue; UCC perfect tender + cure (time left; reasonable grounds) + installment contracts (substantial impairment); divisibility; anticipatory repudiation (unequivocal; retract before reliance) + demand for adequate assurance (2-609 writing, 30 days)" },
    { c: "Fire, death, embargo, purpose destroyed", z: "火灾、死亡、禁运、目的落空", i: "Discharge: impossibility (objective; death in personal-services; destruction of subject), impracticability (extreme + unforeseen; UCC 2-615 allocation), frustration of purpose (principal purpose substantially frustrated, both knew); risk allocation by contract; restitution after discharge" },
    { c: "How much money for the breach?", z: "违约赔多少", i: "Expectation (position if performed; UCC cover/market/resale; lost-volume seller); incidental + consequential (Hadley foreseeability; certainty; mitigation); reliance alternative; restitution (breaching party too, minus damages); liquidated clause test; punitive damages NO; specific performance for unique goods/land" },
    { c: "Someone else benefits or takes over the deal", z: "第三人受益或接手合同", i: "Third-party beneficiary: intended (creditor/donee) vs incidental; vesting (assent/reliance/suit) cuts off modification; assignment of rights (bars: material change; anti-assignment wording) vs delegation of duties (personal services/special trust barred; delegator remains liable; novation releases)" },
    { c: "Defenses to the deal itself", z: "针对合同效力本身的抗辩", i: "Formation defenses: incapacity (minors — necessaries in restitution; mental; intoxication known), duress (economic: wrongful threat + no alternative), undue influence, misrepresentation/fraud (justifiable reliance; concealment), mutual/unilateral mistake (basic assumption; risk-bearing), unconscionability (procedural + substantive, sliding scale), illegality" },
  ]},
  { s: "crimlaw", items: [
    { c: "Somebody dies", z: "有人死亡", i: "Homicide ladder: murder = unlawful killing + malice (intent to kill; intent to GBH; depraved heart; felony murder — inherently dangerous felony, res gestae, merger/Ireland, agency rule + CA SB 1437 limits for accomplices); CA degrees (1st: premeditated/enumerated/lying in wait; else 2nd); voluntary manslaughter (adequate provocation, no cooling; imperfect self-defense) ; involuntary (criminal negligence; misdemeanor-manslaughter); causation (proximate + intervening)" },
    { c: "Defendant was drunk or high", z: "被告醉酒或吸毒", i: "Voluntary intoxication: specific-intent crimes only (CA: admissible on premeditation/deliberation + specific intent, NOT implied malice); involuntary intoxication = insanity-like defense; addiction status can't be punished (Robinson)" },
    { c: "Crime never completed", z: "犯罪未遂或止步于谋划", i: "Inchoate: solicitation (asking = complete; merges); conspiracy (agreement + intent + overt act (CA/federal); CA bilateral; Pinkerton co-conspirator liability (federal) vs CA rejection; withdrawal limits liability for future crimes only; Wharton's rule); attempt (specific intent + substantial step vs CA slight-acts-beyond-preparation); impossibility (factual no defense, legal yes); abandonment (MPC voluntary+complete; CL no)" },
    { c: "Helpers, lookouts, getaway drivers", z: "帮手、望风者、接应司机", i: "Accomplice liability: aid/encourage + intent to assist AND intent crime be committed (mere presence/knowledge insufficient); natural & probable consequences (CA: abolished for murder — SB 1437; aider must act with own malice or felony-murder major-participant+reckless-indifference); withdrawal (repudiate encouragement / neutralize aid); accessory after the fact separate offense" },
    { c: "Police search or seize ANYTHING", z: "警方实施任何搜查或扣押", i: "4A framework: government action; standing/REP; search? (Katz/Jones; Carpenter CSLI; Chatrie geofence 2026); warrant (PC, particularity, Franks) or exception: SILA (Gant autos; cell phones need warrant — Riley), automobile (PC → whole car incl. containers), plain view, consent (scope; co-occupant present objector — Randolph), stop & frisk (RS; Terry), exigency (hot pursuit misdemeanors case-by-case — Lange; emergency aid needs only objectively reasonable basis, NOT PC — Case v. Montana 2026; destruction of evidence), inventory/community caretaking, special needs; arrest in home (Payton)" },
    { c: "Suspect talks to police", z: "嫌疑人对警察开口", i: "Confessions: voluntariness (DP totality; coercion required); Miranda (custody + interrogation; public-safety exception; adequate warnings; unambiguous invocation — silence must be expressly invoked; waiver KIV; Edwards 14-day rule; statement-taken-in-violation: impeachment use OK, physical fruits admissible); 6A Massiah (post-charge deliberate elicitation, offense-specific)" },
    { c: "Identification of the defendant", z: "对被告的辨认指认", i: "Lineups: 6A counsel at post-charge corporeal lineups (not photo arrays); DP: unnecessarily suggestive + substantial likelihood of misidentification (police-arranged only — Perry); independent-source in-court ID" },
    { c: "Illegally obtained evidence at trial", z: "非法取得的证据将上庭", i: "Exclusionary rule + fruit of the poisonous tree; limits: standing, attenuation (Strieff), independent source, inevitable discovery, good faith (Leon; police recordkeeping — Herring); impeachment use; Miranda fruits; knock-announce no suppression; CA Prop 8: evidence admissible unless FEDERAL constitution requires exclusion (state grounds gone)" },
    { c: "Charged, tried, punished — rights at trial", z: "被起诉、受审、量刑——审判权利", i: "6A: speedy trial (Barker), public trial, jury (serious offenses; cross-section; Batson; unanimity — Ramos), confrontation, compulsory process, counsel (attaches at charge; effective — Strickland deficiency+prejudice; choice; self-representation — Faretta; consultation during recesses — Geders/Villarreal 2026); Brady disclosure; guilty pleas (knowing/voluntary; Padilla immigration advice); sentencing: Apprendi jury findings; 8A proportionality/death limits; double jeopardy (attachment; same offense Blockburger; dual sovereignty; mistrial rules)" },
    { c: "Property crimes: what exactly was taken and how", z: "财产犯罪：拿了什么、怎么拿的", i: "Theft taxonomy: larceny (trespassory taking + carrying away + intent to permanently deprive; continuing trespass); larceny by trick (possession by deception) vs false pretenses (TITLE by deception) ; embezzlement (conversion while in lawful possession); robbery (+ force/fear from person/presence; CA Estes); burglary (CL: breaking+entering dwelling at night + felonious intent; CA: ANY entry of structure w/ intent — no breaking/night; auto burglary locked cars); receiving stolen property; consolidation (CA theft; Prop 47 $950 misdemeanor line)" },
    { c: "'It was self-defense' / 'I had to'", z: "'我是自卫'／'我别无选择'", i: "Defenses: self-defense (reasonable force; deadly only vs deadly/GBH; no retreat majority+CA; initial aggressor re-entry; imperfect → voluntary manslaughter CA), defense of others/property (no deadly force for property alone; habitation broader), necessity (natural forces; not homicide CL), duress (threat of imminent death/GBH; not murder), entrapment (subjective: government inducement + no predisposition), insanity (M'Naghten CA; irresistible impulse; MPC; Durham) + competency distinct; infancy" },
    { c: "Regulatory offense, no mens rea word in statute", z: "行政取缔类罪名、法条无主观要件用语", i: "Strict liability (public welfare, statutory rape); vicarious liability limits; mistake of law exceptions (official reliance, no fair notice, element-negating); void for vagueness; ex post facto" },
  ]},
  { s: "realprop", items: [
    { c: "'To A for life, then to B if...' language", z: "'终身归甲，其后若……归乙'", i: "Estates & future interests: classify (FSA, FSD→possibility of reverter, FSSCS→right of entry, life estate → reversion/remainder); remainders (vested/contingent/subject to open) vs executory interests; waste doctrine; RAP: lives in being +21 (fertile octogenarian, unborn widow, slothful executor traps) — CA USRAP 90-year wait-and-see + reformation; restraints on alienation" },
    { c: "Two or more names on the deed", z: "产权登记多个名字", i: "Concurrent estates: JT (four unities + express survivorship language; severance by conveyance/mortgage in title-theory/partition — CA lien theory: mortgage doesn't sever) vs TIC (default) vs CA CP w/ survivorship; rights: possession of whole, ouster, rents from third parties, carrying-cost contribution, improvements at partition" },
    { c: "Landlord-tenant trouble", z: "房东房客纠纷", i: "Leaseholds: tenancy types + termination; duties: rent (abandonment → CA must mitigate), repair; implied warranty of habitability (residential: repair & deduct, withhold, damages), quiet enjoyment/constructive eviction (substantial interference + notice + vacate), retaliatory eviction ban; assignment vs sublease (privity of estate/contract; consent clauses — CA reasonableness); fixtures" },
    { c: "Neighbor keeps crossing the land", z: "邻人反复穿越土地", i: "Easements: creation (express — SoF; implication from prior use; necessity — landlocked; prescription — open/notorious/hostile/continuous for statutory period), scope + overuse, transfer (appurtenant runs; in gross — commercial assignable), termination (merger, release, abandonment + intent, estoppel, prescription); license (revocable; + estoppel = irrevocable); profits" },
    { c: "Deed restrictions: 'residential use only'", z: "契据限制：'仅限住宅用途'", i: "Real covenant (damages: writing, intent, touch & concern, notice, privity — horizontal for burden) vs equitable servitude (injunction: no privity; implied from COMMON SCHEME + notice); defenses: changed conditions, acquiescence, unclean hands; HOA/CC&R reasonableness (CA Nahrstedt deference)" },
    { c: "Occupier treats another's land as their own", z: "占用者把他人土地当自家用", i: "Adverse possession: actual (or constructive under color of title), open & notorious, exclusive, hostile (claim of right; boundary mistakes), continuous (tacking with privity) for statutory period; CA: 5 years + PAY PROPERTY TAXES; disabilities toll; can't run against government" },
    { c: "Contract to sell land signed; closing pending", z: "签了买地合同、尚未过户", i: "Land-sale contract: SoF + part performance; marketable title at closing (defects: AP title unproven, encumbrances, zoning violations existing); equitable conversion (risk of loss — majority buyer; CA UVPRA: seller keeps risk until possession/title); time not of essence default; remedies (SP, damages, deposit); seller disclosure duties (CA TDS) + fraud" },
    { c: "After closing: deed and title problems", z: "过户之后：契据与产权问题", i: "Merger; deed requirements (writing, description, delivery — intent presumptions, escrow; acceptance); deed types: general warranty (6 covenants: present — seisin/right to convey/no encumbrances; future — quiet enjoyment/warranty/further assurances run with land) vs grant deed (CA statutory: implied covenants) vs quitclaim; estoppel by deed" },
    { c: "Same land sold twice", z: "一地二卖", i: "Recording acts: CA RACE-NOTICE (subsequent BFP without notice who records first); notice types (actual, record/constructive, inquiry); BFP for value; shelter rule; wild deeds unindexable; chain-of-title problems; judgment liens & lis pendens" },
    { c: "Loan secured by the property; borrower defaults", z: "不动产抵押贷款违约", i: "Mortgages: lien vs title theory (CA lien); purchase-money priority; foreclosure: judicial vs CA nonjudicial power-of-sale (no deficiency after nonjudicial; one-action rule; anti-deficiency for purchase-money residential); junior interests wiped, seniors survive; redemption (equitable; statutory post-judicial); transfers: subject-to vs assumption (grantee personal liability); due-on-sale; installment land contracts + forfeiture softening" },
    { c: "Water, support, boundaries, trees", z: "水权、支撑权、边界、树木", i: "Water: riparian reasonable use vs prior appropriation (CA hybrid); groundwater correlative rights; lateral support (strict liability for land in natural state; improved land — negligence) & subjacent support; encroachments; boundary agreements/acquiescence" },
    { c: "Zoning fights and variances", z: "分区规划之争", i: "Zoning: police power; nonconforming uses (amortization limits); variance (undue hardship + no public detriment); special/conditional use permits; vested rights; takings crossover (exactions Nollan/Dolan)" },
  ]},
  { s: "torts", items: [
    { c: "Anyone hurt by anyone's conduct", z: "任何人因他人行为受伤", i: "Negligence skeleton — ALWAYS structure: duty (foreseeable P — Cardozo majority; special relationships create affirmative duties; no general duty to rescue; landowner status rules vs CA Rowland reasonable-care-to-all), breach (RP standard; children; professionals — custom sets standard, informed consent; negligence per se — class of persons/class of harm + excuses; res ipsa), causation (actual: but-for; multiple sufficient causes; CA SUBSTANTIAL FACTOR; alternative liability Summers; market share Sindell), proximate (foreseeable type; eggshell P; intervening vs superseding), damages (physical harm; parasitic emotional; collateral source CA modified)" },
    { c: "Shock, fright, witnessing injury", z: "惊吓、精神打击、目睹亲人受伤", i: "NIED: zone of danger (majority) vs CA Thing v. La Chusa bystander test (closely related + present AND contemporaneously aware + severe distress); direct-victim duty cases (misdiagnosis, mishandled corpse); IIED if conduct extreme & outrageous" },
    { c: "Product hurts a user", z: "产品致人损害", i: "Strict products liability: commercial seller/distributor chain; defect — manufacturing (departs from design), design (CA: consumer expectations OR risk-utility/Barker burden-shift), warning (obvious dangers; learned intermediary); causation; foreseeable misuse; plus negligence + warranties (merchantability, fitness) + misrepresentation routes; no SL for services; bystanders covered" },
    { c: "Explosives, wild animals, toxic escapes", z: "爆破、野生动物、危险物泄漏", i: "Strict liability: abnormally dangerous activities (high risk, can't eliminate with care, uncommon in area); wild animals + known-vicious domestic (CA dog-bite statute: strict for bites); defenses: comparative fault reduces (CA), assumption of risk" },
    { c: "Employee or contractor hurts someone on the job", z: "雇员或承包商执行职务伤人", i: "Vicarious liability: respondeat superior (scope of employment; frolic vs detour; intentional torts if furthering business/inherent — CA Lisa M limits); independent contractors (no VL except nondelegable duties, peculiar risk, apparent agency); negligent hiring/supervision direct claim; joint enterprise; auto owner statutes" },
    { c: "Several defendants, uncertain shares", z: "多名被告、责任份额不清", i: "Joint & several liability (indivisible injury; acting in concert); CA Prop 51: ECONOMIC joint & several, NONECONOMIC several only (fault share); contribution + comparative indemnity; alternative liability; concert of action" },
    { c: "Plaintiff was careless too / signed a waiver", z: "原告自身疏忽／签了免责书", i: "Defenses: CA PURE comparative negligence; assumption of risk — express (waivers; unenforceable for gross negligence/public interest — Tunkl) vs primary implied (no duty — sports) vs secondary (folded into comparative); avoidable consequences; last clear chance obsolete" },
    { c: "Punch, grab, scare, lock in, humiliate", z: "殴打、抓扯、恐吓、禁锢、羞辱", i: "Intentional torts: battery (harmful/offensive contact; intent incl. substantial certainty; transferred intent), assault (apprehension of imminent contact), false imprisonment (bounded area; shopkeeper's privilege), IIED (extreme & outrageous; recklessness; third parties); defenses: consent (scope, capacity), self/others/property defense (reasonable, no deadly force for property), necessity (private = incomplete privilege, pay damages — Vincent)" },
    { c: "Entering land, taking or wrecking stuff", z: "闯入土地、拿走或毁坏财物", i: "Trespass to land (intentional entry; no harm needed; mistake no excuse), trespass to chattels (intermeddling, actual damages) vs conversion (serious interference → full value; demand & refusal for innocent buyers)" },
    { c: "Smells, noise, floodlights next door", z: "隔壁异味、噪音、强光", i: "Private nuisance (substantial + unreasonable interference with use/enjoyment; gravity vs utility; sensitive P; coming to the nuisance not a bar); public nuisance (community right; private suit needs special/different injury); remedies balancing (Boomer)" },
    { c: "Reputation-wrecking words; secrets exposed", z: "毁人名誉的言辞；隐私被曝光", i: "Defamation: defamatory statement of/concerning P + publication + falsity/fault by status (public official/figure — NYT actual malice; private + public concern — negligence, actual damages; private/private — CA common law); libel vs slander per se; privileges (absolute: judicial/legislative/spousal; qualified: common interest, fair report — lost by malice/excess); retraction statutes; privacy quartet: intrusion, public disclosure (newsworthiness), false light, appropriation; anti-SLAPP awareness (CA)" },
    { c: "Lies or dirty tricks cause money loss", z: "谎言或不正当手段造成经济损失", i: "Economic torts: intentional misrepresentation (scienter, justifiable reliance, damages), negligent misrepresentation (business capacity, limited class), intentional interference with contract/prospective advantage (CA: independent wrongfulness for prospective), wrongful institution of proceedings; pure economic loss rule limits negligence" },
  ]},
];

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
/* Scoring-noise strips (calibrated 12/07/2026 by blind-testing complete-but-independently-worded
   answers): enumeration markers "(1) (a) (iv)" scored as 1.6×-weighted digits and punished prose
   answers ~12% on the 126 affected cards; case-cite parentheticals "(Byrne v. Boadle)" and
   "Classic:/E.g." tails demanded illustration, not law. All strips are SCORING-side only — the
   displayed model answer stays complete. Markers must not hug a word/digit, so rule cites like
   12(b)(6), 4(k)(1)(A), 2-207(2) survive intact. */
const ENUM_MARK = /(^|[\s:;,—–-])\((?:\d{1,2}|[a-z]|[ivx]{1,4})\)/gi;   // both sides
const CASE_CITE = /\([^()]*\bv\.?\s[^()]*\)/g;                          // model side only
const EG_TAIL = /(?:^|[.;!?])\s*(?:classic|e\.?g\.?|example|illus(?:tration)?)\s*[:,][^.;]*[.;]?/gi;
function scoringModel(model) {
  const t = String(model).replace(ENUM_MARK, "$1 ").replace(CASE_CITE, " ")
    .replace(EG_TAIL, m => (/^[.;!?]/.test(m) ? m[0] : "") + " ");
  return typedTokens(t).length ? t : String(model);    // never strip a model down to nothing
}
/* P/D/K are house style in model answers and natural bar shorthand in typed ones */
const TOK_MAP = { "p's": "plaintiff", "d's": "defendant", "k's": "contract" };
const mapTok = w => TOK_MAP[w] || w;
/* input-only, additive expansions: bare P/D/K fall below the 2-char token floor, graders accept
   standard abbreviations, and "thirty days" must credit "30 days" (numbers weigh 1.6×) */
const NUM_WORDS = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", fifteen: "15", twenty: "20", thirty: "30", sixty: "60", ninety: "90" };
const TYPED_ABBR = { sof: ["statute", "frauds"], sol: ["statute", "limitations"], pj: ["personal", "jurisdiction"],
  smj: ["subject", "matter", "jurisdiction"], rap: ["rule", "against", "perpetuities"], bfp: ["bona", "fide", "purchaser"],
  iied: ["intentional", "infliction", "emotional", "distress"], nied: ["negligent", "infliction", "emotional", "distress"],
  jmol: ["judgment", "matter", "law"], msj: ["summary", "judgment"], acp: ["attorney", "client", "privilege"],
  jt: ["joint", "tenancy"], fsa: ["fee", "simple", "absolute"], cp: ["community", "property"] };
function typedInputTokens(input) {
  const out = typedTokens(String(input).replace(ENUM_MARK, "$1 ")).map(mapTok);
  const extra = [];
  for (const w of out) {
    if (NUM_WORDS[w]) extra.push(NUM_WORDS[w]);
    if (TYPED_ABBR[w]) extra.push(...TYPED_ABBR[w]);
  }
  const singles = (String(input).toLowerCase().match(/\b[pdk]\b/g) || [])
    .map(x => x === "p" ? "plaintiff" : x === "d" ? "defendant" : "contract");
  return out.concat(extra, singles);
}
function scoreTyped(model, input) {
  const uniq = [...new Set(typedTokens(scoringModel(model)).map(mapTok))];
  const ut = [...new Set(typedInputTokens(input))].slice(0, 150);   // paste-bomb guard
  if (!uniq.length) {                            // degenerate model — whole-string fuzzy fallback
    const a = String(model).toLowerCase().trim(), b = String(input).toLowerCase().trim();
    const ok = a === b || (a.length >= 5 && levLe(a, b, Math.ceil(a.length / 5)));
    return { pct: ok ? 1 : 0, tier: ok ? "sharp" : "wrong", sugg: ok ? 3 : 1, matched: ok ? new Set(typedTokens(model)) : new Set(), missedTop: [], scoreSet: null };
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
  /* cuts blind-calibrated: complete answers land 59–100% under this scorer (paraphrase tax is
     real), halves ~12–49%, wrong-area ~16–20%. Err conservative at the good-cut: a Hard where
     Good was deserved costs one extra review; the reverse hides a lapse from FSRS. */
  let tier, sugg;                                 // sugg = FSRS grade suggestion (Easy stays manual)
  if (pct >= 0.80) { tier = "sharp"; sugg = 3; }
  else if (pct >= 0.60) { tier = "good"; sugg = 3; }
  else if (pct >= 0.35) { tier = "pass"; sugg = 2; }
  else { tier = "wrong"; sugg = 1; }
  return { pct, tier, sugg, matched, missedTop: missed.slice(0, 8).map(m => m.w), scoreSet: new Set(uniq) };
}
/* rebuild the model answer with hits green / misses amber (escaping-safe); tokens outside the
   scoring set (enumeration digits, cites, example tails) stay neutral so amber = a real gap */
function highlightModel(model, matched, scoreSet) {
  let out = "", last = 0, m;
  const re = /[A-Za-z][A-Za-z']*|\d+(?:\.\d+)?/g;      // hyphen = separator, mirrors typedTokens
  while ((m = re.exec(model))) {
    out += esc(model.slice(last, m.index));
    const tok = m[0], lw = mapTok(tok.toLowerCase().replace(/^'+|'+$/g, ""));
    const scoreable = lw && !TYPED_STOP.has(lw) && (lw.length >= 2 || /^\d/.test(lw)) && (!scoreSet || scoreSet.has(lw));
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
