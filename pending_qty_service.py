import os
import math
import io
import csv
import logging
from datetime import datetime, date
import psycopg2
from psycopg2.extras import execute_values

logger = logging.getLogger('srinithi_erp.pending_qty')

import calendar

def get_overlapping_months(from_date, to_date):
    """
    Returns list of months with overlap days between from_date and to_date.
    Uses full month names ('April', 'May', etc.) to match monthly_qty_derivation schema.
    """
    overlapping = []
    curr_year = from_date.year
    curr_month = from_date.month
    
    end_year = to_date.year
    end_month = to_date.month
    
    while (curr_year, curr_month) <= (end_year, end_month):
        month_name = calendar.month_name[curr_month]
        days_in_month = calendar.monthrange(curr_year, curr_month)[1]
        month_start = date(curr_year, curr_month, 1)
        month_end = date(curr_year, curr_month, days_in_month)
        
        overlap_start = max(from_date, month_start)
        overlap_end = min(to_date, month_end)
        overlap_days = max(0, (overlap_end - overlap_start).days + 1)
        
        overlapping.append({
            'month': month_name,
            'year': curr_year,
            'days_in_month': days_in_month,
            'overlap_days': overlap_days
        })
        
        curr_month += 1
        if curr_month > 12:
            curr_month = 1
            curr_year += 1
            
    return overlapping


