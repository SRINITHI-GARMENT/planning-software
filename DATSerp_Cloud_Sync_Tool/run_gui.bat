@echo off
setlocal enabledelayedexpansion
title DATSerp — Multi-Report Batch Downloader (Fabric Stock & Production WIP)

:: 1. Prioritize Real Installed Python Executables (Bypassing WindowsApps redirect stub)
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
    set "PY_CMD=python"
)

:: 2. Launch the Desktop GUI
cd /d "%~dp0"
"%PY_CMD%" "%~dp0fabric_stock_gui.py"

:: If GUI closed unexpectedly with error, keep window open to show error
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Application exited with error code %ERRORLEVEL%.
    pause
)
