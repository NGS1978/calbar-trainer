#!/usr/bin/env node
/* Validates deck JSON files. Usage:
     node validate.js data/evidence.json   (one file)
     node validate.js                      (all files in data/)                */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dataDir = path.join(__dirname, 'data');
const files = args.length
  ? args.map(a => path.resolve(__dirname, a))
  : fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).map(f => path.join(dataDir, f));

let totalCards = 0, totalErr = 0;
const allIds = new Set();

for (const file of files) {
  const rel = path.basename(file);
  let deck;
  const errs = [];
  try {
    deck = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`✗ ${rel}: JSON parse failed — ${e.message}`);
    totalErr++;
    continue;
  }
  for (const k of ['subject', 'nameEn', 'nameZh', 'emoji', 'cards']) {
    if (deck[k] === undefined) errs.push(`missing top-level "${k}"`);
  }
  if (typeof deck.mcqTested !== 'boolean') errs.push('mcqTested must be boolean');
  const topics = {};
  const types = { basic: 0, cloze: 0, mcq: 0 };
  for (const c of deck.cards || []) {
    const id = c.id || '(no id)';
    if (!c.id) errs.push('card missing id');
    else if (!/^[A-Za-z0-9_-]+$/.test(c.id)) errs.push(`${id}: id must be [A-Za-z0-9_-]+ (it is interpolated into inline handlers)`);
    else if (allIds.has(c.id)) errs.push(`duplicate id ${id}`);
    allIds.add(c.id);
    if (!['basic', 'cloze', 'mcq'].includes(c.type)) errs.push(`${id}: bad type "${c.type}"`);
    for (const k of ['topic', 'topicZh', 'q', 'qZh', 'explainZh']) {
      if (!c[k] || typeof c[k] !== 'string' || !c[k].trim()) errs.push(`${id}: missing ${k}`);
    }
    if (c.type === 'mcq') {
      if (!Array.isArray(c.choices) || c.choices.length !== 4) errs.push(`${id}: mcq needs exactly 4 choices`);
      if (typeof c.answer !== 'number' || c.answer < 0 || c.answer > 3) errs.push(`${id}: mcq answer must be 0-3`);
    } else {
      for (const k of ['a', 'aZh']) if (!c[k] || !String(c[k]).trim()) errs.push(`${id}: missing ${k}`);
    }
    if (c.type === 'cloze') {
      const m = (c.q.match(/\{\{c::[^}]+\}\}/g) || []).length;
      if (m !== 1) errs.push(`${id}: cloze must contain exactly one {{c::...}} span (found ${m})`);
    }
    if (c.caNote && !c.caNoteZh) errs.push(`${id}: caNote without caNoteZh`);
    types[c.type] = (types[c.type] || 0) + 1;
    topics[c.topic] = (topics[c.topic] || 0) + 1;
  }
  totalCards += (deck.cards || []).length;
  if (errs.length) {
    totalErr += errs.length;
    console.error(`✗ ${rel}: ${(deck.cards || []).length} cards, ${errs.length} error(s):`);
    errs.slice(0, 25).forEach(e => console.error(`    - ${e}`));
    if (errs.length > 25) console.error(`    … and ${errs.length - 25} more`);
  } else {
    console.log(`✓ ${rel}: ${deck.cards.length} cards (basic ${types.basic}, cloze ${types.cloze}, mcq ${types.mcq})`);
    for (const [t, n] of Object.entries(topics)) console.log(`     ${String(n).padStart(3)}  ${t}`);
  }
}
console.log(`\nTOTAL: ${totalCards} cards across ${files.length} file(s); unique ids: ${allIds.size}; errors: ${totalErr}`);
process.exit(totalErr ? 1 : 0);
