@echo off
title VisionAssist – Nayana Vision Assist
echo =====================================================================
echo          VisionAssist - Nayana AI Accessibility Platform
echo =====================================================================
echo.
echo Starting FastAPI Backend with YOLO11n & EasyOCR...
echo.

cd /d "%~dp0backend"

if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found! Please run setup first.
    pause
    exit /b 1
)

start "" http://127.0.0.1:8000
echo Server starting at http://127.0.0.1:8000
echo Press Ctrl+C in this console to stop the server.
echo.
venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
