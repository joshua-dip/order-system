"""사이클 #2 코드 검사 — 모델 없이 돈다.
  ml/topic/.venv/bin/python -m unittest ml/eval/test_c002_checks.py -v"""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "ml/common"), str(ROOT / "ml/fact"), str(ROOT / "ml/fact/windows")]


def _load(name, path):
    import types
    sys.modules.setdefault("cuda_runtime", types.SimpleNamespace(**{k: None for k in (
        "adapter_exists chat_json chat_text load_base_model_name load_model resolve_use_4bit set_adapter").split()}))
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


fact = _load("pipeline_fact_t", ROOT / "ml/fact/windows/pipeline_fact.py")
edit = _load("edit_pipeline_t", ROOT / "ml/common/edit_pipeline.py")

# 시험용 지문은 직접 지어 쓴 문장이다(교재 원문·문항은 공개 저장소에 두지 않는다)
PASSAGE = ("Street trees are an ordinary part of city blocks and quiet suburbs, and so many residents "
           "enjoy the shade of street trees planted along their sidewalks. However, few notice that street trees "
           "have practical value other than their pleasant shade. Indeed, street trees are inexpensive and can "
           "provide several benefits concrete planters can't offer.")


class Verbatim(unittest.TestCase):
    def test_mismatch_answer_is_verbatim(self):
        self.assertTrue(fact.verbatim_in_passage("Many residents enjoy the shade of street trees planted along their sidewalks.", PASSAGE))

    def test_one_word_change_is_not_verbatim(self):
        self.assertFalse(fact.verbatim_in_passage("Street trees are more expensive than concrete planters.", PASSAGE))
        self.assertFalse(fact.verbatim_in_passage("Few residents enjoy the shade of street trees planted along their sidewalks.", PASSAGE))

    def test_negated_in_passage_is_not_true(self):
        # 운영 스캔에서 본 오탐 유형: 원문의 부정(not …)을 뺀 선지는 「원문 그대로」가 아니다
        text = "Keep in mind that not every member always shares the same view on how the plan should run. So listen first."
        self.assertFalse(fact.verbatim_in_passage("Every member always shares the same view on how the plan should run.", text))
        self.assertTrue(fact.verbatim_in_passage("Every member always shares the same view on how the plan should run.",
                                                 "In this club every member always shares the same view on how the plan should run."))

    def test_short_fragment_ignored(self):
        self.assertFalse(fact.verbatim_in_passage("Street trees are inexpensive.", PASSAGE))

    def test_curly_quote_and_case(self):
        self.assertTrue(fact.verbatim_in_passage("STREET TREES CAN PROVIDE SEVERAL BENEFITS CONCRETE PLANTERS CAN’T OFFER", PASSAGE.replace("street trees are inexpensive and can", "street trees can")))


class Endorse(unittest.TestCase):
    def test_vocab_explanation_endorses_wrong_word(self):
        self.assertTrue(edit.endorses_wrong_word("…이는 가로수의 그늘을 외면한다는 의미와 맥락이 연결되므로 ①ignore가 문맥상 적절해 보입니다.", "ignore"))

    def test_correct_explanations_pass(self):
        for text in ("①이 정답입니다. 문맥상 ignore가 아니라 enjoy가 적절합니다.",
                     "ignore는 문맥에 맞지 않으므로 enjoy로 고쳐야 합니다.",
                     "ignore는 적절하지 않다.",
                     "①이 정답입니다. 원래 낱말 enjoy가 적절합니다."):
            self.assertFalse(edit.endorses_wrong_word(text, "ignore"), text)

    def test_word_boundary(self):
        self.assertFalse(edit.endorses_wrong_word("ignored가 적절합니다", "ignore"))


if __name__ == "__main__":
    unittest.main()
