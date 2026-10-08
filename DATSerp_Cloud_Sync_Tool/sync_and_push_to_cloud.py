#!/usr/bin/env python3
"""
DATSerp to Srinithi Garment Cloud ERP - Automated Sync & Direct Push Tool
========================================================================
Runs full 8-step DATSerp download automation and pushes records directly
into the Supabase Cloud PostgreSQL database used by Render.
Can be executed from ANY computer.
"""

import os
import sys
import json
import time
import datetime
import shutil
from pathlib import Path
import openpyxl
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# Ensure local directory is in path
TOOL_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(TOOL_DIR))

# Load .env configuration
ENV_FILE = TOOL_DIR / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)

DEFAULT_DB_URL = "postgresql://postgres.cvlhstgldrgozuokykzw:aadhiammu321sng@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

def log(msg):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def parse_mainout_file(file_path):
    """Parses mainout.xlsx into 5 standard sheet datasets matching ERP tables."""
    p = Path(file_path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    expected_sheets = ['Fabric Stock', 'Fabric WIP', 'Production WIP', 'Pending Orders', 'Finished Goods']
    parsed = {s: [] for s in expected_sheets}
    wb = openpyxl.load_workbook(str(p), data_only=True)

    for sheet_title in expected_sheets:
        if sheet_title not in wb.sheetnames:
            continue
        ws = wb[sheet_title]
        headers = []
        for r_idx, row in enumerate(ws.iter_rows(values_only=True), 1):
            if r_idx == 1:
                headers = [str(c or '').strip() for c in row]
                continue
            if not any(row):
                continue
            r = {headers[col_idx]: val for col_idx, val in enumerate(row) if col_idx < len(headers)}

            if sheet_title in ['Fabric Stock', 'Fabric WIP']:
                parsed[sheet_title].append({
                    'fabric_name': str(r.get('Fabric Name') or r.get('fabric_name') or r.get('Fabric') or '').strip(),
                    'gsm': str(r.get('GSM') or r.get('gsm') or '0').strip(),
                    'dia': str(r.get('DIA') or r.get('dia') or '0').strip(),
                    'color': str(r.get('Color') or r.get('color') or '').strip(),
                    'weight_mtr': str(r.get('Weight') or r.get('weight') or '0').strip(),
                    'uom': 'KGS'
                })
            elif sheet_title == 'Production WIP':
                parsed[sheet_title].append({
                    'product_name': str(r.get('Product Name') or r.get('product_name') or '').strip(),
                    'color': str(r.get('Color') or r.get('color') or '').strip(),
                    'size': str(r.get('Size') or r.get('size') or '').strip(),
                    'production_type': str(r.get('Production Type') or r.get('production_type') or 'Common').strip(),
                    'production_group': str(r.get('Production Group') or r.get('production_group') or 'UNFOLDING').strip(),
                    'qty': str(r.get('Qty') or r.get('qty') or '0').strip()
                })
            else: # Pending Orders, Finished Goods
                parsed[sheet_title].append({
                    'product_name': str(r.get('Product Name') or r.get('product_name') or '').strip(),
                    'color': str(r.get('Color') or r.get('color') or '').strip(),
                    'size': str(r.get('Size') or r.get('size') or '').strip(),
                    'qty': str(r.get('Qty') or r.get('qty') or '0').strip()
                })

    return parsed

def push_to_supabase_database(db_url, parsed_sheets, feed_strategy="replace", operator="auto-sync-tool"):
    """Pushes the 5 parsed sheets atomically into the Supabase PostgreSQL database."""
    log(f"Connecting to Supabase Cloud Database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    try:
        if feed_strategy == 'replace':
            log("Feed Strategy: REPLACE MODE. Clearing old records across 5 stock/wip tables...")
            cur.execute("DELETE FROM fabric_stock;")
            cur.execute("DELETE FROM fabric_wip;")
            cur.execute("DELETE FROM production_wip;")
            cur.execute("DELETE FROM pending_orders;")
            cur.execute("DELETE FROM finished_goods;")

        counts = {}
        sheet_mapping = {
            'Fabric Stock': ('fabric_stock', 'fabric-stock'),
            'Fabric WIP': ('fabric_wip', 'fabric-wip'),
            'Production WIP': ('production_wip', 'production-wip'),
            'Pending Orders': ('pending_orders', 'pending-orders'),
            'Finished Goods': ('finished_goods', 'finished-goods')
        }

        for sheet_title, (table_name, tab_slug) in sheet_mapping.items():
            rows = parsed_sheets.get(sheet_title, [])
            if not rows:
                counts[sheet_title] = 0
                continue

            if tab_slug in ['fabric-stock', 'fabric-wip']:
                data = [
                    (
                        r['fabric_name'],
                        int(float(r['gsm'] or 0)),
                        float(r['dia'] or 0),
                        r['color'],
                        r['uom'],
                        float(r['weight_mtr'] or 0),
                        'VALID',
                        'Synced via Portable Sync Tool',
                        operator,
                        operator
                    )
                    for r in rows
                ]
                psycopg2.extras.execute_values(
                    cur,
                    f"""
                        INSERT INTO {table_name} (fabric_name, gsm, dia, color, uom, weight_mtr, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                        VALUES %s;
                    """,
                    data,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
                )
            elif tab_slug == 'production-wip':
                data = [
                    (
                        r['product_name'],
                        r['color'],
                        r['size'],
                        r['production_type'],
                        r['production_group'],
                        int(float(r['qty'] or 0)),
                        'VALID',
                        'Synced via Portable Sync Tool',
                        operator,
                        operator
                    )
                    for r in rows
                ]
                psycopg2.extras.execute_values(
                    cur,
                    f"""
                        INSERT INTO {table_name} (product_name, color, size, production_type, production_group, qty, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                        VALUES %s;
                    """,
                    data,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
                )
            else: # pending-orders, finished-goods
                data = [
                    (
                        r['product_name'],
                        r['color'],
                        r['size'],
                        int(float(r['qty'] or 0)),
                        'VALID',
                        'Synced via Portable Sync Tool',
                        operator,
                        operator
                    )
                    for r in rows
                ]
                psycopg2.extras.execute_values(
                    cur,
                    f"""
                        INSERT INTO {table_name} (product_name, color, size, qty, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                        VALUES %s;
                    """,
                    data,
                    template="(%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
                )

            counts[sheet_title] = len(rows)

        # Clear balance cache
        cur.execute("DELETE FROM balance_qty_cache;")
        conn.commit()
        cur.close()
        conn.close()
        return True, counts

    except Exception as e:
        conn.rollback()
        cur.close()
        conn.close()
        return False, str(e)


def main():
    print("=" * 65)
    print("   SRINITHI GARMENT - DATSerp AUTO SYNC & CLOUD PUSH TOOL")
    print("=" * 65)
    print("This tool exports live stock/WIP from DATSerp and pushes directly")
    print("into the Supabase Cloud PostgreSQL database for Render.\n")

    user = os.environ.get("ERP_USERNAME", "jana@sng.com").strip()
    pwd = os.environ.get("ERP_PASSWORD", "Jana@#123").strip()
    db_url = os.environ.get("DATABASE_URL", DEFAULT_DB_URL).strip()
    
    # Destination folder defaults to ./downloads/<today>
    today_str = datetime.date.today().strftime("%d-%m-%Y")
    default_dir = str(TOOL_DIR / "downloads" / today_str)
    base_dir = os.environ.get("DOWNLOAD_DIR", default_dir).strip().strip('"').strip("'")
    
    headless_str = os.environ.get("HEADLESS", "false").strip().lower()
    headless = headless_str in ("true", "1", "yes")

    print(f"ERP Account : {user}")
    print(f"Download Dir: {base_dir}")
    print(f"Headless    : {'Yes' if headless else 'No (Browser Visible)'}")
    print("-----------------------------------------------------------------")

    # Ask for confirmation if running interactively
    if sys.stdin and sys.stdin.isatty():
        try:
            input("Press [ENTER] to start Full ERP Download & Push to Cloud (or Ctrl+C to abort)... ")
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            sys.exit(0)

    os.makedirs(base_dir, exist_ok=True)

    # Import download engines
    from fabric_batch_engine import run_batch_download
    from production_wip_engine import run_production_wip_download
    from finished_goods_engine import run_finished_goods_download
    from unfolding_stock_engine import run_unfolding_stock_download
    from cutting_received_engine import run_cutting_received_download
    from pending_order_quantity_engine import run_pending_order_quantity_download
    from fabric_orders_engine import run_fabric_orders_download
    from report_alignment_engine import run_report_alignment, load_filter_config

    # Read active filters and items
    fab_json = TOOL_DIR / "fabric_list.json"
    fab_items = []
    if fab_json.exists():
        with open(fab_json, "r", encoding="utf-8") as f:
            fab_items = [it for it in json.load(f) if it.get("enabled", True)]

    wip_json = TOOL_DIR / "production_wip_list.json"
    wip_items = []
    if wip_json.exists():
        with open(wip_json, "r", encoding="utf-8") as f:
            wip_items = [it for it in json.load(f) if it.get("enabled", True)]

    # 1. Fabric Stock
    log("\n>>> [1/8] DOWNLOADING FABRIC STOCK BATCH <<<")
    run_batch_download(
        username=user,
        password=pwd,
        download_dir=base_dir,
        fabric_items=fab_items,
        headless=headless,
        status_callback=log
    )

    # 2. Production WIP
    log("\n>>> [2/8] DOWNLOADING PRODUCTION WIP <<<")
    run_production_wip_download(
        username=user,
        password=pwd,
        download_dir=base_dir,
        wip_groups=wip_items,
        headless=headless,
        status_callback=log
    )

    # 3. Finished Goods
    log("\n>>> [3/8] DOWNLOADING FINISHED GOODS STOCK <<<")
    run_finished_goods_download(
        username=user,
        password=pwd,
        download_dir=base_dir,
        headless=headless,
        status_callback=log
    )

    # 4. Unfolding Stock
    log("\n>>> [4/8] DOWNLOADING UNFOLDING STOCK <<<")
    run_unfolding_stock_download(
        username=user,
        password=pwd,
        download_dir=base_dir,
        headless=headless,
        status_callback=log
    )

    # 5. Cutting Received Stock
    log("\n>>> [5/8] DOWNLOADING CUTTING RECEIVED STOCK <<<")
    run_cutting_received_download(
        username=user,
        password=pwd,
        download_dir=base_dir,
        headless=headless,
        status_callback=log
    )

    # 6. Pending Order Quantity
    log("\n>>> [6/8] DOWNLOADING PENDING ORDER QUANTITY <<<")
    run_pending_order_quantity_download(
        username=user,
        password=pwd,
        download_dir=base_dir,
        headless=headless,
        status_callback=log
    )

    # 7. Fabric Orders (Pending)
    log("\n>>> [7/8] DOWNLOADING FABRIC ORDERS (PENDING) <<<")
    run_fabric_orders_download(
        db_url=db_url,
        download_dir=base_dir,
        status_filter="Pending",
        status_callback=log
    )

    # 8. Report Alignment
    log("\n>>> [8/8] COMPILING & ALIGNING REPORTS INTO MAINOUNT.XLSX <<<")
    filter_cfg = load_filter_config(TOOL_DIR / "mainout_filter_config.json")
    align_success, out_file = run_report_alignment(
        base_dir=base_dir,
        filter_config=filter_cfg,
        status_callback=log
    )

    if not align_success or not os.path.exists(out_file):
        log(f"[FATAL] mainout.xlsx compilation failed! Aborting database push.")
        sys.exit(1)

    log(f"[SUCCESS] Compiled Excel output: {out_file}")

    # 9. Direct Push to Cloud Database
    log("\n>>> [9/9] PUSHING DIRECTLY TO SUPABASE CLOUD DATABASE <<<")
    parsed_data = parse_mainout_file(out_file)
    success, result = push_to_supabase_database(db_url, parsed_data, feed_strategy="replace")

    if not success:
        log(f"[ERROR] Database push failed: {result}")
        sys.exit(1)

    print("\n" + "=" * 65)
    print("   [SUCCESS] ALL DATA PUSHED TO SUPABASE CLOUD DATABASE!")
    print("=" * 65)
    total_rows = 0
    for sheet, cnt in result.items():
        print(f"   • {sheet:<22}: {cnt:,} rows")
        total_rows += cnt
    print(f"   • Total Records Inserted: {total_rows:,} rows")
    print("=" * 65)
    print("Render Cloud App (https://planning-software-y3mi.onrender.com)")
    print("is now fully updated and live with fresh stock & WIP records!")
    print("=" * 65 + "\n")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"[FATAL ERROR] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
