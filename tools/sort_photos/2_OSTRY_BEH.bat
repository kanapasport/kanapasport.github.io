@echo off
REM ============================================================
REM  KROK 2 - OSTRY BEH
REM  Fotky se PRESUNOU z inboxu do cilove struktury.
REM  Zapise se log, takze beh jde vratit zpet (3_VRATIT_ZPET).
REM ============================================================

cd /d "%~dp0"
call nastaveni.bat

echo.
echo ===============================================
echo   OSTRY BEH - fotky se PRESUNOU z inboxu
echo ===============================================
echo   Zdroj: %PASPORT_INBOX%
echo   Cil:   %PASPORT_DEST%
echo.
set /p POTVRZENI="Pokracovat? (A/N): "
if /i not "%POTVRZENI%"=="A" (
    echo Zruseno.
    pause
    exit /b
)

python sort_photos.py ^
    --dest "%PASPORT_DEST%" ^
    --inbox "%PASPORT_INBOX%" ^
    --tesseract "%PASPORT_TESSERACT%" ^
    --move

echo.
pause
