@echo off
REM ============================================================
REM  KROK 1 - ZKOUSKA NANECISTO
REM  Nic nepresune ani nezkopiruje. Jen projde fotky, rozpozna
REM  mistnosti a vytvori Excel report, ve kterem uvidite,
REM  co by se stalo. Timhle vzdy zacinejte.
REM ============================================================

cd /d "%~dp0"
call nastaveni.bat

echo.
echo ===============================================
echo   ZKOUSKA NANECISTO - nic se nepresouva
echo ===============================================
echo.

python sort_photos.py ^
    --dest "%PASPORT_DEST%" ^
    --inbox "%PASPORT_INBOX%" ^
    --tesseract "%PASPORT_TESSERACT%" ^
    --dry-run

echo.
echo ===============================================
echo  Otevrete v cilove slozce nejnovejsi
echo  report_*.xlsx a podivejte se na list
echo  "Ke kontrole".
echo ===============================================
pause
