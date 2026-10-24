(function () {
  'use strict';
  const M = globalThis.LearnModel;
  const U = globalThis.LearnUI;
  const config = globalThis.PROTOTYPE_CONFIG;
  const controllers = new Map();
  const STORAGE_KEY = 'xueximie-html-prototype-v1';
  const groups = [
    ['index.html', '总览', '5'], ['01-input.html', '输入与生成', '3'], ['02-quiz.html', '闯关与解析', '6'],
    ['03-report.html', '学习报告', '3'], ['04-states.html', '校验与失败', '3'], ['05-library-profile.html', '题库与我的', '6'],
  ];
  const presets = {
    'home-empty': ['初始输入', '首页', '输入学习主题，或点击示例快速填写。'],
    'home-filled': ['闯关 · 输入学习主题', '主页面', '文本输入与生成入口，底部选中「闯关」。'],
    'quiz-loading': ['题库生成中', '加载状态', '提供过程反馈；点击「继续演示」查看生成结果。'],
    'quiz-single': ['单选 · 等待作答', '单选题', 'A–D 四个选项，选中后提交答案。'],
    'quiz-multiple': ['多选 · 已选一项', '多选题', '可以继续选择，完整命中正确答案才计分。'],
    'quiz-judge': ['判断 · 等待作答', '判断题', '判断题使用正确、错误两个选项。'],
    'quiz-correct': ['答题 · 答对与讲解', '答对反馈', '精简答对提示，知识讲解直接完整呈现。'],
    'quiz-wrong': ['答题 · 答错与讲解', '答错反馈', '同时标出错选与正确答案，完整展示讲解。'],
    'quiz-exit': ['退出本轮确认', '确认弹窗', '保留学习进度，可以继续答题或退出。'],
    'report-loading': ['报告生成中', '加载状态', '成绩已保留，正在整理学习总结。'],
    'report-normal': ['学习报告 · 本轮复盘', '二级页面', '4/5 题、80% 正确率、40 XP，与答题记录一致。'],
    'report-perfect': ['全部答对的报告', '满分状态', '不编造薄弱点，提供继续探索的建议。'],
    'input-invalid': ['输入校验', '错误提示', '提示靠近输入框，保留内容供用户修改。'],
    'quiz-error': ['题库生成失败', '失败重试', '保留主题，支持重试或返回修改。'],
    'report-error': ['报告生成失败', '失败重试', '保留成绩和答题记录，无需重新答题。'],
    library: ['题库 · 已生成的关卡', '主页面', '搜索、筛选、继续学习及查看报告。'],
    'library-search': ['题库 · 搜索结果', '搜索状态', '匹配主题名称，可直接打开对应报告。'],
    'library-no-results': ['题库 · 搜索无结果', '搜索空态', '清空搜索与筛选后可重新查看题库。'],
    'library-empty': ['题库 · 暂无关卡', '空状态', '提供生成第一组关卡的明确入口。'],
    profile: ['我的 · 学习概览', '主页面', '累计经验、完成关卡与最近的学习报告。'],
    'profile-empty': ['我的 · 暂无记录', '空状态', '尚无正确率数据时显示「—」。'],
  };

  function siteHeader(demo = false) {
    return `<a class="skip-link" href="#main">跳到主要内容</a><header class="site-header"><a class="site-brand" href="index.html"><span class="brand-mark">${U.icon('spark')}</span><span>学习咩</span><span class="site-meta">AI 闯关学习小程序</span></a><div class="header-actions">${U.button('使用说明', 'help', 'quiet-link')}${demo ? '<a class="launch-link" href="index.html">返回页面总览</a>' : `<a class="launch-link" href="demo.html">体验完整流程 ${U.icon('arrow')}</a>`}</div></header>`;
  }
  function helpDialog() {
    return `<dialog class="help-dialog" id="help-dialog"><h2>从一个好奇的问题开始</h2><p>这是一套可离线打开的 HTML 交互原型。页面以 UI 总图为设计依据，AI 题目与知识总结使用预设示例内容。</p><ol><li>在总览查看五个主要页面，或通过分类查看全部 21 个状态。</li><li>点击「体验完整流程」，输入主题，逐题选择并提交答案。</li><li>答题后直接阅读知识讲解，完成后查看报告，再到题库或我的复盘。</li></ol><p>已提供 RAG、Python、认知心理学与科学常识示例。其他主题会使用 RAG 示例演示。完整体验中的记录保存在当前浏览器；各状态画板的操作独立，点击重置可恢复。</p><p>直接双击 HTML 即可打开。源文件修改后，可在项目目录运行 <code>node prototype/build.cjs</code> 更新交付文件。</p>${U.button('知道了', 'close-help')}</dialog>`;
  }
  function makeProgress(index, selected) {
    let q = M.createQuiz('RAG 入门');
    for (let i = 0; i < index; i++) { q = M.submitAnswer(q, q.questions[i].answer, 1300); q = M.advanceQuiz(q); }
    if (selected) q = M.submitAnswer(q, selected === 'correct' ? q.questions[index].answer : ['B'], 1600);
    return q;
  }
  function makeController(id, preset, live = false) {
    const c = { id, preset, live, view: 'home', state: M.createInitialState(), activeQuizId: 'sample-rag', selected: [], filter: 'all', search: '', error: '', reviewOpen: false, reportFrom: 'profile', generation: 0, startedAt: Date.now(), modal: null, storageFailed: false };
    if (preset === 'home-filled' || preset === 'quiz-loading' || preset === 'quiz-error') c.state.draft = '我想理解 RAG 和传统搜索的区别';
    if (preset === 'input-invalid') c.error = M.validateTopic('');
    if (preset.startsWith('quiz-') && !['quiz-error', 'quiz-loading'].includes(preset)) {
      c.view = 'quiz';
      const index = preset === 'quiz-multiple' ? 3 : preset === 'quiz-judge' ? 4 : 1;
      const selection = preset === 'quiz-correct' ? 'correct' : preset === 'quiz-wrong' ? 'wrong' : null;
      const q = makeProgress(index, selection);
      c.state.quizzes.unshift(q); c.activeQuizId = q.id;
      if (preset === 'quiz-multiple') c.selected = ['A'];
      if (preset === 'quiz-exit') c.modal = 'exit';
    }
    if (preset === 'quiz-loading') { c.view = 'generating'; c.loadingKind = 'quiz'; c.staticLoading = true; }
    if (preset === 'quiz-error') c.view = 'quiz-error';
    if (preset.startsWith('report-')) {
      c.view = preset === 'report-error' ? 'report-error' : preset === 'report-loading' ? 'report-loading' : 'report';
      if (preset === 'report-loading') { c.loadingKind = 'report'; c.staticLoading = true; }
      if (preset === 'report-perfect') {
        let q = M.createQuiz('RAG 入门');
        for (let i = 0; i < q.questions.length; i++) { q = M.submitAnswer(q, q.questions[i].answer); q = M.advanceQuiz(q); }
        c.state.quizzes.unshift(q); c.activeQuizId = q.id;
      }
    }
    if (preset.startsWith('library')) {
      c.view = 'library';
      if (preset === 'library-search') c.search = 'RAG';
      if (preset === 'library-no-results') c.search = '量子力学';
    }
    if (preset.startsWith('profile')) c.view = 'profile';
    if (preset === 'library-empty' || preset === 'profile-empty') c.state.quizzes = [];
    return c;
  }
  function gallery() {
    const nav = `<nav class="group-nav" aria-label="原型分组">${groups.map(([href, label, count]) => `<a href="${href}" ${href === config.file ? 'aria-current="page"' : ''}>${label}<span class="nav-count">${count}</span></a>`).join('')}</nav>`;
    document.body.innerHTML = `${siteHeader()}<section class="site-intro"><p class="eyebrow">XUEXIMIE / INTERACTIVE PROTOTYPE</p><div class="intro-title-row"><div><h1>${U.esc(config.title)}</h1><p>${U.esc(config.description)}</p></div><span class="prototype-tag">离线原型 · 示例内容</span></div></section>${nav}<main class="gallery" id="main">${config.presets.map((preset, i) => {
      const [title, kind, description] = presets[preset];
      return `<article class="screen-card" data-controller="screen-${i}"><div class="screen-card-heading"><span class="screen-number">${String(i + 1).padStart(2, '0')}</span><h2>${title}</h2><span class="screen-kind">${kind}</span></div><div class="device" role="group" aria-label="${title}"></div><div class="screen-caption"><p>${description}</p>${preset.includes('loading') ? U.button('继续演示', 'resolve-generation', 'preview-control') : ''}${U.button(U.icon('refresh'), 'reset-preview', 'preview-control', 'aria-label="重置此画板" title="重置此画板"')}</div></article>`;
    }).join('')}</main><footer class="site-footer"><span>以 UI 总图为依据 · 375 × 812 画板 · 三栏主导航</span><span>题目与报告为示例数据 · <a href="demo.html">进入完整交互体验</a></span></footer>${helpDialog()}`;
    config.presets.forEach((preset, i) => {
      const id = `screen-${i}`; const c = makeController(id, preset);
      c.host = document.querySelector(`[data-controller="${id}"] .device`); controllers.set(id, c); U.render(c);
    });
  }
  function validStoredState(state) {
    return M.isValidState(state);
  }
  function liveDemo() {
    document.body.classList.add('demo-page');
    document.body.innerHTML = `${siteHeader(true)}<main class="demo-layout" id="main"><section class="demo-copy"><p class="eyebrow">A LITTLE CURIOSITY, EVERY DAY</p><h1>把好奇，<br>变成<em>一小关。</em></h1><p>输入一个想学的主题，用几道小题探索知识。<br>每一题都有讲解，每一轮都有收获。</p><div class="demo-flow"><span>输入主题</span>${U.icon('arrow')}<span>逐题学习</span>${U.icon('arrow')}<span>总结复盘</span></div><div class="demo-note">当前为离线交互演示。AI 出题和报告使用示例内容，答题、计分、题库与学习进度可实际操作。</div>${U.button(`${U.icon('refresh')} 恢复示例数据`, 'request-reset', 'quiet-link demo-reset')}</section><section class="screen-card" data-controller="live"><h2 class="sr-only">小程序操作区</h2><div class="device" role="group" aria-label="学习咩完整交互演示"></div></section></main><p id="storage-notice" class="storage-note" role="status" hidden></p>${helpDialog()}`;
    const c = makeController('live', 'home-empty', true);
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value) {
        const saved = JSON.parse(value);
        if (validStoredState(saved)) c.state = saved;
        else showStorageNotice('原有演示记录无法读取，已恢复初始示例。');
      }
    } catch { c.storageFailed = true; showStorageNotice('浏览器暂时无法保存记录，本次演示仍可操作，关闭页面后记录可能清空。'); }
    c.activeQuizId = c.state.activeQuizId || c.state.quizzes[0]?.id;
    const requested = location.hash.slice(1) || new URLSearchParams(location.search).get('view');
    if (['home', 'library', 'profile', 'quiz', 'report'].includes(requested)) c.view = requested;
    if (c.view === 'quiz' && (!U.quiz(c) || U.quiz(c).status === 'completed')) {
      let pending = c.state.quizzes.find(q => q.status !== 'completed');
      if (!pending) { pending = M.createQuiz('RAG 入门'); c.state.quizzes.unshift(pending); }
      c.activeQuizId = pending.id;
    }
    Object.assign(c, M.resolveRoute(c.state, { view: c.view, quizId: history.state?.quizId || c.activeQuizId, reportFrom: history.state?.reportFrom }));
    c.host = document.querySelector('[data-controller="live"] .device'); controllers.set(c.id, c); U.render(c);
    history.replaceState({ view: c.view, quizId: c.activeQuizId, reportFrom: c.reportFrom }, '', `#${c.view}`);
    window.addEventListener('popstate', event => {
      const view = location.hash.slice(1);
      c.generation++;
      c.modal = null; c.selected = []; c.reviewOpen = false;
      Object.assign(c, M.resolveRoute(c.state, { view, quizId: event.state?.quizId, reportFrom: event.state?.reportFrom }));
      persist(c);
      U.render(c);
    });
  }
  function showStorageNotice(text) {
    const node = document.getElementById('storage-notice');
    if (node) { node.textContent = text; node.hidden = false; }
  }
  function persist(c) {
    if (!c.live) return;
    c.state.activeQuizId = c.activeQuizId;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c.state)); c.storageFailed = false; }
    catch { c.storageFailed = true; showStorageNotice('浏览器暂时无法保存记录，本次记录仅在当前页面中保留。'); }
  }
  function replaceQuiz(c, q) {
    c.state.quizzes = c.state.quizzes.map(item => item.id === q.id ? q : item);
    persist(c);
  }
  function navigate(c, view) {
    c.generation++; c.view = view; c.error = ''; c.selected = []; c.reviewOpen = false; c.modal = null; c.startedAt = Date.now();
    U.render(c);
    if (c.live && ['home', 'library', 'profile', 'quiz', 'report'].includes(view) && (location.hash !== `#${view}` || history.state?.quizId !== c.activeQuizId)) {
      history.pushState({ view, quizId: c.activeQuizId, reportFrom: c.reportFrom }, '', `#${view}`);
    }
  }
  function toast(c, text) {
    const node = c.host.querySelector('.device-toast');
    if (!node) return;
    node.textContent = text; node.hidden = false;
    clearTimeout(c.toastTimer);
    c.toastTimer = setTimeout(() => { if (node.isConnected) node.hidden = true; }, 2800);
  }
  function finishGeneration(c) {
    if (c.loadingKind === 'report') { navigate(c, 'report'); return; }
    try {
      const q = M.createQuiz(c.state.draft);
      q.status = 'in-progress';
      c.state.quizzes.unshift(q); c.activeQuizId = q.id; persist(c); navigate(c, 'quiz');
    } catch (error) { navigate(c, 'home'); c.error = error.message; U.render(c); }
  }
  function beginGeneration(c, kind = 'quiz') {
    if (kind === 'quiz') {
      const error = M.validateTopic(c.state.draft);
      if (error) { c.error = error; U.render(c); c.host.querySelector('.topic-input')?.focus(); return; }
    }
    c.loadingKind = kind; c.staticLoading = false; navigate(c, kind === 'report' ? 'report-loading' : 'generating');
    const token = c.generation;
    setTimeout(() => { if (c.generation === token) finishGeneration(c); }, 850);
  }
  function focusDialog(c) {
    const dialog = c.host.querySelector('.screen-dialog');
    if (dialog) dialog.querySelector('button')?.focus();
  }
  function openModal(c, type) { c.modal = type; U.render(c); focusDialog(c); }
  function act(c, action, target) {
    if (action.startsWith('tab-')) { navigate(c, action.slice(4)); return; }
    switch (action) {
      case 'example': {
        c.state.draft = target.dataset.value; c.error = ''; persist(c); U.render(c); c.host.querySelector('.topic-input')?.focus(); break;
      }
      case 'new-topic': c.state.draft = ''; persist(c); navigate(c, 'home'); break;
      case 'select-answer': {
        const current = U.quiz(c); const q = current.questions[current.currentIndex];
        if (current.records[q.id]) return;
        const key = target.dataset.value;
        c.selected = q.type === 'multiple' ? c.selected.includes(key) ? c.selected.filter(value => value !== key) : [...c.selected, key] : [key];
        const scroll = c.host.querySelector('.screen-main').scrollTop;
        U.render(c); c.host.querySelector('.screen-main').scrollTop = scroll;
        c.host.querySelector(`[data-action="select-answer"][data-value="${key}"]`)?.focus({ preventScroll: true }); break;
      }
      case 'submit-answer': {
        try {
          const scroll = c.host.querySelector('.screen-main').scrollTop;
          replaceQuiz(c, M.submitAnswer(U.quiz(c), c.selected, Date.now() - c.startedAt));
          U.render(c); c.host.querySelector('.screen-main').scrollTop = scroll;
          c.host.querySelector('.answer-feedback')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        } catch (error) { toast(c, error.message); }
        break;
      }
      case 'next-question': {
        try {
          const next = M.advanceQuiz(U.quiz(c)); replaceQuiz(c, next);
          if (next.status === 'completed') { c.reportFrom = 'profile'; beginGeneration(c, 'report'); }
          else { c.selected = []; c.startedAt = Date.now(); U.render(c); c.host.querySelector('.question-stem')?.setAttribute('tabindex', '-1'); c.host.querySelector('.question-stem')?.focus({ preventScroll: true }); }
        } catch (error) { toast(c, error.message); }
        break;
      }
      case 'back': if (c.view === 'quiz') openModal(c, 'exit'); else { c.generation++; navigate(c, ['generating', 'quiz-error'].includes(c.view) ? 'home' : c.reportFrom); } break;
      case 'close-modal': c.modal = null; U.render(c); c.host.querySelector('.back-button')?.focus(); break;
      case 'confirm-exit': persist(c); navigate(c, 'library'); break;
      case 'filter': c.filter = target.dataset.value; U.render(c); break;
      case 'clear-search': c.search = ''; c.filter = 'all'; U.render(c); c.host.querySelector('[data-input="search"]')?.focus(); break;
      case 'open-report': c.reportFrom = c.view === 'library' ? 'library' : 'profile'; c.activeQuizId = target.dataset.value; persist(c); navigate(c, 'report'); break;
      case 'resume-quiz': {
        c.activeQuizId = target.dataset.value;
        const current = U.quiz(c);
        if (current.status === 'not-started') replaceQuiz(c, { ...current, status: 'in-progress' });
        persist(c); navigate(c, 'quiz'); break;
      }
      case 'toggle-review': {
        const scroll = c.host.querySelector('.screen-main').scrollTop; c.reviewOpen = !c.reviewOpen; U.render(c);
        c.host.querySelector('.screen-main').scrollTop = scroll;
        if (c.reviewOpen) c.host.querySelector('.review-list')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        else c.host.querySelector('[data-action="toggle-review"]')?.focus({ preventScroll: true });
        break;
      }
      case 'cancel-generation': c.generation++; navigate(c, c.loadingKind === 'report' || c.view === 'report-error' ? c.reportFrom : 'home'); break;
      case 'retry-generation': beginGeneration(c, c.view === 'report-error' ? 'report' : 'quiz'); break;
      case 'resolve-generation': if (c.view === 'report-loading' || c.view === 'generating') finishGeneration(c); break;
      case 'request-reset': openModal(c, 'reset'); break;
      case 'confirm-reset': c.state = M.createInitialState(); c.activeQuizId = 'sample-rag'; persist(c); navigate(c, 'home'); break;
      case 'reset-preview': {
        c.generation++; clearTimeout(c.toastTimer);
        const next = makeController(c.id, c.preset); next.host = c.host; controllers.set(c.id, next); U.render(next); break;
      }
    }
  }
  document.addEventListener('submit', event => {
    if (!event.target.matches('[data-form="topic"]')) return;
    event.preventDefault(); const c = controllers.get(event.target.closest('[data-controller]').dataset.controller); beginGeneration(c);
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'help') { document.getElementById('help-dialog').showModal(); return; }
    if (action === 'close-help') { document.getElementById('help-dialog').close(); return; }
    if (action === 'request-reset') { act(controllers.get('live'), action, target); return; }
    const context = target.closest('[data-controller]');
    if (!context) return;
    const c = controllers.get(context.dataset.controller);
    if (c && !target.disabled) act(c, action, target);
  });
  document.addEventListener('input', event => {
    const target = event.target;
    const context = target.closest('[data-controller]');
    const c = context && controllers.get(context.dataset.controller);
    if (!c) return;
    if (target.matches('[data-input="topic"]')) {
      c.state.draft = target.value; persist(c);
      const count = Array.from(target.value).length;
      c.host.querySelector('.char-counter').textContent = `${count} / 2000`;
      const error = count > 2000 ? M.validateTopic(target.value) : '';
      c.error = error;
      const node = c.host.querySelector('.field-error'); node.textContent = error; node.hidden = !error;
      c.host.querySelector('.textarea-wrap').classList.toggle('invalid', Boolean(error));
      target.setAttribute('aria-invalid', String(Boolean(error)));
    }
    if (target.matches('[data-input="search"]')) {
      c.search = target.value;
      const selectionStart = target.selectionStart;
      U.render(c);
      const input = c.host.querySelector('[data-input="search"]'); input.focus({ preventScroll: true });
      if (typeof selectionStart === 'number') input.setSelectionRange(selectionStart, selectionStart);
    }
  });
  document.addEventListener('keydown', event => {
    const context = event.target.closest('[data-controller]');
    const c = context && controllers.get(context.dataset.controller);
    if (!c?.modal) return;
    if (event.key === 'Escape') { event.preventDefault(); c.modal = null; U.render(c); c.host.querySelector('.back-button')?.focus(); }
    if (event.key === 'Tab') {
      const buttons = [...c.host.querySelectorAll('.screen-dialog button')];
      if (event.shiftKey && event.target === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      if (!event.shiftKey && event.target === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    }
  });
  if (config.mode === 'demo') liveDemo(); else gallery();
})();
