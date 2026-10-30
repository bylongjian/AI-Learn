"""Local interaction sample. Fake external boundaries; never used by app.main.

Run from backend: python -m scripts.quiz_sample
Open http://127.0.0.1:8000 after building the H5 frontend.
"""
from pathlib import Path
import re

from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from app.core.config import Settings
from app.main import create_app
from app.models.knowledge import PreparedKnowledge

SAMPLE_TEXT = "本样品仅验证领域选择和资料不足时的交互，不是实际检索结果。"


class SampleKnowledge:
    async def prepare(self, request):
        if "资料不足" in request.user_input:
            return PreparedKnowledge(status="insufficient", topic=request.user_input)
        source = {"id": "s1", "kind": "user_text", "title": "模拟交互资料", "url": None,
                  "published_at": None, "excerpt": SAMPLE_TEXT}
        if "网页来源" in request.user_input:
            source.update(kind="web", title="模拟网页来源", url="https://example.org/sample")
        if not request.topic_context:
            return PreparedKnowledge(status="clarification", topic=request.user_input, sources=[source], options=[
                {"label": "【模拟】AI 开发", "description": "演示选择一个学习领域后继续出题；此选项不是检索结论。", "source_ids": ["s1"]},
                {"label": "【模拟】其他工程领域", "description": "演示同名概念的另一种选择；具体领域应由真实检索确定。", "source_ids": ["s1"]},
            ])
        return PreparedKnowledge(status="ready", topic=request.topic_context, sources=[source])


class SampleProvider:
    async def complete(self, schema, messages):
        if schema.__name__ == "EvidenceReview":
            return {"questions": [{"question_id": f"q{i}", "passed": True, "issue": "",
                                   "evidence": [{"source_id": "s1", "quote": SAMPLE_TEXT}]} for i in range(1, 6)]}
        if schema.__name__ == "ReportText":
            return {"three_line_summary": ["你体验了模拟选择流程", "资料不足时应当暂停出题", "实际知识仍需真实来源验证"],
                    "advice": ["此样品用于确认交互，不能用于验证知识是否最新。"], "share_quote": "从明确学习目标开始"}
        text = "\n".join(str(message.content) for message in messages)
        domain = re.search(r"确认的领域：([^\n]+)", text)
        topic = domain.group(1) if domain else "模拟领域"
        questions = []
        for index in range(1, 6):
            kind = "single" if index <= 3 else "multiple" if index == 4 else "judge"
            questions.append({"id": f"q{index}", "type": kind,
                "stem": f"【模拟题 {index}】这组题可以用来确认什么？",
                "options": [{"key": key, "text": value} for key, value in zip("AB" if kind == "judge" else "ABCD",
                    ["领域选择的操作路径", "资料不足时的提示" if kind == "multiple" else "新知识的真实性", "真实搜索结果", "实际模型能力"])],
                "answer": ["A", "B"] if kind == "multiple" else ["A"],
                "explanation": SAMPLE_TEXT, "knowledge_point": "样品交互", "difficulty": "easy"})
        questions[-1].update(stem="【模拟题 5】本样品可以证明真实联网知识准确。",
                             options=[{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}], answer=["B"])
        return {"title": f"【模拟样品】{topic[:40]}", "summary": SAMPLE_TEXT, "questions": questions,
                "question_sources": [{"question_id": q["id"], "source_ids": ["s1"]} for q in questions]}


def create_sample_app():
    app = create_app(Settings(_env_file=None, app_env="development"), provider=SampleProvider(), knowledge_service=SampleKnowledge())
    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "h5"

    @app.get("/", response_class=HTMLResponse)
    async def sample_index():
        html = (dist / "index.html").read_text(encoding="utf-8")
        banner = '<div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff1cb;color:#513c14;text-align:center;font:13px/28px sans-serif">模拟交互样品 · 不代表真实搜索结果</div>'
        return HTMLResponse(html.replace("<body>", "<body>" + banner))

    app.mount("/", StaticFiles(directory=dist, html=True), name="sample-assets")
    return app


if __name__ == "__main__":
    uvicorn.run(create_sample_app(), host="127.0.0.1", port=8000)
