#!/usr/bin/env python3
"""
PENDING ORDER QUANTITY BATCH DOWNLOAD ENGINE
Performs automated one-click export of Pending Order Quantity report
from DATSerp ERP using Selenium:
1. Logs into DATSerp ERP.
2. Navigates to Pending Order Quantity page (/#/erp/pendingOrderQuantity).
3. Clears the pre-filled 'SRINITHI GARMENT' from the Company autocomplete field.
4. Clicks the Search button (getReport).
5. Clicks the Green Excel export button (xlsxExportForPendingOrderDetails).
6. Renames and saves the file as 'Pending Order Quantity.xlsx'.
"""

import os
import sys
import time
import datetime
import shutil
import re
from pathlib import Path

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
ERP_PENDING_ORDER_URL = "https://erp.datserp.com/#/erp/pendingOrderQuantity"
DEFAULT_FILENAME = "Pending Order Quantity.xlsx"


def clean_filename(s):
    """Sanitizes filename strings for Windows compatibility."""
    return re.sub(r'[<>:"/\\|?*]', '_', str(s)).strip()


def find_element_by_selectors(driver, selectors, timeout=15, condition="present"):
    start = time.time()
    last_error = None
    while time.time() - start < timeout:
        for by, selector in selectors:
            try:
                elements = driver.find_elements(by, selector)
                for el in elements:
                    if condition == "clickable":
                        if el.is_displayed() and el.is_enabled():
                            return el
                    elif condition == "visible":
                        if el.is_displayed():
                            return el
                    else:
                        return el
            except Exception as e:
                last_error = e
        time.sleep(0.4)
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
        current_files = list(Path(download_dir).glob("*"))
        valid_files = [
            f for f in current_files
            if not f.name.endswith(('.crdownload', '.tmp', '.part', '.htm'))
            and f.is_file()
            and f.stat().st_size > 0
            and (f not in before_files or f.stat().st_mtime >= start_time - 2)
        ]
        if valid_files:
            latest = max(valid_files, key=lambda f: f.stat().st_mtime)
            time.sleep(1)
            return latest
        time.sleep(1)
    return None


