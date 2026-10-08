#!/usr/bin/env python3
"""
REPORT ALIGNMENT & TEMPLATE CONVERSION ENGINE
Automatically processes downloaded ERP reports and compiles them into
the standard 'Stock_WIP_Bulk_Feed_Template' workbook:
- Unfolding Stock -> Production WIP (UNFOLDING)
- Cutting Received Stock -> Production WIP (CUTTING)
- Production WIP Folder -> Production WIP (PR WIP with Pending Quantity)
- Pending Order Quantity -> Pending Orders
- Finished Goods Stock -> Finished Goods
- Fabric Stock Folder -> Fabric Stock
- Fabric Orders Pending -> Fabric WIP
- Output: <Base_Folder>/output/mainout.xlsx
"""

import os
import sys
import json
import shutil
from pathlib import Path
import pandas as pd
import openpyxl
from dotenv import load_dotenv

DEFAULT_TEMPLATE_PATH = str(Path(__file__).parent.resolve() / "Stock_WIP_Bulk_Feed_Template.xlsx")
FILTER_CONFIG_FILE = Path(__file__).parent.resolve() / "mainout_filter_config.json"


def load_filter_config(config_path=None):
    """Loads sheet-wise whitelist filter configuration from JSON."""
    p = config_path or FILTER_CONFIG_FILE
    if isinstance(p, (str, Path)) and os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] Error reading filter config: {e}")
    return {"enabled": True, "filters": {}}


def save_filter_config(data, config_path=None):
    """Saves sheet-wise whitelist filter configuration to JSON."""
    p = config_path or FILTER_CONFIG_FILE
    try:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[ERROR] Error saving filter config: {e}")
        return False


def filter_dataframe_by_items(df, col_name, allowed_items):
    """
    Filters dataframe to keep ONLY rows where df[col_name] matches an item in allowed_items.
    Supports exact match and normalized case-insensitive comparison.
    """
    if df.empty or not allowed_items or col_name not in df.columns:
        return df

    clean_allowed = [str(x).strip().upper() for x in allowed_items if str(x).strip()]
    if not clean_allowed:
        return df

    def is_match(val):
        v = str(val or "").strip().upper()
        if not v:
            return False
        for a in clean_allowed:
            if a == v or a in v:
                return True
        return False

    mask = df[col_name].apply(is_match)
    return df[mask].reset_index(drop=True)


def get_active_filter_names(raw_list):
    """Extracts only active (ticked) item names from a list of dicts or strings."""
    active = []
    for it in raw_list or []:
        if isinstance(it, str):
            s = it.strip()
            if s:
                active.append(s)
        elif isinstance(it, dict):
            if it.get("enabled", True):
                name = str(it.get("name") or "").strip()
                if name:
                    active.append(name)
    return active


