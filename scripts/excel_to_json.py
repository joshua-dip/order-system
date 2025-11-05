#!/usr/bin/env python3
"""
엑셀 파일을 JSON으로 변환하여 converted_data.json에 추가하는 스크립트
"""

import pandas as pd
import json
import sys
import os
from pathlib import Path

def excel_to_json(excel_path):
    """엑셀 파일을 JSON 형식으로 변환"""
    try:
        # 엑셀 파일의 모든 시트 읽기
        excel_file = pd.ExcelFile(excel_path)
        
        # 파일명에서 교재명 추출 (확장자 제거)
        textbook_name = Path(excel_path).stem
        
        result = {
            textbook_name: {}
        }
        
        # 각 시트 처리
        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_path, sheet_name=sheet_name)
            
            # 시트 데이터 구조화
            sheet_data = {"부교재": {}}
            
            # 컬럼명 확인 (유연하게 처리)
            columns = df.columns.tolist()
            
            # 필요한 컬럼 인덱스 찾기
            textbook_col = None
            lesson_col = None
            number_col = None
            
            for i, col in enumerate(columns):
                col_str = str(col).lower()
                if '교재' in col_str:
                    textbook_col = i
                elif '강' in col_str or '회차' in col_str:
                    lesson_col = i
                elif '번호' in col_str:
                    number_col = i
            
            # 컬럼을 찾지 못한 경우 기본 인덱스 사용
            if textbook_col is None:
                textbook_col = 0
            if lesson_col is None:
                lesson_col = 1
            if number_col is None:
                number_col = 2 if len(columns) <= 3 else 4  # 번호는 보통 5번째 열(인덱스 4)
            
            # 데이터프레임을 순회하며 구조 생성
            current_textbook = None
            current_lesson = None
            
            for index, row in df.iterrows():
                # NaN 값 처리
                row = row.fillna('')
                
                # 교재명
                if row.iloc[textbook_col] and row.iloc[textbook_col] != current_textbook:
                    current_textbook = str(row.iloc[textbook_col])
                    if current_textbook not in sheet_data["부교재"]:
                        sheet_data["부교재"][current_textbook] = {}
                
                # 강 또는 회차
                if row.iloc[lesson_col] and current_textbook:
                    current_lesson = str(row.iloc[lesson_col])
                    if current_lesson not in sheet_data["부교재"][current_textbook]:
                        sheet_data["부교재"][current_textbook][current_lesson] = []
                
                # 번호
                if row.iloc[number_col] and current_textbook and current_lesson:
                    number = str(row.iloc[number_col])
                    sheet_data["부교재"][current_textbook][current_lesson].append({
                        "번호": number
                    })
            
            result[textbook_name][sheet_name] = sheet_data
        
        return result
    
    except Exception as e:
        print(f"❌ 엑셀 파일 변환 중 오류 발생: {e}")
        sys.exit(1)

def merge_json(new_data, json_path):
    """새 데이터를 기존 JSON 파일에 병합"""
    try:
        # 기존 JSON 파일 읽기
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        else:
            existing_data = {}
        
        # 새 데이터 병합
        existing_data.update(new_data)
        
        # JSON 파일로 저장
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)
        
        print(f"✅ JSON 파일이 성공적으로 업데이트되었습니다: {json_path}")
        return True
    
    except Exception as e:
        print(f"❌ JSON 병합 중 오류 발생: {e}")
        sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("사용법: python excel_to_json.py <엑셀_파일_경로>")
        sys.exit(1)
    
    excel_path = sys.argv[1]
    
    if not os.path.exists(excel_path):
        print(f"❌ 파일을 찾을 수 없습니다: {excel_path}")
        sys.exit(1)
    
    print(f"📊 엑셀 파일 변환 중: {excel_path}")
    
    # 엑셀을 JSON으로 변환
    json_data = excel_to_json(excel_path)
    
    # converted_data.json 경로
    project_root = Path(__file__).parent.parent
    json_path = project_root / "app" / "data" / "converted_data.json"
    
    # JSON 파일에 병합
    merge_json(json_data, json_path)
    
    # 교재명 출력
    textbook_names = list(json_data.keys())
    print(f"✅ 추가된 교재: {', '.join(textbook_names)}")

if __name__ == "__main__":
    main()

