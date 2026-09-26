#!/usr/bin/env python3
"""대안 초안 경로만 실모델로 확인한다. LoRA 응답만 비워 실패를 재현한다.

  caffeinate -i ml/topic/.venv/bin/python ml/eval/probe_summary_fallback.py \
      --set sep26-go1 --label <고유-label>-forced-fallback --nums 35번,41~42번 --repeat 2

이 결과는 강제로 LoRA를 실패시킨 진단용이며 일반 생성률·품질 점수에 합치지 않는다.
35B 초안·내용 검증·해설은 실제 로컬 모델을 사용한다. 운영 파이프라인 설정은 바꾸지 않는다.
"""
import runpy
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "ml/common"))
    import mlx_runtime

    original = mlx_runtime.chat_text

    def fail_lora(*args, **kwargs):
        return "{}" if kwargs.get("use_adapter") else original(*args, **kwargs)

    mlx_runtime.chat_text = fail_lora
    # 항상 요약만 검사한다. 다른 유형의 시험 결과를 강제 실패로 오염시키지 않는다.
    sys.argv.extend(["--types", "summary"])
    try:
        runpy.run_path(str(root / "ml/eval/run_eval.py"), run_name="__main__")
    finally:
        mlx_runtime.chat_text = original


if __name__ == "__main__":
    main()
