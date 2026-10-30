import asyncio
import json
import logging
from uuid import uuid4
from app.core.content import ContentGuard
from app.llm.generation import ReliableGenerator
from app.models.quiz import Quiz, GroundedQuizContent, QuizRequest
from app.models.knowledge import QuizReference
from app.prompts.quiz import QUIZ_PROMPT
from app.core.errors import AppError, TopicClarification
from app.services.search import KnowledgeService, insufficient
from app.services.evidence import EvidenceService

logger = logging.getLogger(__name__)


class QuizService:
    def __init__(self, generator: ReliableGenerator, guard: ContentGuard, knowledge=None):
        self.generator, self.guard = generator, guard
        self.settings = generator.settings
        self.knowledge = knowledge or KnowledgeService(self.settings, generator, model=getattr(generator.provider, "llm", None))
        self.evidence = EvidenceService(generator)

    async def generate(self, request: QuizRequest) -> Quiz:
        self.guard.check(request.user_input)
        self.guard.check(request.topic_context or "")
        knowledge = await self.knowledge.prepare(request)
        if knowledge.status == "clarification":
            self.guard.check([option.model_dump() for option in knowledge.options])
            raise TopicClarification(knowledge.options)
        if knowledge.status != "ready":
            raise insufficient()
        self.guard.check(knowledge.model_dump())

        def validate(content: GroundedQuizContent) -> None:
            types = [q.type for q in content.questions]
            if len(types) != request.question_count or types.count("single") != request.question_count - 2 or types.count("multiple") != 1 or types.count("judge") != 1:
                logger.warning("quiz rejected; reason=count_or_distribution_mismatch expected_count=%d actual_count=%d types=%s",
                               request.question_count, len(types), types)
                raise ValueError("Generated quiz does not match requested count/distribution")
            if request.difficulty != "mixed" and any(q.difficulty != request.difficulty for q in content.questions):
                logger.warning("quiz rejected; reason=difficulty_mismatch expected_difficulty=%s difficulties=%s",
                               request.difficulty, [q.difficulty for q in content.questions])
                raise ValueError("Generated quiz does not match requested difficulty")
            identifiers = {source.id for source in knowledge.sources}
            if any(not set(item.source_ids) <= identifiers for item in content.question_sources):
                raise ValueError("Generated source association does not exist")

        variables = {**request.model_dump(), "single_count": request.question_count - 2,
                     "confirmed_topic": knowledge.topic, "context": knowledge.model_dump_json(), "correction": ""}
        try:
            async with asyncio.timeout(self.settings.quiz_build_timeout_seconds):
                for attempt in range(2):
                    content = await self.generator.generate(GroundedQuizContent, QUIZ_PROMPT, variables, validate)
                    passed, issue = await self.evidence.check(content, knowledge)
                    if passed:
                        reference = QuizReference(topic=knowledge.topic, retrieved_at=knowledge.retrieved_at,
                                                  sources=knowledge.sources, question_sources=content.question_sources)
                        return Quiz(**content.model_dump(exclude={"question_sources"}), quiz_id=str(uuid4()),
                                    user_input=request.user_input, reference=reference)
                    variables["correction"] = json.dumps({"quiz": content.model_dump(), "issue": issue}, ensure_ascii=False)
                raise AppError(50302, "题目依据检查未通过，请重试或补充学习资料", 503)
        except TimeoutError:
            raise AppError(50401, "题目生成或依据检查超时，请重试", 504) from None
