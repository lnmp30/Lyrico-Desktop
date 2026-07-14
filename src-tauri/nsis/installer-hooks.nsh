; Tauri's default NSIS template remembers the previous installer language in
; the registry and otherwise skips the selector on subsequent runs.
; Always show it so users can switch between Simplified Chinese and English.
!define MUI_LANGDLL_ALWAYSSHOW
