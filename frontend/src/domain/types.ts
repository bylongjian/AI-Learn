export type OptionKey = 'A' | 'B' | 'C' | 'D'
export interface Option { key: OptionKey; text: string }
export interface Question {
  id: string
  type: 'single' | 'multiple' | 'judge'
  stem: string
  options: Option[]
  answer: OptionKey[]
  explanation: string
  knowledge_point: string
  difficulty: 'easy' | 'medium' | 'hard'
}
export interface Quiz {
  quiz_id: string
  title: string
  summary: string
  source_type: 'text'
  user_input: string
  questions: Question[]
}
export interface AnswerRecord {
  question_id: string
  selected_answers: OptionKey[]
  is_correct: boolean
  duration_ms: number
}
export interface Report {
  accuracy: number
  total: number
  correct: number
  xp: number
  mastered_points: string[]
  weak_points: string[]
  three_line_summary: string[]
  advice: string[]
  share_quote: string
}
export interface Session {
  quiz: Quiz
  created_at: string
  updated_at: string
  current_index: number
  records: Record<string, AnswerRecord>
  status: 'not-started' | 'in-progress' | 'completed'
  report_status: 'none' | 'pending' | 'failed' | 'ready'
  report?: Report
}
export interface SavedState { version: 1; draft: string; sessions: Session[] }
