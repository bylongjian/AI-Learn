import { createRequire } from 'node:module'
import type { Quiz } from '../src/domain/types'

const require = createRequire(process.cwd() + '/tests/fixtures.ts')
const prototype = require('../../prototype/src/model.js')

export function quizFixture(): Quiz {
  const sample = prototype.createQuiz('RAG 入门')
  return {
    quiz_id: 'test-quiz', title: sample.title, summary: '检索增强生成基础',
    source_type: 'text', user_input: 'RAG 入门',
    questions: sample.questions.map((q: any) => ({
      id: q.id, type: q.type, stem: q.stem, options: q.options, answer: q.answer,
      explanation: q.explanation, knowledge_point: q.knowledgePoint, difficulty: 'easy',
    })),
  }
}

export function reportFixture() {
  return { accuracy: 80, correct: 4, total: 5, xp: 40,
    mastered_points: ['RAG 的基本概念', 'RAG 的工作流程', '检索质量', '资料质量'],
    weak_points: ['RAG 与传统搜索的区别'],
    three_line_summary: ['先检索，再生成。', '外部资料为回答提供依据。', '检索质量会影响回答质量。'],
    advice: ['先回看待巩固的讲解，再用自己的话解释一次。'],
    share_quote: '把好奇，变成一小关。',
  }
}
