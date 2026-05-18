"""
영어 서·논술형 평가 PDF 렌더러
=========================================

JSON 데이터를 Jinja2 템플릿으로 렌더링한 뒤 WeasyPrint로 A4 PDF 변환.

사용법:
    python render.py <data.json> <output.pdf>

예시:
    python render.py example_data.json mock_exam_3.pdf

필수 패키지:
    pip install weasyprint jinja2

시스템 요구사항:
    - Noto CJK KR 폰트 설치 (한글 렌더링용)
      Ubuntu: sudo apt install fonts-noto-cjk fonts-noto-cjk-extra
      macOS: brew install font-noto-cjk
"""
import json
import sys
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML


def render_exam(data_path: str | Path, output_path: str | Path) -> None:
    """JSON 데이터 → PDF 파이프라인.
    
    Args:
        data_path: 문제 데이터 JSON 파일 경로
        output_path: 생성할 PDF 파일 경로
    """
    script_dir = Path(__file__).resolve().parent
    data_path = Path(data_path)
    output_path = Path(output_path)

    # 1. JSON 데이터 로드
    with open(data_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 2. Jinja2 환경 구성 (HTML 태그 그대로 렌더링 — autoescape=False)
    env = Environment(
        loader=FileSystemLoader(script_dir),
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template('exam_template.html')
    html_string = template.render(**data)

    # 3. WeasyPrint로 PDF 변환
    # base_url을 지정해 styles.css 상대경로 해석
    HTML(string=html_string, base_url=str(script_dir)).write_pdf(str(output_path))

    print(f'✓ PDF 생성 완료: {output_path}')
    print(f'  페이지: 총 2페이지 (시험지 1p + 정답지 1p)')


def render_from_dict(data: dict, output_path: str | Path) -> None:
    """딕셔너리를 직접 받아 렌더링 (Claude API 결과 바로 렌더링용).
    
    Args:
        data: 문제 데이터 딕셔너리 (example_data.json과 동일 스키마)
        output_path: 생성할 PDF 파일 경로
    """
    script_dir = Path(__file__).resolve().parent
    output_path = Path(output_path)

    env = Environment(
        loader=FileSystemLoader(script_dir),
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template('exam_template.html')
    html_string = template.render(**data)

    HTML(string=html_string, base_url=str(script_dir)).write_pdf(str(output_path))
    print(f'✓ PDF 생성 완료: {output_path}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python render.py <data.json> <output.pdf>')
        print('Example: python render.py example_data.json mock_exam_3.pdf')
        sys.exit(1)
    render_exam(sys.argv[1], sys.argv[2])
