#!/usr/bin/env node
/* Assembles the single-file app: src/* + data/*.json  →  index.html */
const fs = require("fs");
const path = require("path");
const R = p => fs.readFileSync(path.join(__dirname, p), "utf8");

const ORDER = ["civpro", "conlaw", "contracts", "crimlaw", "evidence", "realprop", "torts",
               "busassoc", "commprop", "profresp", "remedies", "trusts", "wills", "glossary"];

const decks = [];
for (const slug of ORDER) {
  const p = path.join(__dirname, "data", slug + ".json");
  if (!fs.existsSync(p)) { console.warn(`⚠ missing deck: ${slug}.json — skipped`); continue; }
  const deck = JSON.parse(fs.readFileSync(p, "utf8"));
  decks.push(deck);
}
const nCards = decks.reduce((n, d) => n + d.cards.length, 0);

let html = R("src/template.html");
const put = (tag, content) => { html = html.replace(tag, () => content); };
put("/*__STYLE__*/", R("src/style.css"));
put("/*__DATA__*/", "window.DECKS=" + JSON.stringify(decks) + ";");
put("/*__CORE__*/", R("src/app-core.js"));
put("/*__UI__*/", R("src/app-ui.js"));
/* placeholder nav labels (replaced at runtime by language) */
put("__NAV_HOME__", "首页"); put("__NAV_BROWSE__", "题库");
put("__NAV_STATS__", "统计"); put("__NAV_SET__", "设置");

const out = path.join(__dirname, "index.html");
fs.writeFileSync(out, html);
console.log(`✓ built index.html — ${decks.length} decks, ${nCards} cards, ${(html.length / 1048576).toFixed(2)} MB`);