# Production Type Mapping Table
PROD_TYPE_MAPPING = {
    '# PALAZZO PRODUCTION NEW': 'Common',
    '# SPUN LEGGINGS': 'Stand Alone',
    '#ANKLE JNR': 'Common',
    '#B502 - STYLE GIRL LEGGINGS': 'Stand Alone',
    '#B503-PATIALA': 'Common',
    '#B504-KIDS PATIYALA': 'Common',
    '#BAY 7/8 LEGGINGS': 'Stand Alone',
    '#BEE': 'Common',
    '#BELLA NEW': 'Stand Alone',
    '#BLISS': 'Stand Alone',
    '#COMMON ANKLEFIT PRODUCTION': 'Common',
    '#COMMON FULL LENGTH PRODUCTION': 'Common',
    '#CONGO': 'Stand Alone',
    '#DOVE': 'Common',
    '#DOVE JNR': 'Stand Alone',
    '#DR001 - COTTON FL LEGGINGS': 'Common',
    '#DR002 - COTTON ANKLE LEGGINGS': 'Common',
    '#DR003-SHIMMER ANKLE LEGGINGS': 'Common',
    '#DR004-SHIMMER FL LEGGINGS': 'Common',
    '#DR005-KURTI PANT': 'Common',
    '#ELIX': 'Common',
    '#F301-KIDS PATIYALA': 'Common',
    '#F312-PATIALA': 'Common',
    '#GLAD': 'Common',
    '#IFWBT008': 'Stand Alone',
    '#IFWBT034(DELIGHT)': 'Common',
    '#IFWBT043-RAYON KURTI PANT NEW': 'Stand Alone',
    '#IFWBT049 - METTALIC STRAIGHT PANT': 'Stand Alone',
    '#IFWBT052 - KNITTED KURTI PANT': 'Stand Alone',
    '#IFWBT053 - NEW': 'Stand Alone',
    '#IFWBT058 - CLUOTTES': 'Stand Alone',
    '#IFWBT060 - DENIM JEGGINGS': 'Stand Alone',
    '#IFWBT061-KURTI PANT': 'Common',
    '#JULIET F/S': 'Common',
    '#JULIET F/S WHITE': 'Common',
    '#JULIET H/S': 'Common',
    '#JULIET H/S WHITE': 'Common',
    '#KIDS LEGGINGS': 'Common',
    '#KURTI PANT - PRODUCTION': 'Common',
    '#MISSI': 'Stand Alone',
    '#NILE': 'Stand Alone',
    '#OCEAN': 'Stand Alone',
    '#OCEAN JNR': 'Stand Alone',
    '#PALAZZO PRODUCTION OLD': 'Common',
    '#PATIALA': 'Common',
    '#PATIALA production': 'Common',
    '#PL009 - COTTON PATIALA': 'Common',
    '#PL014-SHIMMER ANKLE LEGGINGS': 'Common',
    '#PL015-SHIMMER CHURIDAR LEGGINGS': 'Common',
    '#PL016-KURTI PANT': 'Common',
    '#R113 LYCRA LEGGINGS': 'Stand Alone',
    '#R114-ANKLE LEGINGS': 'Stand Alone',
    '#R115 - CAPRI LEGGINGS': 'Stand Alone',
    '#R116-LYCRA LEGGINGS': 'Common',
    '#R117-LYCRA LEGGINGS': 'Common',
    '#R118 - VISCOSE LEGGINGS': 'Stand Alone',
    '#R119 - RICH PREMIUM-ANKLE': 'Stand Alone',
    '#R120 - RICH SAREE SHAPWEAR': 'Stand Alone',
    '#R124-FLAT BELT LEGGINGS': 'Stand Alone',
    '#R125 - SHIMMER ANKLE LEGGINGS': 'Stand Alone',
    '#R126-SHIMMER CHURIDAR LEGGINGS': 'Common',
    '#R127-SHIMMER ANKLE LEGGINGS': 'Common',
    '#R128-JEGGINGS': 'Stand Alone',
    '#RITA': 'Common',
    '#RITA WHITE': 'Common',
    '#RIVER JNR': 'Stand Alone',
    '#RIVER-FLAT': 'Stand Alone',
    '#ROOX-NEW': 'Stand Alone',
    '#SALMA': 'Common',
    '#SALMA WHITE': 'Common',
    '#SEA': 'Stand Alone',
    '#SEA-FLAT': 'Stand Alone',
    '#SHIMMER ANKLE PRODUCTION': 'Common',
    '#SHIMMER CHURDITHAR-FIT PRODUCTION': 'Common',
    '#YASMIN': 'Common',
    '#YASMIN-WHITE': 'Common',
    'COMMON COTTON PATIALA PRODUCTION': 'Common',
    'CP001 - KURTI PANT PRODUCTION': 'Stand Alone',
    'FAKE COTTON ANKLE PRODUCTION': 'Common',
    'FAKE COTTON FULL LENGTH LEGGINGS  PRODUCTION': 'Common',
    'FAKE COTTON FULL LENGTH LEGGINGS PRODUCTION': 'Stand Alone',
    'IFWBT066 - SHIMMER SHAPWEAR': 'Stand Alone',
    'JULIET F/S PRODUCTION': 'Common',
    'JULIET H/S PRODUCTION': 'Common',
    'KIDS PATIALA PRODUCTION': 'Common',
    'KOREAN PANT - IFWBT068': 'Stand Alone',
    'LINEN STRAIGHT PANT': 'Stand Alone',
    'LOVE ALL CHURIDAR LEGGINGS': 'Stand Alone',
    'LOVE ALL SHIMMER ANKLE LEGGINGS': 'Stand Alone',
    'PL005 - COTTON PLUS KURTI PANT': 'Stand Alone',
    'PL006 - FANCY PLAZZO DESIGN - 1': 'Stand Alone',
    'RITA PRODUCTION': 'Common',
    'SALMA PRODUCTION': 'Common',
    'SECONDS SHORTS': 'Stand Alone',
    'SUPER LINEN': 'Stand Alone',
    'TIT TIN': 'Stand Alone',
    'WHOLE SALE AL LEGGINGS': 'Common',
    'WHOLE SALE FL LLEGGINGS': 'Common',
    'WHOLE SALE FL SHIMMER': 'Common',
    'YASMIN JNR PRODUCTION': 'Common',
    'YASMIN PRODUCTION': 'Common'
}

