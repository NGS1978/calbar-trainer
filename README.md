# Ron 的加州律考通 · Ron's CalBar Trainer

**中英双语 · 间隔重复 · 加州律师执照考试（California Bar Exam）备考记忆训练器**

A bilingual (简体中文 / English) spaced-repetition trainer for the **February 2027 California Bar Exam**, built for a PRC-trained lawyer preparing from mainland China.

> **在线使用 / Use online:** https://ngs1978.github.io/calbar-trainer/

---

## 📱 快速开始（中文）

1. 打开上面的网址（手机或电脑浏览器均可）。
2. 首页点「**学习新卡**」开始；建议每天 15–25 张新卡。
3. 每天回来清空「**开始复习**」队列 —— 算法（FSRS，Anki 最新一代排程算法）会把每张卡安排在你快要遗忘的时刻。
4. 「**考题演练**」= 模拟选择题（MCQ），答错的卡自动加入复习队列。
5. 设置页可切换界面语言、调整每日新卡量、导出/导入学习进度。

### 🇨🇳 中国大陆访问 / 离线使用

`github.io` 在大陆偶尔无法访问。本应用是**单个 HTML 文件、完全离线可用**：

- 打不开网页时：下载仓库里的 `index.html`（或让朋友发给你），**双击直接用**，功能完全一致。
- 学习进度保存在浏览器本地（localStorage）。**注意：** 在线版和本地文件的进度是分开的；换设备/换浏览器前，先在设置页「导出学习进度」，再到新设备「导入」。
- 手机上可「添加到主屏幕」当 App 用。

### 内容说明

- **1000+ 张卡片**，覆盖加州律考全部 13 个科目 + 法律英语核心词汇：
  民事诉讼、宪法、合同法（含 UCC）、刑法与刑事诉讼、证据法（FRE + CEC 对照）、不动产法、侵权法、商事组织法、夫妻共产法、职业责任（ABA + 加州规则对照）、救济法、信托法、遗嘱与继承法、法律英语词汇。
- 每张卡：英文题面（考试语言）+ 中文翻译 + 中文解析（含与中国法对比的记忆锚点）+ 🐻 加州区别标注 + 记忆钩。
- 卡片类型：问答、挖空（cloze）、选择题（MCQ）。
- ⚠️ 内容由 AI 辅助编写，供记忆训练使用；规则表述请以官方资料与课程讲义为准，存疑的卡片请用 ⚑ 标记后查证。

---

## Features (English)

- **FSRS-4.5 scheduler** (the modern Anki algorithm) with an **exam-aware interval cap** — as Feb 2027 approaches, intervals compress so every card is seen again before exam day.
- **Bilingual by design**: English prompts (the exam language) with toggleable 中文 hints, Chinese explanations that anchor to PRC-law concepts the learner already knows, and standard mainland legal terminology throughout.
- **Three card types**: basic recall, cloze deletion, and bar-style MCQs; **quiz mode** feeds misses back into the review queue.
- **California-distinction callouts** (🐻) — FRE vs CEC, ABA vs CA rules, CA procedure quirks — the highest-yield material on this exam.
- **Habit mechanics**: streaks, XP ranks (书记员 → 首席大法官), daily goal ring, activity heatmap, pacing advisor tied to the exam date.
- **Fully offline single file** — works from `file://`, no CDN, no tracking, progress in localStorage with JSON export/import.

## Development

```
node validate.js        # check all decks in data/
node build.js           # data/*.json + src/* → index.html
node serve.js           # preview at http://localhost:8377
```

Deck files live in `data/*.json` (one per subject). Card schema: see `validate.js`. After editing decks, re-run `node build.js` and commit `index.html`.

## License & content notes

App code: MIT. Card text: original, AI-assisted summaries of black-letter law written for this project — not copied from any commercial outline. This is a study aid, not legal advice; verify against official sources.
