@echo off
setlocal enabledelayedexpansion
title Srinithi Garment - DATSerp Auto Sync and Cloud Push Tool

echo =====================================================================
echo    SRINITHI GARMENT - DATSerp AUTO SYNC and CLOUD PUSH TOOL
echo =====================================================================
echo.

:: 1. Detect Real Installed Python Executables
set "PY_CMD="
if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Python\bin\python.exe"
) else if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
) else if exist "C:\Python312\python.exe" (
    set "PY_CMD=C:\Python312\python.exe"
) else (
    where python >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_CMD=python"
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Python was not found on your system!
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    echo Make sure to check 'Add Python to PATH' during installation.
    echo.
    pause
    exit /b 1
)

echo Python Detected: %PY_CMD%
echo.

cd /d "%~dp0"

:: 2. Check and Install Required Dependencies
echo Checking dependencies...
"%PY_CMD%" -c "import selenium, openpyxl, pandas, psycopg2, dotenv" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Installing required packages: selenium, openpyxl, pandas, psycopg2-binary, python-dotenv...
    "%PY_CMD%" -m pip install -r "%~dp0requirements.txt"
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to install packages. Please check your internet connection.
        pause
        exit /b 1
    )
    echo Dependencies installed successfully.
    echo.
)

:: 3. Launch Sync and Push Script
"%PY_CMD%" "%~dp0sync_and_push_to_cloud.py"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Sync process encountered an error. Exit Code: %ERRORLEVEL%
) else (
    echo.
    echo [DONE] Sync finished successfully!
)

echo.
echo Press any key to close this window...
pause >nul
