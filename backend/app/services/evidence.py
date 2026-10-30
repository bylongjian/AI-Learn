from app.models.knowledge import EvidenceReview
from app.prompts.evidence import EVIDENCE_PROMPT


class EvidenceService:
    def __init__(self, generator):
        self.generator = generator

    async def check(self, content, knowledge):
        result = await self.generator.generate(EvidenceReview, EVIDENCE_PROMPT,
            {"context": knowledge.model_dump_json(), "quiz": content.model_dump_json()})
        sources = {source.id: source for source in knowledge.sources}
        associations = {item.question_id: set(item.source_ids) for item in content.question_sources}
        actual = [review.question_id for review in result.questions]
        if len(set(actual)) != len(actual) or set(actual) != set(associations):
            return False, "审核结果未覆盖全部题目"
        for review in result.questions:
            if not review.passed:
                return False, review.issue or "题目未得到资料支持"
            if not review.evidence:
                return False, "审核没有提供原文依据"
            for evidence in review.evidence:
                source = sources.get(evidence.source_id)
                if (source is None or evidence.source_id not in associations[review.question_id]
                        or not evidence.quote.strip() or evidence.quote not in source.excerpt):
                    return False, "审核引用不是对应资料中的原文"
        return True, ""
