"""실제 모델을 부르지 않고 검증 입력 분리·판독 실패 처리를 확인한다."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from summary_review import read_core, review_main, review_candidate


class SummaryReviewTest(unittest.TestCase):
    def test_core_requires_evidence_present_in_source(self):
        call = Mock(side_effect=[{"claim": "Unsupported", "evidence": "invented"},
                                 {"claim": "A supported claim", "qualification": "", "evidence": "actual evidence"}])
        self.assertIsNotNone(read_core(call, "Here is actual evidence in the text."))
        self.assertEqual(call.call_count, 2)
        self.assertIn("previous evidence", call.call_args.args[1])
        self.assertIn("invented", call.call_args.args[1])
        call = Mock(return_value={"claim": "Bad", "evidence": ""})
        self.assertIsNone(read_core(call, "Source text"))

    def test_main_sees_only_complete_summary(self):
        call = Mock(return_value={"main_point": True, "supported": True, "grammatical": True})
        review_main(call, 'The source.', 'The full completed sentence.', {'claim': 'The claim.', 'qualification': ''})
        user = call.call_args.args[1]
        self.assertIn('[Complete sentence]\nThe full completed sentence.', user)
        self.assertNotIn('[Blank summary]', user)
        self.assertNotIn('________', user)

    def test_missing_or_string_boolean_is_unknown(self):
        for obj in ({}, {'supported': 'false', 'grammatical': True}, {'supported': False}):
            call = Mock(return_value=obj)
            self.assertIsNone(review_candidate(call, 'Source.', 'Candidate.'))
            self.assertEqual(call.call_count, 2)

    def test_candidate_has_no_intended_answer_hint(self):
        call = Mock(return_value={'supported': True, 'grammatical': True})
        result = review_candidate(call, 'Source.', 'The alternative complete sentence.')
        self.assertTrue(result['supported'])
        self.assertEqual(call.call_args.args[1], '[Passage]\nSource.\n\n[Complete sentence]\nThe alternative complete sentence.\n\nReturn JSON.')


if __name__ == '__main__':
    unittest.main()
