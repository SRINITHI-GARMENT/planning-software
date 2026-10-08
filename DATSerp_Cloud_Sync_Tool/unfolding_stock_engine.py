#!/usr/bin/env python3
"""
UNFOLDING STOCK BATCH DOWNLOAD ENGINE
Performs automated Color Wise + Size Wise Unfolding Stock report exports
from DATSerp ERP using Selenium.
"""

import os
import sys
import time
import datetime
import shutil
import re
from pathlib import Path

# Force unbuffered output for real-time logging in Windows
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException,
    NoSuchElementException,
    ElementClickInterceptedException,
    WebDriverException
)

ERP_LOGIN_URL = "https://erp.datserp.com/#/login"
ERP_UNFOLDING_STOCK_URL = "https://erp.datserp.com/#/erp/unfoldingOpeningStockReport"
DEFAULT_FILENAME = "Unfolding Stock.xlsx"


def clean_filename(s):
    """Sanitizes filename strings for Windows compatibility."""
    return re.sub(r'[<>:"/\\|?*]', '_', str(s)).strip()


def find_element_by_selectors(driver, selectors, timeout=15, condition="present"):
    wait = WebDriverWait(driver, timeout)
    last_error = None
    for by, selector in selectors:
        try:
            if condition == "clickable":
                return wait.until(EC.element_to_be_clickable((by, selector)))
            elif condition == "visible":
                return wait.until(EC.visibility_of_element_located((by, selector)))
            else:
                return wait.until(EC.presence_of_element_located((by, selector)))
        except Exception as e:
            last_error = e
            continue
    raise TimeoutException(f"Could not locate element with selectors: {selectors}. Error: {last_error}")


def safe_click(driver, element):
    try:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
        time.sleep(0.1)
    except Exception:
        pass
    try:
        driver.execute_script("arguments[0].click();", element)
    except Exception:
        element.click()


def setup_chrome_driver(download_dir, headless=False):
    dest_path = Path(download_dir).resolve()
    dest_path.mkdir(parents=True, exist_ok=True)

    chrome_options = Options()
    prefs = {
        "download.default_directory": str(dest_path),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
        "profile.default_content_settings.popups": 0,
        "profile.content_settings.exceptions.automatic_downloads.*.setting": 1
    }
    chrome_options.add_experimental_option("prefs", prefs)
    chrome_options.add_argument("--start-maximized")
    chrome_options.add_argument("--disable-notifications")
    chrome_options.add_argument("--disable-popup-blocking")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")

    if headless:
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--window-size=1920,1080")

    driver = webdriver.Chrome(options=chrome_options)

    # Enable downloads in headless mode via CDP
    try:
        driver.execute_cdp_cmd("Page.setDownloadBehavior", {
            "behavior": "allow",
            "downloadPath": str(dest_path)
        })
    except Exception:
        pass

    return driver


def wait_for_new_download(download_dir, before_files, timeout=60):
    start_time = time.time()
    while time.time() - start_time < timeout:
        current_files = set(Path(download_dir).glob("*"))
        new_files = current_files - before_files
        valid_files = [
            f for f in new_files
            if not f.name.endswith(('.crdownload', '.tmp', '.part', '.htm'))
            and f.is_file()
            and f.stat().st_size > 0
        ]
        if valid_files:
            latest = max(valid_files, key=lambda f: f.stat().st_mtime)
            time.sleep(1)
            return latest
        time.sleep(1)
    return None


