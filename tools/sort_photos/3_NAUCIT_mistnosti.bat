@echo off
REM ============================================================
REM  KROK 3 - NAUCENI Z RUCNICH OPRAV
REM
REM  Postup:
REM   1) V cilove slozce najdete slozky "Neznama_mistnost_1" atd.
REM   2) Podivejte se dovnitr na fotku tabletu
REM   3) Slozku PREJMENUJTE na spravny kod mistnosti (napr. GS644)
REM   4) Spustte tento soubor
REM
REM  Skript si nove kody doplni do konfigurace budov a priste
REM  je uz rozpozna sam. S kazdym kolem ubyva rucni prace.
REM ============================================================

cd /d "%~dp0"
call nastaveni.bat

echo.
echo ===============================================
echo   UCENI NOVYCH MISTNOSTI
echo ===============================================
echo.

python sort_photos.py --mode learn --dest "%PASPORT_DEST%"

echo.
pause
