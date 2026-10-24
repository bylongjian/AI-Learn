(function (root) {
  'use strict';
  const M = root.LearnModel;
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
    left: '<path d="m14 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    document: '<path d="M5 3h9l5 5v13H5Z"/><path d="M14 3v6h5M8 13h8M8 17h6"/>',
    book: '<path d="M12 5C8 2 5 3 2 4v16c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-6-2-10 1ZM12 5v16"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M19 11a7 7 0 0 0-12-5L4 9m1 4a7 7 0 0 0 12 5l3-3"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  };
  function icon(name, extra = '') { return `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.document}</svg>`; }
  function esc(value = '') { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function button(label, action, cls = 'primary', extra = '') { return `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`; }
  const isRoot = view => ['home', 'library', 'profile'].includes(view);
  const quiz = c => c.state.quizzes.find(q => q.id === c.activeQuizId) || c.state.quizzes[0];
  function statusBar() {
    return `<div class="status-bar" aria-hidden="true"><span>9:41</span><span class="system-icons"><svg viewBox="0 0 18 12"><path d="M1 11V8h3v3zm4 0V6h3v5zm4 0V3h3v8zm4 0V0h3v11z" fill="currentColor"/></svg><svg viewBox="0 0 17 12"><path d="M1 3a11 11 0 0 1 15 0M4 6a7 7 0 0 1 9 0m-6 3a3 3 0 0 1 3 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8.5" cy="11" r="1" fill="currentColor"/></svg><svg viewBox="0 0 26 12"><rect x="1" y="1" width="21" height="10" rx="2.3" fill="none" stroke="currentColor" opacity=".45"/><rect x="3" y="3" width="17" height="6" rx=".7" fill="currentColor"/><path d="M24 4v4" stroke="currentColor" stroke-width="2" opacity=".5"/></svg></span></div>`;
  }
  function header(c) {
    const label = ['quiz', 'generating', 'quiz-error'].includes(c.view) ? '返回闯关' : `返回${c.reportFrom === 'library' ? '题库' : '我的'}`;
    const leading = isRoot(c.view) ? '<span class="app-wordmark">学习咩</span>' : button(`${icon('left')}<span>${label}</span>`, 'back', 'back-button');
    return `<div class="app-header">${leading}<div class="wechat-capsule" aria-hidden="true"><span class="capsule-dots">•••</span><i class="capsule-line"></i><i class="capsule-ring"></i></div></div>`;
  }
  function tabs(view) {
    return `<nav class="tab-bar" aria-label="小程序主导航">${[['home', '闯关', 'home'], ['library', '题库', 'layers'], ['profile', '我的', 'user']].map(([key, label, symbol]) => button(`${icon(symbol)}<span>${label}</span>`, `tab-${key}`, `tab-item${view === key ? ' active' : ''}`, view === key ? 'aria-current="page"' : '')).join('')}</nav>`;
  }
  function home(c) {
    const value = c.state.draft || '';
    return `<h3 class="page-title">今天想学点什么？</h3><p class="page-subtitle">把好奇，变成一小关</p>
      <form class="topic-form" data-form="topic" novalidate>
        <label class="field-label" for="topic-${c.id}">学习主题或文本</label>
        <div class="textarea-wrap${c.error ? ' invalid' : ''}"><textarea id="topic-${c.id}" class="topic-input" data-input="topic" placeholder="比如：我想理解 RAG 和传统搜索的区别" aria-describedby="counter-${c.id}${c.error ? ` error-${c.id}` : ''}" ${c.error ? 'aria-invalid="true"' : ''}>${esc(value)}</textarea><span class="char-counter" id="counter-${c.id}">${Array.from(value).length} / 2000</span></div>
        <p class="field-error" id="error-${c.id}" role="alert" ${c.error ? '' : 'hidden'}>${esc(c.error || '')}</p>
        <div class="input-meta">${icon('clock')}<span>5 道题 · 约 3 分钟</span></div>
        <button class="primary" type="submit">生成学习关卡</button>
      </form>
      <section class="examples" aria-label="主题示例"><h4 class="section-title">试试这些主题</h4><div class="topic-chips">${['RAG 入门', '认知心理学', '科学常识'].map(text => button(esc(text), 'example', 'topic-chip', `data-value="${esc(text)}"`)).join('')}</div></section>`;
  }
  function quizPage(c) {
    const current = quiz(c);
    if (!current) return empty('还没有学习关卡', '先输入一个主题，开始你的第一轮学习。', '去闯关', 'new-topic');
    const q = current.questions[current.currentIndex];
    const record = current.records[q.id];
    const selected = record ? record.selectedAnswers : c.selected;
    const stats = M.getStats(current);
    const typeLabel = { single: '单选题', multiple: '多选题', judge: '判断题' }[q.type];
    return `<div class="quiz-heading"><h3 class="page-title">${esc(current.title)}</h3><span class="quiz-xp">${stats.xp} XP</span></div>
      <div class="progress-track" role="progressbar" aria-label="答题进度" aria-valuemin="0" aria-valuemax="${stats.total}" aria-valuenow="${stats.answered}"><span style="width:${stats.answered / stats.total * 100}%"></span></div>
      <div class="question-meta"><span>第 ${current.currentIndex + 1} / ${stats.total} 题 · ${typeLabel}</span>${q.type === 'multiple' && !record ? '<span>可选择多个答案</span>' : ''}</div>
      <h4 class="question-stem">${esc(q.stem)}</h4><div class="answer-options" role="group" aria-label="题目选项">
      ${q.options.map(o => {
        const picked = selected.includes(o.key);
        const correct = Boolean(record && q.answer.includes(o.key));
        const wrong = Boolean(record && picked && !q.answer.includes(o.key));
        return button(`<span class="option-key">${o.key}</span><span class="option-text">${esc(o.text)}</span><span class="option-state">${correct ? icon('check') : wrong ? icon('close') : ''}</span>`, 'select-answer', `answer-option${q.type === 'multiple' ? ' multiple' : ''}${picked && !record ? ' selected' : ''}${correct ? ' correct' : ''}${wrong ? ' wrong' : ''}`, `data-value="${o.key}" aria-pressed="${picked}" ${record ? 'disabled' : ''}`);
      }).join('')}</div>
      ${record ? `<section class="answer-feedback" aria-label="作答反馈"><div class="result-line${record.isCorrect ? '' : ' wrong'}" role="status">${icon(record.isCorrect ? 'success' : 'alert')}<span>${record.isCorrect ? '答对了 · +10 XP' : `这题还差一点 · 正确答案 ${q.answer.join('、')}`}</span></div><section class="explanation" aria-label="知识讲解"><h5>知识讲解</h5><p>${esc(q.explanation)}</p></section>${button(current.currentIndex === current.questions.length - 1 ? '完成闯关，查看报告' : '下一题', 'next-question')}</section>` : `<div class="answer-submit">${button('提交答案', 'submit-answer', 'primary', selected.length ? '' : 'disabled')}<p class="answer-hint">提交后，立即查看正确答案与知识讲解</p></div>`}`;
  }
  function empty(title, description, actionLabel, action = 'new-topic', symbol = 'book') {
    return `<div class="empty-state">${icon(symbol)}<h3>${esc(title)}</h3><p>${esc(description)}</p>${button(`${esc(actionLabel)} ${icon('arrow')}`, action, 'text-action')}</div>`;
  }
  function library(c) {
    const quizzes = c.state.quizzes;
    const complete = quizzes.filter(q => q.status === 'completed').length;
    const filtered = quizzes.filter(q => (c.filter === 'all' || (c.filter === 'completed' ? q.status === 'completed' : q.status !== 'completed')) && q.title.toLowerCase().includes(c.search.trim().toLowerCase()));
    return `<h3 class="page-title">我的题库</h3><p class="page-subtitle">共 ${quizzes.length} 组学习关卡</p>
      <label class="search-field">${icon('search')}<input type="search" data-input="search" aria-label="搜索学习主题" placeholder="搜索学习主题" value="${esc(c.search)}"/>${c.search ? button(icon('close'), 'clear-search', 'search-clear', 'aria-label="清空搜索"') : ''}</label>
      <div class="filter-bar" role="group" aria-label="题库筛选">${[['all', '全部', quizzes.length], ['pending', '未完成', quizzes.length - complete], ['completed', '已完成', complete]].map(([key, label, count]) => button(`${label} ${count}`, 'filter', `filter-button${c.filter === key ? ' active' : ''}`, `data-value="${key}" aria-pressed="${c.filter === key}"`)).join('')}</div>
      ${filtered.length ? `<div class="list-surface">${filtered.map(q => {
        const stats = M.getStats(q);
        const completed = q.status === 'completed';
        const pending = q.status === 'not-started';
        return `<article class="library-row"><div class="row-top"><h3>${esc(q.title)}</h3><span class="small-state${completed ? ' complete' : ''}">${completed ? '已完成' : pending ? '未开始' : '学习中'}</span></div><div class="row-bottom"><p>${stats.total} 题 · ${completed ? `正确率 ${stats.accuracy}%` : pending ? '未开始' : `已答 ${stats.answered}/${stats.total} 题`}</p>${button(`${completed ? '查看报告' : pending ? '开始闯关' : '继续学习'} ${icon('right')}`, completed ? 'open-report' : 'resume-quiz', 'row-link', `data-value="${esc(q.id)}"`)}</div></article>`;
      }).join('')}</div><div class="library-new">${button(`${icon('plus')} 新建关卡`, 'new-topic', 'text-action center-action')}</div>` : quizzes.length ? empty('没有找到相关关卡', '换一个关键词，或查看全部学习关卡。', '清空筛选', 'clear-search') : empty('还没有学习关卡', '从一个感兴趣的问题开始，生成你的第一组题。', '去生成第一组关卡')}`;
  }
  function profile(c) {
    const stats = M.getProfileStats(c.state.quizzes);
    const recent = c.state.quizzes.filter(q => q.status === 'completed').slice(0, 3);
    return `<h3 class="page-title">我的学习</h3><p class="page-subtitle">每一小步，都算进步</p><div class="profile-row"><span class="profile-avatar" aria-hidden="true">${icon('user')}</span><span class="profile-name">学习者</span></div>
      <div class="profile-stats"><div class="profile-stat"><strong>${stats.xp} <span class="xp-unit">XP</span></strong><p>累计经验</p></div><div class="profile-stat"><strong>${stats.completed}</strong><p>完成关卡</p></div><div class="profile-stat"><strong>${stats.accuracy === null ? '—' : `${stats.accuracy}%`}</strong><p>${stats.accuracy === null ? '暂无正确率数据' : '平均正确率'}</p></div></div>
      <section class="profile-reports"><h4 class="section-title">最近的报告</h4>${recent.length ? `<div class="list-surface">${recent.map(q => {
        const s = M.getStats(q);
        return button(`<span><h3>${esc(q.title)}</h3><p>${s.correct} / ${s.total} 题 · ${s.accuracy}%</p></span>${icon('right')}`, 'open-report', 'report-row', `data-value="${esc(q.id)}"`);
      }).join('')}</div>` : empty('完成一关，就有一份收获', '你的学习报告会出现在这里。', '开始第一轮学习', 'new-topic', 'document')}</section>
      ${recent.length ? `<div class="profile-home">${button(`去闯关 ${icon('arrow')}`, 'new-topic', 'text-action center-action')}</div>` : ''}<p class="local-note">${c.storageFailed ? '本次记录仅在当前页面保留' : '记录保存在当前设备'}</p>`;
  }
  function report(c) {
    const current = quiz(c);
    if (!current || current.status !== 'completed') return empty('还没有学习报告', '完成一轮闯关，就能看到知识总结。', '开始学习');
    const r = M.getReport(current);
    const circumference = 2 * Math.PI * 34;
    return `<h3 class="page-title">学习报告</h3><p class="page-subtitle">${esc(current.title)} · ${r.total} 道题</p>
      <div class="report-score"><div class="score-ring" role="img" aria-label="本轮正确率 ${r.accuracy}%"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="ring-track" cx="40" cy="40" r="34"/><circle class="ring-value" cx="40" cy="40" r="34" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - r.accuracy / 100)}"/></svg><strong>${r.accuracy}<small>%</small></strong></div><div class="score-copy"><h3>本轮正确率</h3><p>答对 ${r.correct} / ${r.total} 题</p><p class="report-xp">+${r.xp} XP</p></div></div>
      <section class="summary-section"><h4 class="section-title">知识总结</h4><ol class="knowledge-summary">${r.summary.map((text, i) => `<li><span class="summary-number" aria-hidden="true">${i + 1}</span><span>${esc(text)}</span></li>`).join('')}</ol></section>
      <section class="weak-section"><h4 class="section-title">${r.weakPoints.length ? '待巩固' : '本轮全部答对'}</h4><p>${esc(r.weakPoints.length ? r.weakPoints.join('、') : '这些知识点都答对了，继续探索新的主题吧。')}</p></section>
      <div class="report-actions">${button('再学一个主题', 'new-topic')}${button(c.reviewOpen ? '收起本轮题目' : '回看本轮题目', 'toggle-review', 'secondary-text', `aria-expanded="${c.reviewOpen}"`)}</div>
      ${c.reviewOpen ? `<section class="review-list" aria-label="本轮答题记录">${current.questions.map((q, i) => {
        const record = current.records[q.id];
        const labels = keys => keys.map(key => `${key} ${q.options.find(o => o.key === key)?.text || ''}`).join('；');
        return `<article class="review-item"><h4>${i + 1}. ${esc(q.stem)}</h4><p class="${record?.isCorrect ? 'review-correct' : 'review-wrong'}">我的答案：${record ? esc(labels(record.selectedAnswers)) : '未作答'}</p><p>正确答案：${esc(labels(q.answer))}</p><p>${esc(q.explanation)}</p></article>`;
      }).join('')}</section>` : ''}
      <details class="report-more"><summary>学习建议与已掌握知识点</summary><h4 class="section-title">下一步怎么学</h4><p>${esc(r.advice)}</p><h4 class="section-title">本轮答对的知识点</h4>${r.masteredPoints.length ? `<div class="point-tags">${r.masteredPoints.map(p => `<span class="point-tag">${esc(p)}</span>`).join('')}</div>` : '<p>先从上面的讲解开始，一次理解一个知识点。</p>'}</details>`;
  }
  function loading(c) {
    const isReport = c.loadingKind === 'report';
    return `<section class="loading-state" aria-busy="true" aria-label="${isReport ? '报告' : '题目'}生成中"><div class="loader-orbit">${icon(isReport ? 'document' : 'spark')}</div><h2>${isReport ? '整理这一轮的收获' : '把好奇，变成一小关'}</h2><p>${isReport ? '答题记录已保留，正在整理知识总结。' : '正在整理主题和题目，请稍等片刻。'}</p><ul class="generation-steps"><li>${icon('check')}<span>${isReport ? '汇总本轮答题情况' : '理解学习主题'}</span></li><li>${icon('check')}<span>${isReport ? '找出答对与待巩固的知识点' : '梳理关键知识点'}</span></li><li class="pending"><span class="mini-dot"></span><span>${isReport ? '生成知识总结与学习建议' : '准备题目、选项与知识讲解'}</span></li></ul>${button(isReport ? '返回我的' : '返回修改主题', 'cancel-generation', 'secondary-text')}</section>`;
  }
  function failure(c) {
    const isReport = c.view === 'report-error';
    return `<section class="failure-state">${icon('alert')}<h2>${isReport ? '报告暂时没有生成' : '这次没有生成成功'}</h2><p>${isReport ? '答题记录和成绩都已保留。<br>可以重新整理，不需要再答一遍。' : '可能是连接暂时中断了。<br>你的输入还在，稍后再试一次。'}</p>${isReport ? `<div class="failure-detail">${esc(quiz(c).title)}<br>答对 ${M.getStats(quiz(c)).correct} / ${quiz(c).questions.length} 题 · ${M.getStats(quiz(c)).xp} XP</div>` : `<div class="failure-detail">学习主题<br>${esc(c.state.draft || '我想理解 RAG 和传统搜索的区别')}</div>`}${button('重新生成', 'retry-generation')}${button(isReport ? '返回我的' : '返回修改主题', 'cancel-generation', 'secondary-text')}</section>`;
  }
  function overlay(c) {
    if (!c.modal) return '';
    const reset = c.modal === 'reset';
    return `<div class="screen-overlay"><section class="screen-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title-${c.id}" tabindex="-1"><h2 id="dialog-title-${c.id}">${reset ? '恢复示例数据？' : '先休息一下？'}</h2><p>${reset ? '这会清除本次演示保存的关卡与学习记录，恢复最初的三组示例。' : c.live && !c.storageFailed ? '本轮进度会保存在题库中，下次可以从这里继续。' : '本轮进度会保留在当前演示中，可以到题库继续学习。'}</p>${button(reset ? '保留当前记录' : '继续答题', 'close-modal')}${button(reset ? '恢复示例数据' : '退出本轮', reset ? 'confirm-reset' : 'confirm-exit', 'secondary')}</section></div>`;
  }
  function render(c) {
    const views = { home, quiz: quizPage, library, profile, report, generating: loading, 'report-loading': loading, 'quiz-error': failure, 'report-error': failure };
    const contents = (views[c.view] || home)(c);
    c.host.innerHTML = `${statusBar()}${header(c)}<section class="screen-main" aria-label="${{ home: '闯关首页', quiz: '答题内容', library: '题库内容', profile: '我的学习', report: '学习报告' }[c.view] || '生成状态'}">${contents}</section>${isRoot(c.view) ? tabs(c.view) : ''}<div class="home-area" aria-hidden="true"></div>${overlay(c)}<div class="device-toast" role="status" hidden></div>`;
    if (c.modal) c.host.querySelectorAll('.app-header, .screen-main, .tab-bar').forEach(node => { node.inert = true; });
  }
  root.LearnUI = { icon, esc, button, render, quiz, isRoot };
})(globalThis);
