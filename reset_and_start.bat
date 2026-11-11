@echo off
rem Wipes the local database (users, records, activity), then starts the backend with the saved accounts.
rem Authenticator keys are kept, so your phone entries stay valid. Close any running backend first.
cd /d "%~dp0backend"
del /q instance\health.db 2>nul
.venv\Scripts\python.exe run.py
