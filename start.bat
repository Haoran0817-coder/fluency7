@echo off
cd /d "%~dp0"
set PY=C:\Users\24546\.workbuddy\binaries\python\versions\3.13.12\python.exe
if not exist "%PY%" set PY=python
echo Fluency7 -> http://127.0.0.1:8899
echo (Ctrl+C in the new window to stop)
start "" "%PY%" server.py
