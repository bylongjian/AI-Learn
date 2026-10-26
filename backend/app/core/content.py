import json
from app.core.errors import AppError


class ContentGuard:
    """Configurable local screening; this is not a comprehensive moderation service."""

    def __init__(self, blocked_terms: list[str]):
        self.blocked_terms = [term.casefold() for term in blocked_terms if term.strip()]

    def check(self, content) -> None:
        text = (content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)).casefold()
        if any(term in text for term in self.blocked_terms):
            raise AppError(42202, "内容暂不支持，请调整学习主题后重试", 422)