def create_pending_qty_tables(cur):
    """
    Creates isolated database tables for Pending Qty Planning if they do not already exist.
    """
    cur.execute("""
        CREATE TABLE IF NOT EXISTS pending_qty_plans (
            id SERIAL PRIMARY KEY,
            plan_name VARCHAR(100) NOT NULL,
            financial_year VARCHAR(50) NOT NULL,
            version VARCHAR(100) NOT NULL,
            from_date DATE NOT NULL,
            to_date DATE NOT NULL,
            status VARCHAR(50) DEFAULT 'Calculated',
            created_by VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(100),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            confirmed_by VARCHAR(100),
            confirmed_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT uq_pending_qty_plan UNIQUE (plan_name, financial_year, version, from_date, to_date)
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS pending_qty_plan_lines (
            id SERIAL PRIMARY KEY,
            plan_id INTEGER NOT NULL REFERENCES pending_qty_plans(id) ON DELETE CASCADE,
            item_type VARCHAR(50) NOT NULL,
            brand VARCHAR(255),
            category VARCHAR(255),
            product_name VARCHAR(255) NOT NULL,
            common_production_name VARCHAR(255),
            color VARCHAR(255) NOT NULL,
            size VARCHAR(255) NOT NULL,
            requirement_qty NUMERIC(15, 2) DEFAULT 0,
            fg_qty NUMERIC(15, 2) DEFAULT 0,
            wip_qty NUMERIC(15, 2) DEFAULT 0,
            already_planned_qty NUMERIC(15, 2) DEFAULT 0,
            net_pending_qty NUMERIC(15, 2) DEFAULT 0,
            fabric_name VARCHAR(255),
            fabric_color VARCHAR(255),
            dia NUMERIC(10, 2),
            gsm INTEGER,
            fabric_consumption NUMERIC(10, 4) DEFAULT 0,
            fabric_required_kg NUMERIC(15, 2) DEFAULT 0,
            allocated_fabric_kg NUMERIC(15, 2) DEFAULT 0,
            cuttable_qty NUMERIC(15, 2) DEFAULT 0,
            hold_qty NUMERIC(15, 2) DEFAULT 0,
            shortage_kg NUMERIC(15, 2) DEFAULT 0,
            priority INTEGER DEFAULT 999,
            manual_priority INTEGER,
            status VARCHAR(50) DEFAULT 'NO PENDING',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pending_qty_lines_plan_id ON pending_qty_plan_lines(plan_id);")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS pending_qty_fabric_allocations (
            id SERIAL PRIMARY KEY,
            plan_id INTEGER NOT NULL REFERENCES pending_qty_plans(id) ON DELETE CASCADE,
            plan_line_id INTEGER REFERENCES pending_qty_plan_lines(id) ON DELETE CASCADE,
            fabric_name VARCHAR(255) NOT NULL,
            fabric_color VARCHAR(255) NOT NULL,
            dia NUMERIC(10, 2) NOT NULL,
            gsm INTEGER,
            available_stock_kg NUMERIC(15, 2) DEFAULT 0,
            required_fabric_kg NUMERIC(15, 2) DEFAULT 0,
            allocated_fabric_kg NUMERIC(15, 2) DEFAULT 0,
            manual_allocated_kg NUMERIC(15, 2),
            allocation_type VARCHAR(50) DEFAULT 'AUTO',
            priority INTEGER DEFAULT 999,
            status VARCHAR(50) DEFAULT 'ACTIVE',
            created_by VARCHAR(100),
            updated_by VARCHAR(100),
            confirmed_by VARCHAR(100),
            confirmed_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pending_fab_alloc_plan_id ON pending_qty_fabric_allocations(plan_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pending_fab_alloc_line_id ON pending_qty_fabric_allocations(plan_line_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_pending_fab_alloc_lookup ON pending_qty_fabric_allocations(plan_id, fabric_name, fabric_color, dia);")


def calculate_pending_qty_engine(cur, plan_name, financial_year, version, from_date_str, to_date_str, manual_overrides=None, username="System"):
    """
    Isolated, Authoritative Calculation & Fabric Allocation Engine for Pending Qty Planning.
    - Stand Alone Product: Product + Color + Size
    - Common Production: Common Production Name + Primary Color + Size (Aggregating all member details)
    - Fabric Pool: (fabric_name, fabric_color, dia, gsm)
    - Strict Stock Protection: No fabric pool double counting
    """
    create_pending_qty_tables(cur)

    from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
    to_date = datetime.strptime(to_date_str, '%Y-%m-%d').date()

    # Advisory lock for plan calculation serialization
    lock_key = f"pending_qty_{plan_name}_{financial_year}_{version}_{from_date_str}_{to_date_str}"
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s));", (lock_key,))

    # 1. Fetch valid pending orders from Stock / WIP / Pending Order module
    cur.execute("""
        SELECT product_name, color, size, SUM(qty)
        FROM pending_orders
        WHERE validation_status = 'VALID'
        GROUP BY product_name, color, size;
    """)
    po_rows = cur.fetchall()

    if not po_rows:
        return {'success': True, 'plan_id': None, 'message': 'No valid pending orders found in Stock / WIP / Pending Order module.'}

    # Extract active products, colors, sizes
    active_products = list(set(row[0].lower().strip() for row in po_rows if row[0]))
    active_colors = list(set(row[1].lower().strip() for row in po_rows if row[1]))
    active_sizes = list(set(row[2].lower().strip() for row in po_rows if row[2]))

    # 2. Product Master and Common Production Master configurations
    cur.execute("""
        SELECT LOWER(TRIM(p.product_name)), p.id, p.production_type, b.brand_name, pd.product_description,
               cpm.id, cpm.common_production_name,
               f.id, f.fabric_name, f.gsm, p.fabric_consumption, cpm.fabric_consumption, cpm.common_dia
        FROM product_master p
        LEFT JOIN brand_master b ON p.brand_id = b.id
        LEFT JOIN product_description_master pd ON p.product_description_id = pd.id
        LEFT JOIN common_production_master cpm ON p.common_production_id = cpm.id
        LEFT JOIN fabric_master f ON COALESCE(p.fabric_id, cpm.fabric_id) = f.id
        WHERE LOWER(TRIM(p.product_name)) = ANY(%s);
    """, (active_products,))
    
    product_config = {}
    active_common_groups = set()
    for r in cur.fetchall():
        prod_key = r[0]
        prod_id = r[1]
        prod_type = r[2] or 'Stand Alone'
        brand = r[3] or '-'
        category = r[4] or '-'
        cp_id = r[5]
        common_name = r[6]
        fab_id = r[7]
        fab_name = r[8]
        fab_gsm = int(r[9]) if r[9] is not None else 0
        p_consumption = float(r[10]) if r[10] is not None else 0.0
        cp_consumption = float(r[11]) if r[11] is not None else 0.0
        cp_common_dia = float(r[12]) if r[12] is not None else 0.0
        
        product_config[prod_key] = {
            'product_id': prod_id,
            'production_type': prod_type,
            'brand': brand,
            'category': category,
            'common_production_id': cp_id,
            'common_production_name': common_name,
            'fabric_id': fab_id,
            'fabric_name': fab_name,
            'gsm': fab_gsm,
            'fabric_consumption': p_consumption,
            'cp_fabric_consumption': cp_consumption,
            'cp_common_dia': cp_common_dia
        }
        if prod_type == 'Common' and common_name:
            active_common_groups.add(common_name.lower().strip())

    # Size Master ID mapping
    cur.execute("SELECT LOWER(TRIM(size)), id FROM size_master;")
    size_to_id = {r[0]: r[1] for r in cur.fetchall()}

    # Product Dia Mappings (size-specific and fallback common dia)
    cur.execute("""
        SELECT product_id, size_id, dia
        FROM product_dia_mapping
        ORDER BY product_id, size_id NULLS LAST, id ASC;
    """)
    pdm_map = {}
    pdm_fallback = {}
    for pid, sid, dia in cur.fetchall():
        d_val = float(dia) if dia is not None else 0.0
        if sid is not None:
            pdm_map[(pid, sid)] = d_val
        else:
            if pid not in pdm_fallback:
                pdm_fallback[pid] = d_val

    # Common Production Dia Mappings
    cur.execute("""
        SELECT common_production_id, size_id, dia
        FROM common_production_dia_mapping
        ORDER BY common_production_id, size_id NULLS LAST;
    """)
    cpdm_map = {}
    for cpid, sid, dia in cur.fetchall():
        d_val = float(dia) if dia is not None else 0.0
        if sid is not None:
            cpdm_map[(cpid, sid)] = d_val

    # Color resolution maps
    cur.execute("SELECT LOWER(TRIM(display_color)), global_color_code, category FROM color_master;")
    color_rows = cur.fetchall()
    display_to_code = {r[0]: r[1] for r in color_rows}
    color_categories = {r[0]: r[2] for r in color_rows}
    primary_color_by_code = {r[1].lower().strip(): r[0] for r in color_rows if r[2] == 'Primary'}

    cur.execute("SELECT LOWER(TRIM(product_name)), color_category FROM product_master;")
    product_color_cat = {r[0]: r[1] or 'Primary' for r in cur.fetchall()}

    cur.execute("SELECT category, global_color_code, display_color FROM color_master;")
    cat_code_to_display = {}
    for cat, code, disp in cur.fetchall():
        cat_code_to_display[(cat, code)] = disp

    cur.execute("SELECT global_color_code, display_color FROM color_master ORDER BY category DESC;")
    fallback_display = {r[0]: r[1] for r in cur.fetchall()}

    # 3. Fetch Finished Goods Stock
    cur.execute("""
        SELECT LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size)), SUM(qty)
        FROM finished_goods
        WHERE LOWER(TRIM(product_name)) = ANY(%s)
          AND LOWER(TRIM(size)) = ANY(%s)
        GROUP BY LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size));
    """, (active_products, active_sizes))
    fg_map = {}
    for r in cur.fetchall():
        prod_name_lower = r[0]
        stock_color_lower = r[1]
        size_lower = r[2]
        qty = float(r[3] or 0.0)
        
        g_code = display_to_code.get(stock_color_lower)
        if g_code:
            cat = product_color_cat.get(prod_name_lower, 'Primary')
            resolved_color = cat_code_to_display.get((cat, g_code)) or fallback_display.get(g_code, g_code)
            resolved_key = (prod_name_lower, resolved_color.lower().strip(), size_lower)
            fg_map[resolved_key] = fg_map.get(resolved_key, 0.0) + qty
        else:
            resolved_key = (prod_name_lower, stock_color_lower, size_lower)
            fg_map[resolved_key] = fg_map.get(resolved_key, 0.0) + qty

    # 4. Fetch Production WIP Stock (VALID rows only)
    cur.execute("""
        SELECT LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size)), SUM(qty)
        FROM production_wip
        WHERE LOWER(TRIM(product_name)) = ANY(%s)
          AND LOWER(TRIM(size)) = ANY(%s)
          AND validation_status = 'VALID'
        GROUP BY LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size));
    """, (active_products, active_sizes))
    wip_sku_map = {}
    for r in cur.fetchall():
        prod_name_lower = r[0]
        stock_color_lower = r[1]
        size_lower = r[2]
        qty = float(r[3] or 0.0)
        
        g_code = display_to_code.get(stock_color_lower)
        if g_code:
            cat = product_color_cat.get(prod_name_lower, 'Primary')
            resolved_color = cat_code_to_display.get((cat, g_code)) or fallback_display.get(g_code, g_code)
            resolved_key = (prod_name_lower, resolved_color.lower().strip(), size_lower)
            wip_sku_map[resolved_key] = wip_sku_map.get(resolved_key, 0.0) + qty
        else:
            resolved_key = (prod_name_lower, stock_color_lower, size_lower)
            wip_sku_map[resolved_key] = wip_sku_map.get(resolved_key, 0.0) + qty

    # WIP for Common Production Parent groups
    wip_group_map = {}
    if active_common_groups:
        cur.execute("""
            SELECT LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size)), SUM(qty)
            FROM production_wip
            WHERE LOWER(TRIM(product_name)) = ANY(%s)
              AND LOWER(TRIM(size)) = ANY(%s)
              AND validation_status = 'VALID'
            GROUP BY LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size));
        """, (list(active_common_groups), active_sizes))
        for r in cur.fetchall():
            c_prod, wip_col, wip_sz, wip_qty = r[0], r[1], r[2], float(r[3] or 0.0)
            g_code = display_to_code.get(wip_col)
            resolved_col = primary_color_by_code.get(g_code.lower().strip(), wip_col) if g_code else wip_col
            key = (c_prod, resolved_col.lower().strip(), wip_sz)
            wip_group_map[key] = wip_group_map.get(key, 0.0) + wip_qty

    # 5. Pending Orders Demand Mapping
    sku_po_map = {}
    for row in po_rows:
        product_name, color, size, qty = row
        prod_key = product_name.lower().strip()
        config = product_config.get(prod_key, {})
        brand = config.get('brand', '-')
        category = config.get('category', '-')
        sku_key = (brand, category, product_name, color, size)
        sku_po_map[sku_key] = sku_po_map.get(sku_key, 0.0) + float(qty or 0.0)

    # 6. Build lines structure for Stand Alone & Common Production
    standalone_lines = []
    common_groups = {} # key: (common_name_lower, primary_color_lower, size_lower)

    for sku_key, req_qty_raw in sku_po_map.items():
        brand, category, product, color, size = sku_key
        prod_key = product.lower().strip()
        color_lower = color.lower().strip()
        size_lower = size.lower().strip()

        config = product_config.get(prod_key, {
            'product_id': None, 'production_type': 'Stand Alone', 'common_production_id': None,
            'common_production_name': None, 'fabric_id': None, 'fabric_name': None,
            'gsm': 0, 'fabric_consumption': 0.0, 'cp_fabric_consumption': 0.0, 'cp_common_dia': 0.0
        })

        p_type = config.get('production_type', 'Stand Alone')
        common_name = config.get('common_production_name')
        fab_name = config.get('fabric_name') or '-'
        gsm = config.get('gsm') or 0
        
        # Resolve dia
        p_id = config.get('product_id')
        sz_id = size_to_id.get(size_lower)
        dia = pdm_map.get((p_id, sz_id)) or pdm_fallback.get(p_id) or 0.0
        fabric_consumption = config.get('fabric_consumption') or 0.0

        sku_lookup_key = (prod_key, color_lower, size_lower)
        fg_raw = fg_map.get(sku_lookup_key, 0.0)
        wip_raw = wip_sku_map.get(sku_lookup_key, 0.0)
        already_planned_raw = 0.0

        # Resolve primary color for Common Production aggregation
        g_code = display_to_code.get(color_lower)
        primary_color = primary_color_by_code.get(g_code.lower().strip(), color) if g_code else color

        if p_type == 'Common' and common_name:
            group_key = (common_name.lower().strip(), primary_color.lower().strip(), size_lower)
            if group_key not in common_groups:
                cp_id = config.get('common_production_id')
                cp_dia = cpdm_map.get((cp_id, sz_id)) or config.get('cp_common_dia') or 0.0
                cp_consumption = config.get('cp_fabric_consumption') or fabric_consumption
                common_groups[group_key] = {
                    'brand': brand,
                    'category': category,
                    'common_name': common_name,
                    'primary_color': primary_color,
                    'size': size,
                    'fabric_name': fab_name,
                    'gsm': gsm,
                    'dia': cp_dia,
                    'fabric_consumption': cp_consumption,
                    'members': []
                }
            
            common_groups[group_key]['members'].append({
                'brand': brand,
                'category': category,
                'product_name': product,
                'color': color,
                'size': size,
                'req_qty_raw': req_qty_raw,
                'fg_raw': fg_raw,
                'wip_raw': wip_raw,
                'already_planned_raw': 0.0,
                'fabric_name': fab_name,
                'gsm': gsm,
                'dia': dia,
                'fabric_consumption': fabric_consumption
            })
        else:
            net_pending = max(0.0, req_qty_raw - fg_raw - wip_raw - already_planned_raw)
            fab_req_kg = net_pending * fabric_consumption
            standalone_lines.append({
                'item_type': 'Stand Alone',
                'brand': brand,
                'category': category,
                'product_name': product,
                'common_production_name': None,
                'color': color,
                'size': size,
                'requirement_qty': round(req_qty_raw, 2),
                'fg_qty': round(fg_raw, 2),
                'wip_qty': round(wip_raw, 2),
                'already_planned_qty': round(already_planned_raw, 2),
                'net_pending_qty': round(net_pending, 2),
                'fabric_name': fab_name,
                'fabric_color': primary_color,
                'dia': dia,
                'gsm': gsm,
                'fabric_consumption': fabric_consumption,
                'fabric_required_kg': round(fab_req_kg, 2),
                'members': []
            })

    # Common Production Groups assembly
    common_lines = []
    for g_key, g_data in common_groups.items():
        c_name_lower, prim_col_lower, sz_lower = g_key
        common_name = g_data['common_name']
        primary_col = g_data['primary_color']
        size = g_data['size']
        members = g_data['members']

        total_req_raw = sum(m['req_qty_raw'] for m in members)
        total_fg_raw = sum(m['fg_raw'] for m in members)
        member_wip_sum = sum(m['wip_raw'] for m in members)
        parent_wip = wip_group_map.get((c_name_lower, prim_col_lower, sz_lower), 0.0)
        total_wip_raw = member_wip_sum + parent_wip
        already_planned_raw = 0.0

        common_net_pending = max(0.0, total_req_raw - total_fg_raw - total_wip_raw - already_planned_raw)
        cp_consumption = g_data['fabric_consumption']
        common_fab_req_kg = common_net_pending * cp_consumption

        # Member records with their individual net pending
        member_records = []
        for m in members:
            m_net_pending = max(0.0, m['req_qty_raw'] - m['fg_raw'] - m['wip_raw'] - m['already_planned_raw'])
            m_fab_req = m_net_pending * m['fabric_consumption']
            member_records.append({
                'item_type': 'Common Member',
                'brand': m['brand'],
                'category': m['category'],
                'product_name': m['product_name'],
                'common_production_name': common_name,
                'color': m['color'],
                'size': m['size'],
                'requirement_qty': round(m['req_qty_raw'], 2),
                'fg_qty': round(m['fg_raw'], 2),
                'wip_qty': round(m['wip_raw'], 2),
                'already_planned_qty': round(m['already_planned_raw'], 2),
                'net_pending_qty': round(m_net_pending, 2),
                'fabric_name': m['fabric_name'],
                'fabric_color': primary_col,
                'dia': m['dia'],
                'gsm': m['gsm'],
                'fabric_consumption': m['fabric_consumption'],
                'fabric_required_kg': round(m_fab_req, 2)
            })

        common_lines.append({
            'item_type': 'Common',
            'brand': g_data['brand'],
            'category': g_data['category'],
            'product_name': common_name,
            'common_production_name': common_name,
            'color': primary_col,
            'size': size,
            'requirement_qty': round(total_req_raw, 2),
            'fg_qty': round(total_fg_raw, 2),
            'wip_qty': round(total_wip_raw, 2),
            'already_planned_qty': round(already_planned_raw, 2),
            'net_pending_qty': round(common_net_pending, 2),
            'fabric_name': g_data['fabric_name'],
            'fabric_color': primary_col,
            'dia': g_data['dia'],
            'gsm': g_data['gsm'],
            'fabric_consumption': cp_consumption,
            'fabric_required_kg': round(common_fab_req_kg, 2),
            'members': member_records
        })

    all_planning_items = standalone_lines + common_lines

    # 7. Preload Actual Fabric Stock (Logical Fabric Pools)
    cur.execute("""
        SELECT LOWER(TRIM(fabric_name)), LOWER(TRIM(color)), dia, gsm, SUM(weight_mtr)
        FROM fabric_stock
        WHERE validation_status = 'VALID'
        GROUP BY LOWER(TRIM(fabric_name)), LOWER(TRIM(color)), dia, gsm;
    """)
    fabric_stock_map = {}
    for fab, col, d, g, stock_kg in cur.fetchall():
        d_val = float(d) if d is not None else 0.0
        g_val = int(g) if g is not None else 0
        key = (fab, col, d_val, g_val)
        fabric_stock_map[key] = float(stock_kg or 0.0)

    # 8. Build Fabric Pools
    pools = {}
    for idx, item in enumerate(all_planning_items):
        fab = (item['fabric_name'] or '-').lower().strip()
        col = (item['fabric_color'] or '-').lower().strip()
        dia = float(item['dia'] or 0.0)
        gsm = int(item['gsm'] or 0)
        
        pool_key = (fab, col, dia, gsm)
        if pool_key not in pools:
            avail_stock = fabric_stock_map.get(pool_key, 0.0)
            if avail_stock == 0.0:
                for s_key, s_qty in fabric_stock_map.items():
                    if s_key[0] == fab and s_key[1] == col and s_key[2] == dia:
                        avail_stock += s_qty
            
            pools[pool_key] = {
                'fabric_name': item['fabric_name'] or '-',
                'fabric_color': item['fabric_color'] or '-',
                'dia': dia,
                'gsm': gsm,
                'available_stock_kg': avail_stock,
                'consumers': []
            }
        pools[pool_key]['consumers'].append(item)

    # 9. Priority & Allocation Engine
    overrides = manual_overrides or {}

    for pool_key, pool_data in pools.items():
        avail_stock = pool_data['available_stock_kg']
        consumers = pool_data['consumers']

        # Determine priorities
        for item in consumers:
            item_key = (item['product_name'].lower().strip(), item['color'].lower().strip(), item['size'].lower().strip())
            override_info = overrides.get(item_key, {})
            item['priority'] = override_info.get('priority', 999)
            item['manual_priority'] = override_info.get('priority')
            item['manual_allocated_kg'] = override_info.get('manual_allocated_kg')

        # Sort consumers: priority ASC, then net_pending_qty DESC
        consumers.sort(key=lambda x: (x['priority'], -x['net_pending_qty']))

        # Check total manual allocation validation
        manual_sum = sum(c['manual_allocated_kg'] for c in consumers if c.get('manual_allocated_kg') is not None)
        if manual_sum > avail_stock:
            raise ValueError(f"Total manual allocation ({manual_sum:.2f} kg) exceeds available stock ({avail_stock:.2f} kg) for fabric pool {pool_data['fabric_name']} / {pool_data['fabric_color']}!")

        remaining_stock = avail_stock
        # First pass: Allocate manual overrides
        for item in consumers:
            if item.get('manual_allocated_kg') is not None:
                man_kg = min(float(item['manual_allocated_kg']), remaining_stock)
                item['allocated_fabric_kg'] = round(man_kg, 2)
                item['allocation_type'] = 'MANUAL'
                remaining_stock = max(0.0, remaining_stock - man_kg)
            else:
                item['allocated_fabric_kg'] = 0.0
                item['allocation_type'] = 'AUTO'

        # Second pass: Auto allocate remaining stock to non-manual consumers in priority order
        for item in consumers:
            if item.get('manual_allocated_kg') is None:
                needed_kg = float(item['fabric_required_kg'])
                alloc_kg = min(needed_kg, remaining_stock)
                item['allocated_fabric_kg'] = round(alloc_kg, 2)
                remaining_stock = max(0.0, remaining_stock - alloc_kg)

        # Calculate Cuttable Qty, Hold Qty, Shortage, and Status for each consumer
        for item in consumers:
            net_pending = item['net_pending_qty']
            req_kg = item['fabric_required_kg']
            alloc_kg = item['allocated_fabric_kg']
            consumption = item['fabric_consumption']
            shortage_kg = max(0.0, req_kg - alloc_kg)
            item['shortage_kg'] = round(shortage_kg, 2)

            if net_pending <= 0:
                item['cuttable_qty'] = 0.0
                item['hold_qty'] = 0.0
                item['status'] = 'NO PENDING'
            elif alloc_kg >= req_kg and req_kg > 0:
                item['cuttable_qty'] = net_pending
                item['hold_qty'] = 0.0
                item['status'] = 'FULL'
            elif alloc_kg > 0:
                if consumption > 0:
                    cuttable = math.floor(alloc_kg / consumption)
                else:
                    cuttable = net_pending
                cuttable = min(net_pending, cuttable)
                item['cuttable_qty'] = cuttable
                item['hold_qty'] = max(0.0, net_pending - cuttable)
                item['status'] = 'PARTIAL'
            else:
                item['cuttable_qty'] = 0.0
                item['hold_qty'] = net_pending
                item['status'] = 'FABRIC SHORTAGE'

            # Reconcile Common Production Members
            if item['item_type'] == 'Common' and item['members']:
                common_alloc_rem = alloc_kg
                for m in item['members']:
                    m_req_kg = m['fabric_required_kg']
                    m_cons = m['fabric_consumption']
                    m_alloc = min(m_req_kg, common_alloc_rem)
                    m['allocated_fabric_kg'] = round(m_alloc, 2)
                    common_alloc_rem = max(0.0, common_alloc_rem - m_alloc)
                    m['shortage_kg'] = round(max(0.0, m_req_kg - m_alloc), 2)
                    m_pending = m['net_pending_qty']

                    if m_pending <= 0:
                        m['cuttable_qty'] = 0.0
                        m['hold_qty'] = 0.0
                        m['status'] = 'NO PENDING'
                    elif m_alloc >= m_req_kg and m_req_kg > 0:
                        m['cuttable_qty'] = m_pending
                        m['hold_qty'] = 0.0
                        m['status'] = 'FULL'
                    elif m_alloc > 0:
                        m_cuttable = math.floor(m_alloc / m_cons) if m_cons > 0 else m_pending
                        m_cuttable = min(m_pending, m_cuttable)
                        m['cuttable_qty'] = m_cuttable
                        m['hold_qty'] = max(0.0, m_pending - m_cuttable)
                        m['status'] = 'PARTIAL'
                    else:
                        m['cuttable_qty'] = 0.0
                        m['hold_qty'] = m_pending
                        m['status'] = 'FABRIC SHORTAGE'

    # 10. Persist plan snapshot to database
    cur.execute("""
        INSERT INTO pending_qty_plans (
            plan_name, financial_year, version, from_date, to_date, status, created_by, updated_by
        ) VALUES (%s, %s, %s, %s, %s, 'Calculated', %s, %s)
        ON CONFLICT (plan_name, financial_year, version, from_date, to_date)
        DO UPDATE SET
            status = 'Calculated',
            updated_by = EXCLUDED.updated_by,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id;
    """, (plan_name, financial_year, version, from_date, to_date, username, username))
    plan_id = cur.fetchone()[0]

    # Delete previous lines and allocations for this plan_id
    cur.execute("DELETE FROM pending_qty_fabric_allocations WHERE plan_id = %s;", (plan_id,))
    cur.execute("DELETE FROM pending_qty_plan_lines WHERE plan_id = %s;", (plan_id,))

    # Insert parent lines and member lines
    line_inserts = []
    for item in all_planning_items:
        line_inserts.append((
            plan_id, item['item_type'], item['brand'], item['category'], item['product_name'],
            item['common_production_name'], item['color'], item['size'], item['requirement_qty'],
            item['fg_qty'], item['wip_qty'], item['already_planned_qty'], item['net_pending_qty'],
            item['fabric_name'], item['fabric_color'], item['dia'], item['gsm'], item['fabric_consumption'],
            item['fabric_required_kg'], item['allocated_fabric_kg'], item['cuttable_qty'], item['hold_qty'],
            item['shortage_kg'], item['priority'], item['manual_priority'], item['status']
        ))

    insert_line_sql = """
        INSERT INTO pending_qty_plan_lines (
            plan_id, item_type, brand, category, product_name, common_production_name,
            color, size, requirement_qty, fg_qty, wip_qty, already_planned_qty, net_pending_qty,
            fabric_name, fabric_color, dia, gsm, fabric_consumption, fabric_required_kg,
            allocated_fabric_kg, cuttable_qty, hold_qty, shortage_kg, priority, manual_priority, status
        ) VALUES %s RETURNING id, product_name, color, size, item_type;
    """
    execute_values(cur, insert_line_sql, line_inserts)
    saved_lines = cur.fetchall()

    line_id_map = {}
    for lid, pname, col, sz, itype in saved_lines:
        line_id_map[(pname.lower().strip(), col.lower().strip(), sz.lower().strip(), itype)] = lid

    # Insert member lines
    member_values = []
    for item in all_planning_items:
        if item['item_type'] == 'Common' and item['members']:
            for m in item['members']:
                member_values.append((
                    plan_id, m['item_type'], m['brand'], m['category'], m['product_name'],
                    m['common_production_name'], m['color'], m['size'], m['requirement_qty'],
                    m['fg_qty'], m['wip_qty'], m['already_planned_qty'], m['net_pending_qty'],
                    m['fabric_name'], m['fabric_color'], m['dia'], m['gsm'], m['fabric_consumption'],
                    m['fabric_required_kg'], m['allocated_fabric_kg'], m['cuttable_qty'], m['hold_qty'],
                    m['shortage_kg'], 999, None, m['status']
                ))
    if member_values:
        execute_values(cur, insert_line_sql, member_values)

    # Insert fabric allocations
    alloc_inserts = []
    for pool_key, pool_data in pools.items():
        avail_stock = pool_data['available_stock_kg']
        for item in pool_data['consumers']:
            lid = line_id_map.get((item['product_name'].lower().strip(), item['color'].lower().strip(), item['size'].lower().strip(), item['item_type']))
            alloc_inserts.append((
                plan_id, lid, item['fabric_name'], item['fabric_color'], item['dia'], item['gsm'],
                avail_stock, item['fabric_required_kg'], item['allocated_fabric_kg'],
                item['manual_allocated_kg'], item.get('allocation_type', 'AUTO'),
                item['priority'], 'ACTIVE', username, username
            ))

    if alloc_inserts:
        insert_alloc_sql = """
            INSERT INTO pending_qty_fabric_allocations (
                plan_id, plan_line_id, fabric_name, fabric_color, dia, gsm,
                available_stock_kg, required_fabric_kg, allocated_fabric_kg,
                manual_allocated_kg, allocation_type, priority, status, created_by, updated_by
            ) VALUES %s;
        """
        execute_values(cur, insert_alloc_sql, alloc_inserts)

    return {
        'success': True,
        'plan_id': plan_id,
        'total_lines': len(all_planning_items),
        'total_pools': len(pools)
    }


def get_pending_plan_meta(cur):
    """
    Returns dropdown filter options for Pending Qty Planning.
    """
    create_pending_qty_tables(cur)

    # Plans, FY, Versions from monthly_qty_derivation
    cur.execute("""
        SELECT DISTINCT plan_name, financial_year, version
        FROM monthly_qty_derivation
        ORDER BY plan_name, financial_year, version;
    """)
    plan_tuples = cur.fetchall()

    cur.execute("SELECT DISTINCT brand_name FROM brand_master WHERE status = 'Active' ORDER BY brand_name;")
    brands = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT DISTINCT product_description FROM product_description_master WHERE status = 'Active' ORDER BY product_description;")
    categories = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT DISTINCT common_production_name FROM common_production_master WHERE status = 'Active' ORDER BY common_production_name;")
    common_names = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT DISTINCT product_name FROM product_master WHERE status = 'Active' ORDER BY product_name;")
    products = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT DISTINCT display_color FROM color_master WHERE status = 'Active' ORDER BY display_color;")
    colors = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT size FROM size_master ORDER BY id ASC;")
    sizes = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT DISTINCT fabric_name FROM fabric_master WHERE status = 'Active' ORDER BY fabric_name;")
    fabrics = [r[0] for r in cur.fetchall()]

    return {
        'success': True,
        'plans': [{'plan_name': r[0], 'financial_year': r[1], 'version': r[2]} for r in plan_tuples],
        'brands': brands,
        'categories': categories,
        'common_names': common_names,
        'products': products,
        'colors': colors,
        'sizes': sizes,
        'fabrics': fabrics
    }


def get_pending_plan_summary(cur, plan_name="LIVE_PENDING_ORDERS", financial_year="CURRENT", version="v1", from_date_str="2020-01-01", to_date_str="2099-12-31", plan_id=None):
    """
    Calculates KPI metrics for the header KPI cards.
    Supports fetching by plan_id directly or by plan name/dates.
    """
    create_pending_qty_tables(cur)
    
    plan_row = None
    if plan_id:
        cur.execute("""
            SELECT id, status, confirmed_by, confirmed_at
            FROM pending_qty_plans
            WHERE id = %s;
        """, (plan_id,))
        plan_row = cur.fetchone()
    
    if not plan_row and plan_name and from_date_str and to_date_str:
        from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date() if isinstance(from_date_str, str) else from_date_str
        to_date = datetime.strptime(to_date_str, '%Y-%m-%d').date() if isinstance(to_date_str, str) else to_date_str
        cur.execute("""
            SELECT id, status, confirmed_by, confirmed_at
            FROM pending_qty_plans
            WHERE plan_name = %s AND financial_year = %s AND version = %s
              AND from_date = %s AND to_date = %s;
        """, (plan_name, financial_year, version, from_date, to_date))
        plan_row = cur.fetchone()

    if not plan_row:
        # Fallback to the latest plan
        cur.execute("""
            SELECT id, status, confirmed_by, confirmed_at
            FROM pending_qty_plans
            ORDER BY id DESC LIMIT 1;
        """)
        plan_row = cur.fetchone()
    
    if not plan_row:
        return {
            'success': True,
            'plan_status': 'Not Calculated',
            'total_pending_qty': 0,
            'cut_now_qty': 0,
            'partial_qty': 0,
            'fabric_shortage_qty': 0,
            'fabric_pools': {'enough': 0, 'partial': 0, 'shortage': 0, 'total': 0}
        }

    plan_id, plan_status, conf_by, conf_at = plan_row

    # Quantities KPIs from parent lines
    cur.execute("""
        SELECT 
            COALESCE(SUM(net_pending_qty), 0),
            COALESCE(SUM(cuttable_qty), 0),
            COALESCE(SUM(hold_qty), 0),
            COALESCE(SUM(shortage_kg), 0),
            COALESCE(SUM(CASE WHEN status = 'FULL' THEN cuttable_qty ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'PARTIAL' THEN cuttable_qty ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'FABRIC SHORTAGE' THEN hold_qty ELSE 0 END), 0)
        FROM pending_qty_plan_lines
        WHERE plan_id = %s AND item_type IN ('Stand Alone', 'Common');
    """, (plan_id,))
    kpi_row = cur.fetchone()

    # Fabric pool status breakdown
    cur.execute("""
        SELECT 
            fabric_name, fabric_color, dia, gsm,
            available_stock_kg,
            SUM(required_fabric_kg) as total_req,
            SUM(allocated_fabric_kg) as total_alloc
        FROM pending_qty_fabric_allocations
        WHERE plan_id = %s
        GROUP BY fabric_name, fabric_color, dia, gsm, available_stock_kg;
    """, (plan_id,))
    pool_rows = cur.fetchall()

    enough_count = 0
    partial_count = 0
    shortage_count = 0
    for r in pool_rows:
        avail = float(r[4] or 0.0)
        req = float(r[5] or 0.0)
        alloc = float(r[6] or 0.0)
        if req == 0:
            enough_count += 1
        elif alloc >= req:
            enough_count += 1
        elif alloc > 0:
            partial_count += 1
        else:
            shortage_count += 1

    return {
        'success': True,
        'plan_id': plan_id,
        'plan_status': plan_status,
        'confirmed_by': conf_by,
        'confirmed_at': conf_at.isoformat() if conf_at else None,
        'total_pending_qty': float(kpi_row[0]),
        'cut_now_qty': float(kpi_row[1]),
        'partial_qty': float(kpi_row[5]),
        'hold_qty': float(kpi_row[2]),
        'fabric_shortage_qty': float(kpi_row[6]),
        'fabric_shortage_kg': float(kpi_row[3]),
        'fabric_pools': {
            'enough': enough_count,
            'partial': partial_count,
            'shortage': shortage_count,
            'total': len(pool_rows)
        }
    }


def build_filter_clause(filters, item_type_scope="all", table_alias=""):
    """
    Builds SQL WHERE clause and params for pending plan lines.
    """
    pfx = f"{table_alias}." if table_alias else ""
    clauses = []
    params = []

    if item_type_scope == "parents_only":
        clauses.append(f"{pfx}item_type IN ('Stand Alone', 'Common')")
    elif item_type_scope == "members_only":
        clauses.append(f"{pfx}item_type = 'Common Member'")

    product_type = filters.get('product_type', 'All').strip()
    if product_type == 'Stand Alone':
        clauses.append(f"{pfx}item_type = 'Stand Alone'")
    elif product_type == 'Common Production':
        clauses.append(f"{pfx}item_type = 'Common'")

    brand = filters.get('brand', '').strip()
    if brand:
        clauses.append(f"LOWER(TRIM({pfx}brand)) = %s")
        params.append(brand.lower().strip())

    category = filters.get('category', '').strip()
    if category:
        clauses.append(f"LOWER(TRIM({pfx}category)) = %s")
        params.append(category.lower().strip())

    common_name = filters.get('common_production_name', '').strip()
    if common_name:
        clauses.append(f"LOWER(TRIM({pfx}common_production_name)) = %s")
        params.append(common_name.lower().strip())

    product = filters.get('product', '').strip()
    if product:
        clauses.append(f"(LOWER(TRIM({pfx}product_name)) = %s OR LOWER(TRIM({pfx}common_production_name)) = %s)")
        params.extend([product.lower().strip(), product.lower().strip()])

    color = filters.get('color', '').strip()
    if color:
        clauses.append(f"LOWER(TRIM({pfx}color)) = %s")
        params.append(color.lower().strip())

    size = filters.get('size', '').strip()
    if size:
        clauses.append(f"LOWER(TRIM({pfx}size)) = %s")
        params.append(size.lower().strip())

    fabric_name = filters.get('fabric_name', '').strip()
    if fabric_name:
        clauses.append(f"LOWER(TRIM({pfx}fabric_name)) = %s")
        params.append(fabric_name.lower().strip())

    fabric_color = filters.get('fabric_color', '').strip()
    if fabric_color:
        clauses.append(f"LOWER(TRIM({pfx}fabric_color)) = %s")
        params.append(fabric_color.lower().strip())

    status = filters.get('status', '').strip()
    if status and status != 'All':
        clauses.append(f"{pfx}status = %s")
        params.append(status)

    search = filters.get('search', '').strip()
    if search:
        clauses.append(f"""
            (LOWER({pfx}product_name) LIKE %s OR 
             LOWER({pfx}color) LIKE %s OR 
             LOWER({pfx}size) LIKE %s OR 
             LOWER({pfx}brand) LIKE %s OR 
             LOWER({pfx}category) LIKE %s OR
             LOWER({pfx}fabric_name) LIKE %s)
        """)
        s_term = f"%{search.lower()}%"
        params.extend([s_term, s_term, s_term, s_term, s_term, s_term])

    where_str = " AND ".join(clauses) if clauses else "1=1"
    return where_str, params


def get_pending_plan_data(cur, plan_id, filters, page=1, per_page=50, all_records=False):
    """
    Fetches data for Tab 1: Pending Qty Plan (Parent lines).
    """
    where_str, params = build_filter_clause(filters, item_type_scope="parents_only")
    full_params = [plan_id] + params

    cur.execute(f"SELECT COUNT(*) FROM pending_qty_plan_lines WHERE plan_id = %s AND {where_str};", full_params)
    total_count = cur.fetchone()[0]

    # Query Totals
    cur.execute(f"""
        SELECT 
            COALESCE(SUM(requirement_qty), 0),
            COALESCE(SUM(fg_qty), 0),
            COALESCE(SUM(wip_qty), 0),
            COALESCE(SUM(already_planned_qty), 0),
            COALESCE(SUM(net_pending_qty), 0)
        FROM pending_qty_plan_lines
        WHERE plan_id = %s AND {where_str};
    """, full_params)
    totals_row = cur.fetchone()

    limit_clause = ""
    if not all_records:
        limit_clause = f"LIMIT {per_page} OFFSET {(page - 1) * per_page}"

    cur.execute(f"""
        SELECT 
            id, item_type, brand, category, product_name, common_production_name,
            color, size, requirement_qty, fg_qty, wip_qty, already_planned_qty,
            net_pending_qty, status, fabric_name, fabric_color, dia, gsm, fabric_consumption
        FROM pending_qty_plan_lines
        WHERE plan_id = %s AND {where_str}
        ORDER BY product_name ASC, color ASC, size ASC
        {limit_clause};
    """, full_params)
    
    rows = []
    for r in cur.fetchall():
        rows.append({
            'id': r[0],
            'item_type': r[1],
            'brand': r[2],
            'category': r[3],
            'product_name': r[4],
            'common_production_name': r[5],
            'color': r[6],
            'size': r[7],
            'requirement_qty': float(r[8] or 0),
            'fg_qty': float(r[9] or 0),
            'wip_qty': float(r[10] or 0),
            'already_planned_qty': float(r[11] or 0),
            'net_pending_qty': float(r[12] or 0),
            'status': r[13],
            'fabric_name': r[14],
            'fabric_color': r[15],
            'dia': float(r[16] or 0),
            'gsm': r[17],
            'fabric_consumption': float(r[18] or 0),
            'has_members': (r[1] == 'Common')
        })

    return {
        'success': True,
        'rows': rows,
        'total_count': total_count,
        'page': page,
        'per_page': per_page,
        'totals': {
            'requirement_qty': float(totals_row[0]),
            'fg_qty': float(totals_row[1]),
            'wip_qty': float(totals_row[2]),
            'already_planned_qty': float(totals_row[3]),
            'net_pending_qty': float(totals_row[4])
        }
    }


def get_cutting_plan_data(cur, plan_id, filters, page=1, per_page=50, all_records=False):
    """
    Fetches data for Tab 2: Cutting Plan.
    """
    where_str, params = build_filter_clause(filters, item_type_scope="parents_only")
    full_params = [plan_id] + params

    cur.execute(f"SELECT COUNT(*) FROM pending_qty_plan_lines WHERE plan_id = %s AND {where_str};", full_params)
    total_count = cur.fetchone()[0]

    # Query Totals
    cur.execute(f"""
        SELECT 
            COALESCE(SUM(net_pending_qty), 0),
            COALESCE(SUM(fabric_required_kg), 0),
            COALESCE(SUM(allocated_fabric_kg), 0),
            COALESCE(SUM(cuttable_qty), 0),
            COALESCE(SUM(hold_qty), 0),
            COALESCE(SUM(shortage_kg), 0)
        FROM pending_qty_plan_lines
        WHERE plan_id = %s AND {where_str};
    """, full_params)
    totals_row = cur.fetchone()

    limit_clause = ""
    if not all_records:
        limit_clause = f"LIMIT {per_page} OFFSET {(page - 1) * per_page}"

    where_str_l, params_l = build_filter_clause(filters, item_type_scope="parents_only", table_alias="l")
    full_params_l = [plan_id] + params_l

    cur.execute(f"""
        SELECT 
            l.id, l.priority, l.manual_priority, l.item_type, l.brand, l.category,
            l.product_name, l.common_production_name, l.color, l.size,
            l.net_pending_qty, l.fabric_required_kg, a.available_stock_kg,
            l.allocated_fabric_kg, l.cuttable_qty, l.hold_qty, l.shortage_kg,
            l.status, l.fabric_name, l.fabric_color, l.dia, l.gsm, l.fabric_consumption
        FROM pending_qty_plan_lines l
        LEFT JOIN pending_qty_fabric_allocations a ON a.plan_line_id = l.id
        WHERE l.plan_id = %s AND {where_str_l}
        ORDER BY l.priority ASC, l.net_pending_qty DESC, l.product_name ASC
        {limit_clause};
    """, full_params_l)

    rows = []
    for r in cur.fetchall():
        rows.append({
            'id': r[0],
            'priority': r[1],
            'manual_priority': r[2],
            'item_type': r[3],
            'brand': r[4],
            'category': r[5],
            'product_name': r[6],
            'common_production_name': r[7],
            'color': r[8],
            'size': r[9],
            'net_pending_qty': float(r[10] or 0),
            'fabric_required_kg': float(r[11] or 0),
            'available_stock_kg': float(r[12] or 0),
            'allocated_fabric_kg': float(r[13] or 0),
            'cuttable_qty': float(r[14] or 0),
            'hold_qty': float(r[15] or 0),
            'shortage_kg': float(r[16] or 0),
            'status': r[17],
            'fabric_name': r[18],
            'fabric_color': r[19],
            'dia': float(r[20] or 0),
            'gsm': r[21],
            'fabric_consumption': float(r[22] or 0),
            'has_members': (r[3] == 'Common')
        })

    return {
        'success': True,
        'rows': rows,
        'total_count': total_count,
        'page': page,
        'per_page': per_page,
        'totals': {
            'net_pending_qty': float(totals_row[0]),
            'fabric_required_kg': float(totals_row[1]),
            'allocated_fabric_kg': float(totals_row[2]),
            'cuttable_qty': float(totals_row[3]),
            'hold_qty': float(totals_row[4]),
            'shortage_kg': float(totals_row[5])
        }
    }


def get_fab_required_data(cur, plan_id, filters, page=1, per_page=50, all_records=False):
    """
    Fetches data for Tab 3: Fab Required (Fabric Pool Centric View).
    """
    # Filter on allocations and consumers
    clauses = ["plan_id = %s"]
    params = [plan_id]

    fabric_name = filters.get('fabric_name', '').strip()
    if fabric_name:
        clauses.append("LOWER(TRIM(fabric_name)) = %s")
        params.append(fabric_name.lower().strip())

    fabric_color = filters.get('fabric_color', '').strip()
    if fabric_color:
        clauses.append("LOWER(TRIM(fabric_color)) = %s")
        params.append(fabric_color.lower().strip())

    where_str = " AND ".join(clauses)

    cur.execute(f"""
        SELECT 
            fabric_name, fabric_color, dia, gsm, available_stock_kg,
            COUNT(DISTINCT plan_line_id) as consuming_products_count,
            SUM(required_fabric_kg) as total_required_kg,
            SUM(allocated_fabric_kg) as total_allocated_kg
        FROM pending_qty_fabric_allocations
        WHERE {where_str}
        GROUP BY fabric_name, fabric_color, dia, gsm, available_stock_kg
        ORDER BY fabric_name ASC, fabric_color ASC, dia ASC;
    """, params)
    
    all_pools = cur.fetchall()
    total_count = len(all_pools)

    total_fab_req = sum(float(r[6] or 0) for r in all_pools)
    total_fab_avail = sum(float(r[4] or 0) for r in all_pools)
    total_fab_alloc = sum(float(r[7] or 0) for r in all_pools)

    limit_pools = all_pools if all_records else all_pools[(page - 1) * per_page : page * per_page]

    rows = []
    for r in limit_pools:
        fab = r[0]
        col = r[1]
        dia = float(r[2] or 0)
        gsm = r[3]
        avail = float(r[4] or 0)
        consumer_count = r[5]
        req = float(r[6] or 0)
        alloc = float(r[7] or 0)
        remaining = max(0.0, avail - alloc)
        shortage = max(0.0, req - alloc)
        coverage_pct = round((alloc / req * 100.0) if req > 0 else 100.0, 1)

        if req == 0:
            status = 'ENOUGH'
        elif alloc >= req:
            status = 'ENOUGH'
        elif alloc > 0:
            status = 'PARTIAL'
        else:
            status = 'SHORTAGE'

        # Filter by status if requested
        stat_filter = filters.get('status', '').strip()
        if stat_filter and stat_filter != 'All' and status != stat_filter:
            continue

        rows.append({
            'fabric_name': fab,
            'fabric_color': col,
            'dia': dia,
            'gsm': gsm,
            'consuming_products_count': consumer_count,
            'available_stock_kg': avail,
            'required_fabric_kg': req,
            'allocated_fabric_kg': alloc,
            'remaining_fabric_kg': remaining,
            'shortage_kg': shortage,
            'coverage_pct': coverage_pct,
            'status': status
        })

    return {
        'success': True,
        'rows': rows,
        'total_count': total_count,
        'page': page,
        'per_page': per_page,
        'totals': {
            'required_fabric_kg': total_fab_req,
            'available_stock_kg': total_fab_avail,
            'allocated_fabric_kg': total_fab_alloc,
            'shortage_kg': max(0.0, total_fab_req - total_fab_alloc)
        }
    }


def get_fabric_pool_consumers(cur, plan_id, fabric_name, fabric_color, dia, gsm=None):
    """
    Fetches consumer line details for an expanded Fabric Pool row.
    """
    cur.execute("""
        SELECT 
            l.id, l.priority, l.manual_priority, l.item_type, l.product_name,
            l.common_production_name, l.color, l.size, l.net_pending_qty,
            a.required_fabric_kg, a.allocated_fabric_kg, a.manual_allocated_kg,
            l.cuttable_qty, l.hold_qty, l.shortage_kg, l.status, a.allocation_type
        FROM pending_qty_fabric_allocations a
        JOIN pending_qty_plan_lines l ON a.plan_line_id = l.id
        WHERE a.plan_id = %s
          AND LOWER(TRIM(a.fabric_name)) = LOWER(TRIM(%s))
          AND LOWER(TRIM(a.fabric_color)) = LOWER(TRIM(%s))
          AND a.dia = %s
        ORDER BY l.priority ASC, l.net_pending_qty DESC;
    """, (plan_id, fabric_name, fabric_color, float(dia or 0.0)))

    consumers = []
    for r in cur.fetchall():
        consumers.append({
            'line_id': r[0],
            'priority': r[1],
            'manual_priority': r[2],
            'item_type': r[3],
            'product_name': r[4],
            'common_production_name': r[5],
            'color': r[6],
            'size': r[7],
            'net_pending_qty': float(r[8] or 0),
            'required_fabric_kg': float(r[9] or 0),
            'allocated_fabric_kg': float(r[10] or 0),
            'manual_allocated_kg': float(r[11]) if r[11] is not None else None,
            'cuttable_qty': float(r[12] or 0),
            'hold_qty': float(r[13] or 0),
            'shortage_kg': float(r[14] or 0),
            'status': r[15],
            'allocation_type': r[16]
        })

    return {'success': True, 'consumers': consumers}


def get_common_production_members(cur, plan_id, common_name, primary_color, size):
    """
    Fetches member breakdown lines for an expanded Common Production row.
    Filters specifically by common_production_name, primary_color (via fabric_color or color), and size.
    """
    params = [plan_id, common_name.lower().strip(), size.lower().strip()]
    color_clause = ""
    if primary_color and primary_color.strip():
        color_clause = "AND (LOWER(TRIM(fabric_color)) = %s OR LOWER(TRIM(color)) = %s)"
        params.extend([primary_color.lower().strip(), primary_color.lower().strip()])

    query = f"""
        SELECT 
            id, item_type, brand, category, product_name, common_production_name,
            color, size, requirement_qty, fg_qty, wip_qty, already_planned_qty,
            net_pending_qty, fabric_required_kg, allocated_fabric_kg, cuttable_qty,
            hold_qty, shortage_kg, status, fabric_consumption
        FROM pending_qty_plan_lines
        WHERE plan_id = %s
          AND item_type = 'Common Member'
          AND LOWER(TRIM(common_production_name)) = %s
          AND LOWER(TRIM(size)) = %s
          {color_clause}
        ORDER BY product_name ASC, color ASC;
    """
    cur.execute(query, params)

    members = []
    for r in cur.fetchall():
        members.append({
            'id': r[0],
            'item_type': r[1],
            'brand': r[2],
            'category': r[3],
            'product_name': r[4],
            'common_production_name': r[5],
            'color': r[6],
            'size': r[7],
            'requirement_qty': float(r[8] or 0),
            'fg_qty': float(r[9] or 0),
            'wip_qty': float(r[10] or 0),
            'already_planned_qty': float(r[11] or 0),
            'net_pending_qty': float(r[12] or 0),
            'fabric_required_kg': float(r[13] or 0),
            'allocated_fabric_kg': float(r[14] or 0),
            'cuttable_qty': float(r[15] or 0),
            'hold_qty': float(r[16] or 0),
            'shortage_kg': float(r[17] or 0),
            'status': r[18],
            'fabric_consumption': float(r[19] or 0)
        })

    return {'success': True, 'members': members}


def update_plan_line_priority(cur, plan_id, line_id, priority, username="System"):
    """
    Updates priority for a planning line, sets plan status to 'Reviewed', and recalculates allocations.
    """
    cur.execute("""
        UPDATE pending_qty_plan_lines
        SET priority = %s, manual_priority = %s
        WHERE id = %s AND plan_id = %s
        RETURNING product_name, color, size;
    """, (priority, priority, line_id, plan_id))
    
    updated = cur.fetchone()
    if not updated:
        return {'success': False, 'message': 'Plan line not found.'}

    # Fetch plan details to recalculate
    cur.execute("SELECT plan_name, financial_year, version, from_date, to_date FROM pending_qty_plans WHERE id = %s;", (plan_id,))
    p_info = cur.fetchone()
    if p_info:
        # Collect all existing manual priorities and manual allocations
        cur.execute("""
            SELECT product_name, color, size, manual_priority, manual_allocated_kg
            FROM pending_qty_plan_lines l
            LEFT JOIN pending_qty_fabric_allocations a ON a.plan_line_id = l.id
            WHERE l.plan_id = %s AND (l.manual_priority IS NOT NULL OR a.manual_allocated_kg IS NOT NULL);
        """, (plan_id,))
        overrides = {}
        for pname, col, sz, man_p, man_alloc in cur.fetchall():
            key = (pname.lower().strip(), col.lower().strip(), sz.lower().strip())
            overrides[key] = {
                'priority': man_p if man_p is not None else 999,
                'manual_allocated_kg': float(man_alloc) if man_alloc is not None else None
            }
        
        calculate_pending_qty_engine(
            cur, p_info[0], p_info[1], p_info[2],
            p_info[3].strftime('%Y-%m-%d'), p_info[4].strftime('%Y-%m-%d'),
            manual_overrides=overrides, username=username
        )

    return {'success': True, 'message': 'Priority updated and allocations recalculated successfully.'}


def save_manual_allocation(cur, plan_id, fabric_name, fabric_color, dia, gsm, allocations, username="System"):
    """
    Validates and saves manual fabric allocations for a specific fabric pool.
    allocations = [{'line_id': int, 'manual_allocated_kg': float}]
    """
    # 1. Fetch available stock for the pool
    cur.execute("""
        SELECT DISTINCT available_stock_kg
        FROM pending_qty_fabric_allocations
        WHERE plan_id = %s
          AND LOWER(TRIM(fabric_name)) = %s
          AND LOWER(TRIM(fabric_color)) = %s
          AND dia = %s;
    """, (plan_id, fabric_name.lower().strip(), fabric_color.lower().strip(), dia))
    avail_row = cur.fetchone()
    if not avail_row:
        return {'success': False, 'message': 'Fabric pool not found in this plan.'}

    avail_stock = float(avail_row[0] or 0.0)
    
    # 2. Validate total manual allocations <= available stock
    total_manual = sum(float(a.get('manual_allocated_kg') or 0.0) for a in allocations)
    if total_manual > avail_stock + 0.001:
        return {
            'success': False,
            'message': f"Validation Failed: Total manual allocation ({total_manual:.2f} kg) exceeds available stock ({avail_stock:.2f} kg)."
        }

    # Fetch plan details
    cur.execute("SELECT plan_name, financial_year, version, from_date, to_date FROM pending_qty_plans WHERE id = %s;", (plan_id,))
    p_info = cur.fetchone()
    if not p_info:
        return {'success': False, 'message': 'Plan not found.'}

    # Collect existing overrides and merge
    cur.execute("""
        SELECT l.id, l.product_name, l.color, l.size, l.manual_priority, a.manual_allocated_kg
        FROM pending_qty_plan_lines l
        LEFT JOIN pending_qty_fabric_allocations a ON a.plan_line_id = l.id
        WHERE l.plan_id = %s;
    """, (plan_id,))
    
    overrides = {}
    line_map = {}
    for lid, pname, col, sz, man_p, man_alloc in cur.fetchall():
        key = (pname.lower().strip(), col.lower().strip(), sz.lower().strip())
        line_map[lid] = key
        if man_p is not None or man_alloc is not None:
            overrides[key] = {
                'priority': man_p if man_p is not None else 999,
                'manual_allocated_kg': float(man_alloc) if man_alloc is not None else None
            }

    # Apply new manual allocations
    for a in allocations:
        lid = a.get('line_id')
        m_kg = float(a.get('manual_allocated_kg') or 0.0)
        key = line_map.get(lid)
        if key:
            if key not in overrides:
                overrides[key] = {'priority': 999, 'manual_allocated_kg': m_kg}
            else:
                overrides[key]['manual_allocated_kg'] = m_kg

    calculate_pending_qty_engine(
        cur, p_info[0], p_info[1], p_info[2],
        p_info[3].strftime('%Y-%m-%d'), p_info[4].strftime('%Y-%m-%d'),
        manual_overrides=overrides, username=username
    )

    return {'success': True, 'message': 'Manual allocation applied and plan recalculated successfully.'}


def confirm_pending_plan(cur, plan_id, username="Planner"):
    """
    Confirms the plan and locks status.
    """
    cur.execute("""
        UPDATE pending_qty_plans
        SET status = 'Confirmed',
            confirmed_by = %s,
            confirmed_at = CURRENT_TIMESTAMP,
            updated_by = %s,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        RETURNING id;
    """, (username, username, plan_id))
    
    if not cur.fetchone():
        return {'success': False, 'message': 'Plan not found.'}

    return {'success': True, 'message': 'Pending Qty Plan confirmed successfully.'}


def export_pending_plan_csv(cur, export_type, plan_id, filters):
    """
    Generates CSV export data for the requested tab.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    if export_type == 'pending-plan':
        res = get_pending_plan_data(cur, plan_id, filters, all_records=True)
        writer.writerow([
            'Product Type', 'Brand', 'Category', 'Product / Common Production Name',
            'Color', 'Size', 'Requirement Qty', 'FG Stock', 'WIP Qty', 'Already Planned Qty',
            'Net Pending Qty', 'Status'
        ])
        for r in res['rows']:
            writer.writerow([
                r['item_type'], r['brand'], r['category'], r['product_name'],
                r['color'], r['size'], r['requirement_qty'], r['fg_qty'],
                r['wip_qty'], r['already_planned_qty'], r['net_pending_qty'], r['status']
            ])

    elif export_type == 'cutting-plan':
        res = get_cutting_plan_data(cur, plan_id, filters, all_records=True)
        writer.writerow([
            'Priority', 'Product Type', 'Product / Common Production Name', 'Color', 'Size',
            'Net Pending Qty', 'Fabric Required (KG)', 'Available Stock (KG)',
            'Allocated Fabric (KG)', 'Cuttable Qty (Pcs)', 'Hold Qty (Pcs)',
            'Fabric Shortage (KG)', 'Cut Status'
        ])
        for r in res['rows']:
            writer.writerow([
                r['priority'], r['item_type'], r['product_name'], r['color'], r['size'],
                r['net_pending_qty'], r['fabric_required_kg'], r['available_stock_kg'],
                r['allocated_fabric_kg'], r['cuttable_qty'], r['hold_qty'],
                r['shortage_kg'], r['status']
            ])

    elif export_type == 'fab-required':
        res = get_fab_required_data(cur, plan_id, filters, all_records=True)
        writer.writerow([
            'Fabric Name', 'Fabric Color', 'Dia', 'GSM', 'Consuming Products Count',
            'Available Stock (KG)', 'Required Fabric (KG)', 'Allocated Fabric (KG)',
            'Remaining Fabric (KG)', 'Shortage (KG)', 'Coverage %', 'Status'
        ])
        for r in res['rows']:
            writer.writerow([
                r['fabric_name'], r['fabric_color'], r['dia'], r['gsm'],
                r['consuming_products_count'], r['available_stock_kg'],
                r['required_fabric_kg'], r['allocated_fabric_kg'],
                r['remaining_fabric_kg'], r['shortage_kg'], r['coverage_pct'], r['status']
            ])

    elif export_type == 'fabric-allocation-detail':
        cur.execute("""
            SELECT 
                a.fabric_name, a.fabric_color, a.dia, a.gsm,
                l.item_type, l.product_name, l.color, l.size,
                l.net_pending_qty, a.required_fabric_kg, a.allocated_fabric_kg,
                l.cuttable_qty, l.hold_qty, l.shortage_kg, l.priority, l.status
            FROM pending_qty_fabric_allocations a
            JOIN pending_qty_plan_lines l ON a.plan_line_id = l.id
            WHERE a.plan_id = %s
            ORDER BY a.fabric_name, a.fabric_color, l.priority ASC;
        """, (plan_id,))
        writer.writerow([
            'Fabric Name', 'Fabric Color', 'Dia', 'GSM', 'Product Type',
            'Product / Common Group', 'Color', 'Size', 'Net Pending Qty',
            'Required Fabric (KG)', 'Allocated Fabric (KG)', 'Cuttable Qty',
            'Hold Qty', 'Shortage (KG)', 'Priority', 'Status'
        ])
        for r in cur.fetchall():
            writer.writerow(list(r))

    csv_data = output.getvalue()
    output.close()
    return csv_data
