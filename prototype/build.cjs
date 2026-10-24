const fs = require('node:fs');
const path = require('node:path');
const directory = __dirname;
const css = fs.readFileSync(path.join(directory, 'src/style.css'), 'utf8');
const script = ['model.js', 'ui.js', 'app.js'].map(file => fs.readFileSync(path.join(directory, 'src', file), 'utf8')).join('\n');
const pages = [
  { file: 'index.html', title: '五个页面，一条学习路径', description: '以 UI 总图为设计依据。输入一个主题，逐题学习，再回到题库与我的复盘；点击下方画板可直接操作。', presets: ['home-filled', 'library', 'profile', 'quiz-correct', 'report-normal'] },
  { file: '01-input.html', title: '输入与生成', description: '从一小段好奇出发。输入主题、快速选择示例，以及清楚的生成中反馈。', presets: ['home-empty', 'home-filled', 'quiz-loading'] },
  { file: '02-quiz.html', title: '闯关与即时讲解', description: '单选、多选与判断题。答对提示保持精简，知识讲解默认完整显示，读完再继续。', presets: ['quiz-single', 'quiz-multiple', 'quiz-judge', 'quiz-correct', 'quiz-wrong', 'quiz-exit'] },
  { file: '03-report.html', title: '每一轮，都有收获', description: '本轮成绩、三句知识总结、待巩固知识点与学习建议。单次报告是独立详情页。', presets: ['report-loading', 'report-normal', 'report-perfect'] },
  { file: '04-states.html', title: '校验与失败重试', description: '让下一步始终清楚。保留用户输入与答题记录，失败后可以直接重试。', presets: ['input-invalid', 'quiz-error', 'report-error'] },
  { file: '05-library-profile.html', title: '把学过的知识，留在这里', description: '题库管理学习关卡，我的汇总学习收获。包含搜索结果、无结果与首次使用状态。', presets: ['library', 'library-search', 'library-no-results', 'library-empty', 'profile', 'profile-empty'] },
  { file: 'demo.html', title: '学习咩 · 完整交互体验', mode: 'demo' },
];
function inlineSafe(text) { return text.replace(/<\/script/gi, '<\\/script'); }
for (const page of pages) {
  const config = JSON.stringify(page).replace(/</g, '\\u003c');
  const html = `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light">\n<meta name="description" content="学习咩 AI 闯关学习小程序 HTML 交互原型">\n<title>${page.title} · 学习咩</title>\n<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23C6531A'/%3E%3Cpath d='m16 5 3 8 8 3-8 3-3 8-3-8-8-3 8-3z' fill='white'/%3E%3C/svg%3E">\n<style>\n${css}\n</style>\n</head>\n<body>\n<noscript>请启用 JavaScript 以查看和体验交互原型。</noscript>\n<script>globalThis.PROTOTYPE_CONFIG=${config};</script>\n<script>\n${inlineSafe(script)}\n</script>\n</body>\n</html>\n`;
  fs.writeFileSync(path.join(directory, page.file), html, 'utf8');
  process.stdout.write(`${page.file}\n`);
}
