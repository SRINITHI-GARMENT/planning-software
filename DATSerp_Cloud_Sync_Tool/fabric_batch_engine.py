#!/usr/bin/env python3
"""
FABRIC STOCK BATCH DOWNLOAD ENGINE
Performs automated multi-fabric stock exports from DATSerp ERP using Selenium.
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
ERP_FABRIC_STOCK_URL = "https://erp.datserp.com/#/erp/fabricStock"


def clean_filename(s):
    """Sanitizes filename strings for Windows compatibility."""
    return re.sub(r'[<>:"/\\|?*]', '_', str(s)).strip()


def find_element_by_selectors(driver, selectors, timeout=10, condition="present"):
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
        element.click()
    except Exception:
        driver.execute_script("arguments[0].click();", element)


def close_overlays(driver):
    try:
        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
    except Exception:
        pass


def set_angular_autocomplete(driver, field_name, value, timeout=10):
    """
    Sets Angular Material md-autocomplete value robustly by typing, selecting
    from suggestions controller, and closing overlays. Clears field if value is empty.
    """
    if not value or not str(value).strip():
        # Clear field via Angular controller & input
        driver.execute_script(f"""
            var el = document.querySelector("md-autocomplete[md-input-name='{field_name}']") ||
                     document.querySelector("md-autocomplete[md-floating-label*='{field_name}']");
            if (el) {{
                var ctrl = angular.element(el).controller('mdAutocomplete');
                if (ctrl) ctrl.clear();
            }}
        """)
        return

    val_str = str(value).strip()
    
    # 1. Locate the input element for this autocomplete
    selectors = [
        (By.XPATH, f"//md-autocomplete[@md-input-name='{field_name}' or @md-floating-label='{field_name}']//input"),
        (By.XPATH, f"//input[@name='{field_name}']"),
        (By.XPATH, f"//label[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'{field_name.lower()}')]/following::input[1]")
    ]
    inp = find_element_by_selectors(driver, selectors, timeout=timeout, condition="present")
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", inp)
    time.sleep(0.2)

    safe_click(driver, inp)
    time.sleep(0.2)
    inp.send_keys(Keys.CONTROL + "a")
    inp.send_keys(Keys.BACKSPACE)
    time.sleep(0.2)
    inp.send_keys(val_str)
    
    # Allow md-delay (500ms) + query debounce
    time.sleep(1.0)

    # Try selecting via mdAutocomplete controller matches
    matched = driver.execute_script(f"""
        var targetVal = arguments[0].trim().toUpperCase();
        var el = document.querySelector("md-autocomplete[md-input-name='{field_name}']") ||
                 document.querySelector("md-autocomplete[md-floating-label*='{field_name}']");
        if (!el) return false;
        var ctrl = angular.element(el).controller('mdAutocomplete');
        if (!ctrl) return false;
        
        var matches = ctrl.matches;
        if (matches && matches.length > 0) {{
            for (var i = 0; i < matches.length; i++) {{
                var m = matches[i];
                var name = (m.name || m.code || m.title || String(m)).trim().toUpperCase();
                if (name === targetVal || name.indexOf(targetVal) !== -1 || targetVal.indexOf(name) !== -1) {{
                    ctrl.select(i);
                    return true;
                }}
            }}
            ctrl.select(0);
            return true;
        }}
        return false;
    """, val_str)

    if not matched:
        # Fallback: check visible repeat container items or press ENTER
        try:
            items = driver.find_elements(By.XPATH, "//md-virtual-repeat-container[not(contains(@class,'ng-hide'))]//li")
            for it in items:
                txt = driver.execute_script("return (arguments[0].textContent || '').trim();", it)
                if val_str.upper() in txt.upper():
                    safe_click(driver, it)
                    matched = True
                    break
        except Exception:
            pass

        if not matched:
            inp.send_keys(Keys.ARROW_DOWN)
            time.sleep(0.2)
            inp.send_keys(Keys.ENTER)

    time.sleep(0.4)
    close_overlays(driver)
    time.sleep(0.2)


def setup_chrome_driver(download_dir, headless=False):
    Path(download_dir).mkdir(parents=True, exist_ok=True)
    chrome_options = Options()
    
    prefs = {
        "download.default_directory": str(download_dir),
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
        
    return webdriver.Chrome(options=chrome_options)


def wait_for_new_download(download_dir, before_files, timeout=40):
    start_time = time.time()
    while time.time() - start_time < timeout:
        current_files = set(Path(download_dir).glob("*"))
        new_files = current_files - before_files
        valid_files = [
            f for f in new_files 
            if not f.name.endswith(('.crdownload', '.tmp', '.part'))
            and f.is_file()
            and f.stat().st_size > 0
        ]
        if valid_files:
            latest = max(valid_files, key=lambda f: f.stat().st_mtime)
            time.sleep(1)
            return latest
        time.sleep(1)
    return None


def run_batch_download(
    username,
    password,
    fabric_items,
    download_dir=r"C:\ERP_DOWNLOADS",
    headless=False,
    status_callback=None,
    progress_callback=None,
    stop_event=None
):
    """
    Executes automated batch stock report downloads.
    
    Args:
        username (str): ERP Login username
        password (str): ERP Login password
        fabric_items (list): List of dicts [{'fabric': '...', 'unit': 'Kgs', 'gsm': '185'}, ...]
        download_dir (str): Destination directory for reports
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
    if base_dir.name.lower() == "fabric stock":
        dest_dir = base_dir
    else:
        dest_dir = base_dir / "Fabric Stock"
    dest_dir.mkdir(parents=True, exist_ok=True)

    if not username or not password:
        log("[ERROR] ERP credentials are required.")
        return False, "Missing credentials"

    if not fabric_items:
        log("[WARNING] No fabric items selected for download.")
        return False, "No items"

    driver = None
    total_items = len(fabric_items)
    success_count = 0
    fail_count = 0

    try:
        log(f"Starting batch export for {total_items} fabric items...")
        log(f"Destination folder: {dest_dir}")
        
        driver = setup_chrome_driver(dest_dir, headless=headless)
        wait = WebDriverWait(driver, 25)

        # 1. Login once
        log("[1/2] Connecting to DATSerp ERP & Logging in...")
        driver.get(ERP_LOGIN_URL)

        if stop_event and stop_event.is_set():
            return False, "Cancelled by user"

        user_selectors = [
            (By.NAME, "username"),
            (By.NAME, "user"),
            (By.CSS_SELECTOR, "input[type='text'][ng-model*='user' i]"),
            (By.XPATH, "//input[@type='text' or not(@type)][1]")
        ]
        user_in = find_element_by_selectors(driver, user_selectors, timeout=15, condition="visible")
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

        # 2. Open Fabric Stock page
        log("[2/2] Opening Fabric Stock page...")
        driver.get(ERP_FABRIC_STOCK_URL)
        time.sleep(3)

        # 3. Process each Fabric item
        for idx, item in enumerate(fabric_items, start=1):
            if stop_event and stop_event.is_set():
                log("\n[STOPPED] Batch process stopped by user.")
                break

            fab_name = str(item.get("fabric", "")).strip()
            unit_name = str(item.get("unit", "Kgs")).strip() or "Kgs"
            gsm_val = str(item.get("gsm", "")).strip()

            item_desc = f"{fab_name} ({unit_name}" + (f", GSM: {gsm_val}" if gsm_val else "") + ")"
            log(f"\n--- [{idx}/{total_items}] Processing: {item_desc} ---")
            set_progress(idx - 1, total_items)

            try:
                # 3a. Set Fabric Autocomplete
                set_angular_autocomplete(driver, "Fabric", fab_name, timeout=10)

                # 3b. Set Unit Autocomplete
                set_angular_autocomplete(driver, "Unit", unit_name, timeout=8)

                # 3c. Set GSM Autocomplete (or clear if not specified)
                set_angular_autocomplete(driver, "GSM", gsm_val, timeout=8)

                close_overlays(driver)
                time.sleep(0.3)

                # 3d. Click Search
                search_btn = find_element_by_selectors(driver, [
                    (By.XPATH, "//button[@aria-label='Search' or contains(@ng-click,'getReport') or contains(@title,'Search')]"),
                    (By.XPATH, "//button[contains(@class,'btn-info') and (contains(@ng-click,'getReport') or @aria-label='Search')]")
                ], timeout=10, condition="present")

                before_files = set(dest_dir.glob("*"))
                safe_click(driver, search_btn)

                # 3e. Wait for stock report data rows
                start_wait = time.time()
                data_found = False
                while time.time() - start_wait < 25:
                    rows = driver.find_elements(By.XPATH, "//table//tr[td[2][string-length(normalize-space()) > 0 and not(contains(.,'Total')) and not(contains(.,'COLOR'))]]")
                    if len(rows) >= 1:
                        data_found = True
                        log(f"  Stock data loaded ({len(rows)} color rows).")
                        break
                    
                    page_src = driver.page_source.lower()
                    if "no records found" in page_src or "no data found" in page_src:
                        log("  No records found for this fabric.")
                        break
                    time.sleep(1)

                time.sleep(2)

                # 3f. Click GREEN Excel export button (xlsxExportForFabricDetails)
                green_btn = find_element_by_selectors(driver, [
                    (By.XPATH, "//button[contains(@ng-click,'xlsxExportForFabricDetails')]"),
                    (By.XPATH, "//button[@ng-click=\"xlsxExportForFabricDetails('Fabric Stock Report')\"]"),
                    (By.XPATH, "(//button[contains(@ng-click,'xlsxExport')])[last()]")
                ], timeout=10, condition="present")

                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", green_btn)
                time.sleep(0.5)

                downloaded_file = None
                for click_attempt in range(1, 3):
                    safe_click(driver, green_btn)
                    downloaded_file = wait_for_new_download(dest_dir, before_files, timeout=25)
                    if downloaded_file:
                        break
                    time.sleep(2)

                # 3g. Save and rename downloaded file
                if downloaded_file:
                    suffix_parts = [clean_filename(fab_name), clean_filename(unit_name)]
                    if gsm_val:
                        suffix_parts.append(f"{clean_filename(gsm_val)}GSM")
                    target_name = f"Fabric Stock Report - {' - '.join(suffix_parts)}.xlsx"
                    target_path = dest_dir / target_name

                    if target_path.exists():
                        try:
                            target_path.unlink()
                        except Exception:
                            pass

                    shutil.move(str(downloaded_file), str(target_path))
                    log(f"  [SAVED] {target_name} ({target_path.stat().st_size:,} bytes)")
                    success_count += 1
                else:
                    log("  [WARN] Download file did not appear in time.")
                    fail_count += 1

            except Exception as item_err:
                log(f"  [ERROR] Failed to export {item_desc}: {str(item_err)}")
                fail_count += 1

            set_progress(idx, total_items)
            time.sleep(1)

        log("\n" + "=" * 50)
        log(f"BATCH DOWNLOAD COMPLETED!")
        log(f"Total: {total_items} | Success: {success_count} | Skipped/Failed: {fail_count}")
        log(f"Saved in: {dest_dir}")
        log("=" * 50)
        return True, f"Completed: {success_count}/{total_items} saved"

    except Exception as e:
        log(f"\n[FATAL ERROR] Batch automation stopped: {str(e)}")
        return False, str(e)

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


if __name__ == "__main__":
    from dotenv import load_dotenv
    import json
    load_dotenv()
    
    config_file = Path(__file__).parent / "fabric_list.json"
    if config_file.exists():
        with open(config_file, "r", encoding="utf-8") as f:
            items = json.load(f)
    else:
        items = [{"fabric": "CRYSTAL LYCRA", "unit": "Kgs", "gsm": ""}]

    user = os.getenv("ERP_USERNAME")
    pwd = os.getenv("ERP_PASSWORD")
    run_batch_download(user, pwd, items, download_dir=r"C:\ERP_DOWNLOADS")
