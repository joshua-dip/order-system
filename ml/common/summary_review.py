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


KEY_FILL_SYS = """You complete a one-sentence summary of the passage. Output ONLY one JSON object. No markdown.
Keys: A (1-3 words for blank (A)), B (1-3 words for blank (B)), can_be_true (true|false), reason (short English).
Fill (A) and (B) so the completed sentence states the passage accurately: same direction, same strength and the same
cause-effect as the passage. If the words OUTSIDE the blanks already misstate the passage (wrong cause, reversed
relation, a claim the passage does not make), so that no filling can make the sentence true, set can_be_true false."""

KEY_CMP_SYS = """You check the answer key of a summary-completion question against the passage. Output ONLY one JSON object. No markdown.
Keys: A_ok (true|false), B_ok (true|false), reason (short English).
[Reference] is one careful reader's filling, given only for comparison — the key does NOT need to match it.
Default X_ok = true. Set X_ok = false ONLY when the key's word makes the sentence clearly FALSE to the passage:
- it points the opposite way or reverses the relation (complicated → effortless, buy → exploit, ignore → exaggerate);
- it clearly overstates or understates the passage (failed to develop → collapsed; great → exclusive);
- it names a different thing than the passage says (physical improvement → emotional).
A near-synonym, a broader or narrower but fair word, a different part of speech, or a slightly different nuance is OK."""


def key_warning(call, passage: str, summary: str, key: tuple[str, str]) -> tuple[str | None, dict]:
    """정답 쌍을 가리고 먼저 채우게 한 뒤, 정답 낱말이 지문과 분명히 어긋나는 칸만 경고(고칠 낱말 포함)로 돌려준다.
    완성 문장 요지 검사는 「exploit the potential」(지문은 buy)·「so effortless」(지문은 complicated)도 통과시켰다.
    채점된 170문항: X 7건 중 6건을 잡고, 나머지 163건 중 15건에 걸린다(절반 넘게는 실제 흠) — 그래서 버리지 않고
    검수 때 고치도록 경고만 단다(09-30)."""
    fill = call(KEY_FILL_SYS, f"[Passage]\n{passage}\n\n[Summary]\n{summary}\n\nReturn JSON.", max_tokens=160, t=0.0) or {}
    if fill.get("can_be_true") is False:
        return f"요약문 자체가 지문과 어긋날 수 있음 — {str(fill.get('reason') or '')[:120]}", {"fill": fill}
    ref = (str(fill.get("A") or "").strip(), str(fill.get("B") or "").strip())
    if not all(ref):
        return None, {"fill": fill}
    cmp_ = call(KEY_CMP_SYS, f"[Passage]\n{passage}\n\n[Summary]\n{summary}\n\n[Reference]\n(A) {ref[0]} – (B) {ref[1]}\n\n"
                f"[Key]\n(A) {key[0]} – (B) {key[1]}\n\nReturn JSON.", max_tokens=160, t=0.0) or {}
    bad = [f"({x}) {k} → {r}?" for x, k, r, ok in (("A", key[0], ref[0], cmp_.get("A_ok")), ("B", key[1], ref[1], cmp_.get("B_ok")))
           if ok is False]
    if not bad:
        return None, {"fill": fill, "cmp": cmp_}
    return f"정답 쌍 확인 필요 {' '.join(bad)} — {str(cmp_.get('reason') or '')[:140]}", {"fill": fill, "cmp": cmp_}
