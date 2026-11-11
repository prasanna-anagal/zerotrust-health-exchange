@echo off
rem Starts the backend (https://127.0.0.1:8443). Keeps all existing data.
cd /d "%~dp0backend"
.venv\Scripts\python.exe run.py
