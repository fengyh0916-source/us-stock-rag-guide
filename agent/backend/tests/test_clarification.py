import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.agent import (  # noqa: E402
    Intent,
    clarification_reply,
    classify_intent,
    continue_clarification,
    start_clarification,
)
from app.rag import RAGService  # noqa: E402


class ClarificationRoutingTests(unittest.TestCase):
    def test_short_definition_questions_are_answered_directly(self):
        for question in ("美股是什么？", "ETF 是什么？", "我是新手，ETF 是什么？"):
            with self.subTest(question=question):
                self.assertEqual(classify_intent(question), Intent.KNOWLEDGE)

    def test_risk_education_is_not_misclassified_as_a_prohibited_request(self):
        self.assertEqual(
            classify_intent("为什么不应相信所谓稳赚不赔的美股方法？"),
            Intent.KNOWLEDGE,
        )

    def test_broad_path_questions_start_clarification(self):
        for question in ("我想买美股", "普通人该怎么买美股？", "该怎么出入金？"):
            with self.subTest(question=question):
                self.assertIn(classify_intent(question), (Intent.CLARIFY, Intent.GUIDE))

    def test_product_policy_answers_broad_questions_directly(self):
        service = RAGService(SimpleNamespace())
        for question in (
            "我想买美股",
            "普通人该怎么买美股？",
            "该怎么出入金？",
            "该怎么办港卡？",
        ):
            with self.subTest(question=question):
                intent, effective, _, decision = service._prepare_turn(
                    question, None, None
                )
                self.assertEqual(intent, Intent.KNOWLEDGE)
                self.assertEqual(effective, question)
                self.assertIsNone(decision)

    def test_each_turn_contains_exactly_one_question(self):
        decision = start_clarification("我想买美股")
        visible = clarification_reply(decision.question)
        self.assertEqual(visible.count("？"), 1)
        self.assertNotIn("2.", visible)

    def test_clarification_stops_after_two_questions(self):
        first = start_clarification("我想买美股")
        second = continue_clarification("D", first.state)
        self.assertEqual(second.action, "ask")
        self.assertEqual(second.state["asked_count"], 2)

        final = continue_clarification("A", second.state)
        self.assertEqual(final.action, "answer")
        self.assertIn("完整入门路线", final.effective_question)
        self.assertIn("只有大陆银行卡", final.effective_question)

    def test_answer_early_when_one_reply_is_enough(self):
        first = start_clarification("该怎么出入金？")
        final = continue_clarification("B", first.state)
        self.assertEqual(final.action, "answer")
        self.assertIn("已有港卡或其他境外银行账户", final.effective_question)

    def test_user_can_skip_clarification(self):
        first = start_clarification("我想买美股")
        final = continue_clarification("直接回答", first.state)
        self.assertEqual(final.action, "answer")
        self.assertIn("按一般情况直接说明", final.effective_question)

    def test_specific_new_question_resets_old_task(self):
        first = start_clarification("我想买美股")
        next_turn = continue_clarification("没有港卡能不能开盈透？", first.state)
        self.assertEqual(next_turn.action, "restart")
        self.assertEqual(next_turn.effective_question, "没有港卡能不能开盈透？")


class CapturingRetriever:
    def __init__(self):
        self.queries = []

    def search(self, query, top_k=5, tag_filter=None):
        self.queries.append(query)
        return [
            {
                "id": "test-1",
                "text": "已有境外银行账户时，可根据券商支持的方式核对入金和出金路径。",
                "chapter": "测试知识",
                "section": "资金进出",
                "page_start": 1,
                "page_end": 1,
                "tags": ["入金", "出金"],
                "url": "",
                "source": "pdf",
                "score": 5.0,
            }
        ]


class FakeCompletions:
    async def create(self, **kwargs):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="这是结合补充情况生成的测试回答。")
                )
            ]
        )


class ClarificationRAGTests(unittest.IsolatedAsyncioTestCase):
    async def test_final_answer_retrieves_with_collected_information(self):
        retriever = CapturingRetriever()
        service = RAGService(retriever)
        service._client = lambda: SimpleNamespace(
            chat=SimpleNamespace(completions=FakeCompletions())
        )
        first = start_clarification("该怎么出入金？")

        result = await service.chat(
            "B",
            history=[],
            clarification_state=first.state,
        )

        self.assertEqual(result["intent"], "knowledge")
        self.assertIsNone(result["clarification_state"])
        self.assertEqual(len(retriever.queries), 1)
        self.assertIn("已有港卡或其他境外银行账户", retriever.queries[0])

    async def test_legacy_state_is_answered_without_second_question(self):
        retriever = CapturingRetriever()
        service = RAGService(retriever)
        service._client = lambda: SimpleNamespace(
            chat=SimpleNamespace(completions=FakeCompletions())
        )
        first = start_clarification("我想买美股")

        result = await service.chat(
            "D",
            history=[],
            clarification_state=first.state,
        )

        self.assertEqual(result["intent"], "knowledge")
        self.assertIsNone(result["clarification_state"])
        self.assertEqual(len(retriever.queries), 1)
        self.assertIn("完整入门路线", retriever.queries[0])


if __name__ == "__main__":
    unittest.main()
