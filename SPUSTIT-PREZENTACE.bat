@echo off
chcp 65001 >nul
title Pasport Kana 2.0 - web pro prezentaci
setlocal

rem ===========================================================================
rem  Spusti web Pasport Kana na tomhle pocitaci a otevre ho v prohlizeci.
rem
rem  Zkousi postupne vsechno, co na pocitaci muze byt:
rem    1) Python z ArcGIS Pro     (na nasich GIS strojich je vzdy)
rem    2) Python z PATH           (py / python)
rem    3) Node.js                 (npx http-server)
rem    4) PowerShell              (server.ps1 vedle tohohle souboru)
rem
rem  Aspon jedna z moznosti funguje na kazdem Windows - ctvrta nepotrebuje
rem  nainstalovat vubec nic.
rem
rem  Okno nechej otevrene. Zavrenim se web vypne.
rem ===========================================================================

set "SLOZKA=%~dp0"
rem %~dp0 konci zpetnym lomitkem a to by v uvozovkach "...\" rozbilo
rem prikazovou radku (lomitko unikne uvozovku) - proto se usekne
if "%SLOZKA:~-1%"=="\" set "SLOZKA=%SLOZKA:~0,-1%"
set "PORT=5174"
set "ADRESA=http://localhost:%PORT%/index.html"

echo.
echo   Pasport Kana 2.0
echo   ----------------
echo   Slozka: %SLOZKA%
echo   Adresa: %ADRESA%
echo.

rem ---------------------------------------------------- 1) Python z ArcGIS Pro
for %%P in (
    "C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"
    "C:\Program Files (x86)\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"
    "%LOCALAPPDATA%\Programs\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe"
) do (
    if exist %%P (
        echo   Spoustim pres Python z ArcGIS Pro...
        start "" "%ADRESA%"
        %%P -m http.server %PORT% --directory "%SLOZKA%"
        goto :konec
    )
)

rem --------------------------------------------------------- 2) Python z PATH
where py >nul 2>&1
if %errorlevel%==0 (
    echo   Spoustim pres Python z PATH...
    start "" "%ADRESA%"
    py -3 -m http.server %PORT% --directory "%SLOZKA%"
    goto :konec
)
where python >nul 2>&1
if %errorlevel%==0 (
    echo   Spoustim pres Python z PATH...
    start "" "%ADRESA%"
    python -m http.server %PORT% --directory "%SLOZKA%"
    goto :konec
)

rem --------------------------------------------------------------- 3) Node.js
where npx >nul 2>&1
if %errorlevel%==0 (
    echo   Spoustim pres Node.js...
    start "" "%ADRESA%"
    npx --yes http-server "%SLOZKA%" -p %PORT% -c-1
    goto :konec
)

rem ------------------------------------------------------------ 4) PowerShell
if exist "%SLOZKA%\server.ps1" (
    echo   Python ani Node.js tu nejsou - spoustim vlastni server v PowerShellu.
    start "" "%ADRESA%"
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SLOZKA%\server.ps1" -Port %PORT% -Slozka "%SLOZKA%"
    goto :konec
)

echo.
echo   Nepodarilo se najit zadny zpusob, jak web spustit.
echo   Chybi soubor server.ps1 vedle tohohle davkoveho souboru.
echo.
pause

:konec
echo.
echo   Web byl ukoncen.
pause
