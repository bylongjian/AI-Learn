import logging
from uuid import uuid4
from app.core.content import ContentGuard
from app.llm.generation import ReliableGenerator
from app.models.quiz import Quiz, QuizContent, QuizRequest
from app.prompts.quiz import QUIZ_PROMPT

logger = logging.getLogger(__name__)


class QuizService:
    def __init__(self, generator: ReliableGenerator, guard: ContentGuard):
        self.generator, self.guard = generator, guard

    async def generate(self, request: QuizRequest) -> Quiz:
        self.guard.check(request.user_input)

        def validate(content: QuizContent) -> None:
            types = [q.type for q in content.questions]
            if len(types) != request.question_count or types.count("single") != request.question_count - 2 or types.count("multiple") != 1 or types.count("judge") != 1:
                logger.warning("quiz rejected; reason=count_or_distribution_mismatch expected_count=%d actual_count=%d types=%s",
                               request.question_count, len(types), types)
                raise ValueError("Generated quiz does not match requested count/distribution")
            if request.difficulty != "mixed" and any(q.difficulty != request.difficulty for q in content.questions):
                logger.warning("quiz rejected; reason=difficulty_mismatch expected_difficulty=%s difficulties=%s",
                               request.difficulty, [q.difficulty for q in content.questions])
                raise ValueError("Generated quiz does not match requested difficulty")

        content = await self.generator.generate(QuizContent, QUIZ_PROMPT,
            {**request.model_dump(), "single_count": request.question_count - 2}, validate)
        return Quiz(**content.model_dump(), quiz_id=str(uuid4()), user_input=request.user_input)
