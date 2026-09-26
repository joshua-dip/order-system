"""요약 검증: 초안과 독립된 요지, 완성 문장 단위의 사실·문법 판정."""
from __future__ import annotations

CORE_SYS = """Read the passage independently, before seeing any proposed summary.
Return ONLY JSON: {"claim": one short English sentence stating the author's central point,
"qualification": an important limit, contrast or cause that must not be reversed (or ""),
"evidence": a short EXACT continuous quote from the passage supporting the claim}.
Distinguish the author's position from a belief being challenged. Examples support the point; do not replace it.
Do not infer a new cause, stronger quantifier or different time sequence. Quote at most 20 words without ellipses."""

MAIN_SYS = """Audit one COMPLETE proposed summary against the passage and the independent reading notes.
Return ONLY JSON: {"main_point": true|false, "supported": true|false, "grammatical": true|false,
"reason": a short concrete explanation}.
main_point: it preserves the author's central conclusion and essential qualification, rather than only a detail.
supported: EVERY assertion is stated or reasonably entailed. Check who did what, the cause, timing and degree.
grammatical: the complete English sentence reads naturally, with correct word forms and clause connections.
Reading notes are fallible; the passage is authoritative. Do not fix or mentally complete broken English.
There are NO blanks to solve in this task. Judge only the supplied complete sentence."""

CANDIDATE_SYS = """Audit this COMPLETE sentence against the passage. No intended answer is supplied.
Return ONLY JSON: {"supported": true|false, "grammatical": true|false, "reason": a short concrete explanation}.
supported=true if a careful reader could reasonably defend the WHOLE sentence using the passage, even if another
wording would be more precise. Do NOT reject it merely because it differs from an expected answer, uses a broader
fair paraphrase, or expresses a different supported relationship. False requires an identifiable unsupported or
contradictory assertion; explain which assertion and why. Check the two substituted ideas TOGETHER.
grammatical=true only if the sentence as written reads naturally. Do not silently repair missing words or bad syntax."""


def boolean_fields(obj: dict | None, fields: tuple[str, ...]) -> bool:
    return isinstance(obj, dict) and all(type(obj.get(key)) is bool for key in fields)


def read_core(call, passage: str) -> dict | None:
    feedback = ""
    for attempt in range(2):
        obj = call(CORE_SYS, f"[Passage]\n{passage}\n\nReturn JSON with an exact evidence quote." + feedback,
                   max_tokens=240, t=0.0)
        if not isinstance(obj, dict):
            feedback = "\nThe previous response was unreadable. Return a compact JSON object."
            continue
        claim, evidence = obj.get("claim"), obj.get("evidence")
        if (isinstance(claim, str) and claim.strip() and isinstance(evidence, str) and evidence.strip()
                and " ".join(evidence.split()) in " ".join(passage.split())):
            return {"claim": claim, "qualification": str(obj.get("qualification") or ""), "evidence": evidence}
        feedback = (f"\nThe previous evidence was not an exact continuous source quote: {evidence!r}."
                    " Copy a shorter continuous phrase directly from the passage; preserve punctuation and quotation marks."
                    " Do not add closing quotation marks that are absent at the selected location.")
    return None


def review_main(call, passage: str, sentence: str, core: dict) -> dict | None:
    user = (f"[Passage]\n{passage}\n\n[Independent reading notes]\n{core['claim']}\n{core['qualification']}"
            f"\n\n[Complete sentence]\n{sentence}\n\nReturn JSON.")
    for attempt in range(2):
        obj = call(MAIN_SYS, user, max_tokens=220, t=0.0)
        if boolean_fields(obj, ("main_point", "supported", "grammatical")):
            return obj
    return None


def review_candidate(call, passage: str, sentence: str) -> dict | None:
    for attempt in range(2):
        obj = call(CANDIDATE_SYS, f"[Passage]\n{passage}\n\n[Complete sentence]\n{sentence}\n\nReturn JSON.",
                   max_tokens=180, t=0.0)
        if boolean_fields(obj, ("supported", "grammatical")):
            return obj
    return None
