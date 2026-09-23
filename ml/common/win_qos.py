"""Windows 전력 효율 모드(EcoQoS) 끄기 — 로컬 LoRA 워커·추론 자식 공용.

Windows 11 은 화면 없이 도는 백그라운드 프로세스(작업 스케줄러로 띄운 워커 등)를 알아서 효율 모드로 돌린다.
하이브리드 CPU(성능·효율 코어, 예: i5-14400F)에선 효율 코어·낮은 클럭으로 몰려, 0.5B 처럼 CPU 쪽 처리가 대부분인
생성이 같은 코드를 직접 돌릴 때보다 3배 느렸다(109초 → 끄고 33초). 이 프로세스는 항상 성능 쪽으로 돌게 한다.
Windows 가 아니거나 API 가 없으면 아무것도 하지 않는다.
"""
from __future__ import annotations

import os


def opt_out_power_throttling() -> bool:
    """현재 프로세스를 HighQoS 로 — SetProcessInformation(ProcessPowerThrottling, 실행 속도 조절 끔)."""
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        class _State(ctypes.Structure):
            _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]

        # Version 1, ControlMask=EXECUTION_SPEED(0x1) 를 직접 제어, StateMask=0 → 조절하지 않음(HighQoS)
        state = _State(1, 0x1, 0)
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        k32.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        k32.SetProcessInformation.restype = wintypes.BOOL
        process_power_throttling = 4  # PROCESS_INFORMATION_CLASS.ProcessPowerThrottling
        return bool(k32.SetProcessInformation(k32.GetCurrentProcess(), process_power_throttling,
                                              ctypes.byref(state), ctypes.sizeof(state)))
    except Exception:  # noqa: BLE001 — 오래된 Windows 등: 속도만 느릴 뿐 동작엔 지장 없다
        return False
