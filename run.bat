@echo off
cd /d "%~dp0backend"
echo Starting MechanicsMania...
echo Once it says "Application startup complete", open http://localhost:8000 in your browser.
python -m uvicorn main:app --reload --port 8000