FABRIC_RULES = {
    ("HAVY RAYON", 150): "HEAVY_RAYON",
    ("CROSS LOOP DESIGN", 240): "CROSS_LOOP_DESIGN",
    ("LYCRA JERSEY", 210): "LYCRA_JERSY_210GSM",
    ("RAYON SLUB LYCRA BFOLD", 180): "RAYON_SLUB_BFOLD",
    ("METTALIC", 115): "METALLIC_OPEN_WIDTH",
    ("POLY SHIMMER", 180): "POLY_SHIMMER",
    ("VISCOSE LYCRA JERSEY", 250): "VISCOSE_LYCRA_JERSY",
    ("NYLON SHIMMER", 180): "NYLON_SHIMMER",
    ("SINGLE JERSEY", 145): "SINGLE_JERSY",
    ("SINGLE JERSEY", 165): "SINGLE_JERSY_165GSM",
    ("LYCRA JERSEY", 185): "LYCRA_JERSY",
    ("CRYSTAL LYCRA", 145): "CRYSTAL_LYCRA",
    ("VATICON", 145): "VARTICAN",
    ("RAYON", 120): "RAYON"
}
FABRIC_RULES_UPPER = {(k[0].upper(), k[1]): v for k, v in FABRIC_RULES.items()}


def get_production_type(prod):
    p_str = str(prod).strip() if pd.notna(prod) else ""
    if p_str in PROD_TYPE_MAPPING:
        return PROD_TYPE_MAPPING[p_str]
    for k, v in PROD_TYPE_MAPPING.items():
        if k.upper() == p_str.upper():
            return v
    p_upper = p_str.upper()
    if "COMMON" in p_upper or "PRODUCTION" in p_upper or "PATIALA" in p_upper or ("LEGGINGS" in p_upper and "KIDS" in p_upper):
        return "Common"
    return "Stand Alone"


def resolve_auto_paths(base_dir):
    """Detects and resolves standard report paths from a base download folder."""
    b_path = Path(base_dir).resolve()
    out_dir = b_path / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Opening File (Unfolding Stock)
    opening_candidates = [
        b_path / "Unfolding Stock" / "Unfolding Stock.xlsx",
        b_path / "Unfolding Stock.xlsx"
    ]
    opening_file = next((str(p) for p in opening_candidates if p.exists()), str(opening_candidates[0]))

    # 2. Pending Orders File
    pending_candidates = [
        b_path / "Pending Order Quantity" / "Pending Order Quantity.xlsx",
        b_path / "Pending Order Quantity.xlsx"
    ]
    pending_file = next((str(p) for p in pending_candidates if p.exists()), str(pending_candidates[0]))

    # 3. Cutting Received File
    cutting_candidates = [
        b_path / "Cutting Received Stock" / "Cutting Received Stock.xlsx",
        b_path / "Cutting Received Stock.xlsx"
    ]
    cutting_file = next((str(p) for p in cutting_candidates if p.exists()), str(cutting_candidates[0]))

    # 4. Final Goods File
    final_candidates = [
        b_path / "Finished Goods Stock" / "Finished Goods Stock.xlsx",
        b_path / "Finished Goods Stock.xlsx"
    ]
    final_file = next((str(p) for p in final_candidates if p.exists()), str(final_candidates[0]))

    # 5. WIP Folder
    wip_folder = str(b_path / "Production WIP")

    # 6. Fabric Folder
    fabric_folder = str(b_path / "Fabric Stock")

    # 7. Fabric WIP File (Garment ERP Pending Orders)
    fwip_candidates = [
        b_path / "Fabric Orders" / "Fabric Orders Pending.xlsx",
        b_path / "Fabric Orders" / "fabric_orders_report.xlsx",
        b_path / "Fabric Orders Pending.xlsx"
    ]
    fwip_file = next((str(p) for p in fwip_candidates if p.exists()), str(fwip_candidates[0]))

    # 8. Output
    output_file = str(out_dir / "mainout.xlsx")

    return {
        "opening": opening_file,
        "pending": pending_file,
        "cutting": cutting_file,
        "final": final_file,
        "wip": wip_folder,
        "fabric": fabric_folder,
        "fabric_wip": fwip_file,
        "output": output_file
    }


