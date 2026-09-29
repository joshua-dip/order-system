"""파일럿 2 코드 검사 — 모델 없이 돈다(시험 문장은 직접 지은 것).
  ml/topic/.venv/bin/python -m unittest ml/eval/test_c003_checks.py -v"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "ml/common"), str(ROOT / "ml/eval")]

from test_c002_checks import _load  # noqa: E402
from json_extract import looks_truncated, trim_to_sentence, unify_end_period  # noqa: E402

edit = _load("edit_pipeline_t3", ROOT / "ml/common/edit_pipeline.py")
blank = _load("pipeline_blank_t3", ROOT / "ml/blank/windows/pipeline_blank.py")


class Truncation(unittest.TestCase):
    def test_open_quote_is_truncated(self):
        self.assertTrue(looks_truncated("정답은 ②. 뒤 문장 「Street trees are"))
        self.assertEqual(trim_to_sentence("정답은 ②. 뒤 문장은 'Street trees..."), "")

    def test_cut_at_last_closed_sentence(self):
        self.assertEqual(trim_to_sentence("정답은 ④. 이유는 다음과 같다. 「The trees give shade. They also"),
                         "정답은 ④. 이유는 다음과 같다.")

    def test_complete_kept(self):
        t = "정답은 ③. 뒤 문장 「trees give shade」가 핵심이다."
        self.assertFalse(looks_truncated(t))
        self.assertEqual(trim_to_sentence(t), t)


class EndPeriod(unittest.TestCase):
    def test_lonely_period_removed(self):
        self.assertEqual(unify_end_period(["plant more trees.", "cut trees", "sell land", "build walls", "pave roads"]),
                         ["plant more trees", "cut trees", "sell land", "build walls", "pave roads"])

    def test_majority_period_added(self):
        got = unify_end_period(["We should plant trees.", "We must cut trees.", "Cities need walls.", "Roads matter", "Land is cheap."])
        self.assertTrue(all(o.endswith(".") for o in got))

    def test_question_marks_untouched(self):
        self.assertEqual(unify_end_period(["Why Trees?", "Shade Wins.", "Green Streets", "Roots Below", "Cool Cities"])[0], "Why Trees?")


class Restates(unittest.TestCase):
    SENTS = ["Street trees give residents shade on hot summer afternoons.",
             "They also lower energy bills for nearby houses."]

    def test_paraphrase_caught(self):
        r, same = edit._restates("Residents enjoy shade from street trees during hot summer afternoons.", self.SENTS)
        self.assertGreaterEqual(r, 0.5)
        self.assertEqual(same, self.SENTS[0])

    def test_side_topic_passes(self):
        r, _ = edit._restates("Painting fences every spring keeps neighborhoods looking cheerful for visitors.", self.SENTS)
        self.assertLess(r, 0.5)


class Synonym(unittest.TestCase):
    def test_flags_same_meaning_distractor(self):
        opts = ["planting trees", "cutting trees", "growing trees along streets", "paving roads", "building walls"]
        def call(sys_p, user, **k):
            return {"same": "growing trees along streets" in user}
        self.assertEqual(blank._synonym_distractors(call, "…<u>_____</u>…", "planting trees", opts, 0, []), [2])


if __name__ == "__main__":
    unittest.main()
