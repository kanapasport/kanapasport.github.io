@echo off
REM ============================================================
REM  ZACHRANNA BRZDA - vrati cely beh zpet
REM
REM  Fotky se vrati tam, odkud byly vzaty. Potrebujete ID behu,
REM  ktere najdete v nazvu reportu (report_20260806_143000.xlsx
REM  -> ID je 20260806_143000) nebo ve slozce _behy.
REM
REM  Po vraceni spustte trideni znovu s prepinacem --reprocess.
REM ============================================================

cd /d "%~dp0"
call nastaveni.bat

echo.
echo ===============================================
echo   VRACENI BEHU ZPET
echo ===============================================
echo.
echo Dostupne behy najdete zde: %PASPORT_DEST%\_behy
echo.
set /p RUNID="Zadejte ID behu (napr. 20260806_143000): "

if "%RUNID%"=="" (
    echo Nezadano zadne ID. Zruseno.
    pause
    exit /b
)

python sort_photos.py --mode undo --dest "%PASPORT_DEST%" --run-id "%RUNID%"

echo.
pause
