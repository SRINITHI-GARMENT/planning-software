#!/usr/bin/env python3
"""
DATSerp — UNIFIED MULTI-REPORT BATCH DOWNLOADER GUI
A modern Desktop application for automated bulk exports from DATSerp ERP:
- Fabric Stock Reports (routed to <Folder>/Fabric Stock/)
- Production WIP / Product Pending Reports (routed to <Folder>/Production WIP/)
- Extensible custom list management and all-in-one batch runner.
"""

import os
import sys
import json
import time
import datetime
import threading
import subprocess
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox

# Try loading customtkinter for sleek modern dark/light UI
try:
    import customtkinter as ctk
    ctk.set_appearance_mode("Dark")
    ctk.set_default_color_theme("blue")
    USE_CTK = True
except ImportError:
    USE_CTK = False

# Try loading python-dotenv
try:
    from dotenv import load_dotenv, set_key
    load_dotenv()
except ImportError:
    pass

from fabric_batch_engine import run_batch_download as run_fabric_batch
from production_wip_engine import run_production_wip_download
from finished_goods_engine import run_finished_goods_download
from unfolding_stock_engine import run_unfolding_stock_download
from cutting_received_engine import run_cutting_received_download
from pending_order_quantity_engine import run_pending_order_quantity_download
from fabric_orders_engine import run_fabric_orders_download
from report_alignment_engine import (
    run_report_alignment,
    resolve_auto_paths,
    load_filter_config,
    save_filter_config,
    FILTER_CONFIG_FILE
)

SCRIPT_DIR = Path(__file__).parent.resolve()
FABRIC_CONFIG_PATH = SCRIPT_DIR / "fabric_list.json"
WIP_CONFIG_PATH = SCRIPT_DIR / "production_wip_list.json"
ENV_PATH = SCRIPT_DIR / ".env"

DEFAULT_FABRICS = [
    {"fabric": "CRYSTAL LYCRA", "unit": "Kgs", "gsm": "", "enabled": True},
    {"fabric": "LYCRA JERSEY", "unit": "Kgs", "gsm": "185", "enabled": True},
    {"fabric": "LYCRA JERSEY", "unit": "Kgs", "gsm": "210", "enabled": True},
    {"fabric": "NYLON SHIMMER", "unit": "Kgs", "gsm": "", "enabled": True},
    {"fabric": "POLY SHIMMER", "unit": "Kgs", "gsm": "", "enabled": True},
    {"fabric": "VISCOSE LYCRA JERSEY", "unit": "Kgs", "gsm": "", "enabled": True},
    {"fabric": "CROSS LOOP DESIGN", "unit": "Kgs", "gsm": "", "enabled": True},
    {"fabric": "SINGLE JERSEY", "unit": "Kgs", "gsm": "165", "enabled": True},
    {"fabric": "METTALIC", "unit": "Mtr", "gsm": "", "enabled": True},
    {"fabric": "RAYON SLUB LYCRA BFOLD", "unit": "Mtr", "gsm": "", "enabled": True},
    {"fabric": "RAYON", "unit": "Mtr", "gsm": "", "enabled": True},
    {"fabric": "HAVY RAYON", "unit": "Mtr", "gsm": "", "enabled": True}
]

DEFAULT_WIP_GROUPS = [
    {"grouping": "CUTTING", "enabled": True},
    {"grouping": "STITCHING", "enabled": True},
    {"grouping": "SNG - HALF FINISHING", "enabled": True},
    {"grouping": "IRONING & PACKING", "enabled": True}
]


class UnifiedDownloaderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("DATSerp — Multi-Report Automation Suite (Fabric, WIP, Finished Goods, Unfolding & Cutting)")
        self.root.geometry("1020, 840")
        self.root.minsize(880, 720)

        self.fabric_items = self.load_fabric_list()
        self.wip_items = self.load_wip_list()
        
        self.stop_event = threading.Event()
        self.is_running = False

        self.setup_ui()

    # --- CONFIG LOADING & SAVING ---
    def load_fabric_list(self):
        if FABRIC_CONFIG_PATH.exists():
            try:
                with open(FABRIC_CONFIG_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return [dict(item) for item in DEFAULT_FABRICS]

    def save_fabric_list(self):
        try:
            with open(FABRIC_CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self.fabric_items, f, indent=2)
        except Exception as e:
            self.log(f"[ERROR] Failed to save fabric list: {e}")

    def load_wip_list(self):
        if WIP_CONFIG_PATH.exists():
            try:
                with open(WIP_CONFIG_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return [dict(item) for item in DEFAULT_WIP_GROUPS]

    def save_wip_list(self):
        try:
            with open(WIP_CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self.wip_items, f, indent=2)
        except Exception as e:
            self.log(f"[ERROR] Failed to save Production WIP list: {e}")

    # --- UI INITIALIZATION ---
    def setup_ui(self):
        if USE_CTK:
            self.main_frame = ctk.CTkFrame(self.root, corner_radius=12)
            self.main_frame.pack(fill="both", expand=True, padx=14, pady=14)
        else:
            self.main_frame = tk.Frame(self.root, bg="#1e293b")
            self.main_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # 1. Header
        self.create_header()

        # 2. Global ERP Settings & Base Directory
        self.create_settings_section()

        # 3. Multi-Tab Report Area
        self.create_tabview_section()

        # 4. Progress & Bottom Actions
        self.create_bottom_action_section()

        # 5. Real-time Log Console
        self.create_log_section()

    def create_header(self):
        header_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent") if USE_CTK else tk.Frame(self.main_frame)
        header_frame.pack(fill="x", padx=10, pady=(2, 6))

        title = ctk.CTkLabel(
            header_frame,
            text="⚡ DATSerp Multi-Report One-Click Batch Automation",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color="#38bdf8"
        ) if USE_CTK else tk.Label(header_frame, text="DATSerp Batch Downloader", font=("Arial", 16, "bold"))
        title.pack(side="left")

        subtitle = ctk.CTkLabel(
            header_frame,
            text="Fabric, WIP, Finished Goods, Unfolding, Cutting & Pending Order Suite v9.0",
            font=ctk.CTkFont(size=12),
            text_color="#94a3b8"
        ) if USE_CTK else tk.Label(header_frame, text="DATSerp")
        subtitle.pack(side="right")

    def create_settings_section(self):
        cfg_box = ctk.CTkFrame(self.main_frame, corner_radius=8) if USE_CTK else tk.LabelFrame(self.main_frame, text="Global Settings")
        cfg_box.pack(fill="x", padx=10, pady=4)

        grid_frame = ctk.CTkFrame(cfg_box, fg_color="transparent") if USE_CTK else tk.Frame(cfg_box)
        grid_frame.pack(fill="x", padx=12, pady=8)

        # Base Download Path Row
        path_label = ctk.CTkLabel(grid_frame, text="Base Download Folder:", font=ctk.CTkFont(size=12, weight="bold")) if USE_CTK else tk.Label(grid_frame, text="Download Folder:")
        path_label.grid(row=0, column=0, sticky="w", padx=6, pady=2)

        default_dir = os.getenv("DOWNLOAD_DIR", r"C:\ERP_DOWNLOADS")
        self.path_entry = ctk.CTkEntry(grid_frame, width=540) if USE_CTK else tk.Entry(grid_frame, width=50)
        self.path_entry.insert(0, default_dir)
        self.path_entry.grid(row=0, column=1, sticky="ew", padx=6, pady=2)

        browse_btn = ctk.CTkButton(
            grid_frame,
            text="📂 Browse...",
            width=110,
            command=self.browse_folder,
            fg_color="#334155",
            hover_color="#475569"
        ) if USE_CTK else tk.Button(grid_frame, text="Browse...", command=self.browse_folder)
        browse_btn.grid(row=0, column=2, padx=6, pady=2)

        # ERP Credentials Row
        cred_frame = ctk.CTkFrame(grid_frame, fg_color="transparent") if USE_CTK else tk.Frame(grid_frame)
        cred_frame.grid(row=1, column=0, columnspan=3, sticky="w", pady=(6, 2))

        user_label = ctk.CTkLabel(cred_frame, text="ERP User:", font=ctk.CTkFont(size=12)) if USE_CTK else tk.Label(cred_frame, text="User:")
        user_label.pack(side="left", padx=(6, 4))
        self.user_entry = ctk.CTkEntry(cred_frame, width=220) if USE_CTK else tk.Entry(cred_frame, width=20)
        self.user_entry.insert(0, os.getenv("ERP_USERNAME", "jana@sng.com"))
        self.user_entry.pack(side="left", padx=4)

        pass_label = ctk.CTkLabel(cred_frame, text="Password:", font=ctk.CTkFont(size=12)) if USE_CTK else tk.Label(cred_frame, text="Pass:")
        pass_label.pack(side="left", padx=(16, 4))
        self.pass_entry = ctk.CTkEntry(cred_frame, width=200, show="•") if USE_CTK else tk.Entry(cred_frame, width=20, show="*")
        self.pass_entry.insert(0, os.getenv("ERP_PASSWORD", "Jana@#123"))
        self.pass_entry.pack(side="left", padx=4)

        self.show_pass_var = tk.BooleanVar(value=False)
        show_cb = ctk.CTkCheckBox(cred_frame, text="Show", variable=self.show_pass_var, command=self.toggle_pass, width=60) if USE_CTK else tk.Checkbutton(cred_frame, text="Show", variable=self.show_pass_var, command=self.toggle_pass)
        show_cb.pack(side="left", padx=8)

    def toggle_pass(self):
        if self.show_pass_var.get():
            self.pass_entry.configure(show="")
        else:
            self.pass_entry.configure(show="•")

    def browse_folder(self):
        current_dir = self.path_entry.get().strip() or r"C:\ERP_DOWNLOADS"
        selected = filedialog.askdirectory(initialdir=current_dir, title="Select Base Download Destination Folder")
        if selected:
            self.path_entry.delete(0, "end")
            self.path_entry.insert(0, str(Path(selected).resolve()))

    # --- TABVIEW SECTION ---
    def create_tabview_section(self):
        if USE_CTK:
            self.tabview = ctk.CTkTabview(self.main_frame, corner_radius=8, height=270)
            self.tabview.pack(fill="both", expand=True, padx=10, pady=4)
            
            self.tab_fabric = self.tabview.add("🧵 Fabric Stock")
            self.tab_wip = self.tabview.add("🏭 Production WIP")
            self.tab_goods = self.tabview.add("📦 Finished Goods")
            self.tab_unfolding = self.tabview.add("👕 Unfolding Stock")
            self.tab_cutting = self.tabview.add("✂️ Cutting Received")
            self.tab_pending = self.tabview.add("📋 Pending Orders")
            self.tab_fabric_orders = self.tabview.add("🧵 Fabric Orders")
            self.tab_align = self.tabview.add("📊 Generate mainout")
            self.tab_all = self.tabview.add("⚡ All-in-One Runner")
        else:
            self.tab_fabric = tk.Frame(self.main_frame)
            self.tab_wip = tk.Frame(self.main_frame)
            self.tab_goods = tk.Frame(self.main_frame)
            self.tab_unfolding = tk.Frame(self.main_frame)
            self.tab_cutting = tk.Frame(self.main_frame)
            self.tab_pending = tk.Frame(self.main_frame)
            self.tab_fabric_orders = tk.Frame(self.main_frame)
            self.tab_align = tk.Frame(self.main_frame)
            self.tab_all = tk.Frame(self.main_frame)
            self.tab_fabric.pack(fill="both", expand=True)

        self.setup_fabric_tab()
        self.setup_wip_tab()
        self.setup_goods_tab()
        self.setup_unfolding_tab()
        self.setup_cutting_tab()
        self.setup_pending_tab()
        self.setup_fabric_orders_tab()
        self.setup_align_tab()
        self.setup_all_tab()

    # --- TAB 1: FABRIC STOCK ---
    def setup_fabric_tab(self):
        # Header Info Bar
        info_bar = ctk.CTkFrame(self.tab_fabric, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_fabric)
        info_bar.pack(fill="x", padx=6, pady=(4, 2))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Saves into: <Base_Folder>/Fabric Stock/  |  DATSerp Fabric Stock Page",
            font=ctk.CTkFont(size=12),
            text_color="#38bdf8"
        ) if USE_CTK else tk.Label(info_bar, text="Fabric Stock")
        lbl.pack(side="left")

        btn_select_all = ctk.CTkButton(info_bar, text="Select All", width=85, height=24, command=lambda: self.set_all_fabric_checkboxes(True), fg_color="#334155") if USE_CTK else tk.Button(info_bar, text="Select All")
        btn_select_all.pack(side="right", padx=3)

        btn_deselect = ctk.CTkButton(info_bar, text="Deselect All", width=85, height=24, command=lambda: self.set_all_fabric_checkboxes(False), fg_color="#334155") if USE_CTK else tk.Button(info_bar, text="Deselect All")
        btn_deselect.pack(side="right", padx=3)

        btn_reset = ctk.CTkButton(info_bar, text="Reset Defaults", width=95, height=24, command=self.reset_fabric_defaults, fg_color="#475569") if USE_CTK else tk.Button(info_bar, text="Reset")
        btn_reset.pack(side="right", padx=3)

        # Scrollable table
        if USE_CTK:
            self.scroll_fabric = ctk.CTkScrollableFrame(self.tab_fabric, height=130)
            self.scroll_fabric.pack(fill="both", expand=True, padx=6, pady=2)
        else:
            self.scroll_fabric = tk.Frame(self.tab_fabric)
            self.scroll_fabric.pack(fill="both", expand=True, padx=6, pady=2)

        self.fabric_chk_vars = []
        self.render_fabric_table()

        # Add New Fabric Row Form
        add_frame = ctk.CTkFrame(self.tab_fabric, fg_color="#0f172a" if USE_CTK else "#1e293b", corner_radius=6) if USE_CTK else tk.Frame(self.tab_fabric)
        add_frame.pack(fill="x", padx=6, pady=(4, 6))

        add_label = ctk.CTkLabel(add_frame, text="➕ Add Fabric:", font=ctk.CTkFont(size=12, weight="bold"), text_color="#38bdf8") if USE_CTK else tk.Label(add_frame, text="Add:")
        add_label.pack(side="left", padx=6, pady=4)

        self.new_fabric_entry = ctk.CTkEntry(add_frame, placeholder_text="Fabric Description (e.g. 100% COTTON)", width=280) if USE_CTK else tk.Entry(add_frame, width=25)
        self.new_fabric_entry.pack(side="left", padx=3, pady=4)

        if USE_CTK:
            self.new_fabric_unit = ctk.CTkComboBox(add_frame, values=["Kgs", "Mtr", "Pcs", "Box", "Con", "No's"], width=90)
            self.new_fabric_unit.set("Kgs")
        else:
            self.new_fabric_unit = tk.Entry(add_frame, width=8)
            self.new_fabric_unit.insert(0, "Kgs")
        self.new_fabric_unit.pack(side="left", padx=3, pady=4)

        self.new_fabric_gsm = ctk.CTkEntry(add_frame, placeholder_text="GSM (opt)", width=100) if USE_CTK else tk.Entry(add_frame, width=10)
        self.new_fabric_gsm.pack(side="left", padx=3, pady=4)

        add_btn = ctk.CTkButton(add_frame, text="Add", width=80, height=28, command=self.add_new_fabric, fg_color="#10b981", hover_color="#059669") if USE_CTK else tk.Button(add_frame, text="Add", command=self.add_new_fabric)
        add_btn.pack(side="left", padx=6, pady=4)

        # Run Fabric Only Button
        self.btn_run_fabric = ctk.CTkButton(
            add_frame,
            text="🧵 Download Fabric Stock Batch",
            font=ctk.CTkFont(size=12, weight="bold"),
            height=28,
            fg_color="#0284c7",
            hover_color="#0369a1",
            command=self.start_fabric_download
        ) if USE_CTK else tk.Button(add_frame, text="Run Fabric Stock", command=self.start_fabric_download)
        self.btn_run_fabric.pack(side="right", padx=6, pady=4)

    def render_fabric_table(self):
        for widget in self.scroll_fabric.winfo_children():
            widget.destroy()

        self.fabric_chk_vars = []

        header_row = ctk.CTkFrame(self.scroll_fabric, fg_color="#1e293b", corner_radius=4) if USE_CTK else tk.Frame(self.scroll_fabric)
        header_row.pack(fill="x", padx=4, pady=1)

        h_chk = ctk.CTkLabel(header_row, text="Active", width=50, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Active")
        h_chk.pack(side="left", padx=4)

        h_fab = ctk.CTkLabel(header_row, text="Fabric Description", width=360, anchor="w", font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Fabric")
        h_fab.pack(side="left", padx=6)

        h_unit = ctk.CTkLabel(header_row, text="Unit", width=80, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Unit")
        h_unit.pack(side="left", padx=6)

        h_gsm = ctk.CTkLabel(header_row, text="GSM", width=100, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="GSM")
        h_gsm.pack(side="left", padx=6)

        h_act = ctk.CTkLabel(header_row, text="Action", width=70, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Action")
        h_act.pack(side="right", padx=6)

        for idx, item in enumerate(self.fabric_items):
            row_frame = ctk.CTkFrame(self.scroll_fabric, fg_color="#0f172a" if idx % 2 == 0 else "#1e293b", corner_radius=4) if USE_CTK else tk.Frame(self.scroll_fabric)
            row_frame.pack(fill="x", padx=4, pady=1)

            var = tk.BooleanVar(value=item.get("enabled", True))
            self.fabric_chk_vars.append(var)

            chk = ctk.CTkCheckBox(row_frame, text="", variable=var, width=24, command=self.update_fabric_states) if USE_CTK else tk.Checkbutton(row_frame, variable=var)
            chk.pack(side="left", padx=14)

            fab_lbl = ctk.CTkLabel(row_frame, text=item.get("fabric", ""), width=360, anchor="w", font=ctk.CTkFont(size=12)) if USE_CTK else tk.Label(row_frame, text=item.get("fabric", ""))
            fab_lbl.pack(side="left", padx=6)

            unit_lbl = ctk.CTkLabel(row_frame, text=item.get("unit", "Kgs") or "Kgs", width=80, text_color="#f43f5e") if USE_CTK else tk.Label(row_frame, text=item.get("unit", "Kgs"))
            unit_lbl.pack(side="left", padx=6)

            gsm_text = item.get("gsm", "") or "—"
            gsm_lbl = ctk.CTkLabel(row_frame, text=gsm_text, width=100, text_color="#cbd5e1") if USE_CTK else tk.Label(row_frame, text=gsm_text)
            gsm_lbl.pack(side="left", padx=6)

            del_btn = ctk.CTkButton(
                row_frame,
                text="🗑",
                width=36,
                height=22,
                fg_color="#ef4444",
                hover_color="#dc2626",
                command=lambda i=idx: self.delete_fabric(i)
            ) if USE_CTK else tk.Button(row_frame, text="X", command=lambda i=idx: self.delete_fabric(i))
            del_btn.pack(side="right", padx=6, pady=2)

    def update_fabric_states(self):
        for idx, var in enumerate(self.fabric_chk_vars):
            if idx < len(self.fabric_items):
                self.fabric_items[idx]["enabled"] = var.get()
        self.save_fabric_list()

    def set_all_fabric_checkboxes(self, value):
        for var in self.fabric_chk_vars:
            var.set(value)
        self.update_fabric_states()

    def reset_fabric_defaults(self):
        self.fabric_items = [dict(item) for item in DEFAULT_FABRICS]
        self.save_fabric_list()
        self.render_fabric_table()
        self.log("Reset Fabric Stock list to defaults.")

    def add_new_fabric(self):
        fab = self.new_fabric_entry.get().strip()
        unit = self.new_fabric_unit.get().strip()
        gsm = self.new_fabric_gsm.get().strip()

        if not fab:
            messagebox.showwarning("Input Required", "Please enter a Fabric Description.")
            return

        new_item = {"fabric": fab, "unit": unit or "Kgs", "gsm": gsm, "enabled": True}
        self.fabric_items.append(new_item)
        self.save_fabric_list()
        self.render_fabric_table()

        self.new_fabric_entry.delete(0, "end")
        self.new_fabric_gsm.delete(0, "end")
        self.log(f"Added new Fabric: {fab}")

    def delete_fabric(self, index):
        if 0 <= index < len(self.fabric_items):
            removed = self.fabric_items.pop(index)
            self.save_fabric_list()
            self.render_fabric_table()
            self.log(f"Deleted Fabric: {removed.get('fabric')}")

    # --- TAB 2: PRODUCTION WIP ---
    def setup_wip_tab(self):
        # Header Info Bar
        info_bar = ctk.CTkFrame(self.tab_wip, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_wip)
        info_bar.pack(fill="x", padx=6, pady=(4, 2))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Saves into: <Base_Folder>/Production WIP/  |  Product Pending Report Page",
            font=ctk.CTkFont(size=12),
            text_color="#10b981"
        ) if USE_CTK else tk.Label(info_bar, text="Production WIP")
        lbl.pack(side="left")

        btn_select_all = ctk.CTkButton(info_bar, text="Select All", width=85, height=24, command=lambda: self.set_all_wip_checkboxes(True), fg_color="#334155") if USE_CTK else tk.Button(info_bar, text="Select All")
        btn_select_all.pack(side="right", padx=3)

        btn_deselect = ctk.CTkButton(info_bar, text="Deselect All", width=85, height=24, command=lambda: self.set_all_wip_checkboxes(False), fg_color="#334155") if USE_CTK else tk.Button(info_bar, text="Deselect All")
        btn_deselect.pack(side="right", padx=3)

        btn_reset = ctk.CTkButton(info_bar, text="Reset Defaults", width=95, height=24, command=self.reset_wip_defaults, fg_color="#475569") if USE_CTK else tk.Button(info_bar, text="Reset")
        btn_reset.pack(side="right", padx=3)

        # Scrollable table
        if USE_CTK:
            self.scroll_wip = ctk.CTkScrollableFrame(self.tab_wip, height=130)
            self.scroll_wip.pack(fill="both", expand=True, padx=6, pady=2)
        else:
            self.scroll_wip = tk.Frame(self.tab_wip)
            self.scroll_wip.pack(fill="both", expand=True, padx=6, pady=2)

        self.wip_chk_vars = []
        self.render_wip_table()

        # Add New Group Form
        add_frame = ctk.CTkFrame(self.tab_wip, fg_color="#0f172a" if USE_CTK else "#1e293b", corner_radius=6) if USE_CTK else tk.Frame(self.tab_wip)
        add_frame.pack(fill="x", padx=6, pady=(4, 6))

        add_label = ctk.CTkLabel(add_frame, text="➕ Add Group:", font=ctk.CTkFont(size=12, weight="bold"), text_color="#10b981") if USE_CTK else tk.Label(add_frame, text="Add:")
        add_label.pack(side="left", padx=6, pady=4)

        self.new_wip_entry = ctk.CTkEntry(add_frame, placeholder_text="Production Grouping (e.g. CUTTING, STITCHING, SNG - HALF FINISHING)", width=380) if USE_CTK else tk.Entry(add_frame, width=35)
        self.new_wip_entry.pack(side="left", padx=4, pady=4)

        add_btn = ctk.CTkButton(add_frame, text="Add", width=80, height=28, command=self.add_new_wip, fg_color="#10b981", hover_color="#059669") if USE_CTK else tk.Button(add_frame, text="Add", command=self.add_new_wip)
        add_btn.pack(side="left", padx=6, pady=4)

        # Run Production WIP Only Button
        self.btn_run_wip = ctk.CTkButton(
            add_frame,
            text="🏭 Download Production WIP Batch",
            font=ctk.CTkFont(size=12, weight="bold"),
            height=28,
            fg_color="#059669",
            hover_color="#047857",
            command=self.start_wip_download
        ) if USE_CTK else tk.Button(add_frame, text="Run WIP", command=self.start_wip_download)
        self.btn_run_wip.pack(side="right", padx=6, pady=4)

    def render_wip_table(self):
        for widget in self.scroll_wip.winfo_children():
            widget.destroy()

        self.wip_chk_vars = []

        header_row = ctk.CTkFrame(self.scroll_wip, fg_color="#1e293b", corner_radius=4) if USE_CTK else tk.Frame(self.scroll_wip)
        header_row.pack(fill="x", padx=4, pady=1)

        h_chk = ctk.CTkLabel(header_row, text="Active", width=50, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Active")
        h_chk.pack(side="left", padx=4)

        h_name = ctk.CTkLabel(header_row, text="Production Grouping Name", width=480, anchor="w", font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Group")
        h_name.pack(side="left", padx=6)

        h_act = ctk.CTkLabel(header_row, text="Action", width=70, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Action")
        h_act.pack(side="right", padx=6)

        for idx, item in enumerate(self.wip_items):
            row_frame = ctk.CTkFrame(self.scroll_wip, fg_color="#0f172a" if idx % 2 == 0 else "#1e293b", corner_radius=4) if USE_CTK else tk.Frame(self.scroll_wip)
            row_frame.pack(fill="x", padx=4, pady=1)

            var = tk.BooleanVar(value=item.get("enabled", True))
            self.wip_chk_vars.append(var)

            chk = ctk.CTkCheckBox(row_frame, text="", variable=var, width=24, command=self.update_wip_states) if USE_CTK else tk.Checkbutton(row_frame, variable=var)
            chk.pack(side="left", padx=14)

            name_lbl = ctk.CTkLabel(row_frame, text=item.get("grouping", ""), width=480, anchor="w", font=ctk.CTkFont(size=12, weight="bold" if item.get("grouping") in ["CUTTING","STITCHING","SNG - HALF FINISHING","IRONING & PACKING"] else "normal")) if USE_CTK else tk.Label(row_frame, text=item.get("grouping", ""))
            name_lbl.pack(side="left", padx=6)

            del_btn = ctk.CTkButton(
                row_frame,
                text="🗑",
                width=36,
                height=22,
                fg_color="#ef4444",
                hover_color="#dc2626",
                command=lambda i=idx: self.delete_wip(i)
            ) if USE_CTK else tk.Button(row_frame, text="X", command=lambda i=idx: self.delete_wip(i))
            del_btn.pack(side="right", padx=6, pady=2)

    def update_wip_states(self):
        for idx, var in enumerate(self.wip_chk_vars):
            if idx < len(self.wip_items):
                self.wip_items[idx]["enabled"] = var.get()
        self.save_wip_list()

    def set_all_wip_checkboxes(self, value):
        for var in self.wip_chk_vars:
            var.set(value)
        self.update_wip_states()

    def reset_wip_defaults(self):
        self.wip_items = [dict(item) for item in DEFAULT_WIP_GROUPS]
        self.save_wip_list()
        self.render_wip_table()
        self.log("Reset Production WIP list to the 4 default groupings.")

    def add_new_wip(self):
        grp = self.new_wip_entry.get().strip()
        if not grp:
            messagebox.showwarning("Input Required", "Please enter a Production Grouping Name.")
            return

        new_item = {"grouping": grp, "enabled": True}
        self.wip_items.append(new_item)
        self.save_wip_list()
        self.render_wip_table()

        self.new_wip_entry.delete(0, "end")
        self.log(f"Added new Production Grouping: {grp}")

    def delete_wip(self, index):
        if 0 <= index < len(self.wip_items):
            removed = self.wip_items.pop(index)
            self.save_wip_list()
            self.render_wip_table()
            self.log(f"Deleted Production Grouping: {removed.get('grouping')}")

    # --- TAB 3: FINISHED GOODS STOCK ---
    def setup_goods_tab(self):
        # Header Info Bar
        info_bar = ctk.CTkFrame(self.tab_goods, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_goods)
        info_bar.pack(fill="x", padx=6, pady=(4, 6))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Saves into: <Base_Folder>/Finished Goods Stock/Finished Goods Stock.xlsx  |  Final Goods Same Color Stock Page",
            font=ctk.CTkFont(size=12),
            text_color="#f59e0b"
        ) if USE_CTK else tk.Label(info_bar, text="Finished Goods Stock")
        lbl.pack(side="left")

        # Container Card
        card_frame = ctk.CTkFrame(self.tab_goods, corner_radius=10, fg_color="#0f172a" if USE_CTK else "#1e293b") if USE_CTK else tk.Frame(self.tab_goods)
        card_frame.pack(fill="both", expand=True, padx=8, pady=4)

        card_title = ctk.CTkLabel(
            card_frame,
            text="📦 Finished Goods Same Color Stock Report",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#f59e0b"
        ) if USE_CTK else tk.Label(card_frame, text="Finished Goods Same Color Stock", font=("Arial", 14, "bold"))
        card_title.pack(anchor="w", padx=16, pady=(12, 6))

        desc_text = (
            "• Page: https://erp.datserp.com/#/erp/finalgoodsSameColorStockReport\n"
            "• Direct Green Button Export: Clicks the Green Excel button directly without requiring any search filter.\n"
            "• Full Company Breakdown: Automatically exports product wise, color wise, UOM, and sizes breakdown.\n"
            "• Automated File Save: Downloaded report is automatically saved as 'Finished Goods Stock.xlsx'."
        )
        card_desc = ctk.CTkLabel(
            card_frame,
            text=desc_text,
            font=ctk.CTkFont(size=12),
            justify="left",
            text_color="#cbd5e1"
        ) if USE_CTK else tk.Label(card_frame, text=desc_text, justify="left")
        card_desc.pack(anchor="w", padx=16, pady=(0, 14))

        action_row = ctk.CTkFrame(card_frame, fg_color="transparent") if USE_CTK else tk.Frame(card_frame)
        action_row.pack(fill="x", padx=16, pady=(4, 12))

        self.btn_run_goods = ctk.CTkButton(
            action_row,
            text="📦 Download Finished Goods Stock",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=36,
            width=270,
            fg_color="#d97706",
            hover_color="#b45309",
            command=self.start_goods_download
        ) if USE_CTK else tk.Button(action_row, text="Download Finished Goods Stock", command=self.start_goods_download)
        self.btn_run_goods.pack(side="left")

    # --- TAB 4: UNFOLDING STOCK ---
    def setup_unfolding_tab(self):
        # Header Info Bar
        info_bar = ctk.CTkFrame(self.tab_unfolding, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_unfolding)
        info_bar.pack(fill="x", padx=6, pady=(4, 6))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Saves into: <Base_Folder>/Unfolding Stock/Unfolding Stock.xlsx  |  Unfolding Stock - New Page",
            font=ctk.CTkFont(size=12),
            text_color="#a855f7"
        ) if USE_CTK else tk.Label(info_bar, text="Unfolding Stock")
        lbl.pack(side="left")

        # Container Card
        card_frame = ctk.CTkFrame(self.tab_unfolding, corner_radius=10, fg_color="#0f172a" if USE_CTK else "#1e293b") if USE_CTK else tk.Frame(self.tab_unfolding)
        card_frame.pack(fill="both", expand=True, padx=8, pady=4)

        card_title = ctk.CTkLabel(
            card_frame,
            text="👕 Unfolding Stock Report (Color Wise & Size Wise)",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#a855f7"
        ) if USE_CTK else tk.Label(card_frame, text="Unfolding Stock Report", font=("Arial", 14, "bold"))
        card_title.pack(anchor="w", padx=16, pady=(12, 6))

        desc_text = (
            "• Page: https://erp.datserp.com/#/erp/unfoldingOpeningStockReport\n"
            "• Automated Filters: Automatically ticks 'Color Wise' and 'Size Wise' checkboxes.\n"
            "• Search & Load: Clicks the Search button and verifies data table rows have loaded.\n"
            "• Excel Export: Clicks the Red Excel button and saves report as 'Unfolding Stock.xlsx'."
        )
        card_desc = ctk.CTkLabel(
            card_frame,
            text=desc_text,
            font=ctk.CTkFont(size=12),
            justify="left",
            text_color="#cbd5e1"
        ) if USE_CTK else tk.Label(card_frame, text=desc_text, justify="left")
        card_desc.pack(anchor="w", padx=16, pady=(0, 14))

        action_row = ctk.CTkFrame(card_frame, fg_color="transparent") if USE_CTK else tk.Frame(card_frame)
        action_row.pack(fill="x", padx=16, pady=(4, 12))

        self.btn_run_unfolding = ctk.CTkButton(
            action_row,
            text="👕 Download Unfolding Stock",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=36,
            width=270,
            fg_color="#9333ea",
            hover_color="#7e22ce",
            command=self.start_unfolding_download
        ) if USE_CTK else tk.Button(action_row, text="Download Unfolding Stock", command=self.start_unfolding_download)
        self.btn_run_unfolding.pack(side="left")

    # --- TAB 5: CUTTING RECEIVED STOCK ---
    def setup_cutting_tab(self):
        # Header Info Bar
        info_bar = ctk.CTkFrame(self.tab_cutting, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_cutting)
        info_bar.pack(fill="x", padx=6, pady=(4, 6))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Saves into: <Base_Folder>/Cutting Received Stock/Cutting Received Stock.xlsx  |  Cutting Received Stock Page",
            font=ctk.CTkFont(size=12),
            text_color="#ec4899"
        ) if USE_CTK else tk.Label(info_bar, text="Cutting Received Stock")
        lbl.pack(side="left")

        # Container Card
        card_frame = ctk.CTkFrame(self.tab_cutting, corner_radius=10, fg_color="#0f172a" if USE_CTK else "#1e293b") if USE_CTK else tk.Frame(self.tab_cutting)
        card_frame.pack(fill="both", expand=True, padx=8, pady=4)

        card_title = ctk.CTkLabel(
            card_frame,
            text="✂️ Cutting Received Stock Report (Color Wise & Size Wise)",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#ec4899"
        ) if USE_CTK else tk.Label(card_frame, text="Cutting Received Stock Report", font=("Arial", 14, "bold"))
        card_title.pack(anchor="w", padx=16, pady=(12, 6))

        desc_text = (
            "• Page: https://erp.datserp.com/#/erp/cuttingReceivedReport\n"
            "• Automated Filters: Automatically ticks 'Color Wise' and 'Size Wise' checkboxes.\n"
            "• Search & Load: Clicks the Search button and verifies data table rows have loaded.\n"
            "• Excel Export: Clicks the Red Excel button and saves report as 'Cutting Received Stock.xlsx'."
        )
        card_desc = ctk.CTkLabel(
            card_frame,
            text=desc_text,
            font=ctk.CTkFont(size=12),
            justify="left",
            text_color="#cbd5e1"
        ) if USE_CTK else tk.Label(card_frame, text=desc_text, justify="left")
        card_desc.pack(anchor="w", padx=16, pady=(0, 14))

        action_row = ctk.CTkFrame(card_frame, fg_color="transparent") if USE_CTK else tk.Frame(card_frame)
        action_row.pack(fill="x", padx=16, pady=(4, 12))

        self.btn_run_cutting = ctk.CTkButton(
            action_row,
            text="✂️ Download Cutting Received Stock",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=36,
            width=270,
            fg_color="#db2777",
            hover_color="#be185d",
            command=self.start_cutting_download
        ) if USE_CTK else tk.Button(action_row, text="Download Cutting Received Stock", command=self.start_cutting_download)
        self.btn_run_cutting.pack(side="left")

    # --- TAB 6: PENDING ORDER QUANTITY ---
    def setup_pending_tab(self):
        # Header Info Bar
        info_bar = ctk.CTkFrame(self.tab_pending, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_pending)
        info_bar.pack(fill="x", padx=6, pady=(4, 6))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Saves into: <Base_Folder>/Pending Order Quantity/Pending Order Quantity.xlsx  |  Pending Order Quantity Page",
            font=ctk.CTkFont(size=12),
            text_color="#06b6d4"
        ) if USE_CTK else tk.Label(info_bar, text="Pending Order Quantity")
        lbl.pack(side="left")

        # Container Card
        card_frame = ctk.CTkFrame(self.tab_pending, corner_radius=10, fg_color="#0f172a" if USE_CTK else "#1e293b") if USE_CTK else tk.Frame(self.tab_pending)
        card_frame.pack(fill="both", expand=True, padx=8, pady=4)

        card_title = ctk.CTkLabel(
            card_frame,
            text="📋 Pending Order Quantity Report",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#06b6d4"
        ) if USE_CTK else tk.Label(card_frame, text="Pending Order Quantity Report", font=("Arial", 14, "bold"))
        card_title.pack(anchor="w", padx=16, pady=(12, 6))

        desc_text = (
            "• Page: https://erp.datserp.com/#/erp/pendingOrderQuantity\n"
            "• Clear Default Company: Automatically deletes default 'SRINITHI GARMENT' and leaves Company field empty.\n"
            "• Search & Load: Clicks the Search button and verifies data table rows have loaded.\n"
            "• Green Excel Export: Clicks the Green Excel button and saves report as 'Pending Order Quantity.xlsx'."
        )
        card_desc = ctk.CTkLabel(
            card_frame,
            text=desc_text,
            font=ctk.CTkFont(size=12),
            justify="left",
            text_color="#cbd5e1"
        ) if USE_CTK else tk.Label(card_frame, text=desc_text, justify="left")
        card_desc.pack(anchor="w", padx=16, pady=(0, 14))

        action_row = ctk.CTkFrame(card_frame, fg_color="transparent") if USE_CTK else tk.Frame(card_frame)
        action_row.pack(fill="x", padx=16, pady=(4, 12))

        self.btn_run_pending = ctk.CTkButton(
            action_row,
            text="📋 Download Pending Order Quantity",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=36,
            width=280,
            fg_color="#0891b2",
            hover_color="#0e7490",
            command=self.start_pending_order_download
        ) if USE_CTK else tk.Button(action_row, text="Download Pending Order Quantity", command=self.start_pending_order_download)
        self.btn_run_pending.pack(side="left")

    # --- TAB 7: FABRIC ORDERS (PENDING) ---
    def setup_fabric_orders_tab(self):
        # Header Info Bar
        info_bar = ctk.CTkFrame(self.tab_fabric_orders, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_fabric_orders)
        info_bar.pack(fill="x", padx=6, pady=(4, 6))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Saves into: <Base_Folder>/Fabric Orders/Fabric Orders Pending.xlsx  |  Garment ERP Report",
            font=ctk.CTkFont(size=12),
            text_color="#10b981"
        ) if USE_CTK else tk.Label(info_bar, text="Fabric Orders (Pending)")
        lbl.pack(side="left")

        # Container Card
        card_frame = ctk.CTkFrame(self.tab_fabric_orders, corner_radius=10, fg_color="#0f172a" if USE_CTK else "#1e293b") if USE_CTK else tk.Frame(self.tab_fabric_orders)
        card_frame.pack(fill="both", expand=True, padx=8, pady=4)

        card_title = ctk.CTkLabel(
            card_frame,
            text="🧵 Fabric Orders (Pending Status) Report",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#10b981"
        ) if USE_CTK else tk.Label(card_frame, text="Fabric Orders Report", font=("Arial", 14, "bold"))
        card_title.pack(anchor="w", padx=16, pady=(12, 6))

        desc_text = (
            "• Web App: https://garment-erp-wiwk.onrender.com/fabric_orders?tab=report\n"
            "• Direct Garment ERP DB Export: Connects directly to the PostgreSQL database for instant, robust retrieval.\n"
            "• Filter: Automatically filters all Purchase Order items where Status = 'Pending'.\n"
            "• Excel Export: Generates formatted Excel report with PO No, Fabric, UOM, GSM, Colour, DIA, Qty, Process, etc.\n"
            "• Saves to: '<Base_Folder>/Fabric Orders/Fabric Orders Pending.xlsx' and 'fabric_orders_report.xlsx'."
        )
        card_desc = ctk.CTkLabel(
            card_frame,
            text=desc_text,
            font=ctk.CTkFont(size=12),
            justify="left",
            text_color="#cbd5e1"
        ) if USE_CTK else tk.Label(card_frame, text=desc_text, justify="left")
        card_desc.pack(anchor="w", padx=16, pady=(0, 14))

        action_row = ctk.CTkFrame(card_frame, fg_color="transparent") if USE_CTK else tk.Frame(card_frame)
        action_row.pack(fill="x", padx=16, pady=(4, 12))

        self.btn_run_fabric_orders = ctk.CTkButton(
            action_row,
            text="🧵 Download Fabric Orders (Pending)",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=36,
            width=280,
            fg_color="#059669",
            hover_color="#047857",
            command=self.start_fabric_orders_download
        ) if USE_CTK else tk.Button(action_row, text="Download Fabric Orders", command=self.start_fabric_orders_download)
        self.btn_run_fabric_orders.pack(side="left")

    # --- TAB 8: REPORT ALIGNMENT & MAINOUT GENERATION ---
    def setup_align_tab(self):
        info_bar = ctk.CTkFrame(self.tab_align, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_align)
        info_bar.pack(fill="x", padx=6, pady=(4, 6))

        lbl = ctk.CTkLabel(
            info_bar,
            text="📁 Compiles all downloaded reports into: <Base_Folder>/output/mainout.xlsx",
            font=ctk.CTkFont(size=12),
            text_color="#38bdf8"
        ) if USE_CTK else tk.Label(info_bar, text="Generate mainout.xlsx")
        lbl.pack(side="left")

        # Action Buttons Row
        action_row = ctk.CTkFrame(self.tab_align, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_align)
        action_row.pack(fill="x", padx=8, pady=(2, 6))

        self.btn_run_align = ctk.CTkButton(
            action_row,
            text="📊 GENERATE MAINOUT.XLSX NOW",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=34,
            width=260,
            fg_color="#0284c7",
            hover_color="#0369a1",
            command=self.start_align_report
        ) if USE_CTK else tk.Button(action_row, text="Generate mainout.xlsx", command=self.start_align_report)
        self.btn_run_align.pack(side="left", padx=(0, 10))

        self.btn_open_output = ctk.CTkButton(
            action_row,
            text="📂 Open Output Folder",
            font=ctk.CTkFont(size=12),
            height=34,
            width=160,
            fg_color="#334155",
            hover_color="#475569",
            command=self.open_output_folder
        ) if USE_CTK else tk.Button(action_row, text="Open Output Folder", command=self.open_output_folder)
        self.btn_open_output.pack(side="left", padx=(0, 10))

        self.filter_data = self.load_filter_settings()
        self.filter_enabled_var = tk.BooleanVar(value=self.filter_data.get("enabled", True))
        cb_flt = ctk.CTkCheckBox(
            action_row,
            text="✅ Enable Sheet-wise Whitelist Filter (Only keep fed items, remove balance)",
            variable=self.filter_enabled_var,
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color="#10b981",
            command=lambda: self.save_current_filter_state(silent=True)
        ) if USE_CTK else tk.Checkbutton(action_row, variable=self.filter_enabled_var, text="Enable Whitelist Filter")
        cb_flt.pack(side="left", padx=10)

        # Filter Manager Box
        flt_box = ctk.CTkFrame(self.tab_align, corner_radius=10, fg_color="#0f172a" if USE_CTK else "#1e293b") if USE_CTK else tk.Frame(self.tab_align)
        flt_box.pack(fill="both", expand=True, padx=8, pady=4)

        box_header = ctk.CTkFrame(flt_box, fg_color="transparent") if USE_CTK else tk.Frame(flt_box)
        box_header.pack(fill="x", padx=12, pady=(8, 4))

        box_title = ctk.CTkLabel(
            box_header,
            text="🎯 Sheet-wise Whitelist Filter Manager (Row-by-Row with Tick Box)",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#38bdf8"
        ) if USE_CTK else tk.Label(box_header, text="Filter Manager")
        box_title.pack(side="left")

        btn_clear_flt = ctk.CTkButton(
            box_header,
            text="🗑️ Clear Sheet",
            font=ctk.CTkFont(size=11),
            height=26,
            width=100,
            fg_color="#ef4444",
            hover_color="#dc2626",
            command=self.clear_current_sheet_filter
        ) if USE_CTK else tk.Button(box_header, text="Clear", command=self.clear_current_sheet_filter)
        btn_clear_flt.pack(side="right", padx=3)

        btn_paste_flt = ctk.CTkButton(
            box_header,
            text="📋 Paste Multiple",
            font=ctk.CTkFont(size=11, weight="bold"),
            height=26,
            width=120,
            fg_color="#8b5cf6",
            hover_color="#7c3aed",
            command=self.paste_multiple_filter_items
        ) if USE_CTK else tk.Button(box_header, text="Paste Multiple", command=self.paste_multiple_filter_items)
        btn_paste_flt.pack(side="right", padx=3)

        btn_deselect_flt = ctk.CTkButton(
            box_header,
            text="⬜ Deselect All",
            font=ctk.CTkFont(size=11),
            height=26,
            width=100,
            fg_color="#334155",
            hover_color="#475569",
            command=lambda: self.set_all_filter_items(False)
        ) if USE_CTK else tk.Button(box_header, text="Deselect All", command=lambda: self.set_all_filter_items(False))
        btn_deselect_flt.pack(side="right", padx=3)

        btn_select_flt = ctk.CTkButton(
            box_header,
            text="✅ Select All",
            font=ctk.CTkFont(size=11),
            height=26,
            width=90,
            fg_color="#334155",
            hover_color="#475569",
            command=lambda: self.set_all_filter_items(True)
        ) if USE_CTK else tk.Button(box_header, text="Select All", command=lambda: self.set_all_filter_items(True))
        btn_select_flt.pack(side="right", padx=3)

        # Sheet Selection Buttons
        self.filter_sheets = [
            ("🧵 Fabric Stock", "Fabric Stock", "Fabric Name"),
            ("🧵 Fabric WIP", "Fabric WIP", "Fabric Name"),
            ("🏭 Production WIP", "Production WIP", "Product Name"),
            ("📋 Pending Orders", "Pending Orders", "Product Name"),
            ("📦 Finished Goods", "Finished Goods", "Product Name")
        ]
        self.current_filter_sheet = "Fabric Stock"

        tab_select_frame = ctk.CTkFrame(flt_box, fg_color="transparent") if USE_CTK else tk.Frame(flt_box)
        tab_select_frame.pack(fill="x", padx=12, pady=4)

        self.sheet_buttons = {}
        for disp, key, col in self.filter_sheets:
            btn = ctk.CTkButton(
                tab_select_frame,
                text=disp,
                font=ctk.CTkFont(size=11, weight="bold"),
                height=28,
                width=110,
                fg_color="#0284c7" if key == self.current_filter_sheet else "#334155",
                hover_color="#0369a1",
                command=lambda k=key: self.switch_filter_sheet(k)
            ) if USE_CTK else tk.Button(tab_select_frame, text=disp, command=lambda k=key: self.switch_filter_sheet(k))
            btn.pack(side="left", padx=4)
            self.sheet_buttons[key] = btn

        self.filter_hint_lbl = ctk.CTkLabel(
            flt_box,
            text="Allowed items for 'Fabric Stock' by Fabric Name (Check item to keep, uncheck to ignore):",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="#94a3b8"
        ) if USE_CTK else tk.Label(flt_box, text="Items:")
        self.filter_hint_lbl.pack(anchor="w", padx=14, pady=(2, 2))

        # Scrollable table for filter rows
        if USE_CTK:
            self.scroll_filter = ctk.CTkScrollableFrame(flt_box, height=150)
            self.scroll_filter.pack(fill="both", expand=True, padx=10, pady=2)
        else:
            self.scroll_filter = tk.Frame(flt_box)
            self.scroll_filter.pack(fill="both", expand=True, padx=10, pady=2)

        self.filter_chk_vars = []

        # Add New Item Row Bar
        add_frame = ctk.CTkFrame(flt_box, fg_color="#0f172a" if USE_CTK else "#1e293b", corner_radius=6) if USE_CTK else tk.Frame(flt_box)
        add_frame.pack(fill="x", padx=10, pady=(4, 8))

        add_label = ctk.CTkLabel(add_frame, text="➕ Add Item:", font=ctk.CTkFont(size=12, weight="bold"), text_color="#38bdf8") if USE_CTK else tk.Label(add_frame, text="Add:")
        add_label.pack(side="left", padx=6, pady=4)

        self.new_filter_entry = ctk.CTkEntry(
            add_frame,
            placeholder_text="Enter Fabric Name (e.g. CRYSTAL LYCRA)",
            width=380
        ) if USE_CTK else tk.Entry(add_frame, width=35)
        self.new_filter_entry.pack(side="left", padx=3, pady=4)
        self.new_filter_entry.bind("<Return>", lambda event: self.add_filter_item())

        btn_add = ctk.CTkButton(
            add_frame,
            text="➕ Add",
            width=80,
            height=28,
            command=self.add_filter_item,
            fg_color="#10b981",
            hover_color="#059669"
        ) if USE_CTK else tk.Button(add_frame, text="Add", command=self.add_filter_item)
        btn_add.pack(side="left", padx=6, pady=4)

        btn_save_bottom = ctk.CTkButton(
            add_frame,
            text="💾 Save Filters",
            width=110,
            height=28,
            command=lambda: self.save_current_filter_state(silent=False),
            fg_color="#0284c7",
            hover_color="#0369a1"
        ) if USE_CTK else tk.Button(add_frame, text="Save Filters", command=lambda: self.save_current_filter_state(silent=False))
        btn_save_bottom.pack(side="right", padx=6, pady=4)

        # Initial render of table
        self.render_filter_table()

    def load_filter_settings(self):
        cfg = load_filter_config()
        if not isinstance(cfg, dict):
            cfg = {"enabled": True, "filters": {}}
        filters = cfg.setdefault("filters", {})
        # Normalize every sheet list to list of dicts: {"name": str, "enabled": bool}
        for sheet_key in ["Fabric Stock", "Fabric WIP", "Production WIP", "Pending Orders", "Finished Goods"]:
            raw_list = filters.setdefault(sheet_key, [])
            normalized = []
            for item in raw_list:
                if isinstance(item, str):
                    s = item.strip()
                    if s:
                        normalized.append({"name": s, "enabled": True})
                elif isinstance(item, dict):
                    name = str(item.get("name") or "").strip()
                    if name:
                        normalized.append({"name": name, "enabled": bool(item.get("enabled", True))})
            filters[sheet_key] = normalized
        return cfg

    def switch_filter_sheet(self, sheet_key):
        self.current_filter_sheet = sheet_key
        for k, btn in getattr(self, "sheet_buttons", {}).items():
            btn.configure(fg_color="#0284c7" if k == sheet_key else "#334155")

        if sheet_key == "Production WIP":
            placeholder_text = "Enter Unfolding Product Name (e.g. #BELLA NEW)"
        elif "Fabric" in sheet_key:
            placeholder_text = "Enter Fabric Name (e.g. CRYSTAL LYCRA)"
        else:
            placeholder_text = "Enter Product Name (e.g. #BELLA NEW)"

        if hasattr(self, "new_filter_entry"):
            self.new_filter_entry.configure(placeholder_text=placeholder_text)

        self.render_filter_table()

    def render_filter_table(self):
        if not hasattr(self, "scroll_filter"):
            return

        for widget in self.scroll_filter.winfo_children():
            widget.destroy()

        self.filter_chk_vars = []
        sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
        items = self.filter_data.setdefault("filters", {}).setdefault(sheet_key, [])
        active_cnt = sum(1 for it in items if it.get("enabled", True))

        if sheet_key == "Production WIP":
            col_type = "Product Name"
            col_desc = "Allowed Product Name (UNFOLDING only — Cutting & PR WIP are kept 100%)"
            hint_desc = f"Allowed items for 'Production WIP' (Filter applies ONLY to UNFOLDING; Cutting & PR WIP kept 100%) ({len(items)} items configured, {active_cnt} active with tick box):"
            empty_desc = "ℹ️ No filter items configured for Unfolding (All Unfolding, Cutting & PR WIP items will be kept in output).\nAdd Unfolding items below or click '📋 Paste Multiple' to restrict Unfolding."
        else:
            col_type = "Fabric Name" if "Fabric" in sheet_key else "Product Name"
            col_desc = f"Allowed {col_type} (Only these rows will be kept in mainout)"
            hint_desc = f"Allowed items for '{sheet_key}' by {col_type} ({len(items)} items configured, {active_cnt} active with tick box):"
            empty_desc = "ℹ️ No filter items configured for this sheet yet (All items will be kept in output).\nAdd items row-by-row below or click '📋 Paste Multiple' to feed a list."

        # Update Header label count
        if hasattr(self, "filter_hint_lbl"):
            self.filter_hint_lbl.configure(text=hint_desc)

        # Header Row
        header_row = ctk.CTkFrame(self.scroll_filter, fg_color="#1e293b", corner_radius=4) if USE_CTK else tk.Frame(self.scroll_filter)
        header_row.pack(fill="x", padx=4, pady=1)

        h_chk = ctk.CTkLabel(header_row, text="Active", width=55, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Active")
        h_chk.pack(side="left", padx=4)

        h_name = ctk.CTkLabel(header_row, text=col_desc, width=480, anchor="w", font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text=col_type)
        h_name.pack(side="left", padx=6)

        h_status = ctk.CTkLabel(header_row, text="Status", width=90, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Status")
        h_status.pack(side="left", padx=6)

        h_act = ctk.CTkLabel(header_row, text="Action", width=60, font=ctk.CTkFont(weight="bold")) if USE_CTK else tk.Label(header_row, text="Action")
        h_act.pack(side="right", padx=6)

        if not items:
            empty_frame = ctk.CTkFrame(self.scroll_filter, fg_color="transparent") if USE_CTK else tk.Frame(self.scroll_filter)
            empty_frame.pack(fill="x", padx=10, pady=14)
            empty_lbl = ctk.CTkLabel(
                empty_frame,
                text=empty_desc,
                font=ctk.CTkFont(size=12),
                text_color="#94a3b8"
            ) if USE_CTK else tk.Label(empty_frame, text="No items configured.")
            empty_lbl.pack()
            return

        for idx, item in enumerate(items):
            row_frame = ctk.CTkFrame(self.scroll_filter, fg_color="#0f172a" if idx % 2 == 0 else "#1e293b", corner_radius=4) if USE_CTK else tk.Frame(self.scroll_filter)
            row_frame.pack(fill="x", padx=4, pady=1)

            is_active = item.get("enabled", True)
            var = tk.BooleanVar(value=is_active)
            self.filter_chk_vars.append(var)

            chk = ctk.CTkCheckBox(row_frame, text="", variable=var, width=24, command=self.update_filter_item_states) if USE_CTK else tk.Checkbutton(row_frame, variable=var, command=self.update_filter_item_states)
            chk.pack(side="left", padx=16)

            name_lbl = ctk.CTkLabel(row_frame, text=item.get("name", ""), width=480, anchor="w", font=ctk.CTkFont(size=12, weight="bold" if is_active else "normal"), text_color="#f8fafc" if is_active else "#64748b") if USE_CTK else tk.Label(row_frame, text=item.get("name", ""))
            name_lbl.pack(side="left", padx=6)

            status_text = "✅ Included" if is_active else "⏸ Excluded"
            status_color = "#10b981" if is_active else "#64748b"
            status_lbl = ctk.CTkLabel(row_frame, text=status_text, width=90, text_color=status_color, font=ctk.CTkFont(size=11, weight="bold")) if USE_CTK else tk.Label(row_frame, text=status_text)
            status_lbl.pack(side="left", padx=6)

            del_btn = ctk.CTkButton(
                row_frame,
                text="🗑",
                width=36,
                height=22,
                fg_color="#ef4444",
                hover_color="#dc2626",
                command=lambda i=idx: self.delete_filter_item(i)
            ) if USE_CTK else tk.Button(row_frame, text="X", command=lambda i=idx: self.delete_filter_item(i))
            del_btn.pack(side="right", padx=6, pady=2)

    def update_filter_item_states(self):
        sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
        items = self.filter_data.setdefault("filters", {}).setdefault(sheet_key, [])
        for idx, var in enumerate(self.filter_chk_vars):
            if idx < len(items):
                items[idx]["enabled"] = var.get()
        self.save_current_filter_state(silent=True)
        self.render_filter_table()

    def set_all_filter_items(self, value):
        sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
        items = self.filter_data.setdefault("filters", {}).setdefault(sheet_key, [])
        for item in items:
            item["enabled"] = bool(value)
        self.save_current_filter_state(silent=True)
        self.render_filter_table()

    def add_filter_item(self):
        if not hasattr(self, "new_filter_entry"):
            return
        val = self.new_filter_entry.get().strip()
        if not val:
            return

        sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
        items = self.filter_data.setdefault("filters", {}).setdefault(sheet_key, [])

        # Check for duplicates (case-insensitive)
        existing_names = [it.get("name", "").strip().upper() for it in items]
        if val.upper() in existing_names:
            messagebox.showinfo("Already Exists", f"'{val}' is already in the filter list for {sheet_key}.")
            return

        items.append({"name": val, "enabled": True})
        self.save_current_filter_state(silent=True)
        self.render_filter_table()
        self.new_filter_entry.delete(0, "end")
        self.log(f"Added '{val}' to {sheet_key} whitelist filter.")

    def delete_filter_item(self, index):
        sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
        items = self.filter_data.setdefault("filters", {}).setdefault(sheet_key, [])
        if 0 <= index < len(items):
            removed = items.pop(index)
            self.save_current_filter_state(silent=True)
            self.render_filter_table()
            self.log(f"Deleted item from {sheet_key}: {removed.get('name')}")

    def clear_current_sheet_filter(self):
        sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
        items = self.filter_data.setdefault("filters", {}).setdefault(sheet_key, [])
        if not items:
            return
        if messagebox.askyesno("Confirm Clear", f"Are you sure you want to clear all {len(items)} filter items for '{sheet_key}'?"):
            self.filter_data["filters"][sheet_key] = []
            self.save_current_filter_state(silent=True)
            self.render_filter_table()
            self.log(f"Cleared all filter items for sheet: {sheet_key}")

    def paste_multiple_filter_items(self):
        sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
        col_type = "Fabric Name" if "Fabric" in sheet_key else "Product Name"

        # Popup dialog to paste multiple items
        modal = ctk.CTkToplevel(self.root) if USE_CTK else tk.Toplevel(self.root)
        modal.title(f"Paste Multiple Items — {sheet_key}")
        modal.geometry("520x420")
        modal.transient(self.root)
        modal.grab_set()

        lbl_desc = ctk.CTkLabel(
            modal,
            text=f"📋 Paste {col_type} list below (one item per line):",
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#38bdf8"
        ) if USE_CTK else tk.Label(modal, text=f"Paste {col_type} list (one per line):")
        lbl_desc.pack(anchor="w", padx=16, pady=(12, 6))

        txt_box = ctk.CTkTextbox(modal, font=ctk.CTkFont(family="Consolas", size=12), height=260) if USE_CTK else tk.Text(modal, height=14)
        txt_box.pack(fill="both", expand=True, padx=16, pady=4)
        txt_box.focus_set()

        btn_row = ctk.CTkFrame(modal, fg_color="transparent") if USE_CTK else tk.Frame(modal)
        btn_row.pack(fill="x", padx=16, pady=(8, 12))

        def do_add_pasted():
            raw_text = txt_box.get("1.0", "end").strip()
            lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
            if not lines:
                modal.destroy()
                return

            items = self.filter_data.setdefault("filters", {}).setdefault(sheet_key, [])
            existing_upper = {it.get("name", "").strip().upper() for it in items}

            added_count = 0
            for line in lines:
                if line.upper() not in existing_upper:
                    items.append({"name": line, "enabled": True})
                    existing_upper.add(line.upper())
                    added_count += 1

            self.save_current_filter_state(silent=True)
            self.render_filter_table()
            self.log(f"Added {added_count} new items to {sheet_key} filter.")
            modal.destroy()

        btn_confirm = ctk.CTkButton(
            btn_row,
            text=f"➕ Add All to {sheet_key}",
            font=ctk.CTkFont(size=12, weight="bold"),
            height=32,
            fg_color="#10b981",
            hover_color="#059669",
            command=do_add_pasted
        ) if USE_CTK else tk.Button(btn_row, text="Add All", command=do_add_pasted)
        btn_confirm.pack(side="left", padx=(0, 8))

        btn_cancel = ctk.CTkButton(
            btn_row,
            text="Cancel",
            font=ctk.CTkFont(size=12),
            height=32,
            width=90,
            fg_color="#334155",
            hover_color="#475569",
            command=modal.destroy
        ) if USE_CTK else tk.Button(btn_row, text="Cancel", command=modal.destroy)
        btn_cancel.pack(side="left")

    def save_current_filter_state(self, silent=False):
        if hasattr(self, "filter_enabled_var"):
            self.filter_data["enabled"] = self.filter_enabled_var.get()

        save_filter_config(self.filter_data)
        if not silent:
            sheet_key = getattr(self, "current_filter_sheet", "Fabric Stock")
            items = self.filter_data.get("filters", {}).get(sheet_key, [])
            self.log(f"💾 Saved sheet-wise filter configuration to mainout_filter_config.json ({len(items)} items in {sheet_key})")
            messagebox.showinfo("Saved", "Sheet-wise whitelist filters saved successfully!")

    # --- TAB 7: ALL-IN-ONE RUNNER ---
    def setup_all_tab(self):
        all_box = ctk.CTkFrame(self.tab_all, fg_color="transparent") if USE_CTK else tk.Frame(self.tab_all)
        all_box.pack(fill="both", expand=True, padx=16, pady=16)

        title = ctk.CTkLabel(
            all_box,
            text="⚡ Run Multiple Reports in a Single Automated Execution",
            font=ctk.CTkFont(size=15, weight="bold"),
            text_color="#38bdf8"
        ) if USE_CTK else tk.Label(all_box, text="All In One")
        title.pack(anchor="w", pady=(4, 10))

        # Checkboxes for modules to include
        self.run_fabric_batch_var = tk.BooleanVar(value=True)
        cb_fab = ctk.CTkCheckBox(
            all_box,
            text="🧵 Fabric Stock Batch (Downloads to <Base_Folder>/Fabric Stock/)",
            variable=self.run_fabric_batch_var,
            font=ctk.CTkFont(size=13, weight="bold")
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_fabric_batch_var, text="Fabric Stock")
        cb_fab.pack(anchor="w", padx=10, pady=4)

        self.run_wip_batch_var = tk.BooleanVar(value=True)
        cb_wip = ctk.CTkCheckBox(
            all_box,
            text="🏭 Production WIP Batch (CUTTING, STITCHING, SNG, IRONING to <Base_Folder>/Production WIP/)",
            variable=self.run_wip_batch_var,
            font=ctk.CTkFont(size=13, weight="bold")
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_wip_batch_var, text="Production WIP")
        cb_wip.pack(anchor="w", padx=10, pady=4)

        self.run_goods_batch_var = tk.BooleanVar(value=True)
        cb_goods = ctk.CTkCheckBox(
            all_box,
            text="📦 Finished Goods Stock (Saves to <Base_Folder>/Finished Goods Stock/Finished Goods Stock.xlsx)",
            variable=self.run_goods_batch_var,
            font=ctk.CTkFont(size=13, weight="bold")
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_goods_batch_var, text="Finished Goods Stock")
        cb_goods.pack(anchor="w", padx=10, pady=4)

        self.run_unfolding_batch_var = tk.BooleanVar(value=True)
        cb_unfolding = ctk.CTkCheckBox(
            all_box,
            text="👕 Unfolding Stock (Color Wise + Size Wise to <Base_Folder>/Unfolding Stock/Unfolding Stock.xlsx)",
            variable=self.run_unfolding_batch_var,
            font=ctk.CTkFont(size=13, weight="bold")
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_unfolding_batch_var, text="Unfolding Stock")
        cb_unfolding.pack(anchor="w", padx=10, pady=4)

        self.run_cutting_batch_var = tk.BooleanVar(value=True)
        cb_cutting = ctk.CTkCheckBox(
            all_box,
            text="✂️ Cutting Received Stock (Color Wise + Size Wise to <Base_Folder>/Cutting Received Stock/Cutting Received Stock.xlsx)",
            variable=self.run_cutting_batch_var,
            font=ctk.CTkFont(size=13, weight="bold")
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_cutting_batch_var, text="Cutting Received Stock")
        cb_cutting.pack(anchor="w", padx=10, pady=4)

        self.run_pending_batch_var = tk.BooleanVar(value=True)
        cb_pending = ctk.CTkCheckBox(
            all_box,
            text="📋 Pending Order Quantity (Clear Company -> Search -> Green Excel to <Base_Folder>/Pending Order Quantity/)",
            variable=self.run_pending_batch_var,
            font=ctk.CTkFont(size=13, weight="bold")
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_pending_batch_var, text="Pending Order Quantity")
        cb_pending.pack(anchor="w", padx=10, pady=4)

        self.run_fabric_orders_var = tk.BooleanVar(value=True)
        cb_fo = ctk.CTkCheckBox(
            all_box,
            text="🧵 Fabric Orders (Pending) (Garment ERP -> <Base_Folder>/Fabric Orders/)",
            variable=self.run_fabric_orders_var,
            font=ctk.CTkFont(size=13, weight="bold")
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_fabric_orders_var, text="Fabric Orders (Pending)")
        cb_fo.pack(anchor="w", padx=10, pady=4)

        self.run_auto_align_var = tk.BooleanVar(value=True)
        cb_align = ctk.CTkCheckBox(
            all_box,
            text="📊 Auto-Compile & Generate mainout.xlsx in <Base_Folder>/output/ when batch completes",
            variable=self.run_auto_align_var,
            font=ctk.CTkFont(size=13, weight="bold"),
            text_color="#38bdf8"
        ) if USE_CTK else tk.Checkbutton(all_box, variable=self.run_auto_align_var, text="Auto-Generate mainout.xlsx")
        cb_align.pack(anchor="w", padx=10, pady=(6, 4))

        btn_run_all = ctk.CTkButton(
            all_box,
            text="🚀 START ALL-IN-ONE BATCH DOWNLOAD",
            font=ctk.CTkFont(size=15, weight="bold"),
            height=46,
            fg_color="#10b981",
            hover_color="#059669",
            command=self.start_all_download
        ) if USE_CTK else tk.Button(all_box, text="Start All", command=self.start_all_download)
        btn_run_all.pack(fill="x", padx=10, pady=(16, 8))

    # --- BOTTOM ACTION SECTION ---
    def create_bottom_action_section(self):
        act_box = ctk.CTkFrame(self.main_frame, fg_color="transparent") if USE_CTK else tk.Frame(self.main_frame)
        act_box.pack(fill="x", padx=10, pady=4)

        self.start_btn = ctk.CTkButton(
            act_box,
            text="🚀 START BATCH DOWNLOAD",
            font=ctk.CTkFont(size=14, weight="bold"),
            height=38,
            fg_color="#10b981",
            hover_color="#059669",
            command=self.start_all_download
        ) if USE_CTK else tk.Button(act_box, text="START DOWNLOAD", command=self.start_all_download)
        self.start_btn.pack(side="left", padx=4, expand=True, fill="x")

        self.stop_btn = ctk.CTkButton(
            act_box,
            text="⏹ Stop",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=38,
            width=90,
            fg_color="#ef4444",
            hover_color="#dc2626",
            state="disabled",
            command=self.stop_download
        ) if USE_CTK else tk.Button(act_box, text="Stop", command=self.stop_download)
        self.stop_btn.pack(side="left", padx=4)

        self.open_folder_btn = ctk.CTkButton(
            act_box,
            text="📁 Open Folder",
            font=ctk.CTkFont(size=13),
            height=38,
            width=120,
            fg_color="#334155",
            hover_color="#475569",
            command=self.open_download_folder
        ) if USE_CTK else tk.Button(act_box, text="Open Folder", command=self.open_download_folder)
        self.open_folder_btn.pack(side="left", padx=4)

    # --- LOG SECTION ---
    def create_log_section(self):
        log_box = ctk.CTkFrame(self.main_frame, corner_radius=8) if USE_CTK else tk.LabelFrame(self.main_frame, text="Progress & Logs")
        log_box.pack(fill="both", expand=True, padx=10, pady=(2, 6))

        prog_frame = ctk.CTkFrame(log_box, fg_color="transparent") if USE_CTK else tk.Frame(log_box)
        prog_frame.pack(fill="x", padx=10, pady=(4, 2))

        self.progress_bar = ctk.CTkProgressBar(prog_frame, height=10) if USE_CTK else None
        if self.progress_bar:
            self.progress_bar.set(0)
            self.progress_bar.pack(side="left", fill="x", expand=True, padx=(0, 10))

        self.prog_lbl = ctk.CTkLabel(prog_frame, text="Ready", font=ctk.CTkFont(size=12)) if USE_CTK else tk.Label(prog_frame, text="Ready")
        self.prog_lbl.pack(side="right")

        self.log_text = ctk.CTkTextbox(log_box, font=ctk.CTkFont(family="Consolas", size=11), height=120) if USE_CTK else tk.Text(log_box, height=6)
        self.log_text.pack(fill="both", expand=True, padx=10, pady=4)
        self.log("DATSerp Batch Downloader ready. Choose Fabric Stock or Production WIP and click Start.")

    def log(self, message):
        def _append():
            now_str = datetime.datetime.now().strftime("%H:%M:%S")
            self.log_text.insert("end", f"[{now_str}] {message}\n")
            self.log_text.see("end")
        self.root.after(0, _append)

    def set_progress(self, current, total):
        def _update():
            frac = current / total if total > 0 else 0
            if self.progress_bar:
                self.progress_bar.set(frac)
            self.prog_lbl.configure(text=f"Progress: {current}/{total} ({int(frac * 100)}%)")
        self.root.after(0, _update)

    def open_download_folder(self):
        folder = self.path_entry.get().strip() or r"C:\ERP_DOWNLOADS"
        Path(folder).mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(folder)
        else:
            subprocess.Popen(["explorer", folder])

    # --- EXECUTION DISPATCHERS ---
    def _validate_inputs(self):
        username = self.user_entry.get().strip()
        password = self.pass_entry.get().strip()
        download_dir = self.path_entry.get().strip()

        if not username or not password:
            messagebox.showerror("Error", "Please enter ERP Username and Password.")
            return None, None, None

        if not download_dir:
            messagebox.showerror("Error", "Please select a Base Download folder.")
            return None, None, None

        # Save credentials to .env
        try:
            with open(ENV_PATH, "w", encoding="utf-8") as f:
                f.write(f"ERP_USERNAME={username}\nERP_PASSWORD={password}\nDOWNLOAD_DIR={download_dir}\n")
        except Exception:
            pass

        return username, password, download_dir

    def _lock_ui_running(self):
        self.is_running = True
        self.stop_event.clear()
        self.start_btn.configure(state="disabled", text="⏳ DOWNLOADING IN PROGRESS...")
        self.stop_btn.configure(state="normal")
        if hasattr(self, "btn_run_fabric"):
            self.btn_run_fabric.configure(state="disabled")
        if hasattr(self, "btn_run_wip"):
            self.btn_run_wip.configure(state="disabled")
        if hasattr(self, "btn_run_goods"):
            self.btn_run_goods.configure(state="disabled")
        if hasattr(self, "btn_run_unfolding"):
            self.btn_run_unfolding.configure(state="disabled")
        if hasattr(self, "btn_run_cutting"):
            self.btn_run_cutting.configure(state="disabled")
        if hasattr(self, "btn_run_pending"):
            self.btn_run_pending.configure(state="disabled")
        if hasattr(self, "btn_run_fabric_orders"):
            self.btn_run_fabric_orders.configure(state="disabled")
        if hasattr(self, "btn_run_align"):
            self.btn_run_align.configure(state="disabled")

    def _unlock_ui_finished(self):
        self.is_running = False
        self.start_btn.configure(state="normal", text="🚀 START BATCH DOWNLOAD")
        self.stop_btn.configure(state="disabled")
        if hasattr(self, "btn_run_fabric"):
            self.btn_run_fabric.configure(state="normal")
        if hasattr(self, "btn_run_wip"):
            self.btn_run_wip.configure(state="normal")
        if hasattr(self, "btn_run_goods"):
            self.btn_run_goods.configure(state="normal")
        if hasattr(self, "btn_run_unfolding"):
            self.btn_run_unfolding.configure(state="normal")
        if hasattr(self, "btn_run_cutting"):
            self.btn_run_cutting.configure(state="normal")
        if hasattr(self, "btn_run_pending"):
            self.btn_run_pending.configure(state="normal")
        if hasattr(self, "btn_run_fabric_orders"):
            self.btn_run_fabric_orders.configure(state="normal")
        if hasattr(self, "btn_run_align"):
            self.btn_run_align.configure(state="normal")

    def stop_download(self):
        if self.is_running:
            self.stop_event.set()
            self.log("Stopping batch automation... Please wait.")
            self.stop_btn.configure(state="disabled")

    # 1. Start Fabric Only
    def start_fabric_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        active_items = [it for it in self.fabric_items if it.get("enabled", True)]
        if not active_items:
            messagebox.showwarning("No Items", "Please select at least one Fabric from the list.")
            return

        self._lock_ui_running()
        self.set_progress(0, len(active_items))

        thread = threading.Thread(
            target=self._worker_fabric_only,
            args=(user, pwd, active_items, base_dir),
            daemon=True
        )
        thread.start()

    def _worker_fabric_only(self, user, pwd, items, base_dir):
        try:
            success, msg = run_fabric_batch(
                username=user,
                password=pwd,
                fabric_items=items,
                download_dir=base_dir,
                headless=False,
                status_callback=self.log,
                progress_callback=self.set_progress,
                stop_event=self.stop_event
            )
            if success:
                self.log("✅ All selected Fabric Stock reports downloaded successfully!")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"Fabric Stock reports downloaded!\nSaved in {base_dir}\\Fabric Stock"))
            else:
                self.log(f"⚠️ Fabric Stock finished with message: {msg}")
        except Exception as e:
            self.log(f"❌ Fabric Stock error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    # 2. Start Production WIP Only
    def start_wip_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        active_groups = [it for it in self.wip_items if it.get("enabled", True)]
        if not active_groups:
            messagebox.showwarning("No Items", "Please select at least one Production Grouping.")
            return

        self._lock_ui_running()
        self.set_progress(0, len(active_groups))

        thread = threading.Thread(
            target=self._worker_wip_only,
            args=(user, pwd, active_groups, base_dir),
            daemon=True
        )
        thread.start()

    def _worker_wip_only(self, user, pwd, groups, base_dir):
        try:
            success, msg = run_production_wip_download(
                username=user,
                password=pwd,
                grouping_items=groups,
                download_dir=base_dir,
                headless=False,
                status_callback=self.log,
                progress_callback=self.set_progress,
                stop_event=self.stop_event
            )
            if success:
                self.log("✅ All selected Production WIP reports downloaded successfully!")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"Production WIP reports downloaded!\nSaved in {base_dir}\\Production WIP"))
            else:
                self.log(f"⚠️ Production WIP finished with message: {msg}")
        except Exception as e:
            self.log(f"❌ Production WIP error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    # 3. Start Finished Goods Only
    def start_goods_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        self._lock_ui_running()
        self.set_progress(0, 1)

        thread = threading.Thread(
            target=self._worker_goods_only,
            args=(user, pwd, base_dir),
            daemon=True
        )
        thread.start()

    def _worker_goods_only(self, user, pwd, base_dir):
        try:
            success, msg = run_finished_goods_download(
                username=user,
                password=pwd,
                download_dir=base_dir,
                headless=False,
                status_callback=self.log,
                progress_callback=self.set_progress,
                stop_event=self.stop_event
            )
            if success:
                self.log("✅ Finished Goods Stock report downloaded successfully!")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"Finished Goods Stock report downloaded!\nSaved in {base_dir}\\Finished Goods Stock\\Finished Goods Stock.xlsx"))
            else:
                self.log(f"⚠️ Finished Goods Stock finished with message: {msg}")
        except Exception as e:
            self.log(f"❌ Finished Goods Stock error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    # 4. Start Unfolding Stock Only
    def start_unfolding_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        self._lock_ui_running()
        self.set_progress(0, 1)

        thread = threading.Thread(
            target=self._worker_unfolding_only,
            args=(user, pwd, base_dir),
            daemon=True
        )
        thread.start()

    def _worker_unfolding_only(self, user, pwd, base_dir):
        try:
            success, msg = run_unfolding_stock_download(
                username=user,
                password=pwd,
                download_dir=base_dir,
                headless=False,
                status_callback=self.log,
                progress_callback=self.set_progress,
                stop_event=self.stop_event
            )
            if success:
                self.log("✅ Unfolding Stock report downloaded successfully!")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"Unfolding Stock report downloaded!\nSaved in {base_dir}\\Unfolding Stock\\Unfolding Stock.xlsx"))
            else:
                self.log(f"⚠️ Unfolding Stock finished with message: {msg}")
        except Exception as e:
            self.log(f"❌ Unfolding Stock error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    # 5. Start Cutting Received Stock Only
    def start_cutting_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        self._lock_ui_running()
        self.set_progress(0, 1)

        thread = threading.Thread(
            target=self._worker_cutting_only,
            args=(user, pwd, base_dir),
            daemon=True
        )
        thread.start()

    def _worker_cutting_only(self, user, pwd, base_dir):
        try:
            success, msg = run_cutting_received_download(
                username=user,
                password=pwd,
                download_dir=base_dir,
                headless=False,
                status_callback=self.log,
                progress_callback=self.set_progress,
                stop_event=self.stop_event
            )
            if success:
                self.log("✅ Cutting Received Stock report downloaded successfully!")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"Cutting Received Stock report downloaded!\nSaved in {base_dir}\\Cutting Received Stock\\Cutting Received Stock.xlsx"))
            else:
                self.log(f"⚠️ Cutting Received Stock finished with message: {msg}")
        except Exception as e:
            self.log(f"❌ Cutting Received Stock error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    # 6. Start Pending Order Quantity Only
    def start_pending_order_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        self._lock_ui_running()
        self.set_progress(0, 1)

        thread = threading.Thread(
            target=self._worker_pending_order_only,
            args=(user, pwd, base_dir),
            daemon=True
        )
        thread.start()

    def _worker_pending_order_only(self, user, pwd, base_dir):
        try:
            success, msg = run_pending_order_quantity_download(
                username=user,
                password=pwd,
                download_dir=base_dir,
                headless=False,
                status_callback=self.log,
                progress_callback=self.set_progress,
                stop_event=self.stop_event
            )
            if success:
                self.log("✅ Pending Order Quantity report downloaded successfully!")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"Pending Order Quantity report downloaded!\nSaved in {base_dir}\\Pending Order Quantity\\Pending Order Quantity.xlsx"))
            else:
                self.log(f"⚠️ Pending Order Quantity finished with message: {msg}")
        except Exception as e:
            self.log(f"❌ Pending Order Quantity error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    # 7. Start Fabric Orders (Pending) Only
    def start_fabric_orders_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        self._lock_ui_running()
        self.set_progress(0, 1)

        thread = threading.Thread(
            target=self._worker_fabric_orders_only,
            args=(base_dir,),
            daemon=True
        )
        thread.start()

    def _worker_fabric_orders_only(self, base_dir):
        try:
            success, msg = run_fabric_orders_download(
                download_dir=base_dir,
                status_filter="Pending",
                status_callback=self.log,
                progress_callback=self.set_progress,
                stop_event=self.stop_event
            )
            if success:
                self.log("✅ Fabric Orders (Pending) report exported successfully!")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"Fabric Orders (Pending) report exported!\nSaved in {base_dir}\\Fabric Orders\\Fabric Orders Pending.xlsx"))
            else:
                self.log(f"⚠️ Fabric Orders finished with message: {msg}")
        except Exception as e:
            self.log(f"❌ Fabric Orders error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    # 8. Start Report Alignment Only
    def start_align_report(self):
        if self.is_running:
            return
        base_dir = self.path_entry.get().strip() or r"C:\ERP_DOWNLOADS"
        self._lock_ui_running()
        self.set_progress(0, 10)

        thread = threading.Thread(
            target=self._worker_align_only,
            args=(base_dir,),
            daemon=True
        )
        thread.start()

    def _worker_align_only(self, base_dir):
        try:
            self.save_current_filter_state()
            success, out_file = run_report_alignment(
                base_dir=base_dir,
                filter_config=self.filter_data,
                status_callback=self.log,
                progress_callback=self.set_progress
            )
            if success:
                self.log(f"✅ Report alignment completed! Output saved in: {out_file}")
                self.root.after(0, lambda: messagebox.showinfo("Completed", f"All reports aligned successfully!\nSaved in: {out_file}"))
            else:
                self.log(f"⚠️ Report alignment finished with message: {out_file}")
        except Exception as e:
            self.log(f"❌ Report alignment error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)

    def open_output_folder(self):
        base_dir = self.path_entry.get().strip() or r"C:\ERP_DOWNLOADS"
        out_folder = Path(base_dir) / "output"
        out_folder.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(str(out_folder))
        else:
            subprocess.Popen(["explorer", str(out_folder)])

    # 9. Start All-in-One Runner
    def start_all_download(self):
        if self.is_running:
            return
        user, pwd, base_dir = self._validate_inputs()
        if not user:
            return

        do_fabric = self.run_fabric_batch_var.get()
        do_wip = self.run_wip_batch_var.get()
        do_goods = self.run_goods_batch_var.get()
        do_unfolding = self.run_unfolding_batch_var.get()
        do_cutting = self.run_cutting_batch_var.get()
        do_pending = self.run_pending_batch_var.get()
        do_fabric_orders = self.run_fabric_orders_var.get()
        do_auto_align = self.run_auto_align_var.get()

        if not do_fabric and not do_wip and not do_goods and not do_unfolding and not do_cutting and not do_pending and not do_fabric_orders and not do_auto_align:
            messagebox.showwarning("No Modules", "Please select at least one report module or action.")
            return

        active_fabrics = [it for it in self.fabric_items if it.get("enabled", True)] if do_fabric else []
        active_wip = [it for it in self.wip_items if it.get("enabled", True)] if do_wip else []

        total_steps = len(active_fabrics) + len(active_wip) + (1 if do_goods else 0) + (1 if do_unfolding else 0) + (1 if do_cutting else 0) + (1 if do_pending else 0) + (1 if do_fabric_orders else 0) + (1 if do_auto_align else 0)
        self._lock_ui_running()
        self.set_progress(0, total_steps)

        thread = threading.Thread(
            target=self._worker_all_modules,
            args=(user, pwd, active_fabrics, active_wip, do_goods, do_unfolding, do_cutting, do_pending, do_fabric_orders, do_auto_align, base_dir),
            daemon=True
        )
        thread.start()

    def _worker_all_modules(self, user, pwd, active_fabrics, active_wip, do_goods, do_unfolding, do_cutting, do_pending, do_fabric_orders, do_auto_align, base_dir):
        total_steps = len(active_fabrics) + len(active_wip) + (1 if do_goods else 0) + (1 if do_unfolding else 0) + (1 if do_cutting else 0) + (1 if do_pending else 0) + (1 if do_fabric_orders else 0) + (1 if do_auto_align else 0)
        current_offset = 0

        try:
            # 1. Run Fabric Stock if selected
            if active_fabrics and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 1: FABRIC STOCK BATCH <<<")
                def fab_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_fabric_batch(
                    username=user,
                    password=pwd,
                    fabric_items=active_fabrics,
                    download_dir=base_dir,
                    headless=False,
                    status_callback=self.log,
                    progress_callback=fab_prog,
                    stop_event=self.stop_event
                )
                current_offset += len(active_fabrics)

            # 2. Run Production WIP if selected
            if active_wip and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 2: PRODUCTION WIP BATCH <<<")
                def wip_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_production_wip_download(
                    username=user,
                    password=pwd,
                    grouping_items=active_wip,
                    download_dir=base_dir,
                    headless=False,
                    status_callback=self.log,
                    progress_callback=wip_prog,
                    stop_event=self.stop_event
                )
                current_offset += len(active_wip)

            # 3. Run Finished Goods Stock if selected
            if do_goods and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 3: FINISHED GOODS STOCK <<<")
                def goods_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_finished_goods_download(
                    username=user,
                    password=pwd,
                    download_dir=base_dir,
                    headless=False,
                    status_callback=self.log,
                    progress_callback=goods_prog,
                    stop_event=self.stop_event
                )
                current_offset += 1

            # 4. Run Unfolding Stock if selected
            if do_unfolding and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 4: UNFOLDING STOCK (COLOR & SIZE WISE) <<<")
                def unfolding_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_unfolding_stock_download(
                    username=user,
                    password=pwd,
                    download_dir=base_dir,
                    headless=False,
                    status_callback=self.log,
                    progress_callback=unfolding_prog,
                    stop_event=self.stop_event
                )
                current_offset += 1

            # 5. Run Cutting Received Stock if selected
            if do_cutting and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 5: CUTTING RECEIVED STOCK (COLOR & SIZE WISE) <<<")
                def cutting_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_cutting_received_download(
                    username=user,
                    password=pwd,
                    download_dir=base_dir,
                    headless=False,
                    status_callback=self.log,
                    progress_callback=cutting_prog,
                    stop_event=self.stop_event
                )
                current_offset += 1

            # 6. Run Pending Order Quantity if selected
            if do_pending and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 6: PENDING ORDER QUANTITY <<<")
                def pending_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_pending_order_quantity_download(
                    username=user,
                    password=pwd,
                    download_dir=base_dir,
                    headless=False,
                    status_callback=self.log,
                    progress_callback=pending_prog,
                    stop_event=self.stop_event
                )
                current_offset += 1

            # 7. Run Fabric Orders (Pending) if selected
            if do_fabric_orders and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 7: FABRIC ORDERS (PENDING) <<<")
                def fabric_orders_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_fabric_orders_download(
                    download_dir=base_dir,
                    status_filter="Pending",
                    status_callback=self.log,
                    progress_callback=fabric_orders_prog,
                    stop_event=self.stop_event
                )
                current_offset += 1

            # 8. Auto-Compile & Align Reports into mainout.xlsx
            if do_auto_align and not (self.stop_event and self.stop_event.is_set()):
                self.log("\n>>> STARTING MODULE 8: AUTO-GENERATING MAINOUNT.XLSX <<<")
                def align_prog(curr, tot):
                    self.set_progress(current_offset + curr, total_steps)

                run_report_alignment(
                    base_dir=base_dir,
                    filter_config=getattr(self, "filter_data", None),
                    status_callback=self.log,
                    progress_callback=align_prog
                )
                current_offset += 1

            self.set_progress(total_steps, total_steps)
            self.log("\n🎉 ALL BATCH REPORT & ALIGNMENT TASKS COMPLETED!")
            out_path_str = str(Path(base_dir) / "output" / "mainout.xlsx")
            self.root.after(0, lambda: messagebox.showinfo(
                "Batch Complete",
                f"All requested reports downloaded and aligned successfully!\n\n"
                f"Base Folder: {base_dir}\n"
                f"- Fabric Stock\n"
                f"- Production WIP\n"
                f"- Finished Goods Stock\n"
                f"- Unfolding Stock\n"
                f"- Cutting Received Stock\n"
                f"- Pending Order Quantity\n"
                f"- Fabric Orders (Pending)\n\n"
                f"📊 Compiled Template Output:\n{out_path_str}"
            ))

        except Exception as e:
            self.log(f"❌ Batch runner error: {e}")
        finally:
            self.root.after(0, self._unlock_ui_finished)


def main():
    if USE_CTK:
        root = ctk.CTk()
    else:
        root = tk.Tk()
    app = UnifiedDownloaderApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
