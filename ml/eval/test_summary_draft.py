"""대안 초안의 빈칸 위치가 정답 표현과 어긋나지 않는지 검증한다(모델 호출 없음)."""
import sys
import unittest
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from summary_draft import draft_from_spans
from summary_review import CORE_SYS, CANDIDATE_SYS


class SummaryDraftTest(unittest.TestCase):
    def draft(self, sentence="Regular maintenance prevents failures and extends the useful life of equipment.", **changes):
        value = {"sentence": sentence, "A": "prevents", "B": "extends",
                 "distractors": [["causes", "extends"], ["prevents", "shortens"],
                                 ["causes", "shortens"], ["ignores", "reduces"]]}
        return dict(value, **changes)

    def test_mask_round_trip_and_answer_pair(self):
        draft = self.draft()
        parsed = draft_from_spans(draft)
        self.assertEqual(parsed["answer"], 1)
        self.assertEqual(len(parsed["pairs"]), 5)
        a, b = parsed["pairs"][0]
        self.assertEqual(parsed["summary"].replace("(A) ________", a).replace("(B) ________", b), draft["sentence"])

    def test_phrases_punctuation_and_case(self):
        parsed = draft_from_spans(self.draft("Social trust, when earned, strengthens team cohesion.", A="social trust", B="team cohesion"))
        self.assertEqual(parsed["pairs"][0], ["Social trust", "team cohesion"])
        self.assertEqual(parsed["summary"], "(A) ________, when earned, strengthens (B) ________.")

    def test_rejects_missing_repeated_reversed_overlapping_targets(self):
        drafts = [self.draft(A="prevent"), self.draft(A="equipment", B="prevents"),
                  self.draft("It prevents failures and prevents waste, which extends equipment life."),
                  self.draft(A="useful life", B="life"), self.draft(A="prevents", B="prevents"),
                  self.draft("It prevents-failures and extends life."),
                  self.draft("It prevents failures and extends life's value.", B="life")]
        for draft in drafts:
            with self.subTest(draft=draft):
                self.assertIsNone(draft_from_spans(draft))

    def test_rejects_preexisting_blanks_and_malformed_model_output(self):
        for draft in [None, {}, self.draft(sentence="(A) ________ prevents failures and extends life."),
                      self.draft(A=1), self.draft(distractors=[]),
                      self.draft(distractors=[["causes", None]] * 4)]:
            with self.subTest(draft=draft):
                self.assertIsNone(draft_from_spans(draft))

    def exercise_pipeline(self, overrides=None):
        path = Path(__file__).resolve().parents[1] / "summary/windows/pipeline_summary.py"
        spec = importlib.util.spec_from_file_location("summary_pipeline_test", path)
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
        calls = []

        def respond(model, tokenizer, system, user, **kwargs):
            calls.append(system)
            if overrides and system in overrides:
                result = overrides[system]
                value = result(user) if callable(result) else result
            elif system == CORE_SYS:
                value = {"claim": "Maintenance prevents failures and extends equipment life.", "qualification": "",
                         "evidence": "Regular maintenance prevents failures"}
            elif system == pipeline.SYSTEM_PROMPT:
                value = {}  # LoRA 세 번 모두 형식 실패 → 대안 경로를 실제로 거친다.
            elif system == pipeline.DRAFT35_SYS:
                value = self.draft()
            elif system == pipeline.MAIN_SYS:
                value = {"main_point": True, "supported": True, "grammatical": True}
            elif system == pipeline.CHECK_SYS:
                options = user.split('[Complete candidates]\n')[1].split('\n\n')[0].splitlines()
                value = {"checks": [{"i": i + 1, "verdict": "fits" if 'prevents failures and extends' in line else 'wrong'}
                                    for i, line in enumerate(options)]}
            elif system == CANDIDATE_SYS:
                value = {"supported": False, "grammatical": True}
            elif system == pipeline.EXPLAIN_SYS:
                value = {"Explanation": "①이 정답입니다. 정기적인 유지보수가 고장을 예방하고 장비의 사용 수명을 늘린다는 지문의 요지를 두 표현이 정확하게 요약합니다."}
            else:
                value = {"answer": "①", "also_defensible": []}
            return json.dumps(value, ensure_ascii=False)

        with patch.object(pipeline, 'chat_text', side_effect=respond), \
             patch.object(pipeline.random, 'shuffle', side_effect=lambda order: None):
            result = pipeline.run_pipeline(None, None, 'Regular maintenance prevents failures and extends equipment life.')
        return pipeline, calls, result

    def test_lora_failure_reaches_span_fallback_and_content_checks(self):
        pipeline, calls, result = self.exercise_pipeline()
        self.assertTrue(result['ok'])
        self.assertEqual(calls.count(pipeline.SYSTEM_PROMPT), 3)
        self.assertEqual(calls.count(pipeline.CHECK_SYS), 2)
        self.assertIn(pipeline.MAIN_SYS, calls)
        self.assertIn(CANDIDATE_SYS, calls)
        self.assertEqual(result['question_data']['CorrectAnswer'], '①')
        self.assertIn('(A) ________', result['question_data']['Paragraph'])
        self.assertIn('(B) ________', result['question_data']['Paragraph'])

    def test_unknown_or_also_correct_distractors_cannot_pass(self):
        for verdict in ({}, {"supported": True, "grammatical": True}):
            with self.subTest(verdict=verdict):
                _, _, result = self.exercise_pipeline({CANDIDATE_SYS: verdict})
                self.assertFalse(result['ok'])
                self.assertIn('유일성', result['error'])

    def test_unreadable_main_review_cannot_pass(self):
        from summary_review import MAIN_SYS
        _, _, result = self.exercise_pipeline({MAIN_SYS: {}})
        self.assertFalse(result['ok'])

    def test_reordered_verdict_ids_and_duplicate_ids(self):
        pipeline, _, _ = self.exercise_pipeline()
        checks = [{"i": i, "verdict": "fits" if i == 2 else "wrong"} for i in range(5, 0, -1)]
        self.assertEqual(pipeline._verdicts({"checks": checks}), ['wrong', 'fits', 'wrong', 'wrong', 'wrong'])
        checks[0]['i'] = checks[1]['i']
        self.assertIsNone(pipeline._verdicts({"checks": checks}))


if __name__ == "__main__":
    unittest.main()
