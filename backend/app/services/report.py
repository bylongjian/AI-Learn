import json
from app.core.content import ContentGuard
from app.llm.generation import ReliableGenerator
from app.models.report import Report, ReportNarrative, ReportRequest
from app.prompts.report import REPORT_PROMPT
from app.services.scoring import score_answers


class ReportService:
    def __init__(self, generator: ReliableGenerator, guard: ContentGuard):
        self.generator, self.guard = generator, guard

    async def generate(self, request: ReportRequest) -> Report:
        self.guard.check(request.model_dump())
        score = score_answers(request)
        selections = {r.question_id: r.selected_answers for r in request.answer_records}
        answers = [{**q.model_dump(), "selected_answers": selections[q.id]} for q in request.questions]
        narrative = await self.generator.generate(ReportNarrative, REPORT_PROMPT, {
            "topic": request.topic, "stats": json.dumps(score.model_dump(), ensure_ascii=False),
            "answers": json.dumps(answers, ensure_ascii=False),
        })
        return Report(quiz_id=request.quiz_id, **score.model_dump(), **narrative.model_dump())
