@echo off
cd /d "%~dp0"
echo Starting VisionAssist Backend Server...
venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
