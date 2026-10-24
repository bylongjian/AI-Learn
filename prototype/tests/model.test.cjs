const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const modelPath = path.join(__dirname, '../src/model.js');
const M = existsSync(modelPath) ? require(modelPath) : {};

function complete(quiz, wrongIndices = []) {
  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    const selected = wrongIndices.includes(i)
      ? [q.options.find(o => !q.answer.includes(o.key)).key]
      : q.answer;
    quiz = M.submitAnswer(quiz, selected, 1200);
    quiz = M.advanceQuiz(quiz);
  }
  return quiz;
}

test('主题为空或超过 2000 字时就地拒绝，保留正常输入', () => {
  assert.equal(typeof M.validateTopic, 'function');
  assert.match(M.validateTopic('   '), /输入/);
  assert.match(M.validateTopic('学'.repeat(2001)), /2000/);
  assert.equal(M.validateTopic('我想理解 RAG'), '');
});

test('单选和多选具有 A–D 选项，判断题保持两个选项', () => {
  const quiz = M.createQuiz('RAG 入门');
  assert.equal(quiz.questions.length, 5);
  for (const q of quiz.questions) {
    assert.deepEqual(q.options.map(o => o.key), q.type === 'judge' ? ['A', 'B'] : ['A', 'B', 'C', 'D']);
    assert.ok(q.explanation.length > 15);
  }
});

test('多选必须完整命中，少选和多选都不获得 XP', () => {
  const quiz = M.createQuiz('RAG');
  const i = quiz.questions.findIndex(q => q.type === 'multiple');
  const q = quiz.questions[i];
  const atMultiple = { ...quiz, currentIndex: i };
  assert.equal(M.submitAnswer(atMultiple, [...q.answer].reverse()).records[q.id].isCorrect, true);
  assert.equal(M.submitAnswer(atMultiple, [q.answer[0]]).records[q.id].isCorrect, false);
  assert.equal(M.submitAnswer(atMultiple, q.options.map(o => o.key)).records[q.id].isCorrect, false);
});

test('提交后立即得到解释，重复提交不会累计经验', () => {
  const quiz = M.createQuiz('RAG');
  const answered = M.submitAnswer(quiz, quiz.questions[0].answer);
  assert.equal(M.getStats(answered).xp, 10);
  assert.ok(answered.questions[0].explanation);
  assert.throws(() => M.submitAnswer(answered, ['B']), /已提交/);
  assert.equal(M.getStats(answered).xp, 10);
});

test('未作答不能跳题，无效选项不能提交', () => {
  const quiz = M.createQuiz('RAG');
  assert.throws(() => M.advanceQuiz(quiz), /作答/);
  assert.throws(() => M.submitAnswer(quiz, []), /选择/);
  assert.throws(() => M.submitAnswer(quiz, ['Z']), /选项/);
  assert.throws(() => M.submitAnswer(quiz, ['A', 'B']), /一个/);
});

test('五题答对四题的报告为 80%、40 XP，明确薄弱知识点', () => {
  const quiz = complete(M.createQuiz('RAG'), [4]);
  const report = M.getReport(quiz);
  assert.equal(quiz.status, 'completed');
  assert.equal(report.correct, 4);
  assert.equal(report.accuracy, 80);
  assert.equal(report.xp, 40);
  assert.equal(report.total, 5);
  assert.deepEqual(report.weakPoints, ['RAG 与传统搜索的区别']);
  assert.equal(report.summary.length, 3);
});

test('平均正确率按已完成题数加权，包含未完成关卡已获取的 XP', () => {
  const short = complete(M.createQuiz('RAG', { questionCount: 3 }), [2]);
  const long = complete(M.createQuiz('Python'), [4]);
  const pending = M.createQuiz('认知心理学');
  const started = M.submitAnswer(pending, pending.questions[0].answer);
  const stats = M.getProfileStats([short, long, started]);
  assert.equal(stats.completed, 2);
  assert.equal(stats.accuracy, 75);
  assert.equal(stats.xp, 70);
});

test('没有已完成记录时正确率是暂无数据，满分报告无虚构薄弱点', () => {
  assert.equal(M.getProfileStats([]).accuracy, null);
  const report = M.getReport(complete(M.createQuiz('RAG')));
  assert.equal(report.accuracy, 100);
  assert.deepEqual(report.weakPoints, []);
  assert.ok(report.advice.length);
});

test('初始示例始终为三组题库、两组完成、80 XP 与 80% 正确率', () => {
  const state = M.createInitialState();
  assert.equal(state.quizzes.length, 3);
  assert.deepEqual(M.getProfileStats(state.quizzes), { xp: 80, completed: 2, accuracy: 80, correct: 8, total: 10 });
  assert.equal(state.quizzes.filter(q => q.status !== 'completed').length, 1);
  const second = M.createInitialState();
  state.quizzes.pop();
  assert.equal(second.quizzes.length, 3);
});

test('未完成关卡不能生成一份误导性的 0% 或全部答对报告', () => {
  assert.throws(() => M.getReport(M.createQuiz('RAG')), /完成/);
});

test('浏览器历史恢复对应的已完成关卡，不把新关卡当成旧报告', () => {
  const state = M.createInitialState();
  const pending = M.createQuiz('Python');
  state.quizzes.unshift(pending);
  state.activeQuizId = pending.id;
  const route = M.resolveRoute(state, { view: 'report', quizId: 'sample-rag', reportFrom: 'library' });
  assert.equal(route.view, 'report');
  assert.equal(route.activeQuizId, 'sample-rag');
  assert.equal(route.reportFrom, 'library');
  const invalid = M.resolveRoute(state, { view: 'report', quizId: pending.id });
  assert.equal(state.quizzes.find(q => q.id === invalid.activeQuizId).status, 'completed');
  assert.equal(M.resolveRoute({ quizzes: [pending] }, { view: 'report', quizId: pending.id }).view, 'profile');
});

test('缓存校验拒绝损坏的答案记录和选项，正常进度可恢复', () => {
  const state = M.createInitialState();
  assert.equal(M.isValidState(state), true);
  const corruptRecord = M.clone(state);
  corruptRecord.quizzes[0].records['rag-1'] = {};
  assert.equal(M.isValidState(corruptRecord), false);
  const corruptOption = M.clone(state);
  corruptOption.quizzes[0].questions[0].options[0] = {};
  assert.equal(M.isValidState(corruptOption), false);
  const unfinished = M.clone(state);
  unfinished.quizzes[0].status = 'completed';
  delete unfinished.quizzes[0].records['rag-5'];
  assert.equal(M.isValidState(unfinished), false);
  for (const bankKey of ['constructor', '__proto__']) {
    const invalidBank = M.clone(state);
    invalidBank.quizzes[0].bankKey = bankKey;
    assert.equal(M.isValidState(invalidBank), false);
  }
});