def run_unfolding_stock_download(
    username,
    password,
    download_dir=r"C:\ERP_DOWNLOADS",
    headless=False,
    status_callback=None,
    progress_callback=None,
    stop_event=None
):
    """
    Executes automated Unfolding Stock (Color Wise + Size Wise) report export.

    Args:
        username (str): ERP Login username
        password (str): ERP Login password
        download_dir (str): Base destination directory (saved in 'Unfolding Stock' subfolder)
        headless (bool): Run Chrome in background
        status_callback (callable): Function taking a string message
        progress_callback (callable): Function taking (current_idx, total_count)
        stop_event (threading.Event): Cancellation signal
    """
    def log(msg):
        if status_callback:
            status_callback(msg)
        else:
            print(msg, flush=True)

    def set_progress(curr, total):
        if progress_callback:
            progress_callback(curr, total)

    base_dir = Path(download_dir).resolve()
    if base_dir.name.lower() in ("unfolding stock", "unfolding"):
        dest_dir = base_dir
    else:
        dest_dir = base_dir / "Unfolding Stock"
    dest_dir.mkdir(parents=True, exist_ok=True)

    if not username or not password:
        log("[ERROR] ERP credentials are required.")
        return False, "Missing credentials"

    driver = None
    try:
        set_progress(0, 1)
        log("=" * 60)
        log("Starting Unfolding Stock Automated Export...")
        log(f"Destination folder: {dest_dir}")
        log("=" * 60)

        driver = setup_chrome_driver(dest_dir, headless=headless)
        wait = WebDriverWait(driver, 30)

        # 1. Login
        log("[1/4] Connecting to DATSerp ERP & Logging in...")
        driver.get(ERP_LOGIN_URL)

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        user_selectors = [
            (By.NAME, "username"),
            (By.NAME, "user"),
            (By.CSS_SELECTOR, "input[type='text'][ng-model*='user' i]"),
            (By.XPATH, "//input[@type='text' or not(@type)][1]")
        ]
        user_in = find_element_by_selectors(driver, user_selectors, timeout=20, condition="visible")
        user_in.clear()
        user_in.send_keys(username)

        pass_selectors = [
            (By.NAME, "password"),
            (By.CSS_SELECTOR, "input[type='password']"),
            (By.XPATH, "//input[@type='password']")
        ]
        pass_in = find_element_by_selectors(driver, pass_selectors, timeout=10, condition="visible")
        pass_in.clear()
        pass_in.send_keys(password)

        login_btn = find_element_by_selectors(driver, [
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.XPATH, "//button[contains(normalize-space(),'Login') or contains(@ng-click,'login')]")
        ], timeout=10, condition="clickable")
        safe_click(driver, login_btn)

        wait.until(lambda d: "#/login" not in d.current_url or len(d.find_elements(By.CSS_SELECTOR, ".main-content, .navbar, .sidebar, #page-wrapper, .dashboard")) > 0)
        log("  Login successful!")
        time.sleep(2)

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        # 2. Open Unfolding Stock Page
        log("[2/4] Opening Unfolding Stock (unfoldingOpeningStockReport) page...")
        driver.get(ERP_UNFOLDING_STOCK_URL)
        time.sleep(4)

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        # 3. Select Color Wise and Size Wise checkboxes
        log("[3/4] Enabling 'Color Wise' and 'Size Wise' checkboxes...")
        
        # Color Wise checkbox
        color_selectors = [
            (By.XPATH, "//input[@ng-model='filter.isColor']"),
            (By.XPATH, "//label[contains(.,'Color Wise')]/preceding-sibling::input[@type='checkbox'] | //label[contains(.,'Color Wise')]//input[@type='checkbox']"),
            (By.XPATH, "//*[contains(text(),'Color Wise')]/ancestor::label//input | //*[contains(text(),'Color Wise')]/preceding::input[@type='checkbox'][1]")
        ]
        color_cb = find_element_by_selectors(driver, color_selectors, timeout=15, condition="present")
        if not color_cb.is_selected():
            safe_click(driver, color_cb)
            log("  Ticked 'Color Wise' checkbox.")
        else:
            log("  'Color Wise' already checked.")
        time.sleep(0.3)

        # Size Wise checkbox
        size_selectors = [
            (By.XPATH, "//input[@ng-model='filter.isSize']"),
            (By.XPATH, "//label[contains(.,'Size Wise')]/preceding-sibling::input[@type='checkbox'] | //label[contains(.,'Size Wise')]//input[@type='checkbox']"),
            (By.XPATH, "//*[contains(text(),'Size Wise')]/ancestor::label//input | //*[contains(text(),'Size Wise')]/preceding::input[@type='checkbox'][1]")
        ]
        size_cb = find_element_by_selectors(driver, size_selectors, timeout=10, condition="present")
        if not size_cb.is_selected():
            safe_click(driver, size_cb)
            log("  Ticked 'Size Wise' checkbox.")
        else:
            log("  'Size Wise' already checked.")
        time.sleep(0.5)

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        # 4. Click Search Button (Yellow circle in screenshot)
        log("[4/4] Initiating Search and Excel Export...")
        search_selectors = [
            (By.XPATH, "//button[contains(@ng-click,'getReport') or @aria-label='Search']"),
            (By.XPATH, "//button[.//i[contains(@class,'search') or contains(@class,'fa-search')]]"),
            (By.XPATH, "(//form//button)[1]")
        ]
        search_btn = find_element_by_selectors(driver, search_selectors, timeout=10, condition="present")
        safe_click(driver, search_btn)
        log("  Clicked Search button, waiting for data to populate...")

        # Wait for data table rows to populate
        start_wait = time.time()
        rows_loaded = 0
        while time.time() - start_wait < 35:
            rows = driver.find_elements(By.XPATH, "//table//tbody//tr | //table//tr[td[2][string-length(normalize-space()) > 0 and not(contains(.,'Total'))]]")
            if len(rows) >= 1:
                rows_loaded = len(rows)
                log(f"  Unfolding Stock data loaded ({rows_loaded} record rows).")
                break
            time.sleep(1)

        time.sleep(1.5)

        # Click the RED Excel button (Black circle in screenshot)
        log("  Clicking Red Excel export button...")
        excel_btn_selectors = [
            (By.XPATH, "//button[contains(@ng-click,'xlsxExport')]"),
            (By.XPATH, "//button[contains(@ng-click,'xlsxExport')][.//i[contains(@class,'excel') or contains(@class,'file-excel')]]"),
            (By.XPATH, "(//button[.//i[contains(@class,'excel') or contains(@class,'file-excel')]])[1]")
        ]
        excel_btn = find_element_by_selectors(driver, excel_btn_selectors, timeout=10, condition="present")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", excel_btn)
        time.sleep(0.5)

        before_files = set(dest_dir.glob("*"))
        safe_click(driver, excel_btn)
        log("  Export initiated! Waiting for file download...")

        # Wait for file download
        downloaded_file = wait_for_new_download(dest_dir, before_files, timeout=60)

        if not downloaded_file:
            log("  Retrying click on Excel export button...")
            safe_click(driver, excel_btn)
            downloaded_file = wait_for_new_download(dest_dir, before_files, timeout=45)

        if not downloaded_file:
            log("  [ERROR] Unfolding Stock Excel file did not download in time.")
            return False, "Download timeout"

        # Rename to 'Unfolding Stock.xlsx'
        target_name = DEFAULT_FILENAME
        target_path = dest_dir / target_name

        if target_path.exists():
            try:
                target_path.unlink()
            except Exception:
                pass

        shutil.move(str(downloaded_file), str(target_path))
        file_size_bytes = target_path.stat().st_size
        file_size_mb = file_size_bytes / (1024 * 1024)

        set_progress(1, 1)
        log("\n" + "=" * 60)
        log("UNFOLDING STOCK EXPORT COMPLETED SUCCESSFULLY!")
        log(f"  Saved File : {target_path}")
        log(f"  File Size  : {file_size_mb:.2f} MB ({file_size_bytes:,} bytes)")
        log("=" * 60)

        return True, f"Successfully saved {target_name} ({file_size_mb:.2f} MB)"

    except Exception as e:
        log(f"\n[FATAL ERROR] Unfolding Stock automation error: {str(e)}")
        return False, str(e)

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    user = os.getenv("ERP_USERNAME", "jana@sng.com")
    pwd = os.getenv("ERP_PASSWORD", "Jana@#123")
    base_folder = os.getenv("DOWNLOAD_DIR", r"C:\ERP_DOWNLOADS")

    print("===================================================")
    print("  DATSerp - Unfolding Stock Batch Downloader")
    print("===================================================")
    print(f"User: {user}")
    print(f"Target Base Folder: {base_folder}")
    print("---------------------------------------------------")

    success, msg = run_unfolding_stock_download(
        username=user,
        password=pwd,
        download_dir=base_folder,
        headless=False
    )

    if not success:
        sys.exit(1)
