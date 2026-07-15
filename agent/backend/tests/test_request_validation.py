import unittest

from pydantic import ValidationError

from app.main import ChatRequest


class AgentRequestValidationTests(unittest.TestCase):
    def test_history_is_limited_to_eight_messages(self):
        with self.assertRaises(ValidationError):
            ChatRequest(
                message="美股是什么？",
                history=[{"role": "user", "content": "x"}] * 9,
            )

    def test_history_roles_and_lengths_are_bounded(self):
        with self.assertRaises(ValidationError):
            ChatRequest(
                message="美股是什么？",
                history=[{"role": "system", "content": "x"}],
            )
        with self.assertRaises(ValidationError):
            ChatRequest(
                message="美股是什么？",
                history=[{"role": "user", "content": "x" * 4001}],
            )


if __name__ == "__main__":
    unittest.main()
