"""Local UI test server: real API/scoring, fixed prototype AI content, no paid requests."""
import asyncio
import json
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.main import create_app
from app.core.config import Settings


class PrototypeProvider:
    async def complete(self, schema, messages):
        await asyncio.sleep(0.25)
        if "questions" in schema.model_fields:
            payload = json.loads((ROOT / "frontend/tests/fixtures/quiz-content.json").read_text(encoding="utf-8"))
        else:
            payload = {"three_line_summary": ["先检索，再生成。", "外部资料为回答提供依据。", "检索质量会影响回答质量。"],
                       "advice": ["先回看待巩固的讲解，再用自己的话解释一次。"],
                       "share_quote": "把好奇，变成一小关。"}
        return schema.model_validate(payload)


if __name__ == "__main__":
    app = create_app(Settings(_env_file=None, rate_limit_requests=1000), PrototypeProvider())
    print("UI TEST ONLY: fixed prototype AI content; no external model calls", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
