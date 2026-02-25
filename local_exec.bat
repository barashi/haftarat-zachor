@echo off
echo צעד 3: הרץ עם שרת מקומי (חשוב)
echo .
echo  בתיקייה של האתר:
cd
echo .
echo python -m http.server 8000
echo .
echo פתח:
echo open  - http://localhost:8000
echo .

python -m http.server 8000

pause
