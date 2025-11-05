#!/usr/bin/env python3
"""
assets 폴더를 감시하여 새 엑셀 파일이 추가되면 자동으로 변환하는 스크립트
"""

import time
import os
import sys
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import subprocess

class ExcelFileHandler(FileSystemEventHandler):
    """엑셀 파일 변경을 감지하는 핸들러"""
    
    def __init__(self, script_path):
        self.script_path = script_path
        self.processed_files = set()
    
    def on_created(self, event):
        """파일이 생성되었을 때"""
        if event.is_directory:
            return
        
        file_path = Path(event.src_path)
        
        # 엑셀 파일인지 확인 (.xlsx, .xls)
        if file_path.suffix.lower() in ['.xlsx', '.xls']:
            # 임시 파일 제외 (~$로 시작하는 파일)
            if file_path.name.startswith('~$'):
                return
            
            # 이미 처리한 파일인지 확인
            if str(file_path) in self.processed_files:
                return
            
            print(f"\n🔔 새 엑셀 파일 감지: {file_path.name}")
            
            # 파일이 완전히 복사될 때까지 잠시 대기
            time.sleep(1)
            
            try:
                # excel_to_json.py 스크립트 실행
                result = subprocess.run(
                    [sys.executable, self.script_path, str(file_path)],
                    capture_output=True,
                    text=True
                )
                
                if result.returncode == 0:
                    print(result.stdout)
                    self.processed_files.add(str(file_path))
                else:
                    print(f"❌ 변환 실패:\n{result.stderr}")
            
            except Exception as e:
                print(f"❌ 스크립트 실행 중 오류 발생: {e}")

def main():
    # 프로젝트 루트 경로
    project_root = Path(__file__).parent.parent
    assets_path = project_root / "assets"
    script_path = project_root / "scripts" / "excel_to_json.py"
    
    # assets 폴더가 없으면 생성
    assets_path.mkdir(exist_ok=True)
    
    print("=" * 60)
    print("📁 엑셀 파일 자동 변환 시스템 시작")
    print("=" * 60)
    print(f"📂 감시 폴더: {assets_path}")
    print(f"📝 변환 스크립트: {script_path}")
    print("\n💡 사용법:")
    print(f"   1. assets 폴더에 엑셀 파일(.xlsx, .xls)을 추가하세요")
    print(f"   2. 자동으로 converted_data.json에 추가됩니다")
    print("\n⏳ 파일 변경을 감시 중... (Ctrl+C로 종료)\n")
    
    # 파일 시스템 감시자 설정
    event_handler = ExcelFileHandler(script_path)
    observer = Observer()
    observer.schedule(event_handler, str(assets_path), recursive=False)
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n⏹️  감시 종료")
        observer.stop()
    
    observer.join()

if __name__ == "__main__":
    main()

