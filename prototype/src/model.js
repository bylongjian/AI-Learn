(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LearnModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const option = (key, text) => ({ key, text });
  const single = (id, stem, texts, answer, explanation, knowledgePoint) => ({
    id, type: 'single', stem, options: texts.map((text, i) => option('ABCD'[i], text)), answer: [answer], explanation, knowledgePoint,
  });
  const multiple = (id, stem, texts, answer, explanation, knowledgePoint) => ({
    ...single(id, stem, texts, 'A', explanation, knowledgePoint), type: 'multiple', answer,
  });
  const judge = (id, stem, answer, explanation, knowledgePoint) => ({
    id, type: 'judge', stem, options: [option('A', '正确'), option('B', '错误')], answer: [answer], explanation, knowledgePoint,
  });
  const banks = {
    rag: {
      title: 'RAG 入门',
      summary: ['先检索，再生成。', '外部资料为回答提供依据。', '检索质量会影响回答质量。'],
      questions: [
        single('rag-1', 'RAG 中的 R 代表什么？', ['检索（Retrieval）', '推理（Reasoning）', '排序（Ranking）', '重写（Rewriting）'], 'A', 'RAG 是检索增强生成的缩写。其中 R 表示检索：先从外部资料中找到与问题相关的内容，再让模型利用这些资料回答问题。', 'RAG 的基本概念'),
        single('rag-2', 'RAG 的主要作用是什么？', ['先检索资料，再生成回答', '只扩大模型参数', '只调整搜索排名', '只改写问题，不检索资料'], 'A', '先检索相关资料，再结合资料生成回答。检索结果为回答提供依据。RAG 并不是简单地扩大模型参数，也不只是改写问题。', 'RAG 的工作流程'),
        single('rag-3', '选择检索资料时，最应该关注什么？', ['资料与问题的相关性和可靠性', '资料的篇幅越长越好', '只选择标题最吸引人的资料', '随机选择几份资料'], 'A', '能帮助回答当前问题、来源可靠的资料才有价值。无关或不准确的信息可能干扰模型，因此需要同时关注相关性、可靠性与时效性。', '检索质量'),
        multiple('rag-4', '哪些做法有助于提高回答依据的质量？', ['优先使用相关且可靠的来源', '及时更新已经过时的资料', '把大量无关内容全部塞给模型', '编造不存在的资料引用'], ['A', 'B'], '相关、可靠且及时更新的资料能为回答提供更好的依据。大量无关内容会增加干扰，编造引用也不能提高答案的可信度。', '资料质量'),
        judge('rag-5', 'RAG 和传统搜索的输出方式完全相同。', 'B', '传统搜索通常返回资料列表或内容片段。RAG 会在检索之后，结合问题和检索结果生成回答。两者都可能涉及检索，但输出方式与后续处理不同。', 'RAG 与传统搜索的区别'),
      ],
    },
    python: {
      title: 'Python 基础',
      summary: ['变量用来引用数据。', '列表可以按位置读取和修改。', '条件与循环让程序按规则执行。'],
      questions: [
        single('py-1', '下面哪个表达式会得到数字 3？', ['1 + 2', '"1" + "2"', '"3"', '[1, 2]'], 'A', '整数相加会得到整数结果，因此 1 + 2 的结果是数字 3。字符串相加会拼接文本，而字符串 "3" 与数字 3 的类型不同。', '数字与字符串'),
        single('py-2', '列表的第一个元素使用哪个下标？', ['0', '1', '-2', '列表没有下标'], 'A', 'Python 列表从下标 0 开始计数。例如 colors[0] 读取第一个元素。负下标则从列表末尾开始计数。', '列表下标'),
        single('py-3', 'if 语句主要用来做什么？', ['根据条件选择执行路径', '永久保存文件', '自动连接网络', '把所有数据变成文本'], 'A', 'if 会检查条件是否成立，并据此执行不同的代码。用缩进区分代码块，是阅读和编写 Python 条件语句的重要规则。', '条件判断'),
        multiple('py-4', '哪些数据可以用来表示一组元素？', ['列表 list', '元组 tuple', '单个整数 int', '单个布尔值 bool'], ['A', 'B'], '列表和元组都可以容纳多个元素。列表可修改，元组的结构不可直接修改。单个整数和布尔值不用于表示一组独立元素。', '序列类型'),
        judge('py-5', 'for 循环只能遍历数字，不能遍历列表。', 'B', 'for 可以遍历列表、元组、字符串等可迭代对象。每次循环都会取得一个元素，不局限于数字。', '循环与遍历'),
      ],
    },
    cognition: {
      title: '认知心理学',
      summary: ['主动提取比反复重读更能检验理解。', '把复习分散到不同时间。', '用自己的话建立知识之间的联系。'],
      questions: [
        single('cg-1', '哪种方式更能检验你是否真正记住了知识？', ['合上材料，尝试回忆要点', '不停翻看同一段文字', '只标记很多重点', '只看别人整理的结论'], 'A', '合上材料后尝试回忆，是一次主动提取。它能暴露你还没有掌握的部分，而熟悉文字的感觉并不总是代表可以独立回忆。', '主动提取'),
        single('cg-2', '复习一组知识时，更合理的安排是什么？', ['分散到不同时间复习', '只在最后一天连续读很久', '记住后永远不再看', '每次只更换笔记颜色'], 'A', '分散复习让你在不同时间再次提取知识，有助于形成更持久的记忆。具体间隔可根据知识难度和回忆表现调整。', '间隔复习'),
        single('cg-3', '学习新概念时，哪种做法有助于理解？', ['用自己的话解释并举例', '只背定义中的字词顺序', '只计算读了多少页', '不检查任何不懂的地方'], 'A', '用自己的话解释并举例，要求你主动组织概念、建立联系。若解释不清楚，也能帮助发现需要重新学习的部分。', '精细加工'),
        multiple('cg-4', '哪些方法可以帮助复盘？', ['记录容易混淆的概念', '回顾答错的原因', '只看分数，不看题目', '把所有错误都归因于运气'], ['A', 'B'], '复盘需要找出具体的知识缺口和错误原因。把相似概念放在一起比较，并记录自己的误解，通常比分数本身更有指导意义。', '学习复盘'),
        judge('cg-5', '觉得一段内容很熟悉，就一定能独立运用。', 'B', '熟悉感与独立运用是不同层次。尝试脱离材料作答、解释或解决新问题，才能更好地检验能否使用所学知识。', '熟悉感与掌握'),
      ],
    },
    science: {
      title: '科学常识',
      summary: ['观察和证据帮助检验解释。', '对照实验需要控制其他条件。', '结论应与证据支持的范围相符。'],
      questions: [
        single('sc-1', '哪种做法更符合科学探究？', ['提出解释并用证据检验', '只选择支持自己的现象', '一次观察就宣布永远正确', '只凭最初的直觉判断'], 'A', '科学探究需要让解释接受证据检验。观察与实验可能支持某种解释，也可能提示需要修改解释。', '证据与解释'),
        single('sc-2', '做对照实验时，通常应该怎样安排？', ['改变目标因素，尽量保持其他条件一致', '一次改变所有条件', '每次使用完全不同的方法', '只记录自己喜欢的数据'], 'A', '控制其他条件有助于区分目标因素的影响。如果同时改变很多条件，就很难判断结果究竟由什么造成。', '对照实验'),
        single('sc-3', '看到两个现象经常一起发生，能够直接说明什么？', ['它们可能相关，还需要进一步研究', '前者一定导致后者', '后者一定导致前者', '两者必定没有联系'], 'A', '同时发生或变化说明可能存在关联，但不能直接证明因果。还需要排除其他因素，并寻找更充分的证据。', '相关与因果'),
        multiple('sc-4', '哪些信息有助于判断实验结果？', ['测量方法与实验条件', '重复实验的结果', '只看结论是否有趣', '只看图表的配色'], ['A', 'B'], '测量方法、条件和可重复性会影响证据的可信程度。结论是否有趣或图表是否好看，不能替代对实验质量的检查。', '实验可靠性'),
        judge('sc-5', '研究结论可以超出证据支持的范围随意推广。', 'B', '结论应当说明适用的条件和范围。新的对象、环境或条件可能需要新的证据，不能仅凭已有结果作无限推广。', '证据的边界'),
      ],
    },
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  let sequence = 0;
  function validateTopic(value) {
    if (!String(value || '').trim()) return '先输入一个想学的主题或一段文本。';
    if (Array.from(String(value)).length > 2000) return '内容超过 2000 字，请精简后再试。';
    return '';
  }
  function bankKey(value) {
    const text = String(value);
    if (/python|编程|程序/i.test(text)) return 'python';
    if (/认知|心理|记忆|复习|学习方法/i.test(text)) return 'cognition';
    if (/科学|物理|科普|实验/i.test(text)) return 'science';
    return 'rag';
  }
  function createQuiz(input, options = {}) {
    const error = validateTopic(input);
    if (error) throw new Error(error);
    const key = bankKey(input);
    const bank = banks[key];
    const count = options.questionCount ?? 5;
    if (!Number.isInteger(count) || count < 3 || count > 5) throw new Error('每轮题量为 3–5 题。');
    return {
      id: options.id || `quiz-${Date.now()}-${++sequence}`, bankKey: key, title: bank.title, input: input.trim(),
      createdAt: options.createdAt || new Date().toISOString(), questions: clone(bank.questions.slice(0, count)),
      records: {}, currentIndex: 0, status: 'not-started',
    };
  }
  function submitAnswer(quiz, selectedAnswers, durationMs = 0) {
    const q = quiz.questions[quiz.currentIndex];
    if (!q || quiz.status === 'completed' || quiz.records[q.id]) throw new Error('本题已提交，请继续下一题。');
    if (!Array.isArray(selectedAnswers) || !selectedAnswers.length) throw new Error('请先选择答案。');
    const selected = [...new Set(selectedAnswers)];
    if (selected.some(key => !q.options.some(o => o.key === key))) throw new Error('包含无效选项。');
    if (q.type !== 'multiple' && selected.length !== 1) throw new Error('这道题请选择一个答案。');
    const isCorrect = selected.length === q.answer.length && q.answer.every(key => selected.includes(key));
    return {
      ...quiz, status: 'in-progress', records: {
        ...quiz.records,
        [q.id]: { questionId: q.id, selectedAnswers: [...selected], isCorrect, durationMs: Math.max(0, Number(durationMs) || 0) },
      },
    };
  }
  function advanceQuiz(quiz) {
    if (!quiz.records[quiz.questions[quiz.currentIndex]?.id]) throw new Error('请先完成本题作答。');
    if (quiz.currentIndex === quiz.questions.length - 1) return { ...quiz, status: 'completed' };
    return { ...quiz, currentIndex: quiz.currentIndex + 1, status: 'in-progress' };
  }
  function getStats(quiz) {
    const validRecords = quiz.questions.map(q => quiz.records[q.id]).filter(Boolean);
    const correct = validRecords.filter(r => r.isCorrect).length;
    return { total: quiz.questions.length, answered: validRecords.length, correct, xp: correct * 10, accuracy: Math.round(correct / quiz.questions.length * 100) };
  }
  function getReport(quiz) {
    if (quiz.status !== 'completed' || getStats(quiz).answered !== quiz.questions.length) throw new Error('请先完成本轮学习，再查看报告。');
    const stats = getStats(quiz);
    const mastered = new Set();
    const weak = new Set();
    for (const q of quiz.questions) {
      const record = quiz.records[q.id];
      if (record) (record.isCorrect ? mastered : weak).add(q.knowledgePoint);
    }
    for (const point of weak) mastered.delete(point);
    return {
      ...stats, masteredPoints: [...mastered], weakPoints: [...weak], summary: [...banks[quiz.bankKey].summary],
      advice: weak.size ? `先回看「${[...weak][0]}」的讲解，再用自己的话解释一次。` : '本轮全部答对！可以换一个主题，或试着向别人解释刚学到的知识。',
    };
  }
  function getProfileStats(quizzes) {
    let xp = 0; let correct = 0; let total = 0; let completed = 0;
    for (const quiz of quizzes) {
      const stats = getStats(quiz);
      xp += stats.xp;
      if (quiz.status === 'completed') { completed++; correct += stats.correct; total += stats.total; }
    }
    return { xp, completed, accuracy: total ? Math.round(correct / total * 100) : null, correct, total };
  }
  function createInitialState() {
    function sample(input, id) {
      let quiz = createQuiz(input, { id, createdAt: '2026-10-24T01:41:00.000Z' });
      for (let i = 0; i < quiz.questions.length; i++) {
        const q = quiz.questions[i];
        quiz = submitAnswer(quiz, i === 4 ? [q.options.find(o => !q.answer.includes(o.key)).key] : q.answer, 1400);
        quiz = advanceQuiz(quiz);
      }
      return quiz;
    }
    return {
      version: 1, draft: '', quizzes: [
        sample('RAG 入门', 'sample-rag'), sample('Python 基础', 'sample-python'),
        createQuiz('认知心理学', { id: 'sample-cognition', createdAt: '2026-10-24T01:41:00.000Z' }),
      ],
    };
  }
  function resolveRoute(state, route = {}) {
    const allowed = ['home', 'library', 'profile', 'quiz', 'report'];
    let view = allowed.includes(route.view) ? route.view : 'home';
    let current = state.quizzes.find(q => q.id === (route.quizId || state.activeQuizId));
    if (view === 'report') {
      if (current?.status !== 'completed') current = state.quizzes.find(q => q.status === 'completed');
      if (!current) view = 'profile';
    } else if (view === 'quiz') {
      if (!current || current.status === 'completed') current = state.quizzes.find(q => q.status !== 'completed');
      if (!current) view = 'home';
    } else if (!current) current = state.quizzes[0];
    return { view, activeQuizId: current?.id, reportFrom: route.reportFrom === 'library' ? 'library' : 'profile' };
  }
  function isValidState(state) {
    if (!state || state.version !== 1 || typeof state.draft !== 'string' || !Array.isArray(state.quizzes)) return false;
    const quizIds = new Set();
    return state.quizzes.every(q => {
      if (!q || typeof q.id !== 'string' || quizIds.has(q.id) || typeof q.title !== 'string' || typeof q.bankKey !== 'string' || !Object.hasOwn(banks, q.bankKey) ||
          !['not-started', 'in-progress', 'completed'].includes(q.status) || !q.records || typeof q.records !== 'object' || Array.isArray(q.records) ||
          !Number.isInteger(q.currentIndex) || !Array.isArray(q.questions) || q.questions.length < 3 || q.questions.length > 5 || q.currentIndex < 0 || q.currentIndex >= q.questions.length) return false;
      quizIds.add(q.id);
      const questionIds = new Set();
      for (const question of q.questions) {
        if (!question || typeof question.id !== 'string' || questionIds.has(question.id) || typeof question.stem !== 'string' ||
            typeof question.explanation !== 'string' || typeof question.knowledgePoint !== 'string' || !['single', 'multiple', 'judge'].includes(question.type) ||
            !Array.isArray(question.options) || question.options.length !== (question.type === 'judge' ? 2 : 4) ||
            !Array.isArray(question.answer) || !question.answer.length || (question.type !== 'multiple' && question.answer.length !== 1)) return false;
        questionIds.add(question.id);
        const keys = question.options.map(o => o?.key);
        if (new Set(keys).size !== keys.length || question.options.some(o => !o || !['A', 'B', 'C', 'D'].includes(o.key) || typeof o.text !== 'string') ||
            new Set(question.answer).size !== question.answer.length || question.answer.some(key => !keys.includes(key))) return false;
        const record = q.records[question.id];
        if (record !== undefined) {
          if (!record || record.questionId !== question.id || !Array.isArray(record.selectedAnswers) || !record.selectedAnswers.length ||
              record.selectedAnswers.some(key => !keys.includes(key)) || new Set(record.selectedAnswers).size !== record.selectedAnswers.length ||
              (question.type !== 'multiple' && record.selectedAnswers.length !== 1) || typeof record.isCorrect !== 'boolean' ||
              !Number.isFinite(record.durationMs) || record.durationMs < 0) return false;
          const correct = record.selectedAnswers.length === question.answer.length && question.answer.every(key => record.selectedAnswers.includes(key));
          if (record.isCorrect !== correct) return false;
        }
      }
      if (Object.keys(q.records).some(id => !questionIds.has(id))) return false;
      if (q.status === 'completed' && (Object.keys(q.records).length !== q.questions.length || q.currentIndex !== q.questions.length - 1)) return false;
      if (q.status === 'not-started' && (Object.keys(q.records).length || q.currentIndex !== 0)) return false;
      if (q.questions.some((question, index) => index < q.currentIndex && !q.records[question.id])) return false;
      return true;
    });
  }
  return { validateTopic, createQuiz, submitAnswer, advanceQuiz, getStats, getReport, getProfileStats, createInitialState, resolveRoute, isValidState, clone };
});
