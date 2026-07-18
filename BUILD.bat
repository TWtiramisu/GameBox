@echo off
title GameBox Portable Build

echo  Portable Build Script
echo  ================================================
echo.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "EXE_SRC=%ROOT%\src-tauri\target\release\tauri-app.exe"
set "EXE_OUT=%ROOT%\GameBox.exe"

cd /d "%ROOT%"

:: -- Step 1: Build frontend --
echo  [1/2] Building frontend (Vite + TypeScript)...
echo  ------------------------------------------------
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Frontend build failed. Check TypeScript errors above.
    echo.
    pause
    exit /b 1
)
echo  ^> Frontend build OK
echo.

:: -- Step 2: Build Tauri portable exe --
echo  [2/2] Building Tauri backend (portable, no installer)...
echo  ------------------------------------------------
call npm run tauri -- build --no-bundle
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Tauri build failed. Check Rust errors above.
    echo.
    pause
    exit /b 1
)
echo  ^> Tauri build OK
echo.

:: -- Copy output to project root --
echo  ================================================
if exist "%EXE_SRC%" (
    powershell -Command "Copy-Item '%EXE_SRC%' '%EXE_OUT%' -Force"
    echo  Build complete! Portable executable:
    echo.
    echo     %EXE_OUT%
    echo.
    echo  Double-click GameBox.exe to run. No installation required.
) else (
    echo  [WARNING] Output exe not found at:
    echo     %EXE_SRC%
    echo  Check src-tauri\target\release\ manually.
)
echo  ================================================
echo.
pause