def run_report_alignment(
    base_dir=None,
    template_path=None,
    output_path=None,
    custom_paths=None,
    filter_config=None,
    filter_config_path=None,
    status_callback=None,
    progress_callback=None
):
    """
    Executes automated transformation and saves mainout.xlsx.
    """
    def log(msg):
        print(msg)
        if status_callback:
            try:
                status_callback(msg)
            except Exception:
                pass

    def set_progress(curr, tot):
        if progress_callback:
            try:
                progress_callback(curr, tot)
            except Exception:
                pass

    env_path = Path(__file__).parent.resolve() / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)

    if not base_dir:
        base_dir = os.getenv("DOWNLOAD_DIR", r"C:\ERP_DOWNLOADS")

    paths = custom_paths or resolve_auto_paths(base_dir)
    if output_path:
        paths["output"] = str(output_path)

    if not template_path:
        template_path = DEFAULT_TEMPLATE_PATH

    set_progress(0, 10)
    log("===================================================")
    log("  DAILY REPORT ALIGNMENT & TEMPLATE COMPILATION")
    log("===================================================")
    log(f"Base Folder: {base_dir}")
    log(f"Output File: {paths['output']}")
    log("---------------------------------------------------")

    os.makedirs(os.path.dirname(paths["output"]), exist_ok=True)

    # 1. OPENING (UNFOLDING)
    set_progress(1, 10)
    log("1/7 Processing Opening File (Unfolding Stock)...")
    df1_prod = pd.DataFrame()
    if paths.get("opening") and os.path.exists(paths["opening"]):
        try:
            df1 = pd.read_excel(paths["opening"], header=1)
            df1.columns = df1.columns.str.strip()
            df1 = df1.iloc[:-1, :-1]

            df1_unpivot = df1.melt(
                id_vars=["S.No", "Product", "Color"],
                var_name="Size",
                value_name="Quantity"
            ).dropna(subset=["Quantity"])
            df1_unpivot = df1_unpivot[df1_unpivot["Quantity"] != 0]

            df1_prod = pd.DataFrame({
                "Product Name": df1_unpivot["Product"].astype(str).str.strip(),
                "Color": df1_unpivot["Color"].astype(str).str.strip(),
                "Size": df1_unpivot["Size"].astype(str).str.strip(),
                "Production Type": df1_unpivot["Product"].map(get_production_type),
                "Production Group": "UNFOLDING",
                "Qty": pd.to_numeric(df1_unpivot["Quantity"], errors="coerce")
            })
            log(f"    Loaded {len(df1_prod):,} rows from Unfolding Stock.")
        except Exception as e:
            log(f"    [WARN] Opening parsing error: {e}")

    # 2. CUTTING (CUTTING)
    set_progress(2, 10)
    log("2/7 Processing Cutting File (Cutting Received Stock)...")
    df3_prod = pd.DataFrame()
    if paths.get("cutting") and os.path.exists(paths["cutting"]):
        try:
            df3 = pd.read_excel(paths["cutting"], header=1)
            df3.columns = df3.columns.str.strip()
            df3 = df3.iloc[:-1, :-1]

            df3_unpivot = df3.melt(
                id_vars=["S.No", "Product", "Color"],
                var_name="Size",
                value_name="Quantity"
            ).dropna(subset=["Quantity"])
            df3_unpivot = df3_unpivot[df3_unpivot["Quantity"] != 0]

            df3_prod = pd.DataFrame({
                "Product Name": df3_unpivot["Product"].astype(str).str.strip(),
                "Color": df3_unpivot["Color"].astype(str).str.strip(),
                "Size": df3_unpivot["Size"].astype(str).str.strip(),
                "Production Type": df3_unpivot["Product"].map(get_production_type),
                "Production Group": "CUTTING",
                "Qty": pd.to_numeric(df3_unpivot["Quantity"], errors="coerce")
            })
            log(f"    Loaded {len(df3_prod):,} rows from Cutting Received Stock.")
        except Exception as e:
            log(f"    [WARN] Cutting parsing error: {e}")

    # 3. WIP (PR WIP)
    set_progress(3, 10)
    log("3/7 Processing Production WIP Folder...")
    df_wip_prod = pd.DataFrame()
    if paths.get("wip") and os.path.exists(paths["wip"]):
        try:
            all_wip = []
            for file in os.listdir(paths["wip"]):
                if file.endswith(".xlsx") and not file.startswith("~$"):
                    df = pd.read_excel(os.path.join(paths["wip"], file))
                    all_wip.append(df)

            if all_wip:
                wip_data = pd.concat(all_wip, ignore_index=True)
                wip_summary = wip_data.groupby(
                    ["Product", "Color", "Size"], as_index=False
                ).agg(
                    Quantity=("Quantity", "sum"),
                    Pending_Quantity=("Pending Quantity", "sum")
                )

                wip_filtered = wip_summary[
                    wip_summary["Pending_Quantity"].notna() & (wip_summary["Pending_Quantity"] != 0)
                ]

                df_wip_prod = pd.DataFrame({
                    "Product Name": wip_filtered["Product"].astype(str).str.strip(),
                    "Color": wip_filtered["Color"].astype(str).str.strip(),
                    "Size": wip_filtered["Size"].astype(str).str.strip(),
                    "Production Type": wip_filtered["Product"].map(get_production_type),
                    "Production Group": "PR WIP",
                    "Qty": pd.to_numeric(wip_filtered["Pending_Quantity"], errors="coerce")
                })
                log(f"    Loaded {len(df_wip_prod):,} rows from Production WIP folder.")
        except Exception as e:
            log(f"    [WARN] WIP parsing error: {e}")

    # Combine Production WIP
    production_wip_df = pd.concat([df1_prod, df3_prod, df_wip_prod], ignore_index=True)
    production_wip_df = production_wip_df[production_wip_df["Qty"].notna() & (production_wip_df["Qty"] != 0)]
    if not production_wip_df.empty:
        production_wip_df = production_wip_df.groupby(
            ["Product Name", "Color", "Size", "Production Type", "Production Group"],
            as_index=False
        )["Qty"].sum()
    log(f"    -> Combined Production WIP: {len(production_wip_df):,} rows.")

    # 4. PENDING ORDERS
    set_progress(4, 10)
    log("4/7 Processing Pending Orders File...")
    pending_orders_df = pd.DataFrame()
    if paths.get("pending") and os.path.exists(paths["pending"]):
        try:
            df2 = pd.read_excel(paths["pending"])
            df2.columns = df2.columns.str.strip()
            df2 = df2.iloc[:-1, :-1]

            prod_col = "product" if "product" in df2.columns else "Product"

            df2_unpivot = df2.melt(
                id_vars=["S.No", prod_col, "Color"],
                var_name="Size",
                value_name="Quantity"
            ).dropna(subset=["Quantity"])
            df2_unpivot = df2_unpivot[df2_unpivot["Quantity"] != 0]

            pending_orders_df = pd.DataFrame({
                "Product Name": df2_unpivot[prod_col].astype(str).str.strip(),
                "Color": df2_unpivot["Color"].astype(str).str.strip(),
                "Size": df2_unpivot["Size"].astype(str).str.strip(),
                "Qty": pd.to_numeric(df2_unpivot["Quantity"], errors="coerce")
            })
            if not pending_orders_df.empty:
                pending_orders_df = pending_orders_df.groupby(
                    ["Product Name", "Color", "Size"], as_index=False
                )["Qty"].sum()
            log(f"    Loaded {len(pending_orders_df):,} rows from Pending Orders.")
        except Exception as e:
            log(f"    [WARN] Pending Orders parsing error: {e}")

    # 5. FINISHED GOODS
    set_progress(5, 10)
    log("5/7 Processing Finished Goods Stock File...")
    finished_goods_df = pd.DataFrame()
    if paths.get("final") and os.path.exists(paths["final"]):
        try:
            df4 = pd.read_excel(paths["final"], header=None)
            mask = df4.iloc[1] != "Box"
            df4 = df4.loc[:, mask]
            df4.columns = df4.iloc[0]
            df4 = df4[1:].iloc[:-1, :-2]

            df4_unpivot = df4.melt(
                id_vars=["S.No", "Product", "Color", "UOM"],
                var_name="Size",
                value_name="Quantity"
            ).dropna(subset=["Quantity"])
            df4_unpivot = df4_unpivot[df4_unpivot["Quantity"] != 0]

            finished_goods_df = pd.DataFrame({
                "Product Name": df4_unpivot["Product"].astype(str).str.strip(),
                "Color": df4_unpivot["Color"].astype(str).str.strip(),
                "Size": df4_unpivot["Size"].astype(str).str.strip(),
                "Qty": pd.to_numeric(df4_unpivot["Quantity"], errors="coerce")
            })
            if not finished_goods_df.empty:
                finished_goods_df = finished_goods_df.groupby(
                    ["Product Name", "Color", "Size"], as_index=False
                )["Qty"].sum()
            log(f"    Loaded {len(finished_goods_df):,} rows from Finished Goods.")
        except Exception as e:
            log(f"    [WARN] Finished Goods parsing error: {e}")

    # 6. FABRIC STOCK
    set_progress(6, 10)
    log("6/7 Processing Fabric Stock Folder...")
    fabric_stock_df = pd.DataFrame(columns=["Fabric Name", "GSM", "DIA", "Color", "Weight"])
    if paths.get("fabric") and os.path.exists(paths["fabric"]):
        try:
            fabric_data = []
            for file in os.listdir(paths["fabric"]):
                if file.endswith(".xlsx") and not file.startswith("~$"):
                    p = os.path.join(paths["fabric"], file)
                    df = pd.read_excel(p)
                    df.columns = df.columns.str.strip()
                    df = df.drop(columns=["Roll", "Unit"], errors="ignore")

                    if "Weight" in df.columns:
                        df = df[df["Weight"].notna()]
                        df = df[df["Weight"] != 0]

                    if "Fabric" in df.columns and "GSM" in df.columns:
                        def convert(row):
                            fab = str(row["Fabric"]).strip().upper()
                            try:
                                gsm = int(float(row["GSM"]))
                            except Exception:
                                return fab
                            return FABRIC_RULES_UPPER.get((fab, gsm), fab)

                        df["Fabric"] = df.apply(convert, axis=1)

                    fabric_data.append(df)

            if fabric_data:
                fabric_df = pd.concat(fabric_data, ignore_index=True)
                if "Fabric" in fabric_df.columns:
                    fabric_df = fabric_df.rename(columns={"Fabric": "Fabric Name"})

                for col in ["Fabric Name", "GSM", "DIA", "Color", "Weight"]:
                    if col not in fabric_df.columns:
                        fabric_df[col] = ""

                fabric_stock_df = fabric_df[["Fabric Name", "GSM", "DIA", "Color", "Weight"]]
            log(f"    Loaded {len(fabric_stock_df):,} rows from Fabric Stock.")
        except Exception as e:
            log(f"    [WARN] Fabric Stock parsing error: {e}")

    # 7. FABRIC WIP (GARMENT ERP PENDING ORDERS)
    set_progress(7, 10)
    log("7/7 Processing Fabric WIP (Garment ERP Pending Orders)...")
    fabric_wip_df = pd.DataFrame(columns=["Fabric Name", "GSM", "DIA", "Color", "Weight"])
    if paths.get("fabric_wip") and os.path.exists(paths["fabric_wip"]):
        try:
            df_fwip = pd.read_excel(paths["fabric_wip"])
            df_fwip.columns = df_fwip.columns.str.strip()

            if "Status" in df_fwip.columns:
                mask = df_fwip["Status"].astype(str).str.strip().str.lower() == "pending"
                if mask.any():
                    df_fwip = df_fwip[mask]

            if "Fabric" in df_fwip.columns and "GSM" in df_fwip.columns:
                def convert_fwip(row):
                    fab = str(row["Fabric"]).strip().upper()
                    try:
                        gsm = int(float(row["GSM"]))
                    except Exception:
                        return fab
                    return FABRIC_RULES_UPPER.get((fab, gsm), fab)

                df_fwip["Fabric"] = df_fwip.apply(convert_fwip, axis=1)

            col_map = {}
            if "Fabric" in df_fwip.columns:
                col_map["Fabric"] = "Fabric Name"
            if "Colour" in df_fwip.columns:
                col_map["Colour"] = "Color"
            elif "Color" in df_fwip.columns:
                col_map["Color"] = "Color"

            if "Order Qty" in df_fwip.columns:
                col_map["Order Qty"] = "Weight"
            elif "Qty" in df_fwip.columns:
                col_map["Qty"] = "Weight"
            elif "Quantity" in df_fwip.columns:
                col_map["Quantity"] = "Weight"

            df_fwip = df_fwip.rename(columns=col_map)

            if "GSM" in df_fwip.columns:
                df_fwip["GSM"] = pd.to_numeric(df_fwip["GSM"], errors="coerce")
            if "DIA" in df_fwip.columns:
                df_fwip["DIA"] = pd.to_numeric(df_fwip["DIA"], errors="coerce")
            if "Weight" in df_fwip.columns:
                df_fwip["Weight"] = pd.to_numeric(df_fwip["Weight"], errors="coerce")

            for col in ["Fabric Name", "GSM", "DIA", "Color", "Weight"]:
                if col not in df_fwip.columns:
                    df_fwip[col] = ""

            df_fwip = df_fwip[df_fwip["Weight"].notna() & (df_fwip["Weight"] != 0)]
            df_fwip["Color"] = df_fwip["Color"].astype(str).str.strip()
            df_fwip["Fabric Name"] = df_fwip["Fabric Name"].astype(str).str.strip()

            fabric_wip_df = df_fwip.groupby(
                ["Fabric Name", "GSM", "DIA", "Color"],
                as_index=False
            )["Weight"].sum()
            log(f"    Loaded {len(fabric_wip_df):,} rows from Fabric WIP.")
        except Exception as e:
            log(f"    [WARN] Fabric WIP parsing error: {e}")

    # 8. APPLY SHEET-WISE WHITELIST FILTERS
    flt_cfg = filter_config or load_filter_config(filter_config_path)
    if flt_cfg and flt_cfg.get("enabled", True):
        filters_dict = flt_cfg.get("filters", {})

        # 1. Fabric Stock (Filter column: Fabric Name)
        fab_list = get_active_filter_names(filters_dict.get("Fabric Stock", []))
        if fab_list:
            b_cnt = len(fabric_stock_df)
            fabric_stock_df = filter_dataframe_by_items(fabric_stock_df, "Fabric Name", fab_list)
            log(f"  [Filter] Fabric Stock: kept {len(fabric_stock_df):,} of {b_cnt:,} rows ({len(fab_list)} allowed fabrics).")

        # 2. Fabric WIP (Filter column: Fabric Name)
        fwip_list = get_active_filter_names(filters_dict.get("Fabric WIP", []))
        if fwip_list:
            b_cnt = len(fabric_wip_df)
            fabric_wip_df = filter_dataframe_by_items(fabric_wip_df, "Fabric Name", fwip_list)
            log(f"  [Filter] Fabric WIP: kept {len(fabric_wip_df):,} of {b_cnt:,} rows ({len(fwip_list)} allowed fabrics).")

        # 3. Production WIP (Filter only UNFOLDING items; keep all CUTTING and PR WIP rows)
        pwip_list = get_active_filter_names(filters_dict.get("Production WIP", []))
        if pwip_list and not production_wip_df.empty:
            b_cnt = len(production_wip_df)
            if "Production Group" in production_wip_df.columns:
                is_unfolding = production_wip_df["Production Group"].astype(str).str.strip().str.upper() == "UNFOLDING"
                df_other = production_wip_df[~is_unfolding]
                df_unf = production_wip_df[is_unfolding]
                b_unf = len(df_unf)
                df_unf_filtered = filter_dataframe_by_items(df_unf, "Product Name", pwip_list)
                production_wip_df = pd.concat([df_unf_filtered, df_other], ignore_index=True)
                log(f"  [Filter] Production WIP: Kept ALL {len(df_other):,} Cutting & PR WIP rows; Filtered Unfolding ({len(df_unf_filtered):,} of {b_unf:,} rows kept for {len(pwip_list)} allowed products).")
            else:
                production_wip_df = filter_dataframe_by_items(production_wip_df, "Product Name", pwip_list)
                log(f"  [Filter] Production WIP: kept {len(production_wip_df):,} of {b_cnt:,} rows ({len(pwip_list)} allowed products).")

        # 4. Pending Orders (Filter column: Product Name)
        pend_list = get_active_filter_names(filters_dict.get("Pending Orders", []))
        if pend_list:
            b_cnt = len(pending_orders_df)
            pending_orders_df = filter_dataframe_by_items(pending_orders_df, "Product Name", pend_list)
            log(f"  [Filter] Pending Orders: kept {len(pending_orders_df):,} of {b_cnt:,} rows ({len(pend_list)} allowed products).")

        # 5. Finished Goods (Filter column: Product Name)
        fg_list = get_active_filter_names(filters_dict.get("Finished Goods", []))
        if fg_list:
            b_cnt = len(finished_goods_df)
            finished_goods_df = filter_dataframe_by_items(finished_goods_df, "Product Name", fg_list)
            log(f"  [Filter] Finished Goods: kept {len(finished_goods_df):,} of {b_cnt:,} rows ({len(fg_list)} allowed products).")

    # 9. COMPILE INTO OUTPUT TEMPLATE
    set_progress(8, 10)
    log("Compiling all sheets into Excel template...")
    if os.path.exists(template_path):
        log(f"  Cloning base template: {template_path}")
        shutil.copyfile(template_path, paths["output"])
        wb = openpyxl.load_workbook(paths["output"])
    else:
        log("  [NOTE] Template not found, creating fresh workbook.")
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

    def write_to_sheet(sheet_name, df_data, columns):
        if sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            if ws.max_row > 1:
                ws.delete_rows(2, ws.max_row - 1)
        else:
            ws = wb.create_sheet(title=sheet_name)
            ws.append(columns)

        if not df_data.empty:
            for row in df_data[columns].itertuples(index=False):
                ws.append(list(row))

    # 1. Fabric Stock
    write_to_sheet("Fabric Stock", fabric_stock_df, ["Fabric Name", "GSM", "DIA", "Color", "Weight"])
    # 2. Fabric WIP
    write_to_sheet("Fabric WIP", fabric_wip_df, ["Fabric Name", "GSM", "DIA", "Color", "Weight"])
    # 3. Production WIP
    write_to_sheet("Production WIP", production_wip_df, ["Product Name", "Color", "Size", "Production Type", "Production Group", "Qty"])
    # 4. Pending Orders
    write_to_sheet("Pending Orders", pending_orders_df, ["Product Name", "Color", "Size", "Qty"])
    # 5. Finished Goods
    write_to_sheet("Finished Goods", finished_goods_df, ["Product Name", "Color", "Size", "Qty"])

    set_progress(9, 10)
    log("Saving output workbook to disk...")
    wb.save(paths["output"])

    file_size_bytes = os.path.getsize(paths["output"])
    file_size_kb = file_size_bytes / 1024

    set_progress(10, 10)
    log("\n" + "=" * 60)
    log("REPORT CONVERSION COMPLETED SUCCESSFULLY!")
    log(f"  Output Saved : {paths['output']}")
    log(f"  File Size    : {file_size_kb:.2f} KB ({file_size_bytes:,} bytes)")
    log("=" * 60)

    return True, paths["output"]


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    target_base = os.getenv("DOWNLOAD_DIR", r"C:\ERP_DOWNLOADS")
    success, res = run_report_alignment(base_dir=target_base)
    if not success:
        sys.exit(1)