def run_pending_order_quantity_download(
    username,
    password,
    download_dir=r"C:\ERP_DOWNLOADS",
    headless=False,
    status_callback=None,
    progress_callback=None,
    stop_event=None
):
    """
    Executes automated one-click export of Pending Order Quantity report:
    1. Login to DATSerp.
    2. Open /#/erp/pendingOrderQuantity.
    3. Clear the default 'SRINITHI GARMENT' company field.
    4. Click the Search button.
    5. Click the Green Excel export button.

    Args:
        username (str): ERP Login username
        password (str): ERP Login password
        download_dir (str): Base destination directory (will be saved in 'Pending Order Quantity' subfolder)
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
    if base_dir.name.lower() in ("pending order quantity", "pending orders"):
        dest_dir = base_dir
    else:
        dest_dir = base_dir / "Pending Order Quantity"
    dest_dir.mkdir(parents=True, exist_ok=True)

    if not username or not password:
        log("[ERROR] ERP credentials are required.")
        return False, "Missing credentials"

    driver = None
    try:
        set_progress(0, 1)
        log("=" * 60)
        log("Starting Pending Order Quantity Automated Export...")
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

        # 2. Open Pending Order Quantity page
        log("[2/4] Opening Pending Order Quantity (pendingOrderQuantity) page...")
        driver.get(ERP_PENDING_ORDER_URL)
        time.sleep(4)

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        # 3. Clear Company field (defaults to 'SRINITHI GARMENT')
        log("[3/4] Clearing pre-filled Company field ('SRINITHI GARMENT')...")
        company_input_selectors = [
            (By.XPATH, "//md-autocomplete[@md-input-name='Company Name' or @md-floating-label='Company']//input"),
            (By.XPATH, "//input[@name='Company Name']"),
            (By.XPATH, "//label[contains(text(),'Company')]/following::input[1]")
        ]
        company_input = find_element_by_selectors(driver, company_input_selectors, timeout=15, condition="present")
        
        # 1. Keyboard clear and blur
        try:
            company_input.click()
            time.sleep(0.2)
            company_input.send_keys(Keys.CONTROL + "a")
            time.sleep(0.1)
            company_input.send_keys(Keys.BACKSPACE)
            time.sleep(0.2)
            company_input.send_keys(Keys.TAB)
            time.sleep(0.2)
            company_input.send_keys(Keys.ESCAPE)
            time.sleep(0.2)
        except Exception:
            pass

        # 2. JavaScript clear Angular controller & scope models
        driver.execute_script("""
            var el = document.querySelector("md-autocomplete[md-input-name='Company Name']") ||
                     document.querySelector("md-autocomplete[md-floating-label='Company']");
            if (el) {
                var ctrl = angular.element(el).controller('mdAutocomplete');
                if (ctrl) {
                    ctrl.selectedItem = null;
                    ctrl.searchText = '';
                    if (typeof ctrl.clear === 'function') ctrl.clear();
                }
                var scope = angular.element(el).scope();
                if (scope && scope.filter) {
                    delete scope.filter.branch;
                    scope.filter.branch = undefined;
                    delete scope.filter.branchId;
                    scope.filter.branchId = undefined;
                    if (!scope.$$phase) scope.$apply();
                }
                var inp = el.querySelector('input');
                if (inp) inp.value = '';
            }
        """)
        time.sleep(0.5)

        # 3. Verify Company field is empty and branch is removed
        cleared_status = driver.execute_script("""
            var el = document.querySelector("md-autocomplete[md-input-name='Company Name']") ||
                     document.querySelector("md-autocomplete[md-floating-label='Company']");
            var scope = el ? angular.element(el).scope() : null;
            return {
                branch: scope && scope.filter ? scope.filter.branch : undefined,
                val: el && el.querySelector('input') ? el.querySelector('input').value : ''
            };
        """)
        log(f"  Company field status: {cleared_status}")

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        # 4. Click Search Button (getReport)
        log("[4/4] Initiating Search and Green Excel Export...")
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
                log(f"  Pending Order Quantity data loaded ({rows_loaded} rows).")
                break
            time.sleep(1)

        time.sleep(1.5)

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        # Locate and click the GREEN Excel export button (xlsxExportForPendingOrderDetails)
        log("  Clicking Green Excel export button...")
        green_excel_selectors = [
            (By.XPATH, "//button[contains(@ng-click,'xlsxExportForPendingOrderDetails')]"),
            (By.XPATH, "//button[contains(@style,'#1cab1d') or contains(@style,'28, 171, 29') or contains(@style,'rgb(28, 171, 29)')]"),
            (By.XPATH, "//button[contains(@class,'btn') and (contains(@style,'#1cab1d') or contains(@style,'28, 171, 29'))]")
        ]
        green_btn = find_element_by_selectors(driver, green_excel_selectors, timeout=10, condition="present")

        target_name = DEFAULT_FILENAME
        target_path = dest_dir / target_name
        if target_path.exists():
            try:
                target_path.unlink()
            except Exception:
                pass

        before_files = set(dest_dir.glob("*"))
        safe_click(driver, green_btn)
        log("  Export initiated! Waiting for file download...")

        # Wait for file download
        downloaded_file = wait_for_new_download(dest_dir, before_files, timeout=60)

        if not downloaded_file:
            log("  Retrying click on Green Excel export button...")
            safe_click(driver, green_btn)
            downloaded_file = wait_for_new_download(dest_dir, before_files, timeout=45)

        if not downloaded_file:
            log("  [ERROR] Pending Order Quantity Excel file did not download in time.")
            return False, "Download timeout"

        # Rename to 'Pending Order Quantity.xlsx' if needed
        target_name = DEFAULT_FILENAME
        target_path = dest_dir / target_name

        if downloaded_file.resolve() != target_path.resolve():
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
        log("PENDING ORDER QUANTITY EXPORT COMPLETED SUCCESSFULLY!")
        log(f"  Saved File : {target_path}")
        log(f"  File Size  : {file_size_mb:.2f} MB ({file_size_bytes:,} bytes)")
        log("=" * 60)

        return True, f"Successfully saved {target_name} ({file_size_mb:.2f} MB)"

    except Exception as e:
        log(f"\n[FATAL ERROR] Pending Order Quantity automation error: {str(e)}")
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
    print("  DATSerp - Pending Order Quantity Batch Downloader")
    print("===================================================")
    print(f"User: {user}")
    print(f"Target Base Folder: {base_folder}")
    print("---------------------------------------------------")

    success, msg = run_pending_order_quantity_download(
        username=user,
        password=pwd,
        download_dir=base_folder,
        headless=False
    )

    if not success:
        sys.exit(1)
