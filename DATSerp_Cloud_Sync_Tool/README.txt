========================================================================
SRINITHI GARMENT - PORTABLE DATSerp AUTO SYNC & CLOUD PUSH TOOL
========================================================================

This portable tool automatically downloads all 7 stock & WIP reports from
DATSerp ERP, aligns them into mainout.xlsx, and pushes the records directly
into the Supabase Cloud PostgreSQL database used by Render.

------------------------------------------------------------------------
HOW TO RUN:
------------------------------------------------------------------------
1. Make sure Python 3.10+ and Google Chrome are installed on your computer.
2. Double-click "run_sync.bat" to run the automated sync and direct cloud push.
   OR:
   Double-click "run_gui.bat" to open the Desktop GUI.
3. The tool will download all reports, compile mainout.xlsx, and push
   all fresh records to the Supabase Cloud database.
4. When finished, open the Render web app:
   https://planning-software-y3mi.onrender.com
   All stock and WIP screens will be immediately updated!

------------------------------------------------------------------------
SETTINGS (.env):
------------------------------------------------------------------------
You can open ".env" in Notepad to adjust:
- ERP_USERNAME / ERP_PASSWORD: Your DATSerp login
- HEADLESS: Set to "true" for silent background download, or "false" to watch Chrome
- DOWNLOAD_DIR: Custom download folder path (leave blank for ./downloads)
========================================================================
