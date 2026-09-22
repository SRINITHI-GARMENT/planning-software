import sys

class SafeStream:
    def __init__(self, original):
        self.original = original
    def write(self, data):
        try:
            self.original.write(data)
        except Exception:
            pass
    def flush(self):
        try:
            self.original.flush()
        except Exception:
            pass
    def reconfigure(self, *args, **kwargs):
        try:
            self.original.reconfigure(*args, **kwargs)
        except Exception:
            pass
    def __getattr__(self, name):
        return getattr(self.original, name)

sys.stdout = SafeStream(sys.stdout)
sys.stderr = SafeStream(sys.stderr)

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
try:
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

import os
import math
import logging
import psycopg2
import psycopg2.extras
from psycopg2 import pool
from flask import Flask, request, jsonify, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup structured logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('srinithi_erp')

app = Flask(__name__, static_folder='static', static_url_path='')

# Secret Key Configuration
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    SECRET_KEY = 'srinithi_default_secret_key_change_in_production'
    logger.warning("SECRET_KEY environment variable not set. Using default secret key.")
app.secret_key = SECRET_KEY

# Cookie & Session Security Configuration
COOKIE_SECURE = os.environ.get('COOKIE_SECURE', 'False').lower() in ('true', '1', 't')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=COOKIE_SECURE,
    PERMANENT_SESSION_LIFETIME=timedelta(days=7)
)

# Database URL Configuration
DB_URL = os.environ.get('DATABASE_URL')
if not DB_URL:
    logger.error("DATABASE_URL is not set in environment!")
    raise RuntimeError("DATABASE_URL environment variable is required.")

# Connection pool setup
db_pool = None

def init_db_pool():
    global db_pool
    try:
        db_pool = psycopg2.pool.ThreadedConnectionPool(1, 10, DB_URL)
        logger.info("Database connection pool initialized successfully.")
    except Exception as e:
        logger.error(f"Error initializing database connection pool: {e}")

def get_db_connection():
    global db_pool
    if db_pool is None:
        init_db_pool()
    try:
        conn = db_pool.getconn()
        if conn.closed == 0:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
            return conn
    except Exception as e:
        logger.warning(f"Retrieved database connection was invalid or closed: {e}")
        try:
            db_pool.putconn(conn, close=True)
        except Exception:
            pass
    
    logger.info("Re-initializing database connection pool...")
    init_db_pool()
    return db_pool.getconn()

def release_db_connection(conn):
    if db_pool and conn:
        try:
            if not conn.closed and conn.status != psycopg2.extensions.STATUS_READY:
                conn.rollback()
        except Exception:
            pass
        try:
            db_pool.putconn(conn)
        except Exception as e:
            logger.warning(f"Error releasing db connection: {e}")

# Setup Database Tables (Users and Planning tables)
def setup_database():
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Create users table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        # Create planning_headers table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS planning_headers (
                id SERIAL PRIMARY KEY,
                plan_name VARCHAR(100) NOT NULL,
                financial_year VARCHAR(20) NOT NULL,
                planning_method VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'Draft',
                version INT NOT NULL DEFAULT 1,
                remarks TEXT,
                created_by VARCHAR(100) NOT NULL,
                created_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                modified_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                is_latest BOOLEAN DEFAULT TRUE
            );
        """)
        
        # Create planning_details table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS planning_details (
                id SERIAL PRIMARY KEY,
                planning_id INT REFERENCES planning_headers(id) ON DELETE CASCADE,
                month VARCHAR(20) NOT NULL,
                last_year_qty INT NOT NULL DEFAULT 0,
                growth_percent NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                sales_target NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                average_sale_value NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                calculated_qty INT NOT NULL DEFAULT 0,
                manual_adjustment INT NOT NULL DEFAULT 0,
                festival_qty INT NOT NULL DEFAULT 0,
                new_store_qty INT NOT NULL DEFAULT 0,
                final_qty INT NOT NULL DEFAULT 0,
                remarks TEXT,
                locked BOOLEAN DEFAULT FALSE
            );
        """)
        conn.commit()

        # Migrate planning_headers to add version and is_latest columns if not exists
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'planning_headers' AND column_name = 'version';
        """)
        if not cur.fetchone():
            logger.info("Database migration: Adding 'version' column to 'planning_headers' table...")
            cur.execute("ALTER TABLE planning_headers ADD COLUMN version INT NOT NULL DEFAULT 1;")
            conn.commit()
            logger.info("Database migration: 'version' column added successfully.")

        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'planning_headers' AND column_name = 'is_latest';
        """)
        if not cur.fetchone():
            logger.info("Database migration: Adding 'is_latest' column to 'planning_headers' table...")
            cur.execute("ALTER TABLE planning_headers ADD COLUMN is_latest BOOLEAN DEFAULT TRUE;")
            conn.commit()
            logger.info("Database migration: 'is_latest' column added successfully.")

        # Drop old unique constraint uq_plan_name_fy if exists and replace with unique on (plan_name, financial_year, version)
        cur.execute("""
            SELECT conname 
            FROM pg_constraint 
            WHERE conname = 'uq_plan_name_fy' AND conrelid = 'planning_headers'::regclass;
        """)
        if cur.fetchone():
            logger.info("Database migration: Dropping obsolete 'uq_plan_name_fy' constraint from 'planning_headers'...")
            cur.execute("ALTER TABLE planning_headers DROP CONSTRAINT uq_plan_name_fy;")
            conn.commit()
            logger.info("Database migration: 'uq_plan_name_fy' constraint dropped.")

        cur.execute("""
            SELECT conname 
            FROM pg_constraint 
            WHERE conname = 'uq_plan_name_fy_version' AND conrelid = 'planning_headers'::regclass;
        """)
        if not cur.fetchone():
            logger.info("Database migration: Adding 'uq_plan_name_fy_version' constraint to 'planning_headers'...")
            cur.execute("ALTER TABLE planning_headers ADD CONSTRAINT uq_plan_name_fy_version UNIQUE (plan_name, financial_year, version);")
            conn.commit()
            logger.info("Database migration: 'uq_plan_name_fy_version' constraint added.")

        # Migrate planning_details to add locked column if not exists
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'planning_details' AND column_name = 'locked';
        """)
        if not cur.fetchone():
            logger.info("Database migration: Adding 'locked' column to 'planning_details' table...")
            cur.execute("ALTER TABLE planning_details ADD COLUMN locked BOOLEAN DEFAULT FALSE;")
            conn.commit()
            logger.info("Database migration: 'locked' column added successfully.")

        # Migrate sales_data to have id SERIAL PRIMARY KEY column if not exists
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'sales_data' AND column_name = 'id';
        """)
        if not cur.fetchone():
            logger.info("Database migration: Adding 'id' column to 'sales_data' table...")
            cur.execute('ALTER TABLE sales_data ADD COLUMN id SERIAL PRIMARY KEY;')
            conn.commit()
            logger.info("Database migration: 'id' column added successfully.")

        # Ensure performance indexes on sales_data table
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_sales_data_month ON sales_data ("MONTH" DESC);
            CREATE INDEX IF NOT EXISTS idx_sales_data_brand ON sales_data ("BRAND");
            CREATE INDEX IF NOT EXISTS idx_sales_data_product ON sales_data ("product");
            CREATE INDEX IF NOT EXISTS idx_sales_data_status ON sales_data ("PRODUCT STATUS");
            CREATE INDEX IF NOT EXISTS idx_sales_data_size ON sales_data ("Size");
            CREATE INDEX IF NOT EXISTS idx_sales_data_color ON sales_data ("Color");
        """)
        conn.commit()

        # Create color_master table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS color_master (
                id SERIAL PRIMARY KEY,
                global_color_code VARCHAR(100) NOT NULL,
                display_color VARCHAR(255) NOT NULL,
                category VARCHAR(50) NOT NULL CHECK (category IN ('Primary', 'Secondary')),
                status VARCHAR(50) DEFAULT 'Active',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_color_global_category UNIQUE (global_color_code, category)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_color_master_global_code ON color_master(global_color_code);")

        # Dynamic & Idempotent Migration: Drop any single-column UNIQUE constraint or unique index on display_color
        cur.execute("""
            DO $$
            DECLARE
                c_name TEXT;
                idx_name TEXT;
            BEGIN
                -- 1. Drop any single-column UNIQUE constraint on display_color
                FOR c_name IN (
                    SELECT con.conname
                    FROM pg_constraint con
                    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
                    WHERE con.conrelid = 'color_master'::regclass
                      AND con.contype = 'u'
                      AND att.attname = 'display_color'
                      AND array_length(con.conkey, 1) = 1
                ) LOOP
                    EXECUTE 'ALTER TABLE color_master DROP CONSTRAINT IF EXISTS ' || quote_ident(c_name);
                END LOOP;

                -- 2. Drop any standalone single-column UNIQUE index on display_color
                FOR idx_name IN (
                    SELECT i.relname
                    FROM pg_index x
                    JOIN pg_class c ON c.oid = x.indrelid
                    JOIN pg_class i ON i.oid = x.indexrelid
                    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(x.indkey)
                    WHERE c.relname = 'color_master'
                      AND x.indisunique = TRUE
                      AND a.attname = 'display_color'
                      AND array_length(x.indkey, 1) = 1
                ) LOOP
                    EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(idx_name);
                END LOOP;

                -- 3. Ensure UNIQUE (global_color_code, category) exists
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint 
                    WHERE conname = 'uq_color_global_category' AND conrelid = 'color_master'::regclass
                ) THEN
                    ALTER TABLE color_master ADD CONSTRAINT uq_color_global_category UNIQUE (global_color_code, category);
                END IF;
            END $$;
        """)
        conn.commit()
        
        # Create size_master table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS size_master (
                id SERIAL PRIMARY KEY,
                size_code VARCHAR(100) UNIQUE NOT NULL,
                size VARCHAR(100) NOT NULL,
                status VARCHAR(50) DEFAULT 'Active'
            );
        """)
        
        # Create fabric_master table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS fabric_master (
                id SERIAL PRIMARY KEY,
                fabric_name VARCHAR(255) UNIQUE NOT NULL,
                uom VARCHAR(50) NOT NULL,
                gsm NUMERIC NOT NULL,
                status VARCHAR(50) DEFAULT 'Active',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        # Create fabric_color_mapping table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS fabric_color_mapping (
                id SERIAL PRIMARY KEY,
                fabric_id INTEGER REFERENCES fabric_master(id) ON DELETE CASCADE,
                global_color_code VARCHAR(100) NOT NULL,
                display_color VARCHAR(255) NOT NULL,
                category VARCHAR(50) DEFAULT 'Primary',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fabric_color_mapping_fabric_id ON fabric_color_mapping(fabric_id);")

        # Create fabric_dia_mapping table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS fabric_dia_mapping (
                id SERIAL PRIMARY KEY,
                fabric_id INTEGER REFERENCES fabric_master(id) ON DELETE CASCADE,
                dia NUMERIC NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_fabric_dia UNIQUE (fabric_id, dia)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fabric_dia_mapping_fabric_id ON fabric_dia_mapping(fabric_id);")

        # Create brand_master table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS brand_master (
                id SERIAL PRIMARY KEY,
                brand_name VARCHAR(255) UNIQUE NOT NULL,
                brand_code VARCHAR(100) UNIQUE NOT NULL,
                status VARCHAR(50) DEFAULT 'Active',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create product_description_master table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_description_master (
                id SERIAL PRIMARY KEY,
                product_description VARCHAR(255) UNIQUE NOT NULL,
                description_code VARCHAR(100) UNIQUE,
                status VARCHAR(50) DEFAULT 'Active',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create product master and mapping tables
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_master (
                id SERIAL PRIMARY KEY,
                product_name VARCHAR(255) NOT NULL,
                brand_id INTEGER NOT NULL REFERENCES brand_master(id),
                fabric_id INTEGER NOT NULL REFERENCES fabric_master(id),
                product_description_id INTEGER NOT NULL REFERENCES product_description_master(id),
                product_type VARCHAR(100) NOT NULL,
                color_category VARCHAR(50) NOT NULL,
                dia_mode VARCHAR(50) NOT NULL,
                production_type VARCHAR(100) DEFAULT 'Common',
                status VARCHAR(50) DEFAULT 'Active',
                fabric_consumption NUMERIC DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_product_name_brand UNIQUE (product_name, brand_id)
            );
        """)

        cur.execute("""
            ALTER TABLE product_master ADD COLUMN IF NOT EXISTS fabric_consumption NUMERIC DEFAULT 0;
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_color_mapping (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
                global_color_code VARCHAR(100) NOT NULL,
                CONSTRAINT uq_product_color UNIQUE (product_id, global_color_code)
            );
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_dia_mapping (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
                size_id INTEGER REFERENCES size_master(id) ON DELETE CASCADE,
                dia NUMERIC NOT NULL
            );
        """)

        # Create product sales data mapping table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_sales_data_mapping (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
                sales_product_name VARCHAR(255) NOT NULL,
                CONSTRAINT uq_product_sales_data UNIQUE (product_id, sales_product_name)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_sales_data_mapping_product_id ON product_sales_data_mapping(product_id);")

        # Create/Update Common Production Master Columns and Mappings
        logger.info("Database migration: Adding fabric_id, dia_mode, common_dia, and fabric_consumption columns to common_production_master...")
        cur.execute("ALTER TABLE common_production_master ADD COLUMN IF NOT EXISTS fabric_id INTEGER REFERENCES fabric_master(id) ON DELETE SET NULL;")
        cur.execute("ALTER TABLE common_production_master ADD COLUMN IF NOT EXISTS dia_mode VARCHAR(50);")
        cur.execute("ALTER TABLE common_production_master ADD COLUMN IF NOT EXISTS common_dia INTEGER;")
        cur.execute("ALTER TABLE common_production_master ADD COLUMN IF NOT EXISTS fabric_consumption NUMERIC;")

        logger.info("Database migration: Creating common_production_dia_mapping table...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS common_production_dia_mapping (
                common_production_id INTEGER REFERENCES common_production_master(id) ON DELETE CASCADE,
                size_id INTEGER REFERENCES size_master(id) ON DELETE CASCADE,
                dia INTEGER,
                PRIMARY KEY (common_production_id, size_id)
            );
        """)

        # Create planning period status table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS planning_period_status (
                planning_period VARCHAR(20) PRIMARY KEY,
                status VARCHAR(20) NOT NULL DEFAULT 'Draft',
                is_locked BOOLEAN NOT NULL DEFAULT FALSE,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create planning sheet records table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS planning_sheet_records (
                id SERIAL PRIMARY KEY,
                planning_period VARCHAR(20) NOT NULL REFERENCES planning_period_status(planning_period) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
                suggested_contribution NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                manual_contribution NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                approved_contribution NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_period_product UNIQUE (planning_period, product_id)
            );
        """)

        # Create planning product colors table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS planning_product_colors (
                id SERIAL PRIMARY KEY,
                planning_id INTEGER NOT NULL REFERENCES planning_sheet_records(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
                color_id INTEGER NOT NULL REFERENCES color_master(id) ON DELETE CASCADE,
                suggested_percent NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                manual_percent NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                CONSTRAINT uq_planning_color UNIQUE (planning_id, color_id)
            );
        """)

        # Create planning product sizes table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS planning_product_sizes (
                id SERIAL PRIMARY KEY,
                planning_id INTEGER NOT NULL REFERENCES planning_sheet_records(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
                size_id INTEGER NOT NULL REFERENCES size_master(id) ON DELETE CASCADE,
                suggested_percent NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                manual_percent NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                CONSTRAINT uq_planning_size UNIQUE (planning_id, size_id)
            );
        """)

        # Drop old planning contributions table if exists to update schema
        # cur.execute("DROP TABLE IF EXISTS planning_contributions CASCADE;")

        # Create planning contributions range table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS planning_contributions (
                id SERIAL PRIMARY KEY,
                contribution_type VARCHAR(20) NOT NULL,
                product_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE CASCADE,
                color_code VARCHAR(100) DEFAULT NULL,
                size_id INTEGER REFERENCES size_master(id) ON DELETE SET NULL,
                brand_id INTEGER REFERENCES brand_master(id) ON DELETE SET NULL,
                manual_pct NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                version VARCHAR(100) NOT NULL DEFAULT 'Standard',
                status VARCHAR(20) DEFAULT 'Draft',
                created_by VARCHAR(100) DEFAULT 'admin',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP WITH TIME ZONE DEFAULT NULL,
                updated_by VARCHAR(100) DEFAULT NULL,
                fixed_percentage DECIMAL(10,2) DEFAULT NULL
            );
        """)

        # Add logical unique indexes for planning contributions
        cur.execute("DROP INDEX IF EXISTS uq_planning_contrib_product_new CASCADE;")
        cur.execute("DROP INDEX IF EXISTS uq_planning_contrib_color_new CASCADE;")
        cur.execute("DROP INDEX IF EXISTS uq_planning_contrib_size_new CASCADE;")
        cur.execute("DROP INDEX IF EXISTS uq_planning_contrib_size_overall CASCADE;")
        cur.execute("DROP INDEX IF EXISTS uq_planning_contrib_size_colorwise CASCADE;")

        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_contrib_product_logical 
            ON planning_contributions (contribution_type, product_id, brand_id, version) 
            WHERE (contribution_type = 'Product');
        """)

        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_contrib_color_logical 
            ON planning_contributions (contribution_type, product_id, color_code, brand_id, version) 
            WHERE (contribution_type = 'Color');
        """)

        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_contrib_size_overall_logical 
            ON planning_contributions (contribution_type, product_id, size_id, brand_id, version) 
            WHERE (contribution_type = 'Size' AND color_code IS NULL);
        """)

        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_contrib_size_colorwise_logical 
            ON planning_contributions (contribution_type, product_id, size_id, color_code, brand_id, version) 
            WHERE (contribution_type = 'Size' AND color_code IS NOT NULL);
        """)

        # Add audit tracking columns to planning_contributions table if they don't exist
        cur.execute("ALTER TABLE planning_contributions ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP WITH TIME ZONE DEFAULT NULL;")
        cur.execute("ALTER TABLE planning_contributions ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100) DEFAULT NULL;")
        cur.execute("ALTER TABLE planning_contributions ADD COLUMN IF NOT EXISTS fixed_percentage DECIMAL(10,2) DEFAULT NULL;")

        # Backfill existing records: fixed_percentage = manual_pct where fixed_percentage is NULL and manual_pct is NOT NULL
        logger.info("Database migration: Backfilling NULL fixed_percentage values from manual_pct...")
        cur.execute("""
            UPDATE planning_contributions
            SET fixed_percentage = manual_pct
            WHERE fixed_percentage IS NULL AND manual_pct IS NOT NULL;
        """)
        conn.commit()
        logger.info("Database migration: Backfill completed successfully.")

        # Drop old monthly qty derivation table if exists to update schema
        # cur.execute("DROP TABLE IF EXISTS monthly_qty_derivation CASCADE;")

        # Create monthly qty derivation table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS monthly_qty_derivation (
                id SERIAL PRIMARY KEY,
                plan_name VARCHAR(100) NOT NULL,
                financial_year VARCHAR(50) NOT NULL,
                version VARCHAR(100) NOT NULL DEFAULT 'v1',
                month VARCHAR(20) NOT NULL,
                year INTEGER NOT NULL,
                brand VARCHAR(255) NOT NULL,
                category VARCHAR(255) NOT NULL,
                product VARCHAR(255) NOT NULL,
                product_contribution NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                product_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                color VARCHAR(255) NOT NULL,
                color_contribution NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                color_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                size VARCHAR(255) NOT NULL,
                size_contribution NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                final_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                generated_on TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                generated_by VARCHAR(100) DEFAULT 'admin'
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_monthly_qty_derivation_plan_ver ON monthly_qty_derivation(plan_name, financial_year, version);")

        # Ensure fabric_name column exists in balance_qty_cache using ALTER TABLE
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'balance_qty_cache' AND column_name = 'fabric_name';
        """)
        if not cur.fetchone():
            # Check if table exists before altering
            cur.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'balance_qty_cache');")
            if cur.fetchone()[0]:
                logger.info("Database migration: Adding 'fabric_name' column to 'balance_qty_cache' table...")
                cur.execute("ALTER TABLE balance_qty_cache ADD COLUMN IF NOT EXISTS fabric_name VARCHAR(255);")

        # Create balance qty cache table for performance caching
        cur.execute("""
            CREATE TABLE IF NOT EXISTS balance_qty_cache (
                id SERIAL PRIMARY KEY,
                plan_name VARCHAR(100) NOT NULL,
                financial_year VARCHAR(50) NOT NULL,
                version VARCHAR(100) NOT NULL,
                from_date DATE NOT NULL,
                to_date DATE NOT NULL,
                brand VARCHAR(255),
                category VARCHAR(255),
                product VARCHAR(255),
                color VARCHAR(255),
                size VARCHAR(255) NOT NULL,
                calculated_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                finished_goods_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                production_wip_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                pending_production_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                bal_required_qty NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                production_type VARCHAR(100) NOT NULL,
                common_production_name VARCHAR(255),
                fabric_name VARCHAR(255),
                calculation_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_balance_qty_cache_plan_ver ON balance_qty_cache(plan_name, financial_year, version, from_date, to_date);")

        # Run one-time backfill for empty/NULL fabric_name fields in cache
        logger.info("Database migration: Backfilling 'fabric_name' column in 'balance_qty_cache'...")
        cur.execute("""
            UPDATE balance_qty_cache c
            SET fabric_name = f.fabric_name
            FROM product_master p
            JOIN fabric_master f ON p.fabric_id = f.id
            WHERE LOWER(TRIM(c.product)) = LOWER(TRIM(p.product_name))
              AND (c.fabric_name IS NULL OR c.fabric_name = '');
        """)
        cur.execute("""
            UPDATE balance_qty_cache c
            SET fabric_name = (
                SELECT f.fabric_name
                FROM product_master p
                JOIN fabric_master f ON p.fabric_id = f.id
                WHERE p.common_production_id = (SELECT id FROM common_production_master WHERE LOWER(TRIM(common_production_name)) = LOWER(TRIM(c.product)))
                LIMIT 1
            )
            WHERE c.production_type IN ('Common', 'Common Parent WIP')
              AND (c.fabric_name IS NULL OR c.fabric_name = '');
        """)

        # Setup Pending Qty Planning tables (isolated)
        from pending_qty_service import create_pending_qty_tables
        create_pending_qty_tables(cur)

        conn.commit()

        cur.close()
        logger.info("Database tables verified/created successfully.")
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error setting up database tables: {e}", exc_info=True)
    finally:
        if conn:
            release_db_connection(conn)

# Helper function to convert DB datetime/date objects to JSON serializable formats
def serialize_row(row, cols):
    serialized = {}
    for col, val in zip(cols, row):
        if isinstance(val, (datetime, date)):
            serialized[col] = val.isoformat()
        else:
            serialized[col] = val
    return serialized

# Middleware for Authentication Check
def login_required(f):
    def wrapper(*args, **kwargs):
        if 'username' not in session:
            return jsonify({'success': False, 'message': 'Authentication required. Please log in.'}), 401
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper

# Auth APIs
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password are required.'}), 400
        
    if len(password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters long.'}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if user already exists
        cur.execute('SELECT id FROM users WHERE username = %s;', (username,))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': 'Username already exists.'}), 400
            
        password_hash = generate_password_hash(password)
        cur.execute(
            'INSERT INTO users (username, password_hash) VALUES (%s, %s);',
            (username, password_hash)
        )
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'User registered successfully!'}), 201
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password are required.'}), 400
        
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT username, password_hash FROM users WHERE username = %s;', (username,))
        user = cur.fetchone()
        cur.close()
        
        if user and check_password_hash(user[1], password):
            session['username'] = user[0]
            return jsonify({'success': True, 'message': f'Welcome back, {user[0]}!'})
        else:
            return jsonify({'success': False, 'message': 'Invalid username or password.'}), 401
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.pop('username', None)
    return jsonify({'success': True, 'message': 'Logged out successfully.'})

@app.route('/api/auth/session', methods=['GET'])
def get_session():
    if 'username' in session:
        return jsonify({'success': True, 'authenticated': True, 'username': session['username']})
    return jsonify({'success': True, 'authenticated': False})

# Sales API: Summary (Metrics & Chart data)
@app.route('/api/sales/summary', methods=['GET'])
@login_required
def get_sales_summary():
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 1. KPI Metrics (Consolidated Multi-Aggregate Query)
        cur.execute("""
            SELECT 
                COALESCE(SUM("Qty"), 0) AS total_qty,
                COUNT(DISTINCT "BRAND") AS total_brands,
                COUNT(DISTINCT "product") AS total_products,
                COUNT(CASE WHEN TRIM("PRODUCT STATUS") = 'RUNNING' THEN 1 END) AS running_products_count
            FROM sales_data;
        """)
        kpi_row = cur.fetchone()
        total_qty = kpi_row[0] or 0
        total_brands = kpi_row[1] or 0
        total_products = kpi_row[2] or 0
        running_products_count = kpi_row[3] or 0
        
        # 2. Monthly Trend (Line Chart)
        cur.execute("""
            SELECT DATE_TRUNC('month', "MONTH") as month_date, SUM("Qty") as total_qty
            FROM sales_data
            GROUP BY month_date
            ORDER BY month_date ASC;
        """)
        monthly_trend = []
        for row in cur.fetchall():
            m_date = row[0]
            m_label = m_date.strftime('%b %Y') if m_date else 'Unknown'
            monthly_trend.append({'label': m_label, 'value': int(row[1] or 0), 'raw_date': m_date.isoformat() if m_date else None})
            
        # 3. Brand Distribution (Top Brands - Pie/Doughnut Chart)
        cur.execute("""
            SELECT "BRAND", SUM("Qty") as total_qty
            FROM sales_data
            GROUP BY "BRAND"
            ORDER BY total_qty DESC
            LIMIT 10;
        """)
        brand_distribution = [{'brand': row[0] or 'Unknown', 'value': int(row[1] or 0)} for row in cur.fetchall()]
        
        # 4. Status Distribution (Bar Chart)
        cur.execute("""
            SELECT TRIM("PRODUCT STATUS") as status, SUM("Qty") as total_qty
            FROM sales_data
            GROUP BY status
            ORDER BY total_qty DESC;
        """)
        status_distribution = [{'status': row[0] or 'Unknown', 'value': int(row[1] or 0)} for row in cur.fetchall()]
        
        # 5. Distinct Filters lists for front-end dropdowns
        cur.execute('SELECT DISTINCT "BRAND" FROM sales_data WHERE "BRAND" IS NOT NULL ORDER BY "BRAND";')
        filter_brands = [row[0] for row in cur.fetchall()]
        
        cur.execute('SELECT DISTINCT "Size" FROM sales_data WHERE "Size" IS NOT NULL ORDER BY "Size";')
        filter_sizes = [row[0] for row in cur.fetchall()]
        
        cur.close()
        
        return jsonify({
            'success': True,
            'summary': {
                'total_qty': int(total_qty),
                'total_brands': total_brands,
                'total_products': total_products,
                'running_products': running_products_count
            },
            'charts': {
                'monthly_trend': monthly_trend,
                'brand_distribution': brand_distribution,
                'status_distribution': status_distribution
            },
            'filters': {
                'brands': filter_brands,
                'sizes': filter_sizes
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error fetching summary data: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Sales API: Paginated & Filtered List
@app.route('/api/sales', methods=['GET'])
@login_required
def get_sales_list():
    brand = request.args.get('brand', '').strip()
    status = request.args.get('status', '').strip()
    size = request.args.get('size', '').strip()
    search = request.args.get('search', '').strip()
    
    # Pagination
    try:
        page = int(request.args.get('page', 1))
        if page < 1: page = 1
    except ValueError:
        page = 1
        
    try:
        per_page = int(request.args.get('per_page', 20))
        if per_page < 1: per_page = 20
        if per_page > 500: per_page = 500 # limit maximum page size
    except ValueError:
        per_page = 20
        
    offset = (page - 1) * per_page
    
    # Sorting
    sort_by = request.args.get('sort_by', 'MONTH').strip()
    sort_dir = request.args.get('sort_dir', 'DESC').strip().upper()
    
    allowed_sort_columns = {
        'MONTH': '"MONTH"',
        'BRAND': '"BRAND"',
        'PRODUCT DES': '"PRODUCT DES"',
        'PRODUCT STATUS': '"PRODUCT STATUS"',
        'product': '"product"',
        'Color': '"Color"',
        'Size': '"Size"',
        'Qty': '"Qty"'
    }
    
    sort_col = allowed_sort_columns.get(sort_by, '"MONTH"')
    if sort_dir not in ['ASC', 'DESC']:
        sort_dir = 'DESC'
        
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Build query filters dynamically
        query_parts = []
        query_params = []
        
        if brand:
            query_parts.append('"BRAND" = %s')
            query_params.append(brand)
            
        if status:
            query_parts.append('TRIM("PRODUCT STATUS") = %s')
            query_params.append(status)
            
        if size:
            query_parts.append('"Size" = %s')
            query_params.append(size)
            
        if search:
            search_clause = """(
                "BRAND" ILIKE %s OR 
                "PRODUCT DES" ILIKE %s OR 
                "product" ILIKE %s OR 
                "Color" ILIKE %s OR 
                "Size" ILIKE %s
            )"""
            query_parts.append(search_clause)
            search_term = f'%{search}%'
            query_params.extend([search_term] * 5)
            
        where_clause = ""
        if query_parts:
            where_clause = "WHERE " + " AND ".join(query_parts)
            
        # Count query
        count_query = f'SELECT COUNT(*) FROM sales_data {where_clause};'
        cur.execute(count_query, tuple(query_params))
        total_count = cur.fetchone()[0]
        
        # Select query
        select_query = f"""
            SELECT id, "MONTH", "BRAND", "PRODUCT DES", "PRODUCT TYPE", "PRODUCT STATUS", "product", "Color", "Size", "Qty"
            FROM sales_data
            {where_clause}
            ORDER BY {sort_col} {sort_dir}
            LIMIT %s OFFSET %s;
        """
        select_params = list(query_params)
        select_params.extend([per_page, offset])
        
        cur.execute(select_query, tuple(select_params))
        rows = cur.fetchall()
        
        cols = ['id', 'MONTH', 'BRAND', 'PRODUCT_DES', 'PRODUCT_TYPE', 'PRODUCT_STATUS', 'product', 'Color', 'Size', 'Qty']
        sales_records = [serialize_row(row, cols) for row in rows]
        
        cur.close()
        
        return jsonify({
            'success': True,
            'data': sales_records,
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total_records': total_count,
                'total_pages': (total_count + per_page - 1) // per_page
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error fetching sales data: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Export all matching sales data (no pagination limit)
@app.route('/api/sales/export', methods=['GET'])
@login_required
def export_sales_data():
    brand = request.args.get('brand', '').strip()
    status = request.args.get('status', '').strip()
    size = request.args.get('size', '').strip()
    search = request.args.get('search', '').strip()
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        query_parts = []
        query_params = []
        
        if brand:
            query_parts.append('"BRAND" = %s')
            query_params.append(brand)
            
        if status:
            query_parts.append('TRIM("PRODUCT STATUS") = %s')
            query_params.append(status)
            
        if size:
            query_parts.append('"Size" = %s')
            query_params.append(size)
            
        if search:
            search_clause = """(
                "BRAND" ILIKE %s OR 
                "PRODUCT DES" ILIKE %s OR 
                "product" ILIKE %s OR 
                "Color" ILIKE %s OR 
                "Size" ILIKE %s
            )"""
            query_parts.append(search_clause)
            search_term = f'%{search}%'
            query_params.extend([search_term] * 5)
            
        where_clause = ""
        if query_parts:
            where_clause = "WHERE " + " AND ".join(query_parts)
            
        select_query = f"""
            SELECT id, "MONTH", "BRAND", "PRODUCT DES", "PRODUCT TYPE", "PRODUCT STATUS", "product", "Color", "Size", "Qty"
            FROM sales_data
            {where_clause}
            ORDER BY "MONTH" DESC;
        """
        cur.execute(select_query, tuple(query_params))
        rows = cur.fetchall()
        
        cols = ['id', 'MONTH', 'BRAND', 'PRODUCT_DES', 'PRODUCT_TYPE', 'PRODUCT_STATUS', 'product', 'Color', 'Size', 'Qty']
        sales_records = [serialize_row(row, cols) for row in rows]
        cur.close()
        
        return jsonify({
            'success': True,
            'data': sales_records
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error exporting data: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# API to Update a Sales Record
@app.route('/api/sales/<int:record_id>', methods=['PUT'])
@login_required
def update_sales_record(record_id):
    data = request.json or {}
    
    month_str = data.get('MONTH', '').strip()
    brand = data.get('BRAND', '').strip()
    product_des = data.get('PRODUCT_DES', '').strip()
    product_type = data.get('PRODUCT_TYPE', '').strip()
    product_status = data.get('PRODUCT_STATUS', '').strip()
    product = data.get('product', '').strip()
    color = data.get('Color', '').strip()
    size = data.get('Size', '').strip()
    
    try:
        qty = int(data.get('Qty', 0))
        if qty < 0:
            return jsonify({'success': False, 'message': 'Quantity must be a positive integer.'}), 400
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Quantity must be a valid number.'}), 400

    if not brand or not product:
        return jsonify({'success': False, 'message': 'Brand and Product Code are required fields.'}), 400

    # Parse date
    try:
        if 'T' in month_str:
            month_date = datetime.fromisoformat(month_str.split('T')[0])
        else:
            month_date = datetime.strptime(month_str, '%Y-%m-%d')
    except Exception:
        month_date = datetime.now()

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if record exists
        cur.execute('SELECT id FROM sales_data WHERE id = %s;', (record_id,))
        if not cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': 'Record not found.'}), 404
            
        # Perform update
        update_query = """
            UPDATE sales_data
            SET "MONTH" = %s, "BRAND" = %s, "PRODUCT DES" = %s, "PRODUCT TYPE" = %s, 
                "PRODUCT STATUS" = %s, "product" = %s, "Color" = %s, "Size" = %s, "Qty" = %s
            WHERE id = %s;
        """
        cur.execute(update_query, (month_date, brand, product_des, product_type, product_status, product, color, size, qty, record_id))
        conn.commit()
        cur.close()
        
        return jsonify({'success': True, 'message': 'Sales record updated successfully!'})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# API to Delete a Sales Record
@app.route('/api/sales/<int:record_id>', methods=['DELETE'])
@login_required
def delete_sales_record(record_id):
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if record exists
        cur.execute('SELECT id FROM sales_data WHERE id = %s;', (record_id,))
        if not cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': 'Record not found.'}), 404
            
        cur.execute('DELETE FROM sales_data WHERE id = %s;', (record_id,))
        conn.commit()
        cur.close()
        
        return jsonify({'success': True, 'message': 'Sales record deleted successfully!'})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Helper to get the start and end dates from query parameters
def get_period_dates(start_month_str, end_month_str):
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        if not start_month_str:
            cur.execute('SELECT MIN("MONTH") FROM sales_data;')
            start_date = cur.fetchone()[0]
        else:
            start_date = datetime.strptime(start_month_str.split('T')[0], '%Y-%m-%d')
            
        if not end_month_str:
            cur.execute('SELECT MAX("MONTH") FROM sales_data;')
            end_date = cur.fetchone()[0]
        else:
            end_date = datetime.strptime(end_month_str.split('T')[0], '%Y-%m-%d')
            
        cur.close()
        return start_date, end_date
    except Exception:
        return datetime(2000, 1, 1), datetime(2100, 12, 31)
    finally:
        if conn:
            release_db_connection(conn)

# API to Get Distinct Sales Months (to populate filters)
@app.route('/api/sales/months', methods=['GET'])
@login_required
def get_sales_months():
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT DISTINCT "MONTH" FROM sales_data WHERE "MONTH" IS NOT NULL ORDER BY "MONTH" ASC;')
        months = [row[0].strftime('%Y-%m-%d') if row[0] else None for row in cur.fetchall()]
        cur.close()
        return jsonify({'success': True, 'months': [m for m in months if m]})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error fetching months: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Dynamic Filter Builder for Sales Contribution
def build_filtered_query(filters):
    clauses = []
    params = []
    
    # 1. Months range (if individual months list is not provided/empty)
    months = filters.get('months', [])
    if months:
        clauses.append('"MONTH"::date IN %s')
        params.append(tuple(months))
    else:
        start_month = filters.get('start_month', '').strip()
        end_month = filters.get('end_month', '').strip()
        if start_month or end_month:
            start_date, end_date = get_period_dates(start_month, end_month)
            clauses.append('"MONTH" >= %s')
            params.append(start_date)
            clauses.append('"MONTH" <= %s')
            params.append(end_date)
            
    # 2. Brands
    brands = filters.get('brands', [])
    if brands:
        clauses.append('"BRAND" IN %s')
        params.append(tuple(brands))
        
    # 3. Product Descriptions
    descriptions = filters.get('descriptions', [])
    if descriptions:
        clauses.append('"PRODUCT DES" IN %s')
        params.append(tuple(descriptions))
        
    # 4. Product Types
    types = filters.get('types', [])
    if types:
        clauses.append('"PRODUCT TYPE" IN %s')
        params.append(tuple(types))
        
    # 5. Product Statuses
    statuses = filters.get('statuses', [])
    if statuses:
        clauses.append('TRIM("PRODUCT STATUS") IN %s')
        params.append(tuple(statuses))
        
    # 6. Products
    products = filters.get('products', [])
    if products:
        clauses.append('"product" IN %s')
        params.append(tuple(products))
        
    # 7. Colors
    colors = filters.get('colors', [])
    if colors:
        clauses.append('"Color" IN %s')
        params.append(tuple(colors))
        
    # 8. Sizes
    sizes = filters.get('sizes', [])
    if sizes:
        clauses.append('"Size" IN %s')
        params.append(tuple(sizes))
        
    where_clause = ""
    if clauses:
        where_clause = "WHERE " + " AND ".join(clauses)
        
    return where_clause, params


# API: Product/Category Contribution
@app.route('/api/contribution/products', methods=['GET', 'POST'])
@login_required
def get_product_contribution():
    if request.method == 'POST':
        filters = request.json or {}
    else:
        filters = {
            'start_month': request.args.get('start_month', '').strip(),
            'end_month': request.args.get('end_month', '').strip(),
            'group_by': request.args.get('group_by', 'product').strip()
        }
        
    group_by = filters.get('group_by', 'product').strip().lower()
    where_clause, params = build_filtered_query(filters)
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute(f'SELECT SUM("Qty") FROM sales_data {where_clause};', tuple(params))
        total_qty = cur.fetchone()[0] or 0
        
        # Calculate overall total quantity for contribution base %
        cur.execute('SELECT SUM("Qty") FROM sales_data;')
        overall_qty = cur.fetchone()[0] or 1
        contrib_base = round((total_qty / overall_qty) * 100, 2)
        
        if total_qty == 0:
            cur.close()
            return jsonify({
                'success': True, 
                'products': [], 
                'total_qty': 0,
                'overall_qty': int(overall_qty),
                'contrib_base': 0.00
            })
            
        if group_by == 'brand':
            sql = f"""
                SELECT "BRAND", SUM("Qty") as brand_qty
                FROM sales_data
                {where_clause}
                GROUP BY "BRAND"
                ORDER BY brand_qty DESC;
            """
        elif group_by == 'description':
            sql = f"""
                SELECT "PRODUCT DES", SUM("Qty") as desc_qty
                FROM sales_data
                {where_clause}
                GROUP BY "PRODUCT DES"
                ORDER BY desc_qty DESC;
            """
        elif group_by == 'type':
            sql = f"""
                SELECT "PRODUCT TYPE", SUM("Qty") as type_qty
                FROM sales_data
                {where_clause}
                GROUP BY "PRODUCT TYPE"
                ORDER BY type_qty DESC;
            """
        else: # product
            sql = f"""
                SELECT "product", "PRODUCT DES", SUM("Qty") as prod_qty
                FROM sales_data
                {where_clause}
                GROUP BY "product", "PRODUCT DES"
                ORDER BY prod_qty DESC;
            """
            
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        cur.close()
        
        serialized_items = []
        for r in rows:
            val = r[0] or 'Unknown'
            if group_by == 'product':
                desc = r[1] or 'Unknown'
                qty = int(r[2] or 0)
            else:
                desc = ''
                qty = int(r[1] or 0)
                
            contrib_pct = round((qty / total_qty) * 100, 2)
            
            item = {
                'qty': qty,
                'percentage': contrib_pct
            }
            if group_by == 'product':
                item['product'] = val
                item['description'] = desc
            elif group_by == 'brand':
                item['brand'] = val
            elif group_by == 'description':
                item['description'] = val
            elif group_by == 'type':
                item['type'] = val
                
            serialized_items.append(item)
            
        return jsonify({
            'success': True,
            'total_qty': int(total_qty),
            'overall_qty': int(overall_qty),
            'contrib_base': contrib_base,
            'products': serialized_items # Returned under key 'products' for UI compatibility
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)


# API: Color Contribution
@app.route('/api/contribution/colors', methods=['GET', 'POST'])
@login_required
def get_color_contribution():
    if request.method == 'POST':
        filters = request.json or {}
    else:
        product_code = request.args.get('product', '').strip()
        filters = {
            'products': [product_code] if product_code else [],
            'start_month': request.args.get('start_month', '').strip(),
            'end_month': request.args.get('end_month', '').strip()
        }
        
    where_clause, params = build_filtered_query(filters)
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute(f'SELECT SUM("Qty") FROM sales_data {where_clause};', tuple(params))
        total_qty = cur.fetchone()[0] or 0
        
        if total_qty == 0:
            cur.close()
            return jsonify({'success': True, 'colors': [], 'total_qty': 0})
            
        cur.execute(f"""
            SELECT "Color", SUM("Qty") as color_qty
            FROM sales_data
            {where_clause}
            GROUP BY "Color"
            ORDER BY color_qty DESC;
        """, tuple(params))
        rows = cur.fetchall()
        cur.close()
        
        colors = []
        for r in rows:
            color = r[0] or 'Unknown'
            c_qty = int(r[1] or 0)
            contrib_pct = round((c_qty / total_qty) * 100, 2)
            colors.append({
                'color': color,
                'qty': c_qty,
                'percentage': contrib_pct
            })
            
        return jsonify({
            'success': True,
            'total_qty': int(total_qty),
            'colors': colors
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)


# API: Size Contribution
@app.route('/api/contribution/sizes', methods=['GET', 'POST'])
@login_required
def get_size_contribution():
    if request.method == 'POST':
        filters = request.json or {}
    else:
        product_code = request.args.get('product', '').strip()
        color = request.args.get('color', '').strip()
        filters = {
            'products': [product_code] if product_code else [],
            'colors': [color] if color else [],
            'start_month': request.args.get('start_month', '').strip(),
            'end_month': request.args.get('end_month', '').strip()
        }
        
    where_clause, params = build_filtered_query(filters)
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute(f'SELECT SUM("Qty") FROM sales_data {where_clause};', tuple(params))
        total_qty = cur.fetchone()[0] or 0
        
        if total_qty == 0:
            cur.close()
            return jsonify({'success': True, 'sizes': [], 'total_qty': 0})
            
        cur.execute(f"""
            SELECT "Size", SUM("Qty") as size_qty
            FROM sales_data
            {where_clause}
            GROUP BY "Size"
            ORDER BY size_qty DESC;
        """, tuple(params))
        rows = cur.fetchall()
        cur.close()
        
        sizes = []
        for r in rows:
            size_name = r[0] or 'Unknown'
            s_qty = int(r[1] or 0)
            contrib_pct = round((s_qty / total_qty) * 100, 2)
            sizes.append({
                'size': size_name,
                'qty': s_qty,
                'percentage': contrib_pct
            })
            
        return jsonify({
            'success': True,
            'total_qty': int(total_qty),
            'sizes': sizes
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)


# API: Get Distinct Filter Options for Advanced Filter Panel
@app.route('/api/contribution/filter-options', methods=['GET'])
@login_required
def get_contribution_filter_options():
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 1. Brands
        cur.execute('SELECT DISTINCT "BRAND" FROM sales_data WHERE "BRAND" IS NOT NULL ORDER BY "BRAND";')
        brands = [row[0] for row in cur.fetchall()]
        
        # 2. Product Descriptions
        cur.execute('SELECT DISTINCT "PRODUCT DES" FROM sales_data WHERE "PRODUCT DES" IS NOT NULL ORDER BY "PRODUCT DES";')
        descriptions = [row[0] for row in cur.fetchall()]
        
        # 3. Product Types
        cur.execute('SELECT DISTINCT "PRODUCT TYPE" FROM sales_data WHERE "PRODUCT TYPE" IS NOT NULL ORDER BY "PRODUCT TYPE";')
        types = [row[0] for row in cur.fetchall()]
        
        # 4. Product Statuses
        cur.execute('SELECT DISTINCT TRIM("PRODUCT STATUS") FROM sales_data WHERE "PRODUCT STATUS" IS NOT NULL ORDER BY 1;')
        statuses = [row[0] for row in cur.fetchall()]
        
        # 5. Products (Product codes)
        cur.execute('SELECT DISTINCT "product" FROM sales_data WHERE "product" IS NOT NULL ORDER BY "product";')
        products = [row[0] for row in cur.fetchall()]
        
        # 6. Colors
        cur.execute('SELECT DISTINCT "Color" FROM sales_data WHERE "Color" IS NOT NULL ORDER BY "Color";')
        colors = [row[0] for row in cur.fetchall()]
        
        # 7. Sizes
        cur.execute('SELECT DISTINCT "Size" FROM sales_data WHERE "Size" IS NOT NULL ORDER BY "Size";')
        sizes = [row[0] for row in cur.fetchall()]
        
        # 8. Months (formatted YYYY-MM-DD)
        cur.execute('SELECT DISTINCT "MONTH" FROM sales_data WHERE "MONTH" IS NOT NULL ORDER BY "MONTH" ASC;')
        months = [row[0].strftime('%Y-%m-%d') if hasattr(row[0], 'strftime') else str(row[0]) for row in cur.fetchall()]
        
        cur.close()
        
        return jsonify({
            'success': True,
            'brands': brands,
            'descriptions': descriptions,
            'types': types,
            'statuses': statuses,
            'products': products,
            'colors': colors,
            'sizes': sizes,
            'months': months
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)


# =====================================================================
# OVERALL FUTURE QUANTITY PLANNING API ENDPOINTS
# =====================================================================

@app.route('/api/planning/historical', methods=['GET'])
@login_required
def get_historical_planning_data():
    fy = request.args.get('fy', '').strip()
    method = request.args.get('method', 'single').strip() # single or average
    
    if not fy:
        return jsonify({'success': False, 'message': 'Financial year (fy) is required.'}), 400
        
    import re
    match = re.search(r'(\d{4})', fy)
    if not match:
        match2 = re.search(r'(\d{2})', fy)
        if match2:
            start_year = 2000 + int(match2.group(1))
        else:
            start_year = datetime.now().year
    else:
        start_year = int(match.group(1))
        
    prior_start = start_year - 1
    month_list = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March']
    month_names = {
        4: 'April', 5: 'May', 6: 'June', 7: 'July', 8: 'August', 9: 'September',
        10: 'October', 11: 'November', 12: 'December', 1: 'January', 2: 'February', 3: 'March'
    }
    
    if method == 'average':
        years_to_average = [prior_start, prior_start - 1, prior_start - 2]
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            totals = {m: [] for m in month_list}
            for y in years_to_average:
                start_date = f"{y}-04-01"
                end_date = f"{y+1}-04-01"
                cur.execute("""
                    SELECT EXTRACT(MONTH FROM "MONTH") as mon, SUM("Qty")
                    FROM sales_data
                    WHERE "MONTH" >= %s AND "MONTH" < %s
                    GROUP BY mon;
                """, (start_date, end_date))
                rows = cur.fetchall()
                
                for r in rows:
                    mon_num = int(r[0])
                    qty = int(r[1] or 0)
                    m_name = month_names.get(mon_num)
                    if m_name:
                        totals[m_name].append(qty)
            
            result = {}
            for m in month_list:
                vals = totals[m]
                if vals:
                    result[m] = int(sum(vals) / len(vals))
                else:
                    result[m] = 0
            
            cur.close()
            return jsonify({'success': True, 'quantities': result, 'source_years': [f"FY {y}-{str(y+1)[2:]}" for y in years_to_average]})
        except Exception as e:
            return jsonify({'success': False, 'message': f'Error fetching average: {str(e)}'}), 500
        finally:
            if conn:
                release_db_connection(conn)
    else:
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            start_date = f"{prior_start}-04-01"
            end_date = f"{prior_start+1}-04-01"
            
            cur.execute("""
                SELECT EXTRACT(MONTH FROM "MONTH") as mon, SUM("Qty") as total_qty
                FROM sales_data
                WHERE "MONTH" >= %s AND "MONTH" < %s
                GROUP BY mon;
            """, (start_date, end_date))
            
            rows = cur.fetchall()
            cur.close()
            
            qty_map = {name: 0 for name in month_list}
            for r in rows:
                mon_num = int(r[0])
                qty = int(r[1] or 0)
                m_name = month_names.get(mon_num)
                if m_name:
                    qty_map[m_name] = qty
                    
            return jsonify({
                'success': True,
                'quantities': qty_map,
                'source_year': f"FY {prior_start}-{str(prior_start+1)[2:]}"
            })
        except Exception as e:
            return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
        finally:
            if conn:
                release_db_connection(conn)

@app.route('/api/planning/plans', methods=['GET'])
@login_required
def get_plans():
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, plan_name, financial_year, planning_method, status, version, remarks, created_by, created_date, modified_date
            FROM planning_headers
            WHERE is_latest = TRUE
            ORDER BY modified_date DESC;
        """)
        rows = cur.fetchall()
        cols = ['id', 'plan_name', 'financial_year', 'planning_method', 'status', 'version', 'remarks', 'created_by', 'created_date', 'modified_date']
        plans = [serialize_row(row, cols) for row in rows]
        cur.close()
        return jsonify({'success': True, 'plans': plans})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

def sync_plan_actual_sales(cur, plan_id, financial_year):
    """
    Synchronizes actual sales from sales_data for elapsed/completed months
    for the given plan_id and financial_year.
    """
    import re
    match = re.search(r'(\d{4})', financial_year or '')
    if match:
        start_year = int(match.group(1))
    else:
        match2 = re.search(r'(\d{2})', financial_year or '')
        start_year = 2000 + int(match2.group(1)) if match2 else datetime.now().year

    month_map = {
        'April': (start_year, 4),
        'May': (start_year, 5),
        'June': (start_year, 6),
        'July': (start_year, 7),
        'August': (start_year, 8),
        'September': (start_year, 9),
        'October': (start_year, 10),
        'November': (start_year, 11),
        'December': (start_year, 12),
        'January': (start_year + 1, 1),
        'February': (start_year + 1, 2),
        'March': (start_year + 1, 3)
    }
    
    now = datetime.now()
    
    cur.execute("""
        SELECT id, month, last_year_qty
        FROM planning_details
        WHERE planning_id = %s;
    """, (plan_id,))
    rows = cur.fetchall()
    
    for row_id, month, last_year_qty in rows:
        if month not in month_map:
            continue
        y_val, m_val = month_map[month]
        is_elapsed = (y_val < now.year) or (y_val == now.year and m_val < now.month)
        
        if is_elapsed:
            cur.execute("""
                SELECT SUM("Qty") FROM sales_data
                WHERE EXTRACT(YEAR FROM "MONTH") = %s AND EXTRACT(MONTH FROM "MONTH") = %s;
            """, (y_val, m_val))
            actual_val = cur.fetchone()[0]
            actual_qty = int(actual_val or 0)
            ly_qty = int(last_year_qty or 0)
            growth = round(((actual_qty - ly_qty) / ly_qty) * 100, 2) if ly_qty > 0 else 0.00
            
            cur.execute("""
                UPDATE planning_details
                SET final_qty = %s, growth_percent = %s, locked = TRUE, remarks = 'Actual sales loaded (locked)'
                WHERE id = %s;
            """, (actual_qty, growth, row_id))

@app.route('/api/planning/plans/<int:plan_id>', methods=['GET'])
@login_required
def get_plan_details(plan_id):
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT id, plan_name, financial_year, planning_method, status, version, remarks, created_by, created_date, modified_date
            FROM planning_headers
            WHERE id = %s;
        """, (plan_id,))
        header_row = cur.fetchone()
        if not header_row:
            cur.close()
            return jsonify({'success': False, 'message': 'Plan not found.'}), 404
            
        cols = ['id', 'plan_name', 'financial_year', 'planning_method', 'status', 'version', 'remarks', 'created_by', 'created_date', 'modified_date']
        header = serialize_row(header_row, cols)
        
        # Synchronize elapsed months with the latest actual sales from sales_data
        sync_plan_actual_sales(cur, plan_id, header['financial_year'])
        conn.commit()
        
        cur.execute("""
            SELECT id, month, last_year_qty, growth_percent, sales_target, average_sale_value, calculated_qty, manual_adjustment, festival_qty, new_store_qty, final_qty, remarks, locked
            FROM planning_details
            WHERE planning_id = %s
            ORDER BY 
                CASE month
                    WHEN 'April' THEN 1
                    WHEN 'May' THEN 2
                    WHEN 'June' THEN 3
                    WHEN 'July' THEN 4
                    WHEN 'August' THEN 5
                    WHEN 'September' THEN 6
                    WHEN 'October' THEN 7
                    WHEN 'November' THEN 8
                    WHEN 'December' THEN 9
                    WHEN 'January' THEN 10
                    WHEN 'February' THEN 11
                    WHEN 'March' THEN 12
                    ELSE 13
                END;
        """, (plan_id,))
        detail_rows = cur.fetchall()
        detail_cols = ['id', 'month', 'last_year_qty', 'growth_percent', 'sales_target', 'average_sale_value', 'calculated_qty', 'manual_adjustment', 'festival_qty', 'new_store_qty', 'final_qty', 'remarks', 'locked']
        details = [serialize_row(row, detail_cols) for row in detail_rows]
        
        cur.execute("""
            SELECT id, version, status, modified_date, created_by, remarks
            FROM planning_headers
            WHERE plan_name = %s AND financial_year = %s
            ORDER BY version DESC;
        """, (header['plan_name'], header['financial_year']))
        history_rows = cur.fetchall()
        history = [{'id': r[0], 'version': r[1], 'status': r[2], 'modified_date': r[3].isoformat() if r[3] else None, 'created_by': r[4], 'remarks': r[5]} for r in history_rows]
        
        cur.close()
        return jsonify({
            'success': True,
            'plan': header,
            'details': details,
            'versions': history
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/planning/plans', methods=['POST'])
@login_required
def create_plan():
    data = request.json or {}
    plan_name = data.get('plan_name', '').strip()
    financial_year = data.get('financial_year', '').strip()
    planning_method = data.get('planning_method', '').strip()
    remarks = data.get('remarks', '').strip()
    username = session.get('username', 'Admin')
    
    if not plan_name or not financial_year or not planning_method:
        return jsonify({'success': False, 'message': 'Plan Name, Financial Year, and Planning Method are required.'}), 400
        
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT id FROM planning_headers 
            WHERE plan_name = %s AND financial_year = %s AND is_latest = TRUE;
        """, (plan_name, financial_year))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': 'A plan with this name and financial year already exists.'}), 400
            
        cur.execute("""
            INSERT INTO planning_headers (plan_name, financial_year, planning_method, status, version, remarks, created_by)
            VALUES (%s, %s, %s, 'Draft', 1, %s, %s)
            RETURNING id;
        """, (plan_name, financial_year, planning_method, remarks, username))
        new_plan_id = cur.fetchone()[0]
        
        import re
        match = re.search(r'(\d{4})', financial_year)
        if match:
            start_year = int(match.group(1))
        else:
            match2 = re.search(r'(\d{2})', financial_year)
            start_year = 2000 + int(match2.group(1)) if match2 else datetime.now().year
            
        prior_start = start_year - 1
        
        cur.execute("""
            SELECT EXTRACT(MONTH FROM "MONTH") as mon, SUM("Qty")
            FROM sales_data
            WHERE "MONTH" >= %s AND "MONTH" < %s
            GROUP BY mon;
        """, (f"{prior_start}-04-01", f"{prior_start+1}-04-01"))
        rows = cur.fetchall()
        month_names = {
            4: 'April', 5: 'May', 6: 'June', 7: 'July', 8: 'August', 9: 'September',
            10: 'October', 11: 'November', 12: 'December', 1: 'January', 2: 'February', 3: 'March'
        }
        hist_qty = {m: 0 for m in month_names.values()}
        for r in rows:
            mon_num = int(r[0])
            qty = int(r[1] or 0)
            m_name = month_names.get(mon_num)
            if m_name:
                hist_qty[m_name] = qty
                
        months = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March']
        month_map = {
            'April': (start_year, 4),
            'May': (start_year, 5),
            'June': (start_year, 6),
            'July': (start_year, 7),
            'August': (start_year, 8),
            'September': (start_year, 9),
            'October': (start_year, 10),
            'November': (start_year, 11),
            'December': (start_year, 12),
            'January': (start_year + 1, 1),
            'February': (start_year + 1, 2),
            'March': (start_year + 1, 3)
        }
        
        now = datetime.now()
        
        for m in months:
            l_qty = hist_qty.get(m, 0)
            y_val, m_val = month_map[m]
            
            # Check if this month is completed/elapsed (strictly in the past)
            is_elapsed = (y_val < now.year) or (y_val == now.year and m_val < now.month)
            
            if is_elapsed:
                # Fetch actual sales from database for this month
                cur.execute("""
                    SELECT SUM("Qty") FROM sales_data
                    WHERE EXTRACT(YEAR FROM "MONTH") = %s AND EXTRACT(MONTH FROM "MONTH") = %s;
                """, (y_val, m_val))
                actual_val = cur.fetchone()[0]
                actual_qty = int(actual_val or 0)
                
                final_qty = actual_qty
                # Compute actual growth % relative to last year's quantity
                growth_percent = round(((final_qty - l_qty) / l_qty) * 100, 2) if l_qty > 0 else 0.00
                locked = True
                remarks = "Actual sales loaded (locked)"
            else:
                final_qty = l_qty if planning_method == 'Method 1' else 0
                growth_percent = 0.00
                locked = False
                remarks = ""
                
            cur.execute("""
                INSERT INTO planning_details (planning_id, month, last_year_qty, growth_percent, sales_target, average_sale_value, calculated_qty, manual_adjustment, festival_qty, new_store_qty, final_qty, remarks, locked)
                VALUES (%s, %s, %s, %s, 0.00, 0.00, 0, 0, 0, 0, %s, %s, %s);
            """, (new_plan_id, m, l_qty, growth_percent, final_qty, remarks, locked))
            
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Planning scenario created successfully!', 'plan_id': new_plan_id})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/planning/plans/<int:plan_id>', methods=['PUT'])
@login_required
def save_plan_details(plan_id):
    data = request.json or {}
    details = data.get('details', [])
    header_update = data.get('header', {})
    
    username = session.get('username', 'Admin')
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT plan_name, financial_year, planning_method, status, version, remarks, created_by, created_date
            FROM planning_headers
            WHERE id = %s;
        """, (plan_id,))
        plan = cur.fetchone()
        if not plan:
            cur.close()
            return jsonify({'success': False, 'message': 'Plan not found.'}), 404
            
        plan_name, financial_year, planning_method, status, version, remarks, created_by, created_date = plan
        
        new_version = version + 1
        new_remarks = header_update.get('remarks', remarks)
        new_status = header_update.get('status', status)
        new_method = header_update.get('planning_method', planning_method)
        new_name = header_update.get('plan_name', plan_name)
        
        cur.execute("""
            UPDATE planning_headers
            SET is_latest = FALSE
            WHERE plan_name = %s AND financial_year = %s;
        """, (plan_name, financial_year))
        
        cur.execute("""
            INSERT INTO planning_headers (plan_name, financial_year, planning_method, status, version, remarks, created_by, created_date, modified_date, is_latest)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, TRUE)
            RETURNING id;
        """, (new_name, financial_year, new_method, new_status, new_version, new_remarks, username, created_date))
        new_plan_id = cur.fetchone()[0]
        
        for d in details:
            cur.execute("""
                INSERT INTO planning_details (planning_id, month, last_year_qty, growth_percent, sales_target, average_sale_value, calculated_qty, manual_adjustment, festival_qty, new_store_qty, final_qty, remarks, locked)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
            """, (
                new_plan_id,
                d.get('month'),
                int(d.get('last_year_qty', 0)),
                float(d.get('growth_percent', 0)),
                float(d.get('sales_target', 0)),
                float(d.get('average_sale_value', 0)),
                int(d.get('calculated_qty', 0)),
                int(d.get('manual_adjustment', 0)),
                int(d.get('festival_qty', 0)),
                int(d.get('new_store_qty', 0)),
                int(d.get('final_qty', 0)),
                d.get('remarks', ''),
                bool(d.get('locked', False))
            ))
            
        sync_plan_actual_sales(cur, new_plan_id, financial_year)
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Plan saved as a new version successfully!', 'plan_id': new_plan_id, 'version': new_version})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/planning/plans/<int:plan_id>/copy', methods=['POST'])
@login_required
def copy_plan(plan_id):
    data = request.json or {}
    new_name = data.get('plan_name', '').strip()
    financial_year = data.get('financial_year', '').strip()
    username = session.get('username', 'Admin')
    
    if not new_name:
        return jsonify({'success': False, 'message': 'New Plan Name is required.'}), 400
        
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("SELECT plan_name, financial_year, planning_method, remarks FROM planning_headers WHERE id = %s;", (plan_id,))
        source = cur.fetchone()
        if not source:
            cur.close()
            return jsonify({'success': False, 'message': 'Source plan not found.'}), 404
            
        src_name, src_fy, src_method, src_remarks = source
        target_fy = financial_year if financial_year else src_fy
        
        cur.execute("SELECT id FROM planning_headers WHERE plan_name = %s AND financial_year = %s AND is_latest = TRUE;", (new_name, target_fy))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': f"A plan with the name '{new_name}' already exists for {target_fy}."}), 400
            
        cur.execute("""
            INSERT INTO planning_headers (plan_name, financial_year, planning_method, status, version, remarks, created_by)
            VALUES (%s, %s, %s, 'Draft', 1, %s, %s)
            RETURNING id;
        """, (new_name, target_fy, src_method, f"Copy of {src_name}. {src_remarks}", username))
        new_plan_id = cur.fetchone()[0]
        
        cur.execute("""
            INSERT INTO planning_details (planning_id, month, last_year_qty, growth_percent, sales_target, average_sale_value, calculated_qty, manual_adjustment, festival_qty, new_store_qty, final_qty, remarks, locked)
            SELECT %s, month, last_year_qty, growth_percent, sales_target, average_sale_value, calculated_qty, manual_adjustment, festival_qty, new_store_qty, final_qty, remarks, locked
            FROM planning_details
            WHERE planning_id = %s;
        """, (new_plan_id, plan_id))
        
        sync_plan_actual_sales(cur, new_plan_id, target_fy)
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Plan scenario copied successfully!', 'plan_id': new_plan_id})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/planning/plans/<int:plan_id>', methods=['DELETE'])
@login_required
def delete_plan(plan_id):
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("SELECT plan_name, financial_year FROM planning_headers WHERE id = %s;", (plan_id,))
        plan = cur.fetchone()
        if not plan:
            cur.close()
            return jsonify({'success': False, 'message': 'Plan not found.'}), 404
            
        plan_name, financial_year = plan
        
        cur.execute("DELETE FROM planning_headers WHERE plan_name = %s AND financial_year = %s;", (plan_name, financial_year))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f"All versions of plan '{plan_name}' deleted successfully!"})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/planning/plans/<int:plan_id>/final', methods=['PUT'])
@login_required
def set_plan_final(plan_id):
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("SELECT plan_name, financial_year, version FROM planning_headers WHERE id = %s;", (plan_id,))
        plan = cur.fetchone()
        if not plan:
            cur.close()
            return jsonify({'success': False, 'message': 'Plan not found.'}), 404
            
        plan_name, financial_year, version = plan
        
        cur.execute("""
            UPDATE planning_headers
            SET status = 'Draft'
            WHERE financial_year = %s AND plan_name != %s AND is_latest = TRUE;
        """, (financial_year, plan_name))
        
        # Set all versions of this specific plan to Draft first, then this specific version to Final
        cur.execute("""
            UPDATE planning_headers
            SET status = 'Draft'
            WHERE plan_name = %s AND financial_year = %s;
        """, (plan_name, financial_year))
        
        cur.execute("""
            UPDATE planning_headers
            SET status = 'Final'
            WHERE id = %s;
        """, (plan_id,))
        
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f"Plan '{plan_name}' (v{version}) set as the Final Plan for {financial_year}!"})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Color Master CRUD APIs
@app.route('/api/masters/colors', methods=['GET', 'POST'])
@login_required
def colors_api():
    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        category = request.args.get('category', '').strip()
        status = request.args.get('status', '').strip()
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        query = "SELECT id, global_color_code, display_color, category, status FROM color_master WHERE 1=1"
        params = []
        
        if search:
            query += " AND (global_color_code ILIKE %s OR display_color ILIKE %s)"
            params.extend([f'%{search}%', f'%{search}%'])
        if category:
            query += " AND category = %s"
            params.append(category)
        if status:
            query += " AND status = %s"
            params.append(status)
            
        query += " ORDER BY id DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        release_db_connection(conn)
        colors = [{'id': r[0], 'global_color_code': r[1], 'display_color': r[2], 'category': r[3], 'status': r[4]} for r in rows]
        return jsonify({'success': True, 'colors': colors})
        
    elif request.method == 'POST':
        data = request.json or {}
        global_code = data.get('global_color_code', '').strip().upper()
        display = data.get('display_color', '').strip().upper()
        category = data.get('category', '').strip()
        status = data.get('status', 'Active').strip()
        
        if not global_code or not display or not category:
            return jsonify({'success': False, 'message': 'Global Color Code, Display Color, and Category are required.'}), 400
            
        if category not in ['Primary', 'Secondary']:
            return jsonify({'success': False, 'message': 'Category must be either Primary or Secondary.'}), 400
            
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            # Check unique Global Color Code + Category
            cur.execute("SELECT id FROM color_master WHERE global_color_code = %s AND category = %s", (global_code, category))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Global Color Code '{global_code}' already has a '{category}' record."}), 400
                
            cur.execute("INSERT INTO color_master (global_color_code, display_color, category, status) VALUES (%s, %s, %s, %s)", (global_code, display, category, status))
            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Color added successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error adding color: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/colors/<int:id>', methods=['PUT'])
@login_required
def update_color(id):
    data = request.json or {}
    global_code = data.get('global_color_code', '').strip().upper()
    display = data.get('display_color', '').strip().upper()
    category = data.get('category', '').strip()
    status = data.get('status', 'Active').strip()
    
    if not global_code or not display or not category:
        return jsonify({'success': False, 'message': 'Global Color Code, Display Color, and Category are required.'}), 400
        
    if category not in ['Primary', 'Secondary']:
        return jsonify({'success': False, 'message': 'Category must be either Primary or Secondary.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Check unique Global Color Code + Category on other rows
        cur.execute("SELECT id FROM color_master WHERE global_color_code = %s AND category = %s AND id != %s", (global_code, category, id))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': f"Global Color Code '{global_code}' already has a '{category}' record."}), 400

        cur.execute("""
            UPDATE color_master 
            SET global_color_code = %s, display_color = %s, category = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s
        """, (global_code, display, category, status, id))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Color updated successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error updating color: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/colors/<int:id>', methods=['DELETE'])
@login_required
def delete_color(id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM color_master WHERE id = %s", (id,))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Color deleted successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error deleting color: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/colors/bulk', methods=['POST'])
@login_required
def bulk_add_colors():
    data = request.json or {}
    colors = data.get('colors', [])
    if not colors:
        return jsonify({'success': False, 'message': 'No colors list provided.'}), 400
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for c in colors:
            global_code = c.get('global_color_code', '').strip().upper()
            display = c.get('display_color', '').strip().upper()
            category = c.get('category', 'Primary').strip()
            # Title case category
            if category.lower() == 'primary':
                category = 'Primary'
            elif category.lower() == 'secondary':
                category = 'Secondary'
            else:
                category = 'Primary'
            status = c.get('status', 'Active').strip()
            if global_code and display:
                # Match solely by (global_color_code, category)
                cur.execute("SELECT id FROM color_master WHERE global_color_code = %s AND category = %s", (global_code, category))
                existing = cur.fetchone()
                if existing:
                    cur.execute("""
                        UPDATE color_master 
                        SET display_color = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = %s
                    """, (display, status, existing[0]))
                else:
                    cur.execute("""
                        INSERT INTO color_master (global_color_code, display_color, category, status) 
                        VALUES (%s, %s, %s, %s)
                    """, (global_code, display, category, status))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f'Successfully imported {len(colors)} colors.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error importing colors: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


# Size Master CRUD APIs
# Size Master CRUD APIs
@app.route('/api/masters/sizes', methods=['GET', 'POST'])
@login_required
def sizes_api():
    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        conn = get_db_connection()
        cur = conn.cursor()
        if search:
            cur.execute("""
                SELECT id, size_code, size, status 
                FROM size_master 
                WHERE size_code ILIKE %s OR size ILIKE %s 
                ORDER BY id DESC
            """, (f'%{search}%', f'%{search}%'))
        else:
            cur.execute("SELECT id, size_code, size, status FROM size_master ORDER BY id DESC")
        rows = cur.fetchall()
        cur.close()
        release_db_connection(conn)
        sizes = [{'id': r[0], 'size_code': r[1], 'size': r[2], 'status': r[3]} for r in rows]
        return jsonify({'success': True, 'sizes': sizes})
        
    elif request.method == 'POST':
        data = request.json or {}
        code = data.get('size_code', '').strip().upper()
        size = data.get('size', '').strip()
        status = data.get('status', 'Active').strip()
        
        if not code or not size:
            return jsonify({'success': False, 'message': 'Size Code and Size Name are required.'}), 400
            
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO size_master (size_code, size, status) VALUES (%s, %s, %s)", (code, size, status))
            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Size added successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error adding size: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/sizes/<int:id>', methods=['PUT'])
@login_required
def update_size(id):
    data = request.json or {}
    code = data.get('size_code', '').strip().upper()
    size = data.get('size', '').strip()
    status = data.get('status', 'Active').strip()
    
    if not code or not size:
        return jsonify({'success': False, 'message': 'Size Code and Size Name are required.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE size_master SET size_code = %s, size = %s, status = %s WHERE id = %s", (code, size, status, id))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Size updated successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error updating size: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/sizes/<int:id>', methods=['DELETE'])
@login_required
def delete_size(id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM size_master WHERE id = %s", (id,))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Size deleted successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error deleting size: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/sizes/bulk', methods=['POST'])
@login_required
def bulk_add_sizes():
    data = request.json or {}
    sizes = data.get('sizes', [])
    if not sizes:
        return jsonify({'success': False, 'message': 'No sizes list provided.'}), 400
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for s in sizes:
            code = s.get('size_code', '').strip().upper()
            size = s.get('size', '').strip()
            status = s.get('status', 'Active').strip()
            if code and size:
                cur.execute("""
                    INSERT INTO size_master (size_code, size, status) 
                    VALUES (%s, %s, %s)
                    ON CONFLICT (size_code) DO UPDATE 
                    SET size = EXCLUDED.size, status = EXCLUDED.status
                """, (code, size, status))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f'Successfully imported {len(sizes)} sizes.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error importing sizes: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


# Fabric Master CRUD APIs
@app.route('/api/masters/fabrics', methods=['GET', 'POST'])
@login_required
def fabrics_api():
    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        uom = request.args.get('uom', '').strip()
        gsm = request.args.get('gsm', '').strip()
        dia = request.args.get('dia', '').strip()
        status = request.args.get('status', '').strip()

        conn = get_db_connection()
        cur = conn.cursor()

        query = """
            SELECT id, fabric_name, uom, gsm, status, created_at, updated_at 
            FROM fabric_master 
            WHERE 1=1
        """
        params = []

        if search:
            query += " AND fabric_name ILIKE %s"
            params.append(f'%{search}%')
        if uom:
            query += " AND uom = %s"
            params.append(uom)
        if gsm:
            try:
                gsm_val = float(gsm)
                query += " AND gsm = %s"
                params.append(gsm_val)
            except ValueError:
                pass
        if dia:
            try:
                dia_val = float(dia)
                query += " AND EXISTS (SELECT 1 FROM fabric_dia_mapping WHERE fabric_id = fabric_master.id AND dia = %s)"
                params.append(dia_val)
            except ValueError:
                pass
        if status:
            query += " AND status = %s"
            params.append(status)

        query += " ORDER BY id DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()

        fabrics = []
        if rows:
            fabric_ids = [r[0] for r in rows]

            # 1. Batch fetch assigned colors for all retrieved fabric IDs
            cur.execute("""
                SELECT fabric_id, global_color_code, display_color, category 
                FROM fabric_color_mapping 
                WHERE fabric_id = ANY(%s)
                ORDER BY id ASC;
            """, (fabric_ids,))
            colors_by_fabric = {}
            for cr in cur.fetchall():
                f_id_c = cr[0]
                if f_id_c not in colors_by_fabric:
                    colors_by_fabric[f_id_c] = []
                colors_by_fabric[f_id_c].append({
                    'global_color_code': cr[1],
                    'display_color': cr[2],
                    'category': cr[3]
                })

            # 2. Batch fetch assigned DIAs for all retrieved fabric IDs
            cur.execute("""
                SELECT fabric_id, dia 
                FROM fabric_dia_mapping 
                WHERE fabric_id = ANY(%s) 
                ORDER BY dia ASC;
            """, (fabric_ids,))
            dias_by_fabric = {}
            for dr in cur.fetchall():
                f_id_d = dr[0]
                if f_id_d not in dias_by_fabric:
                    dias_by_fabric[f_id_d] = []
                dias_by_fabric[f_id_d].append(float(dr[1]))

            for r in rows:
                f_id = r[0]
                fabrics.append({
                    'id': f_id,
                    'fabric_name': r[1],
                    'uom': r[2],
                    'gsm': float(r[3]),
                    'status': r[4],
                    'created_at': r[5].isoformat() if r[5] else None,
                    'updated_at': r[6].isoformat() if r[6] else None,
                    'colors': colors_by_fabric.get(f_id, []),
                    'dias': dias_by_fabric.get(f_id, [])
                })

        cur.close()
        release_db_connection(conn)
        return jsonify({'success': True, 'fabrics': fabrics})

    elif request.method == 'POST':
        data = request.json or {}
        name = data.get('fabric_name', '').strip()
        uom = data.get('uom', '').strip()
        gsm_str = str(data.get('gsm', '')).strip()
        dias_input = data.get('dias', [])  # list of numeric DIA values
        colors = data.get('colors', [])
        status = data.get('status', 'Active').strip()

        if not name or not uom or not gsm_str:
            return jsonify({'success': False, 'message': 'Fabric Name, UOM, and GSM are required.'}), 400

        try:
            gsm = float(gsm_str)
        except ValueError:
            return jsonify({'success': False, 'message': 'GSM must be a numeric value.'}), 400

        if gsm <= 0:
            return jsonify({'success': False, 'message': 'GSM must be greater than zero.'}), 400

        if uom.upper() not in ['KGS', 'MTR']:
            return jsonify({'success': False, 'message': 'UOM must be either KGS or MTR.'}), 400

        # Validate DIA input (at least one)
        if not dias_input:
            return jsonify({'success': False, 'message': 'At least one DIA must be selected.'}), 400

        dias = []
        for d in dias_input:
            try:
                val = float(d)
                if val <= 0:
                    return jsonify({'success': False, 'message': 'DIA values must be greater than zero.'}), 400
                dias.append(val)
            except (ValueError, TypeError):
                return jsonify({'success': False, 'message': 'DIA values must be numeric.'}), 400

        # Unique distinct list
        dias = list(set(dias))

        # Validate colors
        if not colors:
            return jsonify({'success': False, 'message': 'At least one Primary Color must be selected.'}), 400

        conn = get_db_connection()
        cur = conn.cursor()
        try:
            # Check fabric uniqueness
            cur.execute("SELECT id FROM fabric_master WHERE fabric_name = %s", (name,))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Fabric Name '{name}' already exists."}), 400

            # Verify active primary colors
            verified_colors = []
            for c_val in colors:
                code_val = (c_val.get('global_color_code', '') or c_val.get('display_color', '')) if isinstance(c_val, dict) else str(c_val).strip()
                cur.execute("""
                    SELECT global_color_code, display_color 
                    FROM color_master 
                    WHERE global_color_code = %s AND category = 'Primary' AND status = 'Active'
                """, (code_val,))
                col_row = cur.fetchone()
                if not col_row:
                    cur.execute("""
                        SELECT global_color_code, display_color 
                        FROM color_master 
                        WHERE display_color = %s AND category = 'Primary' AND status = 'Active'
                    """, (code_val,))
                    col_row = cur.fetchone()

                if not col_row:
                    cur.close()
                    return jsonify({'success': False, 'message': f"Color '{code_val}' is not a valid active Primary color."}), 400
                verified_colors.append(col_row)

            # Insert Fabric
            cur.execute("""
                INSERT INTO fabric_master (fabric_name, uom, gsm, status) 
                VALUES (%s, %s, %s, %s) RETURNING id
            """, (name, uom, gsm, status))
            fabric_id = cur.fetchone()[0]

            # Insert Color Mappings
            for vc in verified_colors:
                cur.execute("""
                    INSERT INTO fabric_color_mapping (fabric_id, global_color_code, display_color, category) 
                    VALUES (%s, %s, %s, 'Primary')
                """, (fabric_id, vc[0], vc[1]))

            # Insert DIA Mappings
            for dia_val in dias:
                cur.execute("""
                    INSERT INTO fabric_dia_mapping (fabric_id, dia) 
                    VALUES (%s, %s)
                """, (fabric_id, dia_val))

            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Fabric added successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error adding fabric: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/fabrics/<int:id>', methods=['PUT'])
@login_required
def update_fabric(id):
    data = request.json or {}
    name = data.get('fabric_name', '').strip()
    uom = data.get('uom', '').strip()
    gsm_str = str(data.get('gsm', '')).strip()
    dias_input = data.get('dias', [])
    colors = data.get('colors', [])
    status = data.get('status', 'Active').strip()

    if not name or not uom or not gsm_str:
        return jsonify({'success': False, 'message': 'Fabric Name, UOM, and GSM are required.'}), 400

    try:
        gsm = float(gsm_str)
    except ValueError:
        return jsonify({'success': False, 'message': 'GSM must be a numeric value.'}), 400

    if gsm <= 0:
        return jsonify({'success': False, 'message': 'GSM must be greater than zero.'}), 400

    if uom.upper() not in ['KGS', 'MTR']:
        return jsonify({'success': False, 'message': 'UOM must be either KGS or MTR.'}), 400

    if not dias_input:
        return jsonify({'success': False, 'message': 'At least one DIA must be selected.'}), 400

    dias = []
    for d in dias_input:
        try:
            val = float(d)
            if val <= 0:
                return jsonify({'success': False, 'message': 'DIA values must be greater than zero.'}), 400
            dias.append(val)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'message': 'DIA values must be numeric.'}), 400

    dias = list(set(dias))

    if not colors:
        return jsonify({'success': False, 'message': 'At least one Primary Color must be selected.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Check uniqueness on other rows
        cur.execute("SELECT id FROM fabric_master WHERE fabric_name = %s AND id != %s", (name, id))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': f"Fabric Name '{name}' already exists on another entry."}), 400

        # Verify active primary colors
        verified_colors = []
        for c_val in colors:
            code_val = (c_val.get('global_color_code', '') or c_val.get('display_color', '')) if isinstance(c_val, dict) else str(c_val).strip()
            cur.execute("""
                SELECT global_color_code, display_color 
                FROM color_master 
                WHERE global_color_code = %s AND category = 'Primary' AND status = 'Active'
            """, (code_val,))
            col_row = cur.fetchone()
            if not col_row:
                cur.execute("""
                    SELECT global_color_code, display_color 
                    FROM color_master 
                    WHERE display_color = %s AND category = 'Primary' AND status = 'Active'
                """, (code_val,))
                col_row = cur.fetchone()

            if not col_row:
                cur.close()
                return jsonify({'success': False, 'message': f"Color '{code_val}' is not a valid active Primary color."}), 400
            verified_colors.append(col_row)

        # Update Fabric details
        cur.execute("""
            UPDATE fabric_master 
            SET fabric_name = %s, uom = %s, gsm = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s
        """, (name, uom, gsm, status, id))

        # Rebuild color mappings
        cur.execute("DELETE FROM fabric_color_mapping WHERE fabric_id = %s", (id,))
        for vc in verified_colors:
            cur.execute("""
                INSERT INTO fabric_color_mapping (fabric_id, global_color_code, display_color, category) 
                VALUES (%s, %s, %s, 'Primary')
            """, (id, vc[0], vc[1]))

        # Rebuild DIA mappings
        cur.execute("DELETE FROM fabric_dia_mapping WHERE fabric_id = %s", (id,))
        for dia_val in dias:
            cur.execute("""
                INSERT INTO fabric_dia_mapping (fabric_id, dia) 
                VALUES (%s, %s)
            """, (id, dia_val))

        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Fabric updated successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error updating fabric: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/fabrics/<int:id>', methods=['DELETE'])
@login_required
def delete_fabric(id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE fabric_master SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = %s", (id,))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Fabric soft deleted successfully (status set to Inactive).'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error deleting fabric: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/fabrics/bulk', methods=['POST'])
@login_required
def bulk_add_fabrics():
    data = request.json or {}
    fabrics = data.get('fabrics', [])
    if not fabrics:
        return jsonify({'success': False, 'message': 'No fabrics list provided.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for f in fabrics:
            name = f.get('fabric_name', '').strip()
            uom = f.get('uom', '').strip()
            gsm_str = str(f.get('gsm', '')).strip()
            dia_raw = str(f.get('dia', '')).strip()  # can be comma-separated, e.g. "36,38,40"
            colors_str = f.get('colors', '')
            status = f.get('status', 'Active').strip()

            if name and uom and gsm_str and dia_raw:
                try:
                    gsm = float(gsm_str)
                except ValueError:
                    continue

                if gsm <= 0 or uom.upper() not in ['KGS', 'MTR']:
                    continue

                # Parse multi-DIAs
                dia_tokens = [d.strip() for d in dia_raw.split(',') if d.strip()]
                dias = []
                valid_dias = True
                for dt in dia_tokens:
                    try:
                        d_val = float(dt)
                        if d_val > 0:
                            dias.append(d_val)
                        else:
                            valid_dias = False
                            break
                    except ValueError:
                        valid_dias = False
                        break

                if not valid_dias or not dias:
                    continue

                dias = list(set(dias))

                # Parse colors
                color_names = [c.strip() for c in colors_str.split(',') if c.strip()]
                verified_colors = []
                valid_row = True
                for cn in color_names:
                    cn_clean = cn.strip()
                    code_part = cn_clean.split('—')[0].split(' - ')[0].strip()
                    cur.execute("""
                        SELECT global_color_code, display_color 
                        FROM color_master 
                        WHERE global_color_code = %s AND category = 'Primary' AND status = 'Active'
                    """, (code_part,))
                    col_row = cur.fetchone()
                    if not col_row:
                        cur.execute("""
                            SELECT global_color_code, display_color 
                            FROM color_master 
                            WHERE global_color_code = %s AND category = 'Primary' AND status = 'Active'
                        """, (cn_clean,))
                        col_row = cur.fetchone()
                    if not col_row:
                        cur.execute("""
                            SELECT global_color_code, display_color 
                            FROM color_master 
                            WHERE display_color = %s AND category = 'Primary' AND status = 'Active'
                        """, (cn_clean,))
                        col_row = cur.fetchone()

                    if col_row:
                        verified_colors.append(col_row)
                    else:
                        valid_row = False
                        break

                if not valid_row or not verified_colors:
                    continue

                # Check if fabric name already exists
                cur.execute("SELECT id FROM fabric_master WHERE fabric_name = %s", (name,))
                existing = cur.fetchone()
                if existing:
                    fabric_id = existing[0]
                    cur.execute("""
                        UPDATE fabric_master 
                        SET uom = %s, gsm = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = %s
                    """, (uom, gsm, status, fabric_id))
                    cur.execute("DELETE FROM fabric_color_mapping WHERE fabric_id = %s", (fabric_id,))
                    cur.execute("DELETE FROM fabric_dia_mapping WHERE fabric_id = %s", (fabric_id,))
                else:
                    cur.execute("""
                        INSERT INTO fabric_master (fabric_name, uom, gsm, status) 
                        VALUES (%s, %s, %s, %s) RETURNING id
                    """, (name, uom, gsm, status))
                    fabric_id = cur.fetchone()[0]

                # Insert colors
                for vc in verified_colors:
                    cur.execute("""
                        INSERT INTO fabric_color_mapping (fabric_id, global_color_code, display_color, category) 
                        VALUES (%s, %s, %s, 'Primary')
                    """, (fabric_id, vc[0], vc[1]))

                # Insert DIAs
                for dia_val in dias:
                    cur.execute("""
                        INSERT INTO fabric_dia_mapping (fabric_id, dia) 
                        VALUES (%s, %s)
                    """, (fabric_id, dia_val))

        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f'Successfully imported/updated {len(fabrics)} fabric records.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error bulk importing fabrics: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


# Brand Master CRUD APIs
@app.route('/api/masters/brands', methods=['GET', 'POST'])
@login_required
def brands_api():
    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        status = request.args.get('status', '').strip()

        conn = get_db_connection()
        cur = conn.cursor()

        query = """
            SELECT id, brand_name, brand_code, status, created_at, updated_at 
            FROM brand_master 
            WHERE 1=1
        """
        params = []

        if search:
            query += " AND (brand_name ILIKE %s OR brand_code ILIKE %s)"
            params.extend([f'%{search}%', f'%{search}%'])
        if status:
            query += " AND status = %s"
            params.append(status)

        query += " ORDER BY id DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        release_db_connection(conn)

        brands = [{
            'id': r[0],
            'brand_name': r[1],
            'brand_code': r[2],
            'status': r[3],
            'created_at': r[4].isoformat() if r[4] else None,
            'updated_at': r[5].isoformat() if r[5] else None
        } for r in rows]

        return jsonify({'success': True, 'brands': brands})

    elif request.method == 'POST':
        data = request.json or {}
        name = data.get('brand_name', '').strip()
        code = data.get('brand_code', '').strip().upper()
        status = data.get('status', 'Active').strip()

        if not name or not code:
            return jsonify({'success': False, 'message': 'Brand Name and Brand Code are required.'}), 400

        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute("SELECT id FROM brand_master WHERE brand_name = %s", (name,))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Brand Name '{name}' already exists."}), 400

            cur.execute("SELECT id FROM brand_master WHERE brand_code = %s", (code,))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Brand Code '{code}' already exists."}), 400

            cur.execute("""
                INSERT INTO brand_master (brand_name, brand_code, status) 
                VALUES (%s, %s, %s)
            """, (name, code, status))
            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Brand added successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error adding brand: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/brands/<int:id>', methods=['PUT'])
@login_required
def update_brand(id):
    data = request.json or {}
    name = data.get('brand_name', '').strip()
    code = data.get('brand_code', '').strip().upper()
    status = data.get('status', 'Active').strip()

    if not name or not code:
        return jsonify({'success': False, 'message': 'Brand Name and Brand Code are required.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM brand_master WHERE brand_name = %s AND id != %s", (name, id))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': f"Brand Name '{name}' already exists on another entry."}), 400

        cur.execute("SELECT id FROM brand_master WHERE brand_code = %s AND id != %s", (code, id))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': f"Brand Code '{code}' already exists on another entry."}), 400

        cur.execute("""
            UPDATE brand_master 
            SET brand_name = %s, brand_code = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s
        """, (name, code, status, id))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Brand updated successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error updating brand: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/brands/<int:id>', methods=['DELETE'])
@login_required
def delete_brand(id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE brand_master SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = %s", (id,))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Brand soft deleted successfully (status set to Inactive).'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error deleting brand: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/common-production', methods=['GET', 'POST'])
@login_required
def common_production_api():
    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        status = request.args.get('status', '').strip()

        query = """
            SELECT c.id, c.common_production_code, c.common_production_name, c.description, c.status, 
                   c.created_at, c.updated_at, c.fabric_id, f.fabric_name, c.dia_mode, c.common_dia,
                   c.fabric_consumption
            FROM common_production_master c
            LEFT JOIN fabric_master f ON c.fabric_id = f.id
            WHERE 1=1
        """
        params = []

        if search:
            query += " AND (c.common_production_name ILIKE %s OR c.common_production_code ILIKE %s)"
            params.extend([f'%{search}%', f'%{search}%'])
        if status:
            query += " AND c.status = %s"
            params.append(status)

        query += " ORDER BY c.id DESC"
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        
        common_productions = []
        for r in rows:
            cp_id = r[0]
            cur.execute("""
                SELECT cpdm.size_id, s.size AS size_name, cpdm.dia 
                FROM common_production_dia_mapping cpdm
                LEFT JOIN size_master s ON cpdm.size_id = s.id
                WHERE cpdm.common_production_id = %s
                ORDER BY s.id ASC
            """, (cp_id,))
            dias = []
            for size in cur.fetchall():
                dias.append({
                    'size_id': size[0],
                    'size_name': size[1],
                    'dia': int(size[2]) if size[2] is not None else None
                })
            
            common_productions.append({
                'id': cp_id,
                'common_production_code': r[1],
                'common_production_name': r[2],
                'description': r[3] or '',
                'status': r[4],
                'created_at': r[5].isoformat() if r[5] else None,
                'updated_at': r[6].isoformat() if r[6] else None,
                'fabric_id': r[7],
                'fabric_name': r[8] or '',
                'dia_mode': r[9] or None,
                'common_dia': r[10],
                'fabric_consumption': float(r[11]) if r[11] is not None else None,
                'dias': dias
            })
            
        cur.close()
        release_db_connection(conn)
        
        return jsonify({'success': True, 'common_productions': common_productions})

    elif request.method == 'POST':
        data = request.json or {}
        name = data.get('common_production_name', '').strip()
        status = data.get('status', 'Active').strip()
        fabric_id = data.get('fabric_id')
        fabric_consumption_raw = data.get('fabric_consumption')
        dia_mode = data.get('dia_mode', '').strip()
        common_dia_raw = data.get('common_dia')
        dias = data.get('dias', [])
        username = session.get('username', 'Admin')

        if not name:
            return jsonify({'success': False, 'message': 'Common Production Name is required.'}), 400
        if not fabric_id:
            return jsonify({'success': False, 'message': 'Fabric is required.'}), 400
        
        if fabric_consumption_raw is None or str(fabric_consumption_raw).strip() == '':
            return jsonify({'success': False, 'message': 'Fabric Consumption is required.'}), 400
        try:
            fabric_consumption = float(fabric_consumption_raw)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'message': 'Fabric Consumption must be a valid numeric value.'}), 400
        if fabric_consumption <= 0:
            return jsonify({'success': False, 'message': 'Fabric Consumption must be greater than 0.'}), 400

        if dia_mode not in ['Common DIA for All Sizes', 'Size-wise DIA']:
            return jsonify({'success': False, 'message': 'Invalid DIA Selection Mode.'}), 400
        if not dias:
            return jsonify({'success': False, 'message': 'At least one Size must be selected.'}), 400

        common_dia = None
        if dia_mode == 'Common DIA for All Sizes':
            if common_dia_raw is None or str(common_dia_raw).strip() == '':
                return jsonify({'success': False, 'message': 'Common DIA is required for Common DIA mode.'}), 400
            try:
                common_dia = int(common_dia_raw)
            except ValueError:
                return jsonify({'success': False, 'message': 'Common DIA must be a valid integer.'}), 400
        else:
            # Validate size-wise DIAs
            for item in dias:
                size_id = item.get('size_id')
                size_dia = item.get('dia')
                if not size_id:
                    return jsonify({'success': False, 'message': 'Invalid size_id in mappings.'}), 400
                if size_dia is None or str(size_dia).strip() == '':
                    return jsonify({'success': False, 'message': 'Each selected size must have a DIA configured for Size-wise DIA mode.'}), 400
                try:
                    int(size_dia)
                except ValueError:
                    return jsonify({'success': False, 'message': 'DIA must be a valid integer.'}), 400

        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute("SELECT id FROM common_production_master WHERE common_production_name = %s", (name,))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Common Production Name '{name}' already exists."}), 400

            # Automatically generate unique sequential code
            cur.execute("SELECT MAX(id) FROM common_production_master;")
            max_id = cur.fetchone()[0] or 0
            code = f"CP{max_id + 1:03d}"

            cur.execute("""
                INSERT INTO common_production_master (common_production_code, common_production_name, fabric_id, fabric_consumption, dia_mode, common_dia, status, created_by, updated_by) 
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (code, name, int(fabric_id), fabric_consumption, dia_mode, common_dia, status, username, username))
            cp_id = cur.fetchone()[0]

            for item in dias:
                size_id = int(item.get('size_id'))
                dia_val = int(item.get('dia')) if dia_mode == 'Size-wise DIA' else None
                cur.execute("""
                    INSERT INTO common_production_dia_mapping (common_production_id, size_id, dia) 
                    VALUES (%s, %s, %s)
                """, (cp_id, size_id, dia_val))

            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Common Production added successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error adding Common Production: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/common-production/<int:id>', methods=['PUT', 'DELETE'])
@login_required
def common_production_detail_api(id):
    if request.method == 'PUT':
        data = request.json or {}
        name = data.get('common_production_name', '').strip()
        status = data.get('status', 'Active').strip()
        fabric_id = data.get('fabric_id')
        fabric_consumption_raw = data.get('fabric_consumption')
        dia_mode = data.get('dia_mode', '').strip()
        common_dia_raw = data.get('common_dia')
        dias = data.get('dias', [])
        username = session.get('username', 'Admin')

        if not name:
            return jsonify({'success': False, 'message': 'Common Production Name is required.'}), 400
        if not fabric_id:
            return jsonify({'success': False, 'message': 'Fabric is required.'}), 400

        if fabric_consumption_raw is None or str(fabric_consumption_raw).strip() == '':
            return jsonify({'success': False, 'message': 'Fabric Consumption is required.'}), 400
        try:
            fabric_consumption = float(fabric_consumption_raw)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'message': 'Fabric Consumption must be a valid numeric value.'}), 400
        if fabric_consumption <= 0:
            return jsonify({'success': False, 'message': 'Fabric Consumption must be greater than 0.'}), 400

        if dia_mode not in ['Common DIA for All Sizes', 'Size-wise DIA']:
            return jsonify({'success': False, 'message': 'Invalid DIA Selection Mode.'}), 400
        if not dias:
            return jsonify({'success': False, 'message': 'At least one Size must be selected.'}), 400

        common_dia = None
        if dia_mode == 'Common DIA for All Sizes':
            if common_dia_raw is None or str(common_dia_raw).strip() == '':
                return jsonify({'success': False, 'message': 'Common DIA is required for Common DIA mode.'}), 400
            try:
                common_dia = int(common_dia_raw)
            except ValueError:
                return jsonify({'success': False, 'message': 'Common DIA must be a valid integer.'}), 400
        else:
            # Validate size-wise DIAs
            for item in dias:
                size_id = item.get('size_id')
                size_dia = item.get('dia')
                if not size_id:
                    return jsonify({'success': False, 'message': 'Invalid size_id in mappings.'}), 400
                if size_dia is None or str(size_dia).strip() == '':
                    return jsonify({'success': False, 'message': 'Each selected size must have a DIA configured for Size-wise DIA mode.'}), 400
                try:
                    int(size_dia)
                except ValueError:
                    return jsonify({'success': False, 'message': 'DIA must be a valid integer.'}), 400

        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute("SELECT id FROM common_production_master WHERE common_production_name = %s AND id != %s", (name, id))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Common Production Name '{name}' already exists on another entry."}), 400

            cur.execute("""
                UPDATE common_production_master 
                SET common_production_name = %s, fabric_id = %s, fabric_consumption = %s, dia_mode = %s, common_dia = %s, status = %s, updated_by = %s, updated_at = CURRENT_TIMESTAMP 
                WHERE id = %s
            """, (name, int(fabric_id), fabric_consumption, dia_mode, common_dia, status, username, id))

            cur.execute("DELETE FROM common_production_dia_mapping WHERE common_production_id = %s", (id,))
            for item in dias:
                size_id = int(item.get('size_id'))
                dia_val = int(item.get('dia')) if dia_mode == 'Size-wise DIA' else None
                cur.execute("""
                    INSERT INTO common_production_dia_mapping (common_production_id, size_id, dia) 
                    VALUES (%s, %s, %s)
                """, (id, size_id, dia_val))

            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Common Production updated successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error updating Common Production: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

    elif request.method == 'DELETE':
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            # Soft delete: set status to Inactive
            cur.execute("UPDATE common_production_master SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = %s", (id,))
            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Common Production soft deleted successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error deleting Common Production: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/brands/bulk', methods=['POST'])
@login_required
def bulk_add_brands():
    data = request.json or {}
    brands = data.get('brands', [])
    if not brands:
        return jsonify({'success': False, 'message': 'No brands list provided.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for b in brands:
            name = b.get('brand_name', '').strip()
            code = b.get('brand_code', '').strip().upper()
            status = b.get('status', 'Active').strip()

            if name and code:
                cur.execute("SELECT id FROM brand_master WHERE brand_name = %s OR brand_code = %s", (name, code))
                existing = cur.fetchone()
                if existing:
                    cur.execute("""
                        UPDATE brand_master 
                        SET brand_name = %s, brand_code = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = %s
                    """, (name, code, status, existing[0]))
                else:
                    cur.execute("""
                        INSERT INTO brand_master (brand_name, brand_code, status) 
                        VALUES (%s, %s, %s)
                    """, (name, code, status))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f'Successfully imported/updated {len(brands)} brand records.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error bulk importing brands: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


# Product Description Master CRUD APIs
@app.route('/api/masters/product-descriptions', methods=['GET', 'POST'])
@login_required
def product_descriptions_api():
    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        status = request.args.get('status', '').strip()

        conn = get_db_connection()
        cur = conn.cursor()

        query = """
            SELECT id, product_description, description_code, status, created_at, updated_at 
            FROM product_description_master 
            WHERE 1=1
        """
        params = []

        if search:
            query += " AND (product_description ILIKE %s OR description_code ILIKE %s)"
            params.extend([f'%{search}%', f'%{search}%'])
        if status:
            query += " AND status = %s"
            params.append(status)

        query += " ORDER BY id DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        release_db_connection(conn)

        descriptions = [{
            'id': r[0],
            'product_description': r[1],
            'description_code': r[2],
            'status': r[3],
            'created_at': r[4].isoformat() if r[4] else None,
            'updated_at': r[5].isoformat() if r[5] else None
        } for r in rows]

        return jsonify({'success': True, 'descriptions': descriptions})

    elif request.method == 'POST':
        data = request.json or {}
        description = data.get('product_description', '').strip()
        code = data.get('description_code', '').strip().upper()
        status = data.get('status', 'Active').strip()

        if not description:
            return jsonify({'success': False, 'message': 'Product Description is required.'}), 400

        db_code = code if code else None

        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute("SELECT id FROM product_description_master WHERE product_description = %s", (description,))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Product Description '{description}' already exists."}), 400

            if db_code:
                cur.execute("SELECT id FROM product_description_master WHERE description_code = %s", (db_code,))
                if cur.fetchone():
                    cur.close()
                    return jsonify({'success': False, 'message': f"Description Code '{db_code}' already exists."}), 400

            cur.execute("""
                INSERT INTO product_description_master (product_description, description_code, status) 
                VALUES (%s, %s, %s)
            """, (description, db_code, status))
            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Product Description added successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error adding product description: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/product-descriptions/<int:id>', methods=['PUT'])
@login_required
def update_product_description(id):
    data = request.json or {}
    description = data.get('product_description', '').strip()
    code = data.get('description_code', '').strip().upper()
    status = data.get('status', 'Active').strip()

    if not description:
        return jsonify({'success': False, 'message': 'Product Description is required.'}), 400

    db_code = code if code else None

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM product_description_master WHERE product_description = %s AND id != %s", (description, id))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': f"Product Description '{description}' already exists on another entry."}), 400

        if db_code:
            cur.execute("SELECT id FROM product_description_master WHERE description_code = %s AND id != %s", (db_code, id))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Description Code '{db_code}' already exists on another entry."}), 400

        cur.execute("""
            UPDATE product_description_master 
            SET product_description = %s, description_code = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s
        """, (description, db_code, status, id))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Product Description updated successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error updating product description: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/product-descriptions/<int:id>', methods=['DELETE'])
@login_required
def delete_product_description(id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE product_description_master SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = %s", (id,))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Product Description soft deleted successfully (status set to Inactive).'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error deleting product description: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/product-descriptions/bulk', methods=['POST'])
@login_required
def bulk_add_product_descriptions():
    data = request.json or {}
    descriptions = data.get('descriptions', [])
    if not descriptions:
        return jsonify({'success': False, 'message': 'No descriptions list provided.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for item in descriptions:
            desc = item.get('product_description', '').strip()
            code = item.get('description_code', '').strip().upper()
            status = item.get('status', 'Active').strip()

            db_code = code if code else None

            if desc:
                if db_code:
                    cur.execute("SELECT id FROM product_description_master WHERE product_description = %s OR description_code = %s", (desc, db_code))
                else:
                    cur.execute("SELECT id FROM product_description_master WHERE product_description = %s", (desc,))
                
                existing = cur.fetchone()
                if existing:
                    cur.execute("""
                        UPDATE product_description_master 
                        SET product_description = %s, description_code = %s, status = %s, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = %s
                    """, (desc, db_code, status, existing[0]))
                else:
                    cur.execute("""
                        INSERT INTO product_description_master (product_description, description_code, status) 
                        VALUES (%s, %s, %s)
                    """, (desc, db_code, status))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f'Successfully imported/updated {len(descriptions)} product description records.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error bulk importing product descriptions: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


# Product Master CRUD APIs
@app.route('/api/masters/products', methods=['GET', 'POST'])
@login_required
def products_api():
    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        brand_id = request.args.get('brand_id', '').strip()
        fabric_id = request.args.get('fabric_id', '').strip()
        product_type = request.args.get('product_type', '').strip()
        desc_id = request.args.get('product_description_id', '').strip()
        status = request.args.get('status', '').strip()
        prod_type_filter = request.args.get('production_type', '').strip()

        conn = get_db_connection()
        cur = conn.cursor()

        query = """
            SELECT p.id, p.product_name, p.brand_id, b.brand_name, p.fabric_id, f.fabric_name, 
                   p.product_description_id, d.product_description, p.product_type, 
                   p.color_category, p.dia_mode, p.production_type, p.status, p.created_at, p.updated_at,
                   p.fabric_consumption, p.common_production_id, cpm.common_production_name
            FROM product_master p
            JOIN brand_master b ON p.brand_id = b.id
            JOIN fabric_master f ON p.fabric_id = f.id
            JOIN product_description_master d ON p.product_description_id = d.id
            LEFT JOIN common_production_master cpm ON p.common_production_id = cpm.id
            WHERE 1=1
        """
        params = []

        if search:
            query += " AND p.product_name ILIKE %s"
            params.append(f'%{search}%')
        if brand_id:
            query += " AND p.brand_id = %s"
            params.append(int(brand_id))
        if fabric_id:
            query += " AND p.fabric_id = %s"
            params.append(int(fabric_id))
        if product_type:
            query += " AND p.product_type = %s"
            params.append(product_type)
        if desc_id:
            query += " AND p.product_description_id = %s"
            params.append(int(desc_id))
        if status:
            query += " AND p.status = %s"
            params.append(status)
        if prod_type_filter:
            query += " AND p.production_type = %s"
            params.append(prod_type_filter)

        query += " ORDER BY p.id DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()

        products = []
        if rows:
            product_ids = [r[0] for r in rows]

            # 1. Batch fetch assigned colors for all retrieved products
            cur.execute("""
                SELECT pcm.product_id, pcm.global_color_code, c.display_color 
                FROM product_color_mapping pcm
                JOIN product_master p ON pcm.product_id = p.id
                LEFT JOIN color_master c ON pcm.global_color_code = c.global_color_code AND c.category = p.color_category
                WHERE pcm.product_id = ANY(%s)
                ORDER BY pcm.product_id, pcm.id DESC;
            """, (product_ids,))
            colors_by_product = {}
            for col in cur.fetchall():
                p_id_c = col[0]
                if p_id_c not in colors_by_product:
                    colors_by_product[p_id_c] = []
                colors_by_product[p_id_c].append({
                    'global_color_code': col[1],
                    'display_color': col[2] or col[1]
                })

            # 2. Batch fetch assigned DIAs/sizes for all retrieved products
            cur.execute("""
                SELECT pdm.product_id, pdm.size_id, s.size AS size_name, pdm.dia 
                FROM product_dia_mapping pdm
                LEFT JOIN size_master s ON pdm.size_id = s.id
                WHERE pdm.product_id = ANY(%s)
                ORDER BY pdm.id ASC;
            """, (product_ids,))
            dias_by_product = {}
            for dia in cur.fetchall():
                p_id_d = dia[0]
                if p_id_d not in dias_by_product:
                    dias_by_product[p_id_d] = []
                dias_by_product[p_id_d].append({
                    'size_id': dia[1],
                    'size_name': dia[2] or 'Common',
                    'dia': float(dia[3])
                })

            # 3. Batch fetch assigned sales data products for all retrieved products
            cur.execute("""
                SELECT product_id, sales_product_name 
                FROM product_sales_data_mapping 
                WHERE product_id = ANY(%s)
                ORDER BY id ASC;
            """, (product_ids,))
            sales_data_by_product = {}
            for sdp in cur.fetchall():
                p_id_s = sdp[0]
                if p_id_s not in sales_data_by_product:
                    sales_data_by_product[p_id_s] = []
                sales_data_by_product[p_id_s].append(sdp[1])

            for r in rows:
                p_id = r[0]
                products.append({
                    'id': p_id,
                    'product_name': r[1],
                    'brand_id': r[2],
                    'brand_name': r[3],
                    'fabric_id': r[4],
                    'fabric_name': r[5],
                    'product_description_id': r[6],
                    'product_description': r[7],
                    'product_type': r[8],
                    'color_category': r[9],
                    'dia_mode': r[10],
                    'production_type': r[11],
                    'status': r[12],
                    'colors': colors_by_product.get(p_id, []),
                    'dias': dias_by_product.get(p_id, []),
                    'sales_data_products': sales_data_by_product.get(p_id, []),
                    'fabric_consumption': float(r[15]) if len(r) > 15 and r[15] is not None else (None if r[11] == 'Common' else 0.0),
                    'common_production_id': r[16],
                    'common_production_name': r[17],
                    'created_at': r[13].isoformat() if r[13] else None,
                    'updated_at': r[14].isoformat() if r[14] else None
                })

        cur.close()
        release_db_connection(conn)
        return jsonify({'success': True, 'products': products})

    elif request.method == 'POST':
        data = request.json or {}
        name = data.get('product_name', '').strip()
        brand_id = data.get('brand_id')
        fabric_id = data.get('fabric_id')
        desc_id = data.get('product_description_id')
        prod_type = data.get('product_type', '').strip()
        color_cat = data.get('color_category', '').strip()
        dia_mode = data.get('dia_mode', '').strip()
        production_type = data.get('production_type', 'Common').strip()
        status = data.get('status', 'Active').strip()
        colors = data.get('colors', [])
        dias = data.get('dias', [])
        sales_data_products = data.get('sales_data_products', [])
        try:
            fabric_consumption = float(data.get('fabric_consumption', 0) or 0)
        except (ValueError, TypeError):
            fabric_consumption = 0.0

        common_production_id = data.get('common_production_id')
        if production_type == 'Common':
            if not common_production_id:
                return jsonify({'success': False, 'message': 'Common Production Name is required when Production Type is Common.'}), 400
        else:
            common_production_id = None

        if not name or not brand_id or not fabric_id or not desc_id or not prod_type or not color_cat or not dia_mode or not production_type:
            return jsonify({'success': False, 'message': 'All required fields must be populated.'}), 400

        if not colors:
            return jsonify({'success': False, 'message': 'At least one Color must be selected.'}), 400

        conn = get_db_connection()
        cur = conn.cursor()
        try:
            if production_type == 'Common':
                cur.execute("""
                    SELECT fabric_id, dia_mode, common_dia, fabric_consumption 
                    FROM common_production_master 
                    WHERE id = %s AND status = 'Active';
                """, (int(common_production_id),))
                cp_res = cur.fetchone()
                if not cp_res:
                    cur.close()
                    return jsonify({'success': False, 'message': 'The selected Common Production is invalid or inactive.'}), 400
                cp_fabric_id, cp_dia_mode, cp_common_dia, cp_fabric_consumption = cp_res
                
                if not cp_fabric_id:
                    cur.close()
                    return jsonify({'success': False, 'message': 'Fabric is not configured for this Common Production.'}), 400
                if not cp_dia_mode:
                    cur.close()
                    return jsonify({'success': False, 'message': 'Size and DIA configuration is not available for this Common Production.'}), 400
                
                # Check fabric matching: reject if mismatch
                if int(fabric_id) != int(cp_fabric_id):
                    cur.close()
                    return jsonify({'success': False, 'message': 'Fabric does not match the selected Common Production configuration.'}), 400

                # Check fabric consumption matching: reject if mismatch
                if cp_fabric_consumption is not None:
                    if abs(fabric_consumption - float(cp_fabric_consumption)) > 1e-5:
                        cur.close()
                        return jsonify({'success': False, 'message': 'Fabric Consumption does not match the selected Common Production configuration.'}), 400
                    fabric_consumption = float(cp_fabric_consumption)
                else:
                    fabric_consumption = None
                
                # Load allowed sizes from common_production_dia_mapping
                cur.execute("""
                    SELECT size_id, dia 
                    FROM common_production_dia_mapping 
                    WHERE common_production_id = %s;
                """, (int(common_production_id),))
                cp_mappings = cur.fetchall()
                if not cp_mappings:
                    cur.close()
                    return jsonify({'success': False, 'message': 'Size and DIA configuration is not available for this Common Production.'}), 400
                
                allowed_sizes_map = { r[0]: r[1] for r in cp_mappings }
                
                # Validate sizes
                submitted_size_ids = [int(item.get('size_id')) for item in dias if item.get('size_id')]
                if not submitted_size_ids:
                    cur.close()
                    return jsonify({'success': False, 'message': 'At least one valid configured Size must be selected.'}), 400
                
                for s_id in submitted_size_ids:
                    if s_id not in allowed_sizes_map:
                        cur.execute("SELECT size FROM size_master WHERE id = %s;", (s_id,))
                        size_name = cur.fetchone()
                        size_name_str = size_name[0] if size_name else str(s_id)
                        cur.close()
                        return jsonify({'success': False, 'message': f"Size '{size_name_str}' is not configured in the selected Common Production Master."}), 400
                
                # Override DIAs based on common production mode
                overridden_dias = []
                for item in dias:
                    s_id = int(item.get('size_id'))
                    if cp_dia_mode == 'Common DIA for All Sizes':
                        if cp_common_dia is None or str(cp_common_dia).strip() == '':
                            cur.close()
                            return jsonify({'success': False, 'message': 'Common DIA is not configured for this Common Production.'}), 400
                        overridden_dias.append({
                            'size_id': s_id,
                            'dia': int(cp_common_dia)
                        })
                    else: # Size-wise DIA
                        size_wise_dia = allowed_sizes_map.get(s_id)
                        if size_wise_dia is None or str(size_wise_dia).strip() == '':
                            cur.close()
                            return jsonify({'success': False, 'message': f"DIA is not configured for size {s_id} in the selected Common Production."}), 400
                        overridden_dias.append({
                            'size_id': s_id,
                            'dia': int(size_wise_dia)
                        })
                
                dias = overridden_dias
                dia_mode = cp_dia_mode

            cur.execute("SELECT id FROM product_master WHERE product_name = %s AND brand_id = %s", (name, brand_id))
            if cur.fetchone():
                cur.close()
                return jsonify({'success': False, 'message': f"Product Name '{name}' already exists for the selected Brand."}), 400

            cur.execute("""
                INSERT INTO product_master (product_name, brand_id, fabric_id, product_description_id, product_type, color_category, dia_mode, production_type, status, fabric_consumption, common_production_id) 
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (name, brand_id, fabric_id, desc_id, prod_type, color_cat, dia_mode, production_type, status, fabric_consumption, common_production_id))
            p_id = cur.fetchone()[0]

            for color_code in colors:
                cur.execute("""
                    INSERT INTO product_color_mapping (product_id, global_color_code) 
                    VALUES (%s, %s)
                """, (p_id, color_code))

            for item in dias:
                size_id = item.get('size_id')
                db_size_id = int(size_id) if size_id else None
                dia_val = float(item.get('dia', 0))
                cur.execute("""
                    INSERT INTO product_dia_mapping (product_id, size_id, dia) 
                    VALUES (%s, %s, %s)
                """, (p_id, db_size_id, dia_val))

            for sp_name in sales_data_products:
                cur.execute("""
                    INSERT INTO product_sales_data_mapping (product_id, sales_product_name) 
                    VALUES (%s, %s)
                """, (p_id, sp_name))

            conn.commit()
            cur.close()
            return jsonify({'success': True, 'message': 'Product added successfully.'})
        except Exception as e:
            conn.rollback()
            cur.close()
            return jsonify({'success': False, 'message': f'Error adding product: {str(e)}'}), 500
        finally:
            release_db_connection(conn)

@app.route('/api/masters/products/<int:id>', methods=['PUT'])
@login_required
def update_product(id):
    data = request.json or {}
    name = data.get('product_name', '').strip()
    brand_id = data.get('brand_id')
    fabric_id = data.get('fabric_id')
    desc_id = data.get('product_description_id')
    prod_type = data.get('product_type', '').strip()
    color_cat = data.get('color_category', '').strip()
    dia_mode = data.get('dia_mode', '').strip()
    production_type = data.get('production_type', 'Common').strip()
    status = data.get('status', 'Active').strip()
    colors = data.get('colors', [])
    dias = data.get('dias', [])
    sales_data_products = data.get('sales_data_products', [])
    try:
        fabric_consumption = float(data.get('fabric_consumption', 0) or 0)
    except (ValueError, TypeError):
        fabric_consumption = 0.0

    common_production_id = data.get('common_production_id')
    if production_type == 'Common':
        if not common_production_id:
            return jsonify({'success': False, 'message': 'Common Production Name is required when Production Type is Common.'}), 400
    else:
        common_production_id = None

    if not name or not brand_id or not fabric_id or not desc_id or not prod_type or not color_cat or not dia_mode or not production_type:
        return jsonify({'success': False, 'message': 'All required fields must be populated.'}), 400

    if not colors:
        return jsonify({'success': False, 'message': 'At least one Color must be selected.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if production_type == 'Common':
            cur.execute("""
                SELECT fabric_id, dia_mode, common_dia, fabric_consumption 
                FROM common_production_master 
                WHERE id = %s AND status = 'Active';
            """, (int(common_production_id),))
            cp_res = cur.fetchone()
            if not cp_res:
                cur.close()
                return jsonify({'success': False, 'message': 'The selected Common Production is invalid or inactive.'}), 400
            cp_fabric_id, cp_dia_mode, cp_common_dia, cp_fabric_consumption = cp_res
            
            if not cp_fabric_id:
                cur.close()
                return jsonify({'success': False, 'message': 'Fabric is not configured for this Common Production.'}), 400
            if not cp_dia_mode:
                cur.close()
                return jsonify({'success': False, 'message': 'Size and DIA configuration is not available for this Common Production.'}), 400
            
            # Check fabric matching: reject if mismatch
            if int(fabric_id) != int(cp_fabric_id):
                cur.close()
                return jsonify({'success': False, 'message': 'Fabric does not match the selected Common Production configuration.'}), 400

            # Check fabric consumption matching: reject if mismatch
            if cp_fabric_consumption is not None:
                if abs(fabric_consumption - float(cp_fabric_consumption)) > 1e-5:
                    cur.close()
                    return jsonify({'success': False, 'message': 'Fabric Consumption does not match the selected Common Production configuration.'}), 400
                fabric_consumption = float(cp_fabric_consumption)
            else:
                fabric_consumption = None
            
            # Load allowed sizes from common_production_dia_mapping
            cur.execute("""
                SELECT size_id, dia 
                FROM common_production_dia_mapping 
                WHERE common_production_id = %s;
            """, (int(common_production_id),))
            cp_mappings = cur.fetchall()
            if not cp_mappings:
                cur.close()
                return jsonify({'success': False, 'message': 'Size and DIA configuration is not available for this Common Production.'}), 400
            
            allowed_sizes_map = { r[0]: r[1] for r in cp_mappings }
            
            # Validate sizes
            submitted_size_ids = [int(item.get('size_id')) for item in dias if item.get('size_id')]
            if not submitted_size_ids:
                cur.close()
                return jsonify({'success': False, 'message': 'At least one valid configured Size must be selected.'}), 400
            
            for s_id in submitted_size_ids:
                if s_id not in allowed_sizes_map:
                    cur.execute("SELECT size FROM size_master WHERE id = %s;", (s_id,))
                    size_name = cur.fetchone()
                    size_name_str = size_name[0] if size_name else str(s_id)
                    cur.close()
                    return jsonify({'success': False, 'message': f"Size '{size_name_str}' is not configured in the selected Common Production Master."}), 400
            
            # Override DIAs based on common production mode
            overridden_dias = []
            for item in dias:
                s_id = int(item.get('size_id'))
                if cp_dia_mode == 'Common DIA for All Sizes':
                    if cp_common_dia is None or str(cp_common_dia).strip() == '':
                        cur.close()
                        return jsonify({'success': False, 'message': 'Common DIA is not configured for this Common Production.'}), 400
                    overridden_dias.append({
                        'size_id': s_id,
                        'dia': int(cp_common_dia)
                    })
                else: # Size-wise DIA
                    size_wise_dia = allowed_sizes_map.get(s_id)
                    if size_wise_dia is None or str(size_wise_dia).strip() == '':
                        cur.close()
                        return jsonify({'success': False, 'message': f"DIA is not configured for size {s_id} in the selected Common Production."}), 400
                    overridden_dias.append({
                        'size_id': s_id,
                        'dia': int(size_wise_dia)
                    })
            
            dias = overridden_dias
            dia_mode = cp_dia_mode

        cur.execute("SELECT id FROM product_master WHERE product_name = %s AND brand_id = %s AND id != %s", (name, brand_id, id))
        if cur.fetchone():
            cur.close()
            return jsonify({'success': False, 'message': f"Product Name '{name}' already exists for this Brand on another entry."}), 400

        cur.execute("""
            UPDATE product_master 
            SET product_name = %s, brand_id = %s, fabric_id = %s, product_description_id = %s, 
                product_type = %s, color_category = %s, dia_mode = %s, production_type = %s, status = %s, 
                fabric_consumption = %s, common_production_id = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s
        """, (name, brand_id, fabric_id, desc_id, prod_type, color_cat, dia_mode, production_type, status, fabric_consumption, common_production_id, id))

        cur.execute("DELETE FROM product_color_mapping WHERE product_id = %s", (id,))
        for color_code in colors:
            cur.execute("""
                INSERT INTO product_color_mapping (product_id, global_color_code) 
                VALUES (%s, %s)
            """, (id, color_code))

        cur.execute("DELETE FROM product_dia_mapping WHERE product_id = %s", (id,))
        for item in dias:
            size_id = item.get('size_id')
            db_size_id = int(size_id) if size_id else None
            dia_val = float(item.get('dia', 0))
            cur.execute("""
                INSERT INTO product_dia_mapping (product_id, size_id, dia) 
                VALUES (%s, %s, %s)
            """, (id, db_size_id, dia_val))

        cur.execute("DELETE FROM product_sales_data_mapping WHERE product_id = %s", (id,))
        for sp_name in sales_data_products:
            cur.execute("""
                INSERT INTO product_sales_data_mapping (product_id, sales_product_name) 
                VALUES (%s, %s)
            """, (id, sp_name))

        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Product updated successfully.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error updating product: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/products/<int:id>', methods=['DELETE'])
@login_required
def delete_product(id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE product_master SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE id = %s", (id,))
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Product soft deleted successfully (status set to Inactive).'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error deleting product: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/sales-products', methods=['GET'])
@login_required
def get_sales_products():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute('SELECT DISTINCT "product" FROM sales_data WHERE "product" IS NOT NULL ORDER BY "product";')
        products = [r[0] for r in cur.fetchall()]
        return jsonify({'success': True, 'products': products})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading sales products: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/products/bulk', methods=['POST'])
@login_required
def bulk_add_products():
    data = request.json or {}
    products = data.get('products', [])
    if not products:
        return jsonify({'success': False, 'message': 'No products list provided.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for p in products:
            name = p.get('product_name', '').strip()
            brand_name = p.get('brand_name', '').strip()
            fabric_name = p.get('fabric_name', '').strip()
            desc_text = p.get('product_description', '').strip()
            prod_type = p.get('product_type', 'Core Product').strip()
            color_cat = p.get('color_category', 'Primary').strip()
            dia_mode = p.get('dia_mode', 'Common DIA for All Sizes').strip()
            production_type = p.get('production_type', 'Common').strip()
            status = p.get('status', 'Active').strip()
            colors_str = p.get('colors', '')
            common_dia = p.get('common_dia')
            try:
                fabric_consumption = float(p.get('fabric_consumption', 0) or 0)
            except (ValueError, TypeError):
                fabric_consumption = 0.0

            cur.execute("SELECT id FROM brand_master WHERE brand_name = %s", (brand_name,))
            b_row = cur.fetchone()
            if not b_row:
                continue
            b_id = b_row[0]

            cur.execute("SELECT id FROM fabric_master WHERE fabric_name = %s", (fabric_name,))
            f_row = cur.fetchone()
            if not f_row:
                continue
            f_id = f_row[0]

            cur.execute("SELECT id FROM product_description_master WHERE product_description = %s", (desc_text,))
            d_row = cur.fetchone()
            if not d_row:
                continue
            d_id = d_row[0]

            parsed_colors = []
            if colors_str:
                for c_part in colors_str.split(','):
                    c_clean = c_part.strip()
                    cur.execute("SELECT global_color_code FROM color_master WHERE display_color = %s OR global_color_code = %s", (c_clean, c_clean))
                    c_row = cur.fetchone()
                    if c_row:
                        parsed_colors.append(c_row[0])

            if not parsed_colors:
                continue

            cur.execute("SELECT id FROM product_master WHERE product_name = %s AND brand_id = %s", (name, b_id))
            existing = cur.fetchone()

            if existing:
                p_id = existing[0]
                cur.execute("""
                    UPDATE product_master 
                    SET fabric_id = %s, product_description_id = %s, product_type = %s, 
                        color_category = %s, dia_mode = %s, production_type = %s, status = %s, 
                        fabric_consumption = %s, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = %s
                """, (f_id, d_id, prod_type, color_cat, dia_mode, production_type, status, fabric_consumption, p_id))
            else:
                cur.execute("""
                    INSERT INTO product_master (product_name, brand_id, fabric_id, product_description_id, product_type, color_category, dia_mode, production_type, status, fabric_consumption) 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """, (name, b_id, f_id, d_id, prod_type, color_cat, dia_mode, production_type, status, fabric_consumption))
                p_id = cur.fetchone()[0]

            cur.execute("DELETE FROM product_color_mapping WHERE product_id = %s", (p_id,))
            for cc in parsed_colors:
                cur.execute("""
                    INSERT INTO product_color_mapping (product_id, global_color_code) 
                    VALUES (%s, %s)
                """, (p_id, cc))

            cur.execute("DELETE FROM product_dia_mapping WHERE product_id = %s", (p_id,))
            if common_dia:
                try:
                    dia_num = float(common_dia)
                    cur.execute("""
                        INSERT INTO product_dia_mapping (product_id, size_id, dia) 
                        VALUES (%s, NULL, %s)
                    """, (p_id, dia_num))
                except:
                    pass

        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Successfully imported/updated product records.'})
    except Exception as e:
        conn.rollback()
        cur.close()
        return jsonify({'success': False, 'message': f'Error bulk importing products: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


# Helper to convert Planning Period (e.g. "July 2026") into Financial Year (e.g. "2026-27") and Month Name (e.g. "July")
def get_financial_year_and_month(period_str):
    parts = period_str.split()
    if len(parts) != 2:
        return None, None
    month_name, year_str = parts
    try:
        year = int(year_str)
    except ValueError:
        return None, None
    
    month_lower = month_name.lower()
    if month_lower in ['january', 'february', 'march']:
        start_year = year - 1
    else:
        start_year = year
        
    fy = f"{start_year}-{str(start_year + 1)[2:]}"
    return fy, month_name

# Helper to find previous month planning period string and last year same month period string
def get_prev_and_ly_period(month, year_str):
    months_order = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    try:
        year = int(year_str)
    except ValueError:
        return None, None
        
    try:
        m_idx = months_order.index(month)
    except ValueError:
        return None, None
        
    if m_idx == 0:
        prev_month = "December"
        prev_year = year - 1
    else:
        prev_month = months_order[m_idx - 1]
        prev_year = year
        
    prev_period = f"{prev_month} {prev_year}"
    ly_period = f"{month} {year - 1}"
    return prev_period, ly_period

# GET planning sheet data & calculations
@app.route('/api/planning-sheet/data', methods=['GET'])
@login_required
def get_planning_sheet_data():
    month = request.args.get('month', '').strip()
    year = request.args.get('year', '').strip()
    
    if not month or not year:
        return jsonify({'success': False, 'message': 'Month and Year parameters are required.'}), 400
        
    planning_period = f"{month} {year}"
    prev_period, ly_period = get_prev_and_ly_period(month, year)
    
    month_map = {
        'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
        'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
    }
    m_num = month_map.get(month.lower())
    if not m_num:
        return jsonify({'success': False, 'message': f'Invalid month name: {month}'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 1. Fetch planning period status
        cur.execute("SELECT status, is_locked FROM planning_period_status WHERE planning_period = %s;", (planning_period,))
        status_row = cur.fetchone()
        if not status_row:
            cur.execute("""
                INSERT INTO planning_period_status (planning_period, status, is_locked)
                VALUES (%s, 'Draft', FALSE);
            """, (planning_period,))
            conn.commit()
            status = 'Draft'
            is_locked = False
        else:
            status, is_locked = status_row
            
        # 2. Fetch past saved contributions for variance/growth comparison
        cur.execute("""
            SELECT product_id, manual_contribution 
            FROM planning_sheet_records
            WHERE planning_period = %s
        """, (prev_period,))
        prev_contributions = {r[0]: float(r[1]) for r in cur.fetchall()}

        cur.execute("""
            SELECT product_id, manual_contribution 
            FROM planning_sheet_records
            WHERE planning_period = %s
        """, (ly_period,))
        ly_contributions = {r[0]: float(r[1]) for r in cur.fetchall()}

        # 3. Fetch active Product Masters
        cur.execute("""
            SELECT p.id, p.product_name, p.brand_id, b.brand_name, p.color_category
            FROM product_master p
            JOIN brand_master b ON p.brand_id = b.id
            WHERE p.status = 'Active'
            ORDER BY p.product_name ASC;
        """)
        active_products = cur.fetchall()
        product_ids = [p[0] for p in active_products]
        
        # 4. Fetch Sales Mappings
        product_mappings = {}
        all_mapped_sales_products = set()
        if product_ids:
            cur.execute("""
                SELECT product_id, sales_product_name 
                FROM product_sales_data_mapping
                WHERE product_id IN %s
            """, (tuple(product_ids),))
            for r in cur.fetchall():
                pid, sp_name = r
                if pid not in product_mappings:
                    product_mappings[pid] = []
                product_mappings[pid].append(sp_name)
                all_mapped_sales_products.add(sp_name)

        # 5. Fetch actual sales for current period, previous period, and last year same month
        current_sales = {}
        prev_sales = {}
        ly_sales = {}
        
        current_color_sales = {}
        current_size_sales = {}
        
        # Parse previous month numbers
        try:
            prev_yr = int(year)
            prev_m_num = m_num - 1
            if prev_m_num == 0:
                prev_m_num = 12
                prev_yr = prev_yr - 1
        except:
            prev_m_num = 1
            prev_yr = 2026
            
        if all_mapped_sales_products:
            tuple_mapped = tuple(all_mapped_sales_products)
            
            # Current sales
            cur.execute("""
                SELECT "product", SUM("Qty")
                FROM sales_data
                WHERE EXTRACT(MONTH FROM "MONTH") = %s AND EXTRACT(YEAR FROM "MONTH") = %s
                AND "product" IN %s
                GROUP BY "product";
            """, (m_num, int(year), tuple_mapped))
            current_sales = {r[0]: int(r[1] or 0) for r in cur.fetchall()}
            
            # Previous sales
            cur.execute("""
                SELECT "product", SUM("Qty")
                FROM sales_data
                WHERE EXTRACT(MONTH FROM "MONTH") = %s AND EXTRACT(YEAR FROM "MONTH") = %s
                AND "product" IN %s
                GROUP BY "product";
            """, (prev_m_num, prev_yr, tuple_mapped))
            prev_sales = {r[0]: int(r[1] or 0) for r in cur.fetchall()}
            
            # Last year same month sales
            cur.execute("""
                SELECT "product", SUM("Qty")
                FROM sales_data
                WHERE EXTRACT(MONTH FROM "MONTH") = %s AND EXTRACT(YEAR FROM "MONTH") = %s
                AND "product" IN %s
                GROUP BY "product";
            """, (m_num, int(year) - 1, tuple_mapped))
            ly_sales = {r[0]: int(r[1] or 0) for r in cur.fetchall()}
            
            # Current sales by Color (for color breakdown)
            cur.execute("""
                SELECT "product", "Color", SUM("Qty")
                FROM sales_data
                WHERE EXTRACT(MONTH FROM "MONTH") = %s AND EXTRACT(YEAR FROM "MONTH") = %s
                AND "product" IN %s AND "Color" IS NOT NULL
                GROUP BY "product", "Color";
            """, (m_num, int(year), tuple_mapped))
            for r in cur.fetchall():
                prod, color, qty = r
                if prod not in current_color_sales:
                    current_color_sales[prod] = {}
                current_color_sales[prod][color.strip().upper()] = int(qty or 0)
                
            # Current sales by Size (for size breakdown)
            cur.execute("""
                SELECT "product", "Size", SUM("Qty")
                FROM sales_data
                WHERE EXTRACT(MONTH FROM "MONTH") = %s AND EXTRACT(YEAR FROM "MONTH") = %s
                AND "product" IN %s AND "Size" IS NOT NULL
                GROUP BY "product", "Size";
            """, (m_num, int(year), tuple_mapped))
            for r in cur.fetchall():
                prod, sz, qty = r
                if prod not in current_size_sales:
                    current_size_sales[prod] = {}
                current_size_sales[prod][sz.strip().upper()] = int(qty or 0)

        # 6. Fetch saved Planning Records for the current period
        saved_records = {}
        saved_colors = {}
        saved_sizes = {}
        if product_ids:
            cur.execute("""
                SELECT id, product_id, suggested_contribution, manual_contribution, approved_contribution
                FROM planning_sheet_records
                WHERE planning_period = %s AND product_id IN %s
            """, (planning_period, tuple(product_ids)))
            for r in cur.fetchall():
                sheet_id, pid, sug, man, app = r
                saved_records[pid] = {
                    'id': sheet_id,
                    'suggested_contribution': float(sug),
                    'manual_contribution': float(man),
                    'approved_contribution': float(app)
                }
            
            saved_sheet_ids = [saved_records[pid]['id'] for pid in saved_records]
            if saved_sheet_ids:
                cur.execute("""
                    SELECT planning_id, color_id, suggested_percent, manual_percent
                    FROM planning_product_colors
                    WHERE planning_id IN %s
                """, (tuple(saved_sheet_ids),))
                for r in cur.fetchall():
                    sh_id, col_id, sug_pct, man_pct = r
                    if sh_id not in saved_colors:
                        saved_colors[sh_id] = {}
                    saved_colors[sh_id][col_id] = {
                        'suggested_percent': float(sug_pct),
                        'manual_percent': float(man_pct)
                    }

                cur.execute("""
                    SELECT planning_id, size_id, suggested_percent, manual_percent
                    FROM planning_product_sizes
                    WHERE planning_id IN %s
                """, (tuple(saved_sheet_ids),))
                for r in cur.fetchall():
                    sh_id, sz_id, sug_pct, man_pct = r
                    if sh_id not in saved_sizes:
                        saved_sizes[sh_id] = {}
                    saved_sizes[sh_id][sz_id] = {
                        'suggested_percent': float(sug_pct),
                        'manual_percent': float(man_pct)
                    }

        # 7. Merge sales quantities per Product Master
        product_sales_qty = {}
        product_sales_prev_qty = {}
        product_sales_ly_qty = {}
        
        for pid, pname, bid, bname, col_cat in active_products:
            mapped_names = product_mappings.get(pid, [])
            
            curr_sum = sum(current_sales.get(name, 0) for name in mapped_names)
            prev_sum = sum(prev_sales.get(name, 0) for name in mapped_names)
            ly_sum = sum(ly_sales.get(name, 0) for name in mapped_names)
            
            product_sales_qty[pid] = curr_sum
            product_sales_prev_qty[pid] = prev_sum
            product_sales_ly_qty[pid] = ly_sum

        total_current_sales_qty = sum(product_sales_qty.values())
        
        # BATCHED MAPPINGS FOR PHASE 2D:
        # Batch 1: All active colors mapped to active products
        batched_colors_map = {pid: [] for pid in product_ids}
        if product_ids:
            cur.execute("""
                SELECT pcm.product_id, c.id, c.global_color_code, c.display_color
                FROM product_color_mapping pcm
                JOIN product_master p ON pcm.product_id = p.id
                JOIN color_master c ON pcm.global_color_code = c.global_color_code AND c.category = p.color_category
                WHERE pcm.product_id = ANY(%s) AND c.status = 'Active';
            """, (product_ids,))
            for pid, cid, gcode, dcol in cur.fetchall():
                if pid in batched_colors_map:
                    batched_colors_map[pid].append((cid, gcode, dcol))

        # Batch 2: All active sizes mapped to active products
        batched_sizes_map = {pid: [] for pid in product_ids}
        if product_ids:
            cur.execute("""
                SELECT pdm.product_id, s.id, s.size_code, s.size
                FROM product_dia_mapping pdm
                JOIN size_master s ON pdm.size_id = s.id
                WHERE pdm.product_id = ANY(%s) AND s.status = 'Active'
                GROUP BY pdm.product_id, s.id, s.size_code, s.size;
            """, (product_ids,))
            for pid, sid, scode, sval in cur.fetchall():
                if pid in batched_sizes_map:
                    batched_sizes_map[pid].append((sid, scode, sval))
        
        # 8. Build products list payload with dynamically computed details
        products_payload = []
        for pid, pname, bid, bname, col_cat in active_products:
            mapped_names = product_mappings.get(pid, [])
            
            curr_qty = product_sales_qty[pid]
            ly_qty = product_sales_ly_qty[pid]
            
            # Suggested Contribution %
            if total_current_sales_qty > 0:
                sug_contrib = (curr_qty / total_current_sales_qty) * 100.0
            else:
                sug_contrib = 0.0
                
            # Growth %
            if ly_qty > 0:
                growth_pct = ((curr_qty - ly_qty) / ly_qty) * 100.0
            else:
                growth_pct = None # N/A
                
            # Saved manual contributions
            saved = saved_records.get(pid)
            if saved:
                manual_contrib = saved['manual_contribution']
                approved_contrib = saved['approved_contribution']
                sheet_record_id = saved['id']
            else:
                manual_contrib = sug_contrib
                approved_contrib = sug_contrib
                sheet_record_id = None
                
            variance = manual_contrib - sug_contrib
            last_month_contrib = prev_contributions.get(pid, 0.0)
            last_year_contrib = ly_contributions.get(pid, 0.0)
            
            # COLORS list for this product (from batched_colors_map)
            configured_colors = batched_colors_map.get(pid, [])
            
            colors_list = []
            color_sales_sum = 0
            temp_color_sales = {}
            for col_id, g_code, disp_col in configured_colors:
                c_qty = 0
                for name in mapped_names:
                    c_qty += current_color_sales.get(name, {}).get(disp_col.strip().upper(), 0)
                    c_qty += current_color_sales.get(name, {}).get(g_code.strip().upper(), 0)
                temp_color_sales[col_id] = c_qty
                color_sales_sum += c_qty
                
            for col_id, g_code, disp_col in configured_colors:
                c_qty = temp_color_sales[col_id]
                if color_sales_sum > 0:
                    sug_color_pct = (c_qty / color_sales_sum) * 100.0
                else:
                    sug_color_pct = 100.0 / len(configured_colors) if configured_colors else 0.0
                    
                # Load saved manual
                saved_col_data = saved_colors.get(sheet_record_id, {}).get(col_id) if sheet_record_id else None
                if saved_col_data:
                    man_color_pct = saved_col_data['manual_percent']
                else:
                    man_color_pct = sug_color_pct
                    
                colors_list.append({
                    'color_id': col_id,
                    'color_code': g_code,
                    'color_name': disp_col,
                    'sales_qty': c_qty,
                    'suggested_percent': round(sug_color_pct, 4),
                    'manual_percent': round(man_color_pct, 4),
                    'variance': round(man_color_pct - sug_color_pct, 4)
                })
                
            # SIZES list for this product (from batched_sizes_map)
            configured_sizes = batched_sizes_map.get(pid, [])
            
            sizes_list = []
            size_sales_sum = 0
            temp_size_sales = {}
            for sz_id, sz_code, sz_val in configured_sizes:
                s_qty = 0
                for name in mapped_names:
                    s_qty += current_size_sales.get(name, {}).get(sz_val.strip().upper(), 0)
                    s_qty += current_size_sales.get(name, {}).get(sz_code.strip().upper(), 0)
                temp_size_sales[sz_id] = s_qty
                size_sales_sum += s_qty
                
            for sz_id, sz_code, sz_val in configured_sizes:
                s_qty = temp_size_sales[sz_id]
                if size_sales_sum > 0:
                    sug_sz_pct = (s_qty / size_sales_sum) * 100.0
                else:
                    sug_sz_pct = 100.0 / len(configured_sizes) if configured_sizes else 0.0
                    
                # Load saved manual
                saved_sz_data = saved_sizes.get(sheet_record_id, {}).get(sz_id) if sheet_record_id else None
                if saved_sz_data:
                    man_sz_pct = saved_sz_data['manual_percent']
                else:
                    man_sz_pct = sug_sz_pct
                    
                sizes_list.append({
                    'size_id': sz_id,
                    'size_code': sz_code,
                    'size_name': sz_val,
                    'sales_qty': s_qty,
                    'suggested_percent': round(sug_sz_pct, 4),
                    'manual_percent': round(man_sz_pct, 4),
                    'variance': round(man_sz_pct - sug_sz_pct, 4)
                })

            products_payload.append({
                'product_id': pid,
                'product_name': pname,
                'brand_id': bid,
                'brand_name': bname,
                'sales_products': mapped_names,
                'sales_qty': curr_qty,
                'growth_percent': round(growth_pct, 2) if growth_pct is not None else None,
                'last_month_contribution': round(last_month_contrib, 4),
                'last_year_contribution': round(last_year_contrib, 4),
                'suggested_contribution': round(sug_contrib, 4),
                'manual_contribution': round(manual_contrib, 4),
                'approved_contribution': round(approved_contrib, 4),
                'variance': round(variance, 4),
                'colors': colors_list,
                'sizes': sizes_list
            })
            
        # 9. Query Total Planned Qty from Overall Quantity Planning
        fy, m_name = get_financial_year_and_month(planning_period)
        total_planned_qty = 0
        if fy and m_name:
            cur.execute("""
                SELECT d.final_qty 
                FROM planning_details d
                JOIN planning_headers h ON d.planning_id = h.id
                WHERE h.financial_year = %s AND d.month = %s AND h.is_latest = TRUE
                ORDER BY h.version DESC LIMIT 1;
            """, (fy, m_name))
            row = cur.fetchone()
            if row:
                total_planned_qty = int(row[0] or 0)

        cur.close()
        return jsonify({
            'success': True,
            'planning_period': planning_period,
            'status': status,
            'is_locked': is_locked,
            'total_sales_qty': total_current_sales_qty,
            'total_planned_qty': total_planned_qty,
            'products': products_payload
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Error loading planning data: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# SAVE planning sheet data
@app.route('/api/planning-sheet/save', methods=['POST'])
@login_required
def save_planning_sheet():
    data = request.json or {}
    period = data.get('planning_period', '').strip()
    products = data.get('products', [])
    
    if not period:
        return jsonify({'success': False, 'message': 'Planning period is required.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Check if period is locked
        cur.execute("SELECT is_locked FROM planning_period_status WHERE planning_period = %s;", (period,))
        row = cur.fetchone()
        if row and row[0]:
            cur.close()
            return jsonify({'success': False, 'message': 'This planning period is locked and cannot be edited.'}), 403
            
        # Ensure status row exists
        if not row:
            cur.execute("""
                INSERT INTO planning_period_status (planning_period, status, is_locked)
                VALUES (%s, 'Draft', FALSE);
            """, (period,))
            
        # Loop products and save contributions
        for p in products:
            pid = p.get('product_id')
            sug_contrib = float(p.get('suggested_contribution', 0.0))
            man_contrib = float(p.get('manual_contribution', 0.0))
            app_contrib = float(p.get('approved_contribution', man_contrib)) # Approved contribution equals manual contribution on save
            
            cur.execute("""
                INSERT INTO planning_sheet_records (planning_period, product_id, suggested_contribution, manual_contribution, approved_contribution)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (planning_period, product_id) 
                DO UPDATE SET 
                    suggested_contribution = EXCLUDED.suggested_contribution,
                    manual_contribution = EXCLUDED.manual_contribution,
                    approved_contribution = EXCLUDED.approved_contribution,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id;
            """, (period, pid, sug_contrib, man_contrib, app_contrib))
            
            planning_record_id = cur.fetchone()[0]
            
            # Save colors breakdown
            for col in p.get('colors', []):
                col_id = col.get('color_id')
                sug_col_pct = float(col.get('suggested_percent', 0.0))
                man_col_pct = float(col.get('manual_percent', 0.0))
                cur.execute("""
                    INSERT INTO planning_product_colors (planning_id, product_id, color_id, suggested_percent, manual_percent)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (planning_id, color_id)
                    DO UPDATE SET
                        suggested_percent = EXCLUDED.suggested_percent,
                        manual_percent = EXCLUDED.manual_percent;
                """, (planning_record_id, pid, col_id, sug_col_pct, man_col_pct))
                
            # Save sizes breakdown
            for sz in p.get('sizes', []):
                sz_id = sz.get('size_id')
                sug_sz_pct = float(sz.get('suggested_percent', 0.0))
                man_sz_pct = float(sz.get('manual_percent', 0.0))
                cur.execute("""
                    INSERT INTO planning_product_sizes (planning_id, product_id, size_id, suggested_percent, manual_percent)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (planning_id, size_id)
                    DO UPDATE SET
                        suggested_percent = EXCLUDED.suggested_percent,
                        manual_percent = EXCLUDED.manual_percent;
                """, (planning_record_id, pid, sz_id, sug_sz_pct, man_sz_pct))
                
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Planning sheet saved successfully.'})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Error saving planning sheet: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# COPY manual contributions from previous month
@app.route('/api/planning-sheet/copy-previous', methods=['GET', 'POST'])
@login_required
def copy_previous_month():
    if request.method == 'POST':
        data = request.json or {}
        period = data.get('planning_period', '').strip()
    else:
        period = request.args.get('planning_period', '').strip()
        
    if not period:
        return jsonify({'success': False, 'message': 'Planning period is required.'}), 400
        
    parts = period.split()
    if len(parts) != 2:
        return jsonify({'success': False, 'message': 'Invalid period format.'}), 400
        
    month, year = parts
    prev_period, ly_period = get_prev_and_ly_period(month, year)
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, product_id, manual_contribution
            FROM planning_sheet_records
            WHERE planning_period = %s;
        """, (prev_period,))
        records = cur.fetchall()
        
        if not records:
            cur.close()
            return jsonify({
                'success': False, 
                'message': f'No saved planning data found for the previous month ({prev_period}).'
            })
            
        copied_data = {}
        for rid, pid, man_contrib in records:
            cur.execute("""
                SELECT color_id, manual_percent
                FROM planning_product_colors
                WHERE planning_id = %s;
            """, (rid,))
            colors_map = {r[0]: float(r[1]) for r in cur.fetchall()}
            
            cur.execute("""
                SELECT size_id, manual_percent
                FROM planning_product_sizes
                WHERE planning_id = %s;
            """, (rid,))
            sizes_map = {r[0]: float(r[1]) for r in cur.fetchall()}
            
            copied_data[pid] = {
                'manual_contribution': float(man_contrib),
                'colors': colors_map,
                'sizes': sizes_map
            }
            
        cur.close()
        return jsonify({
            'success': True,
            'copied_period': prev_period,
            'data': copied_data
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error copying previous month: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

# UPDATE status / lock state
@app.route('/api/planning-sheet/status', methods=['POST'])
@login_required
def update_planning_sheet_status():
    data = request.json or {}
    period = data.get('planning_period', '').strip()
    status = data.get('status', '').strip()
    is_locked = data.get('is_locked')
    
    if not period:
        return jsonify({'success': False, 'message': 'Planning period is required.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT status, is_locked FROM planning_period_status WHERE planning_period = %s;", (period,))
        row = cur.fetchone()
        
        if is_locked is True or status == 'Approved':
            cur.execute("""
                UPDATE planning_sheet_records
                SET approved_contribution = manual_contribution, updated_at = CURRENT_TIMESTAMP
                WHERE planning_period = %s;
            """, (period,))
            
        if not row:
            cur.execute("""
                INSERT INTO planning_period_status (planning_period, status, is_locked)
                VALUES (%s, %s, %s);
            """, (period, status or 'Draft', is_locked if is_locked is not None else False))
        else:
            update_fields = []
            params = []
            if status:
                update_fields.append("status = %s")
                params.append(status)
            if is_locked is not None:
                update_fields.append("is_locked = %s")
                params.append(is_locked)
                
            if update_fields:
                params.append(period)
                cur.execute(f"""
                    UPDATE planning_period_status
                    SET {", ".join(update_fields)}, updated_at = CURRENT_TIMESTAMP
                    WHERE planning_period = %s;
                """, tuple(params))
                
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': 'Planning status updated successfully.'})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Error updating status: {str(e)}'}), 500
    finally:
        release_db_connection(conn)
# --- PLANNING CONTRIBUTION SHEET ENDPOINTS ---

# GET metadata for filters
@app.route('/api/planning-contribution/meta', methods=['GET'])
@login_required
def get_planning_contribution_meta():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Brands
        cur.execute("SELECT id, brand_name FROM brand_master WHERE status = 'Active' ORDER BY brand_name;")
        brands = [{'id': r[0], 'brand_name': r[1]} for r in cur.fetchall()]
        
        # Products
        cur.execute("SELECT id, product_name, product_type, brand_id FROM product_master WHERE status = 'Active' ORDER BY product_name;")
        products = [{'id': r[0], 'product_name': r[1], 'product_type': r[2], 'brand_id': r[3]} for r in cur.fetchall()]
        
        # Sales products mapping
        cur.execute("SELECT product_id, sales_product_name FROM product_sales_data_mapping ORDER BY sales_product_name;")
        sales_mappings = []
        for p_id, s_name in cur.fetchall():
            sales_mappings.append({'product_id': p_id, 'sales_product_name': s_name})
            
        # Product color mapping
        cur.execute("SELECT DISTINCT product_id, global_color_code FROM product_color_mapping;")
        color_mappings = []
        for p_id, col in cur.fetchall():
            color_mappings.append({'product_id': p_id, 'global_color_code': col})
            
        # Product size mapping
        cur.execute("SELECT DISTINCT product_id, size_id FROM product_dia_mapping;")
        size_mappings = []
        for p_id, s_id in cur.fetchall():
            size_mappings.append({'product_id': p_id, 'size_id': s_id})
            
        # Colors master
        cur.execute("SELECT global_color_code, display_color FROM color_master WHERE status = 'Active' ORDER BY display_color;")
        colors = [{'color_code': r[0], 'color_name': r[1]} for r in cur.fetchall()]
        
        # Sizes master
        cur.execute("SELECT id, size, size_code FROM size_master WHERE status = 'Active' ORDER BY size;")
        sizes = [{'id': r[0], 'size_name': r[1], 'size_code': r[2]} for r in cur.fetchall()]
        
        cur.close()
        return jsonify({
            'success': True,
            'brands': brands,
            'products': products,
            'sales_mappings': sales_mappings,
            'color_mappings': color_mappings,
            'size_mappings': size_mappings,
            'colors': colors,
            'sizes': sizes
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading metadata: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

# GET distinct contribution versions
@app.route('/api/planning-contribution/versions', methods=['GET'])
@login_required
def get_planning_contribution_versions():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT version FROM planning_contributions ORDER BY version;")
        versions = [r[0] for r in cur.fetchall()]
        if 'Standard' not in versions:
            versions.insert(0, 'Standard')
        return jsonify({'success': True, 'versions': versions})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

# POST copy contribution version data
@app.route('/api/planning-contribution/copy-version', methods=['POST'])
@login_required
def copy_planning_contribution_version():
    data = request.json or {}
    c_type = data.get('contribution_type', '').strip()
    source_ver = data.get('source_version', '').strip()
    target_ver = data.get('target_version', '').strip()
    
    if not c_type or not source_ver or not target_ver:
        return jsonify({'success': False, 'message': 'Missing contribution type, source, or target version.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        username = session.get('username', 'admin')
        if c_type == 'Product':
            cur.execute("""
                INSERT INTO planning_contributions (
                    contribution_type, product_id, color_code, size_id, brand_id, 
                    manual_pct, version, status, created_by,
                    fixed_percentage, last_updated, updated_by
                )
                SELECT contribution_type, product_id, color_code, size_id, brand_id,
                       manual_pct, %s, 'Draft', %s,
                       fixed_percentage, last_updated, updated_by
                FROM planning_contributions
                WHERE contribution_type = 'Product' AND version = %s
                ON CONFLICT (contribution_type, product_id, brand_id, version) 
                WHERE (contribution_type = 'Product')
                DO UPDATE SET manual_pct = EXCLUDED.manual_pct, updated_at = CURRENT_TIMESTAMP,
                              fixed_percentage = EXCLUDED.fixed_percentage, last_updated = EXCLUDED.last_updated, updated_by = EXCLUDED.updated_by;
            """, (target_ver, username, source_ver))
        elif c_type == 'Color':
            cur.execute("""
                INSERT INTO planning_contributions (
                    contribution_type, product_id, color_code, size_id, brand_id, 
                    manual_pct, version, status, created_by,
                    fixed_percentage, last_updated, updated_by
                )
                SELECT contribution_type, product_id, color_code, size_id, brand_id,
                       manual_pct, %s, 'Draft', %s,
                       fixed_percentage, last_updated, updated_by
                FROM planning_contributions
                WHERE contribution_type = 'Color' AND version = %s
                ON CONFLICT (contribution_type, product_id, color_code, brand_id, version) 
                WHERE (contribution_type = 'Color')
                DO UPDATE SET manual_pct = EXCLUDED.manual_pct, updated_at = CURRENT_TIMESTAMP,
                              fixed_percentage = EXCLUDED.fixed_percentage, last_updated = EXCLUDED.last_updated, updated_by = EXCLUDED.updated_by;
            """, (target_ver, username, source_ver))
        elif c_type == 'Size':
            # Color-wise
            cur.execute("""
                INSERT INTO planning_contributions (
                    contribution_type, product_id, color_code, size_id, brand_id, 
                    manual_pct, version, status, created_by,
                    fixed_percentage, last_updated, updated_by
                )
                SELECT contribution_type, product_id, color_code, size_id, brand_id,
                       manual_pct, %s, 'Draft', %s,
                       fixed_percentage, last_updated, updated_by
                FROM planning_contributions
                WHERE contribution_type = 'Size' AND color_code IS NOT NULL AND version = %s
                ON CONFLICT (contribution_type, product_id, size_id, color_code, brand_id, version) 
                WHERE (contribution_type = 'Size' AND color_code IS NOT NULL)
                DO UPDATE SET manual_pct = EXCLUDED.manual_pct, updated_at = CURRENT_TIMESTAMP,
                              fixed_percentage = EXCLUDED.fixed_percentage, last_updated = EXCLUDED.last_updated, updated_by = EXCLUDED.updated_by;
            """, (target_ver, username, source_ver))
            
            # Overall
            cur.execute("""
                INSERT INTO planning_contributions (
                    contribution_type, product_id, color_code, size_id, brand_id, 
                    manual_pct, version, status, created_by,
                    fixed_percentage, last_updated, updated_by
                )
                SELECT contribution_type, product_id, color_code, size_id, brand_id,
                       manual_pct, %s, 'Draft', %s,
                       fixed_percentage, last_updated, updated_by
                FROM planning_contributions
                WHERE contribution_type = 'Size' AND color_code IS NULL AND version = %s
                ON CONFLICT (contribution_type, product_id, size_id, brand_id, version) 
                WHERE (contribution_type = 'Size' AND color_code IS NULL)
                DO UPDATE SET manual_pct = EXCLUDED.manual_pct, updated_at = CURRENT_TIMESTAMP,
                              fixed_percentage = EXCLUDED.fixed_percentage, last_updated = EXCLUDED.last_updated, updated_by = EXCLUDED.updated_by;
            """, (target_ver, username, source_ver))
                
        conn.commit()
        cur.close()
        return jsonify({'success': True, 'message': f'Successfully copied contributions from version "{source_ver}" to "{target_ver}".'})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'success': False, 'message': f'Error copying version: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

# POST calculate single row parameters on period change
@app.route('/api/planning-contribution/calculate-row', methods=['POST'])
@login_required
def calculate_planning_contribution_row():
    data = request.json or {}
    c_type = data.get('contribution_type', '').strip()
    from_month = data.get('from_month', 'April').strip()
    from_year = int(data.get('from_year', 2026))
    to_month = data.get('to_month', 'December').strip()
    to_year = int(data.get('to_year', 2026))
    sales_prods = data.get('sales_products', [])
    product_id = data.get('product_id')
    color_code = data.get('color_code')
    size_id = data.get('size_id')
    
    if not c_type:
        return jsonify({'success': False, 'message': 'Missing required fields.'}), 400
        
    MONTH_NAMES = {
        'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
        'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
    }
    
    try:
        from_m_num = MONTH_NAMES.get(from_month, 4)
        from_date = date(from_year, from_m_num, 1)
        
        to_m_num = MONTH_NAMES.get(to_month, 12)
        if to_m_num == 12:
            to_date = date(to_year, 12, 31)
        else:
            to_date = date(to_year, to_m_num + 1, 1) - timedelta(days=1)
            
        from_date_ly = date(from_year - 1, from_m_num, 1)
        if to_m_num == 12:
            to_date_ly = date(to_year - 1, 12, 31)
        else:
            to_date_ly = date(to_year - 1, to_m_num + 1, 1) - timedelta(days=1)
            
    except Exception as parse_err:
        return jsonify({'success': False, 'message': f'Error parsing periods: {str(parse_err)}'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Resolve global color code to display color
        color_display = ''
        if color_code:
            cur.execute("SELECT display_color FROM color_master WHERE global_color_code = %s LIMIT 1;", (color_code,))
            row_disp = cur.fetchone()
            color_display = row_disp[0] if row_disp else color_code

        # Denominator initialization
        denom = 0.0
        denom_ly = 0.0
        qty = 0.0
        qty_ly = 0.0
        
        if c_type == 'Product':
            cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (from_date, to_date))
            oq = cur.fetchone()
            denom = float(oq[0]) if oq and oq[0] is not None else 0.0
            
            cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (from_date_ly, to_date_ly))
            oql = cur.fetchone()
            denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
            
            if sales_prods:
                cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date, to_date, sales_prods))
                r = cur.fetchone()
                qty = float(r[0]) if r and r[0] is not None else 0.0
                
                cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date_ly, to_date_ly, sales_prods))
                r_ly = cur.fetchone()
                qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                
        elif c_type == 'Color':
            if sales_prods:
                cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date, to_date, sales_prods))
                oq = cur.fetchone()
                denom = float(oq[0]) if oq and oq[0] is not None else 0.0
                
                cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date_ly, to_date_ly, sales_prods))
                oql = cur.fetchone()
                denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
                
                cur.execute("""
                    SELECT SUM(COALESCE(s."Qty", 0))
                    FROM sales_data s
                    JOIN color_master cm ON s."Color" = cm.display_color
                    WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                """, (sales_prods, color_code, from_date, to_date))
                r = cur.fetchone()
                qty = float(r[0]) if r and r[0] is not None else 0.0
                
                cur.execute("""
                    SELECT SUM(COALESCE(s."Qty", 0))
                    FROM sales_data s
                    JOIN color_master cm ON s."Color" = cm.display_color
                    WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                """, (sales_prods, color_code, from_date_ly, to_date_ly))
                r_ly = cur.fetchone()
                qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                
        elif c_type == 'Size' and size_id:
            cur.execute("SELECT size FROM size_master WHERE id = %s;", (size_id,))
            sz_row = cur.fetchone()
            sz_name = sz_row[0] if sz_row else ''
            
            if sales_prods and sz_name:
                if color_code:
                    cur.execute("""
                        SELECT SUM(COALESCE(s."Qty", 0))
                        FROM sales_data s
                        JOIN color_master cm ON s."Color" = cm.display_color
                        WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                    """, (sales_prods, color_code, from_date, to_date))
                    oq = cur.fetchone()
                    denom = float(oq[0]) if oq and oq[0] is not None else 0.0
                    
                    cur.execute("""
                        SELECT SUM(COALESCE(s."Qty", 0))
                        FROM sales_data s
                        JOIN color_master cm ON s."Color" = cm.display_color
                        WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                    """, (sales_prods, color_code, from_date_ly, to_date_ly))
                    oql = cur.fetchone()
                    denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
                    
                    cur.execute("""
                        SELECT SUM(COALESCE(s."Qty", 0))
                        FROM sales_data s
                        JOIN color_master cm ON s."Color" = cm.display_color
                        WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."Size" = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                    """, (sales_prods, color_code, sz_name, from_date, to_date))
                    r = cur.fetchone()
                    qty = float(r[0]) if r and r[0] is not None else 0.0
                    
                    cur.execute("""
                        SELECT SUM(COALESCE(s."Qty", 0))
                        FROM sales_data s
                        JOIN color_master cm ON s."Color" = cm.display_color
                        WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."Size" = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                    """, (sales_prods, color_code, sz_name, from_date_ly, to_date_ly))
                    r_ly = cur.fetchone()
                    qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                else:
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s;', (sales_prods, from_date, to_date))
                    oq = cur.fetchone()
                    denom = float(oq[0]) if oq and oq[0] is not None else 0.0
                    
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s;', (sales_prods, from_date_ly, to_date_ly))
                    oql = cur.fetchone()
                    denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
                    
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "Size" = %s AND "MONTH" >= %s AND "MONTH" <= %s;', (sales_prods, sz_name, from_date, to_date))
                    r = cur.fetchone()
                    qty = float(r[0]) if r and r[0] is not None else 0.0
                    
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "Size" = %s AND "MONTH" >= %s AND "MONTH" <= %s;', (sales_prods, sz_name, from_date_ly, to_date_ly))
                    r_ly = cur.fetchone()
                    qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                    
        avg_pct = (qty / denom * 100.0) if denom > 0.0 else 0.0
        ly_pct = (qty_ly / denom_ly * 100.0) if denom_ly > 0.0 else 0.0
        
        suggestion_rule = data.get('suggestion_rule', 'Average Sales %').strip()
        if suggestion_rule == 'Weighted Average + Last Year':
            sug_pct = 0.5 * avg_pct + 0.5 * ly_pct
        else:
            sug_pct = avg_pct
            
        cur.close()
        return jsonify({
            'success': True,
            'selected_period_avg_pct': avg_pct,
            'last_year_same_period_pct': ly_pct,
            'suggested_pct': sug_pct
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error calculating row: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

# POST calculate multiple rows parameters on bulk period change
@app.route('/api/planning-contribution/calculate-rows-bulk', methods=['POST'])
@login_required
def calculate_planning_contribution_rows_bulk():
    data = request.json or {}
    c_type = data.get('contribution_type', '').strip()
    from_month = data.get('from_month', 'April').strip()
    from_year = int(data.get('from_year', 2026))
    to_month = data.get('to_month', 'December').strip()
    to_year = int(data.get('to_year', 2026))
    rows = data.get('rows', [])
    suggestion_rule = data.get('suggestion_rule', 'Average Sales %').strip()
    
    if not c_type or not rows:
        return jsonify({'success': False, 'message': 'Missing required fields.'}), 400
        
    MONTH_NAMES = {
        'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
        'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
    }
    
    try:
        from_m_num = MONTH_NAMES.get(from_month, 4)
        from_date = date(from_year, from_m_num, 1)
        
        to_m_num = MONTH_NAMES.get(to_month, 12)
        if to_m_num == 12:
            to_date = date(to_year, 12, 31)
        else:
            to_date = date(to_year, to_m_num + 1, 1) - timedelta(days=1)
            
        from_date_ly = date(from_year - 1, from_m_num, 1)
        if to_m_num == 12:
            to_date_ly = date(to_year - 1, 12, 31)
        else:
            to_date_ly = date(to_year - 1, to_m_num + 1, 1) - timedelta(days=1)
            
    except Exception as parse_err:
        return jsonify({'success': False, 'message': f'Error parsing periods: {str(parse_err)}'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    results = []
    try:
        global_denom = None
        global_denom_ly = None
        
        if c_type == 'Product':
            cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (from_date, to_date))
            oq = cur.fetchone()
            global_denom = float(oq[0]) if oq and oq[0] is not None else 0.0
            
            cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (from_date_ly, to_date_ly))
            oql = cur.fetchone()
            global_denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
            
        for r_data in rows:
            product_id = r_data.get('product_id')
            color_code = r_data.get('color_code')
            size_id = r_data.get('size_id')
            active_sales = r_data.get('active_sales_products', [])
            
            denom = 0.0
            denom_ly = 0.0
            qty = 0.0
            qty_ly = 0.0
            
            if c_type == 'Product':
                denom = global_denom
                denom_ly = global_denom_ly
                if active_sales:
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date, to_date, active_sales))
                    r = cur.fetchone()
                    qty = float(r[0]) if r and r[0] is not None else 0.0
                    
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date_ly, to_date_ly, active_sales))
                    r_ly = cur.fetchone()
                    qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                    
            elif c_type == 'Color':
                if active_sales:
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date, to_date, active_sales))
                    oq = cur.fetchone()
                    denom = float(oq[0]) if oq and oq[0] is not None else 0.0
                    
                    cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s);', (from_date_ly, to_date_ly, active_sales))
                    oql = cur.fetchone()
                    denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
                    
                    cur.execute("""
                        SELECT SUM(COALESCE(s."Qty", 0))
                        FROM sales_data s
                        JOIN color_master cm ON s."Color" = cm.display_color
                        WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                    """, (active_sales, color_code, from_date, to_date))
                    r = cur.fetchone()
                    qty = float(r[0]) if r and r[0] is not None else 0.0
                    
                    cur.execute("""
                        SELECT SUM(COALESCE(s."Qty", 0))
                        FROM sales_data s
                        JOIN color_master cm ON s."Color" = cm.display_color
                        WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                    """, (active_sales, color_code, from_date_ly, to_date_ly))
                    r_ly = cur.fetchone()
                    qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                    
            elif c_type == 'Size' and size_id:
                cur.execute("SELECT size FROM size_master WHERE id = %s;", (size_id,))
                sz_row = cur.fetchone()
                sz_name = sz_row[0] if sz_row else ''
                
                if active_sales and sz_name:
                    if color_code:
                        cur.execute("""
                            SELECT SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                        """, (active_sales, color_code, from_date, to_date))
                        oq = cur.fetchone()
                        denom = float(oq[0]) if oq and oq[0] is not None else 0.0
                        
                        cur.execute("""
                            SELECT SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                        """, (active_sales, color_code, from_date_ly, to_date_ly))
                        oql = cur.fetchone()
                        denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
                        
                        cur.execute("""
                            SELECT SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."Size" = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                        """, (active_sales, color_code, sz_name, from_date, to_date))
                        r = cur.fetchone()
                        qty = float(r[0]) if r and r[0] is not None else 0.0
                        
                        cur.execute("""
                            SELECT SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND cm.global_color_code = %s AND s."Size" = %s AND s."MONTH" >= %s AND s."MONTH" <= %s;
                        """, (active_sales, color_code, sz_name, from_date_ly, to_date_ly))
                        r_ly = cur.fetchone()
                        qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                    else:
                        cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s;', (active_sales, from_date, to_date))
                        oq = cur.fetchone()
                        denom = float(oq[0]) if oq and oq[0] is not None else 0.0
                        
                        cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s;', (active_sales, from_date_ly, to_date_ly))
                        oql = cur.fetchone()
                        denom_ly = float(oql[0]) if oql and oql[0] is not None else 0.0
                        
                        cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "Size" = %s AND "MONTH" >= %s AND "MONTH" <= %s;', (active_sales, sz_name, from_date, to_date))
                        r = cur.fetchone()
                        qty = float(r[0]) if r and r[0] is not None else 0.0
                        
                        cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "product" = ANY(%s) AND "Size" = %s AND "MONTH" >= %s AND "MONTH" <= %s;', (active_sales, sz_name, from_date_ly, to_date_ly))
                        r_ly = cur.fetchone()
                        qty_ly = float(r_ly[0]) if r_ly and r_ly[0] is not None else 0.0
                        
            avg_pct = (qty / denom * 100.0) if denom > 0.0 else 0.0
            ly_pct = (qty_ly / denom_ly * 100.0) if denom_ly > 0.0 else 0.0
            
            if suggestion_rule == 'Weighted Average + Last Year':
                sug_pct = 0.5 * avg_pct + 0.5 * ly_pct
            else:
                sug_pct = avg_pct
                
            results.append({
                'product_id': product_id,
                'color_code': color_code,
                'size_id': size_id,
                'selected_period_avg_pct': avg_pct,
                'last_year_same_period_pct': ly_pct,
                'suggested_pct': sug_pct
            })
            
        cur.close()
        return jsonify({
            'success': True,
            'results': results
        })
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'success': False, 'message': f'Error performing bulk calculation: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

def safe_float(v, default=0.0):
    try:
        val = float(v)
        return val if math.isfinite(val) else default
    except (TypeError, ValueError):
        return default


def normalize_percentages(raw_values):
    import math
    if not raw_values:
        return []
    safe_vals = [safe_float(v, 0.0) for v in raw_values]
    total_raw = sum(safe_vals)
    if total_raw <= 0.0 or not math.isfinite(total_raw):
        return [0.00] * len(safe_vals)
        
    scaled = [(v / total_raw) * 100.0 for v in safe_vals]
    
    # Floor each to 2 decimal places and find the difference
    floored = [math.floor(v * 100) / 100.0 for v in scaled]
    diff = 100.00 - sum(floored)
    # Convert difference to number of 0.01 units
    units = int(round(diff * 100))
    
    if units != 0:
        # Sort indices by their remainders (descending)
        remainders = [(i, (scaled[i] - floored[i])) for i in range(len(scaled))]
        remainders.sort(key=lambda x: x[1], reverse=True)
        
        # Distribute the units
        for k in range(min(abs(units), len(scaled))):
            idx = remainders[k][0]
            if units > 0:
                floored[idx] = round(floored[idx] + 0.01, 2)
            else:
                floored[idx] = round(floored[idx] - 0.01, 2)
                
    return [round(f, 2) for f in floored]



MONTH_NAMES = {
    'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
    'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
}

def parse_period_dates(from_m, from_y, to_m, to_y):
    try:
        f_month = MONTH_NAMES.get(from_m, 4)
        f_date = date(int(from_y), f_month, 1)
        
        t_month = MONTH_NAMES.get(to_m, 12)
        if t_month == 12:
            t_date = date(int(to_y), 12, 31)
        else:
            t_date = date(int(to_y), t_month + 1, 1) - timedelta(days=1)
            
        f_date_ly = date(int(from_y) - 1, f_month, 1)
        if t_month == 12:
            t_date_ly = date(int(to_y) - 1, 12, 31)
        else:
            t_date_ly = date(int(to_y) - 1, t_month + 1, 1) - timedelta(days=1)
            
        return f_date, t_date, f_date_ly, t_date_ly
    except Exception:
        return date(2026, 4, 1), date(2026, 12, 31), date(2025, 4, 1), date(2025, 12, 31)


# GET contributions data for Contribution Master page with server-side pagination
@app.route('/api/planning-contribution/data', methods=['GET'])
@login_required
def get_planning_contribution_data():
    c_type = request.args.get('contribution_type', 'Product').strip()
    brand_id = request.args.get('brand_id', '').strip()
    version = request.args.get('version', 'Standard').strip() or 'Standard'
    color_code_filter = request.args.get('color_code', '').strip()
    size_id_filter = request.args.get('size_id', '').strip()
    
    # Filter arrays
    product_ids_raw = request.args.get('product_ids', '')
    product_ids = [int(x) for x in product_ids_raw.split(',') if x.strip()] if product_ids_raw else []
    
    # Pagination args
    try:
        page = int(request.args.get('page', 1))
        if page < 1: page = 1
    except:
        page = 1
        
    try:
        per_page = int(request.args.get('per_page', 10))
        if per_page < 1: per_page = 10
    except:
        per_page = 10
        
    offset = (page - 1) * per_page
    
    req_from_m = request.args.get('from_month', '').strip()
    req_from_y = request.args.get('from_year', '').strip()
    req_to_m = request.args.get('to_month', '').strip()
    req_to_y = request.args.get('to_year', '').strip()

    from_m = req_from_m if req_from_m else 'April'
    try:
        from_y = int(req_from_y) if req_from_y else 2026
    except ValueError:
        from_y = 2026
    to_m = req_to_m if req_to_m else 'December'
    try:
        to_y = int(req_to_y) if req_to_y else 2026
    except ValueError:
        to_y = 2026
        
    default_from_month = from_m
    default_from_year = from_y
    default_to_month = to_m
    default_to_year = to_y
 
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Resolve global color code to display color
        color_display_filter = ''
        if color_code_filter:
            cur.execute("SELECT display_color FROM color_master WHERE global_color_code = %s LIMIT 1;", (color_code_filter,))
            row_disp = cur.fetchone()
            color_display_filter = row_disp[0] if row_disp else color_code_filter

        message = None
        results = []
        total_count = 0
        
        if c_type == 'Product':
            # Count query
            count_q = "SELECT COUNT(*) FROM product_master p WHERE p.status = 'Active'"
            params = []
            if brand_id:
                count_q += " AND p.brand_id = %s"
                params.append(int(brand_id))
            if product_ids:
                count_q += " AND p.id = ANY(%s)"
                params.append(product_ids)
            cur.execute(count_q, tuple(params))
            total_count = cur.fetchone()[0] or 0
            
            # Data query
            q = """
                SELECT p.id, p.product_name, p.product_type, b.brand_name, d.product_description, p.brand_id
                FROM product_master p
                JOIN brand_master b ON p.brand_id = b.id
                JOIN product_description_master d ON p.product_description_id = d.id
                WHERE p.status = 'Active'
            """
            q_params = []
            if brand_id:
                q += " AND p.brand_id = %s"
                q_params.append(int(brand_id))
            if product_ids:
                q += " AND p.id = ANY(%s)"
                q_params.append(product_ids)
            q += " ORDER BY p.product_name LIMIT %s OFFSET %s;"
            q_params.extend([per_page, offset])
            
            cur.execute(q, tuple(q_params))
            products = cur.fetchall()
            
            # Preload sales mappings for the paginated products
            prod_ids = [p[0] for p in products]
            prod_sales_map = {}
            if prod_ids:
                cur.execute("""
                    SELECT product_id, sales_product_name 
                    FROM product_sales_data_mapping 
                    WHERE product_id = ANY(%s);
                """, (prod_ids,))
                for pid, sname in cur.fetchall():
                    if pid not in prod_sales_map:
                        prod_sales_map[pid] = []
                    prod_sales_map[pid].append(sname)
            
            f_date, t_date, f_date_ly, t_date_ly = parse_period_dates(from_m, from_y, to_m, to_y)
            
            cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (f_date, t_date))
            oq = cur.fetchone()
            overall_qty = safe_float(oq[0]) if oq and oq[0] is not None else 0.0
            
            cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (f_date_ly, t_date_ly))
            oql = cur.fetchone()
            overall_qty_ly = safe_float(oql[0]) if oql and oql[0] is not None else 0.0

            # BATCH 1: Saved contributions for page products (ordered by latest updated)
            saved_map_p = {}
            if prod_ids:
                cur.execute("""
                    SELECT product_id, manual_pct, status, last_updated, updated_by, COALESCE(fixed_percentage, manual_pct)
                    FROM planning_contributions
                    WHERE product_id = ANY(%s) AND contribution_type = 'Product' AND version = %s
                    ORDER BY product_id, COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
                """, (prod_ids, version))
                for r in cur.fetchall():
                    pid = r[0]
                    if pid not in saved_map_p:
                        saved_map_p[pid] = r[1:]

            # BATCH 2: Sales quantities for all sales products in the page (current & last year)
            all_page_sales = list(set([sp for sp_list in prod_sales_map.values() for sp in sp_list]))
            sales_qty_curr_map = {}
            sales_qty_ly_map = {}
            if all_page_sales:
                cur.execute("""
                    SELECT product, SUM(COALESCE("Qty", 0))
                    FROM sales_data
                    WHERE "MONTH" >= %s AND "MONTH" <= %s AND product = ANY(%s)
                    GROUP BY product;
                """, (f_date, t_date, all_page_sales))
                for sp_name, qty in cur.fetchall():
                    sales_qty_curr_map[sp_name] = safe_float(qty)

                cur.execute("""
                    SELECT product, SUM(COALESCE("Qty", 0))
                    FROM sales_data
                    WHERE "MONTH" >= %s AND "MONTH" <= %s AND product = ANY(%s)
                    GROUP BY product;
                """, (f_date_ly, t_date_ly, all_page_sales))
                for sp_name, qty in cur.fetchall():
                    sales_qty_ly_map[sp_name] = safe_float(qty)

            for p_id, p_name, p_type, b_name, p_desc, p_brand_id in products:
                mapped_sales = prod_sales_map.get(p_id, [])
                active_sales = mapped_sales
                
                saved = saved_map_p.get(p_id)
                saved_manual_pct = safe_float(saved[0]) if saved and saved[0] is not None else None
                status_val = saved[1] if saved else 'Draft'
                last_upd = saved[2].strftime('%d-%b-%Y %I:%M:%S %p') if saved and saved[2] else None
                upd_by = saved[3] if saved else None
                fixed_pct = safe_float(saved[4]) if saved and saved[4] is not None else None
                
                sales_qty = sum(sales_qty_curr_map.get(sp, 0.0) for sp in active_sales)
                sales_qty_ly = sum(sales_qty_ly_map.get(sp, 0.0) for sp in active_sales)
                selected_period_avg_pct = (sales_qty / overall_qty * 100.0) if overall_qty > 0.0 else 0.0
                last_year_same_period_pct = (sales_qty_ly / overall_qty_ly * 100.0) if overall_qty_ly > 0.0 else 0.0
                suggested_pct = selected_period_avg_pct
                
                results.append({
                    'product_id': p_id,
                    'product_name': p_name,
                    'brand_id': p_brand_id,
                    'brand_name': b_name,
                    'product_type': p_type,
                    'product_description': p_desc,
                    'sales_products': mapped_sales,
                    'active_sales_products': active_sales,
                    'from_month': from_m,
                    'from_year': from_y,
                    'to_month': to_m,
                    'to_year': to_y,
                    'selected_period_avg_pct': safe_float(selected_period_avg_pct),
                    'last_year_same_period_pct': safe_float(last_year_same_period_pct),
                    'suggested_pct': safe_float(suggested_pct),
                    'manual_pct': saved_manual_pct,
                    'status': status_val,
                    'last_updated': last_upd,
                    'updated_by': upd_by,
                    'fixed_percentage': fixed_pct
                })
                
        elif c_type == 'Color':
            # 1. Resolve selected products
            selected_pids = []
            if product_ids:
                if brand_id:
                    cur.execute("SELECT id FROM product_master WHERE id = ANY(%s) AND brand_id = %s AND status = 'Active';", (product_ids, int(brand_id)))
                    selected_pids = [r[0] for r in cur.fetchall()]
                else:
                    selected_pids = product_ids
            else:
                if brand_id:
                    cur.execute("SELECT id FROM product_master WHERE status = 'Active' AND brand_id = %s;", (int(brand_id),))
                    selected_pids = [r[0] for r in cur.fetchall()]
                else:
                    cur.execute("SELECT id FROM product_master WHERE status = 'Active';")
                    selected_pids = [r[0] for r in cur.fetchall()]
            
            if not selected_pids:
                total_count = 0
                results = []
            else:
                # Preload sales mappings for the selected products
                prod_sales_map = {}
                cur.execute("""
                    SELECT product_id, sales_product_name 
                    FROM product_sales_data_mapping 
                    WHERE product_id = ANY(%s);
                """, (selected_pids,))
                for pid, sname in cur.fetchall():
                    if pid not in prod_sales_map:
                        prod_sales_map[pid] = []
                    prod_sales_map[pid].append(sname)

                # Brand name if brand_id filter is specified
                brand_name = None
                if brand_id:
                    cur.execute("SELECT brand_name FROM brand_master WHERE id = %s;", (int(brand_id),))
                    row_b = cur.fetchone()
                    if row_b:
                        brand_name = row_b[0]
                        
                # Saved contributions mapping prioritizing authoritative recency
                cur.execute("""
                    SELECT product_id, color_code, manual_pct, status, last_updated, updated_by, COALESCE(fixed_percentage, manual_pct)
                    FROM planning_contributions
                    WHERE product_id = ANY(%s) AND contribution_type = 'Color' AND version = %s
                    ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
                """, (selected_pids, version))
                saved_rows = cur.fetchall()
                saved_map = {}
                for r in saved_rows:
                    key = (r[0], r[1])
                    if key not in saved_map:
                        saved_map[key] = {
                            'manual_pct': safe_float(r[2]) if r[2] is not None else None,
                            'status': r[3],
                            'last_updated': r[4].strftime('%d-%b-%Y %I:%M:%S %p') if r[4] else None,
                            'updated_by': r[5],
                            'fixed_percentage': safe_float(r[6]) if r[6] is not None else None
                        }
                    
                # Get all product-color combinations
                comb_q = """
                    SELECT p.id, p.product_name, c.global_color_code, c.display_color, p.brand_id
                    FROM product_master p
                    JOIN product_color_mapping m ON p.id = m.product_id
                    JOIN color_master c ON m.global_color_code = c.global_color_code AND c.category = p.color_category
                    WHERE p.status = 'Active' AND c.status = 'Active' AND p.id = ANY(%s)
                """
                comb_params = [selected_pids]
                if color_code_filter:
                    comb_q += " AND c.global_color_code = %s"
                    comb_params.append(color_code_filter)
                comb_q += " ORDER BY p.product_name, c.display_color;"
                cur.execute(comb_q, tuple(comb_params))
                combinations = cur.fetchall()
                
                f_date, t_date, f_date_ly, t_date_ly = parse_period_dates(from_m, from_y, to_m, to_y)
                suggestion_rule = request.args.get('suggestion_rule', 'Average Sales %').strip()

                # Group combinations by product_id to perform strictly product-isolated sales calculations
                by_prod_combs = {}
                for p_id, p_name, c_code, c_name, p_brand_id in combinations:
                    if p_id not in by_prod_combs:
                        by_prod_combs[p_id] = []
                    by_prod_combs[p_id].append((p_id, p_name, c_code, c_name, p_brand_id))

                # BATCH COLOR SALES QUERIES (Current & Last Year)
                all_mapped_sales = list(set([sp for sp_list in prod_sales_map.values() for sp in sp_list]))
                prod_total_q_map = {}
                prod_total_q_ly_map = {}
                color_breakdown_curr = {}  # { sp_name: { global_color_code: qty } }
                color_breakdown_ly = {}

                if all_mapped_sales:
                    if brand_name:
                        cur.execute("""
                            SELECT product, SUM(COALESCE("Qty", 0)) 
                            FROM sales_data 
                            WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s AND LOWER("BRAND") = LOWER(%s)
                            GROUP BY product;
                        """, (all_mapped_sales, f_date, t_date, brand_name))
                        for sp_name, qty in cur.fetchall():
                            prod_total_q_map[sp_name] = safe_float(qty)

                        cur.execute("""
                            SELECT product, SUM(COALESCE("Qty", 0)) 
                            FROM sales_data 
                            WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s AND LOWER("BRAND") = LOWER(%s)
                            GROUP BY product;
                        """, (all_mapped_sales, f_date_ly, t_date_ly, brand_name))
                        for sp_name, qty in cur.fetchall():
                            prod_total_q_ly_map[sp_name] = safe_float(qty)

                        cur.execute("""
                            SELECT s.product, cm.global_color_code, SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s AND LOWER(s."BRAND") = LOWER(%s)
                            GROUP BY s.product, cm.global_color_code;
                        """, (all_mapped_sales, f_date, t_date, brand_name))
                        for sp_name, code, qty in cur.fetchall():
                            if sp_name not in color_breakdown_curr:
                                color_breakdown_curr[sp_name] = {}
                            color_breakdown_curr[sp_name][code] = safe_float(qty)

                        cur.execute("""
                            SELECT s.product, cm.global_color_code, SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s AND LOWER(s."BRAND") = LOWER(%s)
                            GROUP BY s.product, cm.global_color_code;
                        """, (all_mapped_sales, f_date_ly, t_date_ly, brand_name))
                        for sp_name, code, qty in cur.fetchall():
                            if sp_name not in color_breakdown_ly:
                                color_breakdown_ly[sp_name] = {}
                            color_breakdown_ly[sp_name][code] = safe_float(qty)
                    else:
                        cur.execute("""
                            SELECT product, SUM(COALESCE("Qty", 0)) 
                            FROM sales_data 
                            WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s
                            GROUP BY product;
                        """, (all_mapped_sales, f_date, t_date))
                        for sp_name, qty in cur.fetchall():
                            prod_total_q_map[sp_name] = safe_float(qty)

                        cur.execute("""
                            SELECT product, SUM(COALESCE("Qty", 0)) 
                            FROM sales_data 
                            WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s
                            GROUP BY product;
                        """, (all_mapped_sales, f_date_ly, t_date_ly))
                        for sp_name, qty in cur.fetchall():
                            prod_total_q_ly_map[sp_name] = safe_float(qty)

                        cur.execute("""
                            SELECT s.product, cm.global_color_code, SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s
                            GROUP BY s.product, cm.global_color_code;
                        """, (all_mapped_sales, f_date, t_date))
                        for sp_name, code, qty in cur.fetchall():
                            if sp_name not in color_breakdown_curr:
                                color_breakdown_curr[sp_name] = {}
                            color_breakdown_curr[sp_name][code] = safe_float(qty)

                        cur.execute("""
                            SELECT s.product, cm.global_color_code, SUM(COALESCE(s."Qty", 0))
                            FROM sales_data s
                            JOIN color_master cm ON s."Color" = cm.display_color
                            WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s
                            GROUP BY s.product, cm.global_color_code;
                        """, (all_mapped_sales, f_date_ly, t_date_ly))
                        for sp_name, code, qty in cur.fetchall():
                            if sp_name not in color_breakdown_ly:
                                color_breakdown_ly[sp_name] = {}
                            color_breakdown_ly[sp_name][code] = safe_float(qty)

                temp_results = []
                for p_id_val, comb_list in by_prod_combs.items():
                    p_brand_id = comb_list[0][4]
                    mapped_sales = prod_sales_map.get(p_id_val, [])
                    
                    # 1. Total product sales in period
                    p_total_q = sum(prod_total_q_map.get(sp, 0.0) for sp in mapped_sales) if mapped_sales else 0.0
                    p_total_q_ly = sum(prod_total_q_ly_map.get(sp, 0.0) for sp in mapped_sales) if mapped_sales else 0.0
                    
                    # 2. Color breakdown for mapped sales products
                    color_qty_map = {}
                    color_qty_ly_map = {}
                    if mapped_sales:
                        for sp in mapped_sales:
                            for code, qty in color_breakdown_curr.get(sp, {}).items():
                                color_qty_map[code] = color_qty_map.get(code, 0.0) + qty
                            for code, qty in color_breakdown_ly.get(sp, {}).items():
                                color_qty_ly_map[code] = color_qty_ly_map.get(code, 0.0) + qty

                    prod_temp_rows = []
                    for p_id_val, p_name, c_code, c_name, p_brand_id in comb_list:
                        c_qty = color_qty_map.get(c_code, 0.0)
                        c_qty_ly = color_qty_ly_map.get(c_code, 0.0)
                        
                        raw_avg = (c_qty / p_total_q * 100.0) if p_total_q > 0.0 else 0.0
                        raw_ly = (c_qty_ly / p_total_q_ly * 100.0) if p_total_q_ly > 0.0 else 0.0
                        
                        if suggestion_rule == 'Weighted Average + Last Year':
                            raw_sug = 0.5 * raw_avg + 0.5 * raw_ly
                        else:
                            raw_sug = raw_avg
                            
                        saved = saved_map.get((p_id_val, c_code))
                        
                        prod_temp_rows.append({
                            'product_id': p_id_val,
                            'product_name': p_name,
                            'brand_id': p_brand_id,
                            'color_code': c_code,
                            'color_name': c_name,
                            'sales_products': mapped_sales,
                            'active_sales_products': mapped_sales,
                            'from_month': from_m,
                            'from_year': from_y,
                            'to_month': to_m,
                            'to_year': to_y,
                            'selected_period_avg_pct': safe_float(raw_avg),
                            'last_year_same_period_pct': safe_float(raw_ly),
                            'suggested_pct': safe_float(raw_sug),
                            'manual_pct': saved['manual_pct'] if saved else None,
                            'status': saved['status'] if saved else 'Draft',
                            'last_updated': saved['last_updated'] if saved else None,
                            'updated_by': saved['updated_by'] if saved else None,
                            'fixed_percentage': saved['fixed_percentage'] if saved else None,
                            'has_sales': p_total_q > 0.0,
                            'has_sales_ly': p_total_q_ly > 0.0
                        })
                    temp_results.extend(prod_temp_rows)

                # Group by product_id and normalize percentages conditionally (only when sales > 0)
                by_prod = {}
                for row in temp_results:
                    pid = row['product_id']
                    if pid not in by_prod:
                        by_prod[pid] = []
                    by_prod[pid].append(row)
                    
                results = []
                for pid, prod_rows in by_prod.items():
                    has_sales = prod_rows[0].get('has_sales', False)
                    has_sales_ly = prod_rows[0].get('has_sales_ly', False)

                    if has_sales:
                        norm_avg = normalize_percentages([r['selected_period_avg_pct'] for r in prod_rows])
                        norm_sug = normalize_percentages([r['suggested_pct'] for r in prod_rows])
                    else:
                        norm_avg = [0.00] * len(prod_rows)
                        norm_sug = [0.00] * len(prod_rows)

                    if has_sales_ly:
                        norm_ly = normalize_percentages([r['last_year_same_period_pct'] for r in prod_rows])
                    else:
                        norm_ly = [0.00] * len(prod_rows)
                    
                    for i, r in enumerate(prod_rows):
                        r['selected_period_avg_pct'] = norm_avg[i]
                        r['last_year_same_period_pct'] = norm_ly[i]
                        r['suggested_pct'] = norm_sug[i]
                        
                        if r['manual_pct'] is None:
                            r['manual_pct'] = norm_sug[i]
                        r['variance'] = safe_float(r['manual_pct']) - safe_float(r['suggested_pct'])
                        r.pop('has_sales', None)
                        r.pop('has_sales_ly', None)
                        results.append(r)
                        
                results.sort(key=lambda x: (x['product_name'], x['color_name']))
                total_count = len(results)
                results = results[offset : offset + per_page]
                
        elif c_type == 'Size':
            # 1. Resolve selected products
            selected_pids = []
            if product_ids:
                if brand_id:
                    cur.execute("SELECT id FROM product_master WHERE id = ANY(%s) AND brand_id = %s AND status = 'Active';", (product_ids, int(brand_id)))
                    selected_pids = [r[0] for r in cur.fetchall()]
                else:
                    selected_pids = product_ids
            else:
                if brand_id:
                    cur.execute("SELECT id FROM product_master WHERE status = 'Active' AND brand_id = %s;", (int(brand_id),))
                    selected_pids = [r[0] for r in cur.fetchall()]
                else:
                    cur.execute("SELECT id FROM product_master WHERE status = 'Active';")
                    selected_pids = [r[0] for r in cur.fetchall()]
            
            if not selected_pids:
                total_count = 0
                results = []
            else:
                # Preload sales mappings for the selected products
                prod_sales_map = {}
                cur.execute("""
                    SELECT product_id, sales_product_name 
                    FROM product_sales_data_mapping 
                    WHERE product_id = ANY(%s);
                """, (selected_pids,))
                for pid, sname in cur.fetchall():
                    if pid not in prod_sales_map:
                        prod_sales_map[pid] = []
                    prod_sales_map[pid].append(sname)

                # Brand name if brand_id filter is specified
                brand_name = None
                if brand_id:
                    cur.execute("SELECT brand_name FROM brand_master WHERE id = %s;", (int(brand_id),))
                    row_b = cur.fetchone()
                    if row_b:
                        brand_name = row_b[0]
                        
                # Saved contributions mapping prioritizing exact period match then latest saved record
                q = """
                    SELECT product_id, color_code, size_id, manual_pct, status, last_updated, updated_by, COALESCE(fixed_percentage, manual_pct)
                    FROM planning_contributions
                    WHERE product_id = ANY(%s) AND contribution_type = 'Size' AND version = %s
                """
                params = [selected_pids, version]
                if color_code_filter:
                    q += " AND color_code = %s"
                    params.append(color_code_filter)
                if size_id_filter:
                    q += " AND size_id = %s"
                    params.append(int(size_id_filter))
                q += " ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;"
                cur.execute(q, tuple(params))
                saved_rows = cur.fetchall()
                saved_map = {}
                for r in saved_rows:
                    p_id_r, c_code_r, sz_id_r = r[0], r[1], r[2]
                    k_specific = (p_id_r, c_code_r, sz_id_r)
                    if k_specific not in saved_map:
                        saved_map[k_specific] = {
                            'manual_pct': safe_float(r[3]) if r[3] is not None else None,
                            'status': r[4],
                            'last_updated': r[5].strftime('%d-%b-%Y %I:%M:%S %p') if r[5] else None,
                            'updated_by': r[6],
                            'fixed_percentage': safe_float(r[7]) if r[7] is not None else None
                        }
                    if c_code_r is None:
                        k_overall = (p_id_r, None, sz_id_r)
                        if k_overall not in saved_map:
                            saved_map[k_overall] = saved_map[k_specific]
                    
                # Get all product-size combinations
                comb_q = """
                    SELECT DISTINCT p.id, p.product_name, s.id, s.size, s.size_code, p.brand_id
                    FROM product_master p
                    JOIN product_dia_mapping m ON p.id = m.product_id
                    JOIN size_master s ON m.size_id = s.id
                    WHERE p.status = 'Active' AND s.status = 'Active' AND p.id = ANY(%s)
                """
                comb_params = [selected_pids]
                if size_id_filter:
                    comb_q += " AND s.id = %s"
                    comb_params.append(int(size_id_filter))
                comb_q += " ORDER BY p.product_name, s.size;"
                cur.execute(comb_q, tuple(comb_params))
                combinations = cur.fetchall()
                
                f_date, t_date, f_date_ly, t_date_ly = parse_period_dates(from_m, from_y, to_m, to_y)
                suggestion_rule = request.args.get('suggestion_rule', 'Average Sales %').strip()

                # Group combinations by product_id for strict product-isolated calculation
                by_prod_combs = {}
                for p_id, p_name, sz_id, sz_name, sz_code, p_brand_id in combinations:
                    if p_id not in by_prod_combs:
                        by_prod_combs[p_id] = []
                    by_prod_combs[p_id].append((p_id, p_name, sz_id, sz_name, sz_code, p_brand_id))

                # BATCH SIZE SALES QUERIES (Current & Last Year)
                all_mapped_sales = list(set([sp for sp_list in prod_sales_map.values() for sp in sp_list]))
                size_denom_curr = {}
                size_denom_ly = {}
                size_breakdown_curr = {}  # { sp_name: { size_name: qty } }
                size_breakdown_ly = {}

                if all_mapped_sales:
                    if color_code_filter:
                        if brand_name:
                            cur.execute("""
                                SELECT s.product, SUM(COALESCE(s."Qty", 0)) 
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND LOWER(s."BRAND") = LOWER(%s) AND cm.global_color_code = %s
                                GROUP BY s.product;
                            """, (all_mapped_sales, f_date, t_date, brand_name, color_code_filter))
                            for sp_name, qty in cur.fetchall():
                                size_denom_curr[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT s.product, SUM(COALESCE(s."Qty", 0)) 
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND LOWER(s."BRAND") = LOWER(%s) AND cm.global_color_code = %s
                                GROUP BY s.product;
                            """, (all_mapped_sales, f_date_ly, t_date_ly, brand_name, color_code_filter))
                            for sp_name, qty in cur.fetchall():
                                size_denom_ly[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT s.product, s."Size", SUM(COALESCE(s."Qty", 0))
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND LOWER(s."BRAND") = LOWER(%s) AND cm.global_color_code = %s
                                GROUP BY s.product, s."Size";
                            """, (all_mapped_sales, f_date, t_date, brand_name, color_code_filter))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_curr:
                                    size_breakdown_curr[sp_name] = {}
                                size_breakdown_curr[sp_name][sz] = safe_float(qty)

                            cur.execute("""
                                SELECT s.product, s."Size", SUM(COALESCE(s."Qty", 0))
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND LOWER(s."BRAND") = LOWER(%s) AND cm.global_color_code = %s
                                GROUP BY s.product, s."Size";
                            """, (all_mapped_sales, f_date_ly, t_date_ly, brand_name, color_code_filter))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_ly:
                                    size_breakdown_ly[sp_name] = {}
                                size_breakdown_ly[sp_name][sz] = safe_float(qty)
                        else:
                            cur.execute("""
                                SELECT s.product, SUM(COALESCE(s."Qty", 0)) 
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND cm.global_color_code = %s
                                GROUP BY s.product;
                            """, (all_mapped_sales, f_date, t_date, color_code_filter))
                            for sp_name, qty in cur.fetchall():
                                size_denom_curr[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT s.product, SUM(COALESCE(s."Qty", 0)) 
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND cm.global_color_code = %s
                                GROUP BY s.product;
                            """, (all_mapped_sales, f_date_ly, t_date_ly, color_code_filter))
                            for sp_name, qty in cur.fetchall():
                                size_denom_ly[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT s.product, s."Size", SUM(COALESCE(s."Qty", 0))
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND cm.global_color_code = %s
                                GROUP BY s.product, s."Size";
                            """, (all_mapped_sales, f_date, t_date, color_code_filter))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_curr:
                                    size_breakdown_curr[sp_name] = {}
                                size_breakdown_curr[sp_name][sz] = safe_float(qty)

                            cur.execute("""
                                SELECT s.product, s."Size", SUM(COALESCE(s."Qty", 0))
                                FROM sales_data s
                                JOIN color_master cm ON s."Color" = cm.display_color
                                WHERE s.product = ANY(%s) AND s."MONTH" >= %s AND s."MONTH" <= %s 
                                  AND cm.global_color_code = %s
                                GROUP BY s.product, s."Size";
                            """, (all_mapped_sales, f_date_ly, t_date_ly, color_code_filter))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_ly:
                                    size_breakdown_ly[sp_name] = {}
                                size_breakdown_ly[sp_name][sz] = safe_float(qty)
                    else:
                        if brand_name:
                            cur.execute("""
                                SELECT product, SUM(COALESCE("Qty", 0)) 
                                FROM sales_data 
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s AND LOWER("BRAND") = LOWER(%s)
                                GROUP BY product;
                            """, (all_mapped_sales, f_date, t_date, brand_name))
                            for sp_name, qty in cur.fetchall():
                                size_denom_curr[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT product, SUM(COALESCE("Qty", 0)) 
                                FROM sales_data 
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s AND LOWER("BRAND") = LOWER(%s)
                                GROUP BY product;
                            """, (all_mapped_sales, f_date_ly, t_date_ly, brand_name))
                            for sp_name, qty in cur.fetchall():
                                size_denom_ly[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT product, "Size", SUM(COALESCE("Qty", 0))
                                FROM sales_data
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s AND LOWER("BRAND") = LOWER(%s)
                                GROUP BY product, "Size";
                            """, (all_mapped_sales, f_date, t_date, brand_name))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_curr:
                                    size_breakdown_curr[sp_name] = {}
                                size_breakdown_curr[sp_name][sz] = safe_float(qty)

                            cur.execute("""
                                SELECT product, "Size", SUM(COALESCE("Qty", 0))
                                FROM sales_data
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s AND LOWER("BRAND") = LOWER(%s)
                                GROUP BY product, "Size";
                            """, (all_mapped_sales, f_date_ly, t_date_ly, brand_name))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_ly:
                                    size_breakdown_ly[sp_name] = {}
                                size_breakdown_ly[sp_name][sz] = safe_float(qty)
                        else:
                            cur.execute("""
                                SELECT product, SUM(COALESCE("Qty", 0)) 
                                FROM sales_data 
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s
                                GROUP BY product;
                            """, (all_mapped_sales, f_date, t_date))
                            for sp_name, qty in cur.fetchall():
                                size_denom_curr[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT product, SUM(COALESCE("Qty", 0)) 
                                FROM sales_data 
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s
                                GROUP BY product;
                            """, (all_mapped_sales, f_date_ly, t_date_ly))
                            for sp_name, qty in cur.fetchall():
                                size_denom_ly[sp_name] = safe_float(qty)

                            cur.execute("""
                                SELECT product, "Size", SUM(COALESCE("Qty", 0))
                                FROM sales_data
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s
                                GROUP BY product, "Size";
                            """, (all_mapped_sales, f_date, t_date))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_curr:
                                    size_breakdown_curr[sp_name] = {}
                                size_breakdown_curr[sp_name][sz] = safe_float(qty)

                            cur.execute("""
                                SELECT product, "Size", SUM(COALESCE("Qty", 0))
                                FROM sales_data
                                WHERE "product" = ANY(%s) AND "MONTH" >= %s AND "MONTH" <= %s
                                GROUP BY product, "Size";
                            """, (all_mapped_sales, f_date_ly, t_date_ly))
                            for sp_name, sz, qty in cur.fetchall():
                                if sp_name not in size_breakdown_ly:
                                    size_breakdown_ly[sp_name] = {}
                                size_breakdown_ly[sp_name][sz] = safe_float(qty)

                temp_results = []
                for p_id, comb_list in by_prod_combs.items():
                    mapped_sales = prod_sales_map.get(p_id, [])
                    denom = sum(size_denom_curr.get(sp, 0.0) for sp in mapped_sales) if mapped_sales else 0.0
                    denom_ly = sum(size_denom_ly.get(sp, 0.0) for sp in mapped_sales) if mapped_sales else 0.0
                    size_qty_map = {}
                    size_qty_ly_map = {}

                    if mapped_sales:
                        for sp in mapped_sales:
                            for sz, qty in size_breakdown_curr.get(sp, {}).items():
                                size_qty_map[sz] = size_qty_map.get(sz, 0.0) + qty
                            for sz, qty in size_breakdown_ly.get(sp, {}).items():
                                size_qty_ly_map[sz] = size_qty_ly_map.get(sz, 0.0) + qty

                    prod_temp_rows = []
                    for p_id_val, p_name, sz_id, sz_name, sz_code, p_brand_id in comb_list:
                        s_qty = size_qty_map.get(sz_name, 0.0)
                        s_qty_ly = size_qty_ly_map.get(sz_name, 0.0)
                        
                        raw_avg = (s_qty / denom * 100.0) if denom > 0.0 else 0.0
                        raw_ly = (s_qty_ly / denom_ly * 100.0) if denom_ly > 0.0 else 0.0
                        
                        if suggestion_rule == 'Weighted Average + Last Year':
                            raw_sug = 0.5 * raw_avg + 0.5 * raw_ly
                        else:
                            raw_sug = raw_avg
                            
                        target_c_code = color_code_filter if color_code_filter else None
                        saved = saved_map.get((p_id_val, target_c_code, sz_id)) or (saved_map.get((p_id_val, None, sz_id)) if not target_c_code else None)
                        
                        prod_temp_rows.append({
                            'product_id': p_id_val,
                            'product_name': p_name,
                            'brand_id': p_brand_id,
                            'size_id': sz_id,
                            'size_name': sz_name,
                            'size_code': sz_code,
                            'sales_products': mapped_sales,
                            'active_sales_products': mapped_sales,
                            'from_month': from_m,
                            'from_year': from_y,
                            'to_month': to_m,
                            'to_year': to_y,
                            'color_code': color_code_filter if color_code_filter else None,
                            'selected_period_avg_pct': safe_float(raw_avg),
                            'last_year_same_period_pct': safe_float(raw_ly),
                            'suggested_pct': safe_float(raw_sug),
                            'manual_pct': saved['manual_pct'] if saved else None,
                            'status': saved['status'] if saved else 'Draft',
                            'last_updated': saved['last_updated'] if saved else None,
                            'updated_by': saved['updated_by'] if saved else None,
                            'fixed_percentage': saved['fixed_percentage'] if saved else None,
                            'has_sales': denom > 0.0,
                            'has_sales_ly': denom_ly > 0.0
                        })
                    temp_results.extend(prod_temp_rows)

                # Group by product_id and normalize percentages conditionally (only when sales > 0)
                by_prod = {}
                for row in temp_results:
                    pid = row['product_id']
                    if pid not in by_prod:
                        by_prod[pid] = []
                    by_prod[pid].append(row)
                    
                results = []
                for pid, prod_rows in by_prod.items():
                    has_sales = prod_rows[0].get('has_sales', False)
                    has_sales_ly = prod_rows[0].get('has_sales_ly', False)

                    if has_sales:
                        norm_avg = normalize_percentages([r['selected_period_avg_pct'] for r in prod_rows])
                        norm_sug = normalize_percentages([r['suggested_pct'] for r in prod_rows])
                    else:
                        norm_avg = [0.00] * len(prod_rows)
                        norm_sug = [0.00] * len(prod_rows)

                    if has_sales_ly:
                        norm_ly = normalize_percentages([r['last_year_same_period_pct'] for r in prod_rows])
                    else:
                        norm_ly = [0.00] * len(prod_rows)
                    
                    for i, r in enumerate(prod_rows):
                        r['selected_period_avg_pct'] = norm_avg[i]
                        r['last_year_same_period_pct'] = norm_ly[i]
                        r['suggested_pct'] = norm_sug[i]
                        
                        if r['manual_pct'] is None:
                            r['manual_pct'] = norm_sug[i]
                        r['variance'] = safe_float(r['manual_pct']) - safe_float(r['suggested_pct'])
                        r.pop('has_sales', None)
                        r.pop('has_sales_ly', None)
                        results.append(r)
                        
                results.sort(key=lambda x: (x['product_name'], x['size_name']))
                total_count = len(results)
                results = results[offset : offset + per_page]
                
        cur.close()
        return jsonify({
            'success': True,
            'contribution_type': c_type,
            'version': version,
            'rows': results,
            'total_count': total_count,
            'page': page,
            'per_page': per_page,
            'message': message
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading contribution sheet data: {str(e)}'}), 500
    finally:
        release_db_connection(conn)



@app.route('/api/planning-contribution/product-colors', methods=['GET'])
@login_required
def get_product_colors():
    p_id = request.args.get('product_id', '').strip()
    if not p_id:
        return jsonify({'success': False, 'message': 'Missing product ID'}), 400
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT brand_id, color_category FROM product_master WHERE id = %s;", (int(p_id),))
        row = cur.fetchone()
        if not row:
            cur.close()
            return jsonify({'success': False, 'message': 'Product not found'}), 404
        brand_id, color_cat = row
        
        cur.execute("""
            SELECT m.global_color_code, c.display_color
            FROM product_color_mapping m
            JOIN color_master c ON m.global_color_code = c.global_color_code
            WHERE m.product_id = %s AND c.category = %s AND c.status = 'Active'
            ORDER BY c.display_color;
        """, (int(p_id), color_cat))
        colors = [{'color_code': r[0], 'color_name': f"{r[0]} — {r[1]}" if r[0] and r[1] and r[0].upper() != r[1].upper() else (r[1] or r[0]), 'display_color': r[1], 'global_color_code': r[0]} for r in cur.fetchall()]
        cur.close()
        return jsonify({'success': True, 'colors': colors})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        if conn:
            release_db_connection(conn)


# POST save contributions data
@app.route('/api/planning-contribution/save', methods=['POST'])
@login_required
def save_planning_contribution():
    data = request.json or {}
    c_type = data.get('contribution_type', '').strip()
    rows = data.get('rows', [])
    version = data.get('version', 'Standard').strip() or 'Standard'
    size_method = int(data.get('size_method', 1))
    selected_colors = data.get('selected_colors', [])
    
    if not c_type:
        return jsonify({'success': False, 'message': 'Missing contribution type.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    saved_records = []
    failed_validations = []
    seen_keys = set()
    
    current_time = datetime.now()
    username = session.get('username', 'Admin')
    
    try:
        # Cleanup obsolete contribution records for this product
        if rows:
            p_id = int(rows[0].get('product_id'))
            
            if c_type == 'Color':
                cur.execute("""
                    DELETE FROM planning_contributions
                    WHERE product_id = %s AND contribution_type = 'Color' AND version = %s
                      AND color_code NOT IN (
                          SELECT global_color_code FROM product_color_mapping WHERE product_id = %s
                      );
                """, (p_id, version, p_id))
            elif c_type == 'Size':
                cur.execute("""
                    DELETE FROM planning_contributions
                    WHERE product_id = %s AND contribution_type = 'Size' AND version = %s
                      AND size_id NOT IN (
                          SELECT size_id FROM product_dia_mapping WHERE product_id = %s AND size_id IS NOT NULL
                      );
                """, (p_id, version, p_id))
            elif c_type == 'Product':
                cur.execute("""
                    DELETE FROM planning_contributions
                    WHERE contribution_type = 'Product' AND version = %s
                      AND product_id NOT IN (
                          SELECT id FROM product_master WHERE status = 'Active'
                      );
                """, (version,))

        # We only save/update the exact rows present in the payload (no sibling expansion or total validations)
        final_save_rows = []
        if c_type == 'Size' and size_method == 2:
            for r in rows:
                # Keep the overall record
                final_save_rows.append(r)
                # Copy to selected colors
                for col_code in selected_colors:
                    r_copy = r.copy()
                    r_copy['color_code'] = col_code
                    final_save_rows.append(r_copy)
        else:
            final_save_rows = rows

        # Save merged records
        for idx, r in enumerate(final_save_rows):
            p_id = int(r.get('product_id'))
            c_code = r.get('color_code')
            sz_id = r.get('size_id')
            brand_id = r.get('brand_id')
            manual_pct = float(r.get('manual_pct', 0.0))
            
            # Resolve brand_id if not present
            if not brand_id:
                cur.execute("SELECT brand_id FROM product_master WHERE id = %s;", (p_id,))
                brand_row = cur.fetchone()
                brand_id = brand_row[0] if brand_row else None
            else:
                brand_id = int(brand_id)

            # Query existing values in the database using logical keys, taking the latest (id DESC) in case of logical duplicates
            existing_id = None
            existing_fixed_percentage = None
            existing_last_updated = None
            existing_updated_by = None
            
            if c_type == 'Product':
                cur.execute("""
                    SELECT id, fixed_percentage, last_updated, updated_by 
                    FROM planning_contributions
                    WHERE product_id = %s AND contribution_type = 'Product' AND version = %s
                    ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC
                    LIMIT 1;
                """, (p_id, version))
            elif c_type == 'Color':
                cur.execute("""
                    SELECT id, fixed_percentage, last_updated, updated_by 
                    FROM planning_contributions
                    WHERE product_id = %s AND color_code = %s AND contribution_type = 'Color' AND version = %s
                    ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC
                    LIMIT 1;
                """, (p_id, c_code, version))
            elif c_type == 'Size':
                if c_code:
                    cur.execute("""
                        SELECT id, fixed_percentage, last_updated, updated_by 
                        FROM planning_contributions
                        WHERE product_id = %s AND size_id = %s AND color_code = %s AND contribution_type = 'Size' AND version = %s
                        ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC
                        LIMIT 1;
                    """, (p_id, sz_id, c_code, version))
                else:
                    cur.execute("""
                        SELECT id, fixed_percentage, last_updated, updated_by 
                        FROM planning_contributions
                        WHERE product_id = %s AND size_id = %s AND color_code IS NULL AND contribution_type = 'Size' AND version = %s
                        ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC
                        LIMIT 1;
                    """, (p_id, sz_id, version))
            
            row_exist = cur.fetchone()
            if row_exist:
                existing_id, existing_fixed_percentage, existing_last_updated, existing_updated_by = row_exist

            # Detect manual edit from frontend flag
            is_manually_edited = r.get('is_manually_edited', False)
            
            # If manually edited OR no previous record exists in database: update audit fields.
            # Otherwise, preserve the existing database values.
            if is_manually_edited or existing_fixed_percentage is None:
                new_fixed_pct = manual_pct
                new_last_upd = current_time
                new_upd_by = username
            else:
                new_fixed_pct = float(existing_fixed_percentage) if existing_fixed_percentage is not None else None
                new_last_upd = existing_last_updated
                new_upd_by = existing_updated_by

            if existing_id is not None:
                # Update the existing record in place
                cur.execute("""
                    UPDATE planning_contributions
                    SET manual_pct = %s,
                        last_updated = %s,
                        updated_by = %s,
                        fixed_percentage = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                """, (manual_pct, new_last_upd, new_upd_by, new_fixed_pct, existing_id))
            else:
                # Insert the new record
                if c_type == 'Product':
                    cur.execute("""
                        INSERT INTO planning_contributions (
                            contribution_type, product_id, color_code, size_id, brand_id, 
                            manual_pct, version, status, created_by,
                            last_updated, updated_by, fixed_percentage
                        ) VALUES (%s, %s, NULL, NULL, %s, %s, %s, 'Draft', %s, %s, %s, %s);
                    """, (c_type, p_id, brand_id, manual_pct, version, username, new_last_upd, new_upd_by, new_fixed_pct))
                elif c_type == 'Color':
                    cur.execute("""
                        INSERT INTO planning_contributions (
                            contribution_type, product_id, color_code, size_id, brand_id, 
                            manual_pct, version, status, created_by,
                            last_updated, updated_by, fixed_percentage
                        ) VALUES (%s, %s, %s, NULL, %s, %s, %s, 'Draft', %s, %s, %s, %s);
                    """, (c_type, p_id, c_code, brand_id, manual_pct, version, username, new_last_upd, new_upd_by, new_fixed_pct))
                elif c_type == 'Size':
                    if c_code:
                        cur.execute("""
                            INSERT INTO planning_contributions (
                                contribution_type, product_id, color_code, size_id, brand_id, 
                                manual_pct, version, status, created_by,
                                last_updated, updated_by, fixed_percentage
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'Draft', %s, %s, %s, %s);
                        """, (c_type, p_id, c_code, sz_id, brand_id, manual_pct, version, username, new_last_upd, new_upd_by, new_fixed_pct))
                    else:
                        cur.execute("""
                            INSERT INTO planning_contributions (
                                contribution_type, product_id, color_code, size_id, brand_id, 
                                manual_pct, version, status, created_by,
                                last_updated, updated_by, fixed_percentage
                            ) VALUES (%s, %s, NULL, %s, %s, %s, %s, 'Draft', %s, %s, %s, %s);
                        """, (c_type, p_id, sz_id, brand_id, manual_pct, version, username, new_last_upd, new_upd_by, new_fixed_pct))

            last_updated_str = new_last_upd.strftime('%d-%b-%Y %I:%M:%S %p') if new_last_upd else None
            saved_records.append({
                'product_id': p_id,
                'color_code': c_code,
                'size_id': sz_id,
                'manual_pct': manual_pct,
                'last_updated': last_updated_str,
                'updated_by': new_upd_by,
                'fixed_percentage': new_fixed_pct
            })

        # Determine total sum in database (before committing current transaction)
        db_total_pct = 0.0
        if rows:
            p_id = int(rows[0].get('product_id'))
            c_code = rows[0].get('color_code')
            
            if c_type == 'Size':
                if c_code:
                    cur.execute("""
                        SELECT SUM(manual_pct) 
                        FROM planning_contributions 
                        WHERE product_id = %s AND color_code = %s AND contribution_type = 'Size' AND version = %s
                          AND size_id IN (SELECT size_id FROM product_dia_mapping WHERE product_id = %s AND size_id IS NOT NULL);
                    """, (p_id, c_code, version, p_id))
                else:
                    cur.execute("""
                        SELECT SUM(manual_pct) 
                        FROM planning_contributions 
                        WHERE product_id = %s AND color_code IS NULL AND contribution_type = 'Size' AND version = %s
                          AND size_id IN (SELECT size_id FROM product_dia_mapping WHERE product_id = %s AND size_id IS NOT NULL);
                    """, (p_id, version, p_id))
                db_total_pct = float(cur.fetchone()[0] or 0.0)
            elif c_type == 'Color':
                cur.execute("""
                    SELECT SUM(manual_pct) 
                    FROM planning_contributions 
                    WHERE product_id = %s AND contribution_type = 'Color' AND version = %s
                      AND color_code IN (SELECT global_color_code FROM product_color_mapping WHERE product_id = %s);
                """, (p_id, version, p_id))
                db_total_pct = float(cur.fetchone()[0] or 0.0)
            elif c_type == 'Product':
                cur.execute("""
                    SELECT SUM(manual_pct) 
                    FROM planning_contributions 
                    WHERE contribution_type = 'Product' AND version = %s
                      AND product_id IN (SELECT id FROM product_master WHERE status = 'Active');
                """, (version,))
                db_total_pct = float(cur.fetchone()[0] or 0.0)

            status_text = 'Completed'
            status_db = 'Completed'
            remaining_pct = 0.0
            if abs(db_total_pct - 100.0) < 0.01:
                status_text = 'Completed'
                status_db = 'Completed'
            elif db_total_pct == 0.0:
                status_text = 'Missing'
                status_db = 'Missing'
            else:
                status_text = 'Partial Contribution'
                status_db = 'Partial'
                remaining_pct = 100.0 - db_total_pct

            # Update status column in database for all sibling rows
            if c_type == 'Product':
                cur.execute("""
                    UPDATE planning_contributions 
                    SET status = %s 
                    WHERE contribution_type = 'Product' AND version = %s;
                """, (status_db, version))
            elif c_type == 'Color':
                cur.execute("""
                    UPDATE planning_contributions 
                    SET status = %s 
                    WHERE contribution_type = 'Color' AND product_id = %s AND version = %s;
                """, (status_db, p_id, version))
            elif c_type == 'Size':
                if c_code:
                    cur.execute("""
                        UPDATE planning_contributions 
                        SET status = %s 
                        WHERE contribution_type = 'Size' AND product_id = %s AND color_code = %s AND version = %s;
                    """, (status_db, p_id, c_code, version))
                else:
                    cur.execute("""
                        UPDATE planning_contributions 
                        SET status = %s 
                        WHERE contribution_type = 'Size' AND product_id = %s AND color_code IS NULL AND version = %s;
                    """, (status_db, p_id, version))

        conn.commit()
        
        # Assemble summary metrics after successful commit
        log_info = {}
        msg = "Contributions saved successfully."
        if rows:
            p_name = ''
            cur2 = conn.cursor()
            cur2.execute("SELECT product_name FROM product_master WHERE id = %s;", (p_id,))
            p_name_row = cur2.fetchone()
            p_name = p_name_row[0] if p_name_row else ''
            
            col_id = None
            col_name = ''
            if c_code:
                cur2.execute("SELECT id, display_color FROM color_master WHERE global_color_code = %s LIMIT 1;", (c_code,))
                col_row = cur2.fetchone()
                if col_row:
                    col_id, col_name = col_row
            cur2.close()

            log_info = {
                'product_id': p_id,
                'product_name': p_name,
                'color_id': col_id,
                'color_name': col_name,
                'version': version,
                'contribution_type': c_type,
                'rows_submitted': len(rows),
                'rows_saved': len(rows),
                'rows_updated': len(rows),
                'database_total_pct': db_total_pct,
                'status': status_text
            }
            
            if status_db == 'Partial':
                msg = f"⚠ Contribution Total = {db_total_pct:.2f}%\nSaved successfully.\nStatus = Partial Contribution\nRemaining Contribution = {remaining_pct:.2f}%"
            else:
                msg = f"Contributions saved successfully.\nStatus = {status_text}."

        cur.close()
        
        resp_data = {
            'success': True,
            'message': msg,
            'success_count': len(saved_records),
            'failed_count': 0,
            'details': [],
            'saved_records': saved_records,
            'log_info': log_info
        }
        return jsonify(resp_data)

    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error saving planning contributions: {e}", exc_info=True)
        return jsonify({'success': False, 'message': 'An error occurred while saving contributions. Please try again.'}), 500
    finally:
        release_db_connection(conn)


@app.route('/api/planning-contribution/bulk-calculate', methods=['POST'])
@login_required
def bulk_calculate_planning_contributions():
    data = request.json or {}
    from_month = data.get('from_month', 'April').strip()
    from_year = int(data.get('from_year', 2026))
    to_month = data.get('to_month', 'December').strip()
    to_year = int(data.get('to_year', 2026))
    suggestion_rule = data.get('suggestion_rule', 'Average Sales %').strip()
    version = data.get('version', 'Standard').strip() or 'Standard'
    
    brand_id = data.get('brand_id')
    product_ids = data.get('product_ids', [])
    color_codes = data.get('color_codes', [])

    MONTH_NAMES = {
        'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
        'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
    }
    
    try:
        from_m_num = MONTH_NAMES.get(from_month, 4)
        from_date = date(from_year, from_m_num, 1)
        
        to_m_num = MONTH_NAMES.get(to_month, 12)
        if to_m_num == 12:
            to_date = date(to_year, 12, 31)
        else:
            to_date = date(to_year, to_m_num + 1, 1) - timedelta(days=1)
            
        from_date_ly = date(from_year - 1, from_m_num, 1)
        if to_m_num == 12:
            to_date_ly = date(to_year - 1, 12, 31)
        else:
            to_date_ly = date(to_year - 1, to_m_num + 1, 1) - timedelta(days=1)
            
    except Exception as parse_err:
        return jsonify({'success': False, 'message': f'Error parsing periods: {str(parse_err)}'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # 1. Fetch Global Denominators
        cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (from_date, to_date))
        oq = cur.fetchone()
        global_sales_qty = float(oq[0]) if oq and oq[0] is not None else 0.0
        
        cur.execute('SELECT SUM(COALESCE("Qty", 0)) FROM sales_data WHERE "MONTH" >= %s AND "MONTH" <= %s;', (from_date_ly, to_date_ly))
        oql = cur.fetchone()
        global_sales_qty_ly = float(oql[0]) if oql and oql[0] is not None else 0.0

        # 2. Fetch Active Products
        q = """
            SELECT p.id, p.product_name, p.brand_id, b.brand_name
            FROM product_master p
            JOIN brand_master b ON p.brand_id = b.id
            WHERE p.status = 'Active'
        """
        params = []
        if brand_id:
            q += " AND p.brand_id = %s"
            params.append(int(brand_id))
        if product_ids:
            q += " AND p.id = ANY(%s)"
            params.append([int(pid) for pid in product_ids])
        
        cur.execute(q, tuple(params))
        active_products = cur.fetchall()
        active_pids = [p[0] for p in active_products]

        if not active_pids:
            return jsonify({
                'success': True,
                'products': [],
                'colors': [],
                'sizes': [],
                'validation': {
                    'product_total': 0.0,
                    'color_groups_valid': True,
                    'size_groups_valid': True
                }
            })

        # 3. Fetch Product Mapped Sales names
        cur.execute("SELECT product_id, sales_product_name FROM product_sales_data_mapping WHERE product_id = ANY(%s);", (active_pids,))
        mappings = cur.fetchall()
        product_sales_map = {}
        all_sales_names = []
        for pid, sname in mappings:
            if pid not in product_sales_map:
                product_sales_map[pid] = []
            product_sales_map[pid].append(sname)
            all_sales_names.append(sname)

        # 4. Fetch Grouped Sales quantities in bulk
        # Current Period
        cur.execute("""
            SELECT "product", SUM(COALESCE("Qty", 0))
            FROM sales_data
            WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s)
            GROUP BY "product";
        """, (from_date, to_date, all_sales_names))
        sales_product_qty = {r[0]: float(r[1]) for r in cur.fetchall()}

        cur.execute("""
            SELECT s."product", cm.global_color_code, SUM(COALESCE(s."Qty", 0))
            FROM sales_data s
            JOIN color_master cm ON s."Color" = cm.display_color
            WHERE s."MONTH" >= %s AND s."MONTH" <= %s AND s."product" = ANY(%s)
            GROUP BY s."product", cm.global_color_code;
        """, (from_date, to_date, all_sales_names))
        sales_color_qty = {(r[0], r[1]): float(r[2]) for r in cur.fetchall()}

        cur.execute("""
            SELECT s."product", cm.global_color_code, s."Size", SUM(COALESCE(s."Qty", 0))
            FROM sales_data s
            JOIN color_master cm ON s."Color" = cm.display_color
            WHERE s."MONTH" >= %s AND s."MONTH" <= %s AND s."product" = ANY(%s)
            GROUP BY s."product", cm.global_color_code, s."Size";
        """, (from_date, to_date, all_sales_names))
        sales_size_qty = {(r[0], r[1], r[2]): float(r[3]) for r in cur.fetchall()}

        cur.execute("""
            SELECT s."product", s."Size", SUM(COALESCE(s."Qty", 0))
            FROM sales_data s
            WHERE s."MONTH" >= %s AND s."MONTH" <= %s AND s."product" = ANY(%s)
            GROUP BY s."product", s."Size";
        """, (from_date, to_date, all_sales_names))
        sales_size_no_color_qty = {(r[0], r[1]): float(r[2]) for r in cur.fetchall()}

        # Last Year Period
        cur.execute("""
            SELECT "product", SUM(COALESCE("Qty", 0))
            FROM sales_data
            WHERE "MONTH" >= %s AND "MONTH" <= %s AND "product" = ANY(%s)
            GROUP BY "product";
        """, (from_date_ly, to_date_ly, all_sales_names))
        sales_product_qty_ly = {r[0]: float(r[1]) for r in cur.fetchall()}

        cur.execute("""
            SELECT s."product", cm.global_color_code, SUM(COALESCE(s."Qty", 0))
            FROM sales_data s
            JOIN color_master cm ON s."Color" = cm.display_color
            WHERE s."MONTH" >= %s AND s."MONTH" <= %s AND s."product" = ANY(%s)
            GROUP BY s."product", cm.global_color_code;
        """, (from_date_ly, to_date_ly, all_sales_names))
        sales_color_qty_ly = {(r[0], r[1]): float(r[2]) for r in cur.fetchall()}

        cur.execute("""
            SELECT s."product", cm.global_color_code, s."Size", SUM(COALESCE(s."Qty", 0))
            FROM sales_data s
            JOIN color_master cm ON s."Color" = cm.display_color
            WHERE s."MONTH" >= %s AND s."MONTH" <= %s AND s."product" = ANY(%s)
            GROUP BY s."product", cm.global_color_code, s."Size";
        """, (from_date_ly, to_date_ly, all_sales_names))
        sales_size_qty_ly = {(r[0], r[1], r[2]): float(r[3]) for r in cur.fetchall()}

        cur.execute("""
            SELECT s."product", s."Size", SUM(COALESCE(s."Qty", 0))
            FROM sales_data s
            WHERE s."MONTH" >= %s AND s."MONTH" <= %s AND s."product" = ANY(%s)
            GROUP BY s."product", s."Size";
        """, (from_date_ly, to_date_ly, all_sales_names))
        sales_size_no_color_qty_ly = {(r[0], r[1]): float(r[2]) for r in cur.fetchall()}

        # 5. Fetch existing fixed/manual contributions ordered by recency
        cur.execute("""
            SELECT contribution_type, product_id, color_code, size_id, manual_pct, COALESCE(fixed_percentage, manual_pct), status, last_updated, updated_by
            FROM planning_contributions
            WHERE product_id = ANY(%s) AND version = %s
            ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
        """, (active_pids, version))
        existing_contribs = cur.fetchall()
        existing_map = {}
        for r in existing_contribs:
            c_type, p_id, c_code, sz_id, manual_pct, fixed_pct, status, last_upd, upd_by = r
            manual_pct = float(manual_pct) if manual_pct is not None else 0.0
            fixed_pct = float(fixed_pct) if fixed_pct is not None else None
            last_upd_str = last_upd.strftime('%d-%b-%Y %I:%M:%S %p') if last_upd else None
            
            if c_type == 'Product':
                key = (c_type, p_id)
            elif c_type == 'Color':
                key = (c_type, p_id, c_code)
            elif c_type == 'Size':
                key = (c_type, p_id, sz_id, c_code)
                
            if key not in existing_map:
                existing_map[key] = {
                    'manual_pct': manual_pct,
                    'fixed_percentage': fixed_pct,
                    'status': status,
                    'last_updated': last_upd_str,
                    'updated_by': upd_by
                }

        # 6. Fetch Color mappings
        cur.execute("""
            SELECT m.product_id, c.global_color_code, c.display_color
            FROM product_color_mapping m
            JOIN color_master c ON m.global_color_code = c.global_color_code
            JOIN product_master p ON p.id = m.product_id
            WHERE p.status = 'Active' AND c.status = 'Active' AND c.category = p.color_category AND p.id = ANY(%s);
        """, (active_pids,))
        colors_data = cur.fetchall()
        product_colors_map = {}
        for pid, ccode, cdisp in colors_data:
            if pid not in product_colors_map:
                product_colors_map[pid] = []
            product_colors_map[pid].append((ccode, cdisp))

        # 7. Fetch Size mappings
        cur.execute("""
            SELECT DISTINCT p.id, s.id, s.size, s.size_code
            FROM product_master p
            JOIN product_dia_mapping m ON p.id = m.product_id
            JOIN size_master s ON m.size_id = s.id
            WHERE p.status = 'Active' AND s.status = 'Active' AND p.id = ANY(%s);
        """, (active_pids,))
        sizes_data = cur.fetchall()
        product_sizes_map = {}
        for pid, szid, szname, szcode in sizes_data:
            if pid not in product_sizes_map:
                product_sizes_map[pid] = []
            product_sizes_map[pid].append((szid, szname, szcode))

        # 8. Loop and Calculate
        products_res = []
        colors_res = []
        sizes_res = []

        for pid, pname, brand_id, brand_name in active_products:
            sales_prods = product_sales_map.get(pid, [])
            
            # --- Product Level ---
            p_sales_qty = sum(sales_product_qty.get(sp, 0.0) for sp in sales_prods)
            p_sales_qty_ly = sum(sales_product_qty_ly.get(sp, 0.0) for sp in sales_prods)
            
            p_avg_pct = (p_sales_qty / global_sales_qty * 100.0) if global_sales_qty > 0.0 else 0.0
            p_ly_pct = (p_sales_qty_ly / global_sales_qty_ly * 100.0) if global_sales_qty_ly > 0.0 else 0.0
            
            if suggestion_rule == 'Weighted Average + Last Year':
                p_suggested = 0.5 * p_avg_pct + 0.5 * p_ly_pct
            else:
                p_suggested = p_avg_pct
                
            p_existing = existing_map.get(('Product', pid), {})
            p_current_fixed = p_existing.get('fixed_percentage')
            
            products_res.append({
                'product_id': pid,
                'product_name': pname,
                'brand_id': brand_id,
                'brand_name': brand_name,
                'sales_qty': p_sales_qty,
                'calculated_pct': p_suggested,
                'current_fixed_pct': p_current_fixed,
                'new_pct': p_suggested,
                'status': p_existing.get('status', 'Draft'),
                'last_updated': p_existing.get('last_updated'),
                'updated_by': p_existing.get('updated_by')
            })

            # --- Color Level ---
            product_colors = product_colors_map.get(pid, [])
            color_raw_list = []
            
            for ccode, cdisp in product_colors:
                if color_codes and ccode not in color_codes:
                    continue
                c_sales_qty = sum(sales_color_qty.get((sp, ccode), 0.0) for sp in sales_prods)
                c_sales_qty_ly = sum(sales_color_qty_ly.get((sp, ccode), 0.0) for sp in sales_prods)
                
                c_avg_pct = (c_sales_qty / p_sales_qty * 100.0) if p_sales_qty > 0.0 else 0.0
                c_ly_pct = (c_sales_qty_ly / p_sales_qty_ly * 100.0) if p_sales_qty_ly > 0.0 else 0.0
                
                if suggestion_rule == 'Weighted Average + Last Year':
                    c_suggested = 0.5 * c_avg_pct + 0.5 * c_ly_pct
                else:
                    c_suggested = c_avg_pct
                    
                color_raw_list.append({
                    'color_code': ccode,
                    'color_name': cdisp,
                    'sales_qty': c_sales_qty,
                    'sales_qty_ly': c_sales_qty_ly,
                    'raw_avg': c_avg_pct,
                    'raw_ly': c_ly_pct,
                    'raw_suggested': c_suggested
                })
                
            if color_raw_list:
                norm_avg = normalize_percentages([x['raw_avg'] for x in color_raw_list])
                norm_ly = normalize_percentages([x['raw_ly'] for x in color_raw_list])
                norm_sug = normalize_percentages([x['raw_suggested'] for x in color_raw_list])
                
                for idx, col in enumerate(color_raw_list):
                    ccode = col['color_code']
                    c_existing = existing_map.get(('Color', pid, ccode), {})
                    c_current_fixed = c_existing.get('fixed_percentage')
                    c_new_pct = norm_sug[idx]
                    
                    colors_res.append({
                        'product_id': pid,
                        'product_name': pname,
                        'color_code': ccode,
                        'color_name': col['color_name'],
                        'sales_qty': col['sales_qty'],
                        'calculated_pct': c_new_pct,
                        'current_fixed_pct': c_current_fixed,
                        'new_pct': c_new_pct,
                        'status': c_existing.get('status', 'Draft'),
                        'last_updated': c_existing.get('last_updated'),
                        'updated_by': c_existing.get('updated_by')
                    })

            # --- Size Level ---
            product_sizes = product_sizes_map.get(pid, [])
            if product_colors:
                for ccode, cdisp in product_colors:
                    if color_codes and ccode not in color_codes:
                        continue
                    pc_sales_qty = sum(sales_color_qty.get((sp, ccode), 0.0) for sp in sales_prods)
                    pc_sales_qty_ly = sum(sales_color_qty_ly.get((sp, ccode), 0.0) for sp in sales_prods)
                    
                    size_raw_list = []
                    for szid, szname, szcode in product_sizes:
                        s_sales_qty = sum(sales_size_qty.get((sp, ccode, szname), 0.0) for sp in sales_prods)
                        s_sales_qty_ly = sum(sales_size_qty_ly.get((sp, ccode, szname), 0.0) for sp in sales_prods)
                        
                        s_avg_pct = (s_sales_qty / pc_sales_qty * 100.0) if pc_sales_qty > 0.0 else 0.0
                        s_ly_pct = (s_sales_qty_ly / pc_sales_qty_ly * 100.0) if pc_sales_qty_ly > 0.0 else 0.0
                        
                        if suggestion_rule == 'Weighted Average + Last Year':
                            s_suggested = 0.5 * s_avg_pct + 0.5 * s_ly_pct
                        else:
                            s_suggested = s_avg_pct
                            
                        size_raw_list.append({
                            'size_id': szid,
                            'size_name': szname,
                            'size_code': szcode,
                            'sales_qty': s_sales_qty,
                            'sales_qty_ly': s_sales_qty_ly,
                            'raw_avg': s_avg_pct,
                            'raw_ly': s_ly_pct,
                            'raw_suggested': s_suggested
                        })
                        
                    if size_raw_list:
                        sz_norm_sug = normalize_percentages([x['raw_suggested'] for x in size_raw_list])
                        
                        for sidx, sz in enumerate(size_raw_list):
                            szid = sz['size_id']
                            s_existing = existing_map.get(('Size', pid, szid, ccode), {})
                            s_current_fixed = s_existing.get('fixed_percentage')
                            s_new_pct = sz_norm_sug[sidx]
                            
                            sizes_res.append({
                                'product_id': pid,
                                'product_name': pname,
                                'color_code': ccode,
                                'color_name': cdisp,
                                'size_id': szid,
                                'size_name': sz['size_name'],
                                'size_code': sz['size_code'],
                                'sales_qty': sz['sales_qty'],
                                'calculated_pct': s_new_pct,
                                'current_fixed_pct': s_current_fixed,
                                'new_pct': s_new_pct,
                                'status': s_existing.get('status', 'Draft'),
                                'last_updated': s_existing.get('last_updated'),
                                'updated_by': s_existing.get('updated_by')
                            })
            else:
                size_raw_list = []
                for szid, szname, szcode in product_sizes:
                    s_sales_qty = sum(sales_size_no_color_qty.get((sp, szname), 0.0) for sp in sales_prods)
                    s_sales_qty_ly = sum(sales_size_no_color_qty_ly.get((sp, szname), 0.0) for sp in sales_prods)
                    
                    s_avg_pct = (s_sales_qty / p_sales_qty * 100.0) if p_sales_qty > 0.0 else 0.0
                    s_ly_pct = (s_sales_qty_ly / p_sales_qty_ly * 100.0) if p_sales_qty_ly > 0.0 else 0.0
                    
                    if suggestion_rule == 'Weighted Average + Last Year':
                        s_suggested = 0.5 * s_avg_pct + 0.5 * s_ly_pct
                    else:
                        s_suggested = s_avg_pct
                        
                    size_raw_list.append({
                        'size_id': szid,
                        'size_name': szname,
                        'size_code': szcode,
                        'sales_qty': s_sales_qty,
                        'sales_qty_ly': s_sales_qty_ly,
                        'raw_avg': s_avg_pct,
                        'raw_ly': s_ly_pct,
                        'raw_suggested': s_suggested
                    })
                    
                if size_raw_list:
                    sz_norm_sug = normalize_percentages([x['raw_suggested'] for x in size_raw_list])
                    
                    for sidx, sz in enumerate(size_raw_list):
                        szid = sz['size_id']
                        s_existing = existing_map.get(('Size', pid, szid, None), {})
                        s_current_fixed = s_existing.get('fixed_percentage')
                        s_new_pct = sz_norm_sug[sidx]
                        
                        sizes_res.append({
                            'product_id': pid,
                            'product_name': pname,
                            'color_code': None,
                            'color_name': None,
                            'size_id': szid,
                            'size_name': sz['size_name'],
                            'size_code': sz['size_code'],
                            'sales_qty': sz['sales_qty'],
                            'calculated_pct': s_new_pct,
                            'current_fixed_pct': s_current_fixed,
                            'new_pct': s_new_pct,
                            'status': s_existing.get('status', 'Draft'),
                            'last_updated': s_existing.get('last_updated'),
                            'updated_by': s_existing.get('updated_by')
                        })

        # 9. Validation metrics
        product_sum = sum(p['new_pct'] for p in products_res)
        
        # Color groups validation
        color_groups_valid = True
        color_sums = {}
        for c in colors_res:
            pid = c['product_id']
            color_sums[pid] = color_sums.get(pid, 0.0) + c['new_pct']
        for pid, csum in color_sums.items():
            if abs(csum - 100.00) >= 0.05 and abs(csum) >= 0.05:
                color_groups_valid = False
                break
                
        # Size groups validation
        size_groups_valid = True
        size_sums = {}
        for s in sizes_res:
            key = (s['product_id'], s['color_code'])
            size_sums[key] = size_sums.get(key, 0.0) + s['new_pct']
        for key, ssum in size_sums.items():
            if abs(ssum - 100.00) >= 0.05 and abs(ssum) >= 0.05:
                size_groups_valid = False
                break

        cur.close()
        
        return jsonify({
            'success': True,
            'products': products_res,
            'colors': colors_res,
            'sizes': sizes_res,
            'validation': {
                'product_total': round(product_sum, 2),
                'color_groups_valid': color_groups_valid,
                'size_groups_valid': size_groups_valid
            }
        })
        
    except Exception as e:
        if conn: conn.rollback()
        if cur: cur.close()
        return jsonify({'success': False, 'message': f'Error performing bulk calculation: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


@app.route('/api/planning-contribution/bulk-save', methods=['POST'])
@login_required
def bulk_save_planning_contributions():
    from psycopg2.extras import execute_values
    data = request.json or {}
    from_month = data.get('from_month')
    from_year = int(data.get('from_year')) if data.get('from_year') is not None else None
    to_month = data.get('to_month')
    to_year = int(data.get('to_year')) if data.get('to_year') is not None else None
    version = data.get('version', 'Standard').strip() or 'Standard'
    
    products = data.get('products', [])
    colors = data.get('colors', [])
    sizes = data.get('sizes', [])
    
    if not from_month or not from_year or not to_month or not to_year:
        return jsonify({'success': False, 'message': 'Missing period fields.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    current_time = datetime.now()
    username = session.get('username', 'Admin')
    
    saved_records = []
    
    try:
        # 1. Collect all product IDs from payload to query metadata & brand
        all_product_ids = set()
        for p in products:
            all_product_ids.add(int(p.get('product_id')))
        for c in colors:
            all_product_ids.add(int(c.get('product_id')))
        for s in sizes:
            all_product_ids.add(int(s.get('product_id')))
            
        product_ids_list = list(all_product_ids)
        
        # 2. Bulk Brand Lookup
        brand_map = {}
        if product_ids_list:
            cur.execute("SELECT id, brand_id FROM product_master WHERE id = ANY(%s);", (product_ids_list,))
            brand_map = {row[0]: row[1] for row in cur.fetchall()}
            
        # 3. Preload Existing Records (to preserve original created_by)
        existing_created_by_map = {}
        if product_ids_list:
            cur.execute("""
                SELECT contribution_type, product_id, color_code, size_id, created_by
                FROM planning_contributions
                WHERE product_id = ANY(%s) AND version = %s;
            """, (product_ids_list, version))
            for row in cur.fetchall():
                ctype, pid, ccode, szid, created_by = row
                if ctype == 'Product':
                    key = ('Product', pid, version)
                elif ctype == 'Color':
                    key = ('Color', pid, ccode, version)
                elif ctype == 'Size':
                    key = ('Size', pid, ccode, szid, version) # ccode is None for overall
                else:
                    continue
                existing_created_by_map[key] = created_by
                
        # 4. Prepare Deletion Keys & Insert Tuples
        product_del_keys = set()
        color_del_keys = set()
        size_colorwise_del_keys = set()
        size_overall_del_keys = set()
        
        insert_rows = []
        
        # A. Process Products
        for p in products:
            p_id = int(p.get('product_id'))
            new_pct = float(p.get('new_pct', 0.0))
            brand_id = brand_map.get(p_id)
            
            product_del_keys.add((p_id, version))
            
            key = ('Product', p_id, version)
            orig_created_by = existing_created_by_map.get(key, username)
            
            insert_rows.append((
                'Product', p_id, None, None, brand_id,
                new_pct, new_pct,
                version, 'Completed', orig_created_by, current_time, username
            ))
            
        # B. Process Colors
        for c in colors:
            p_id = int(c.get('product_id'))
            ccode = c.get('color_code')
            new_pct = float(c.get('new_pct', 0.0))
            brand_id = brand_map.get(p_id)
            
            color_del_keys.add((p_id, ccode, version))
            
            key = ('Color', p_id, ccode, version)
            orig_created_by = existing_created_by_map.get(key, username)
            
            insert_rows.append((
                'Color', p_id, ccode, None, brand_id,
                new_pct, new_pct,
                version, 'Completed', orig_created_by, current_time, username
            ))
            
        # C. Process Sizes
        for s in sizes:
            p_id = int(s.get('product_id'))
            ccode = s.get('color_code')
            sz_id = int(s.get('size_id'))
            new_pct = float(s.get('new_pct', 0.0))
            brand_id = brand_map.get(p_id)
            
            if ccode:
                size_colorwise_del_keys.add((p_id, ccode, sz_id, version))
                key = ('Size', p_id, ccode, sz_id, version)
            else:
                size_overall_del_keys.add((p_id, sz_id, version))
                key = ('Size', p_id, None, sz_id, version)
                
            orig_created_by = existing_created_by_map.get(key, username)
            
            insert_rows.append((
                'Size', p_id, ccode, sz_id, brand_id,
                new_pct, new_pct,
                version, 'Completed', orig_created_by, current_time, username
            ))
            
        # 5. Perform Bulk DELETEs
        if product_del_keys:
            cur.execute("""
                DELETE FROM planning_contributions
                WHERE contribution_type = 'Product' AND (product_id, version) IN %s;
            """, (tuple(product_del_keys),))
            
        if color_del_keys:
            cur.execute("""
                DELETE FROM planning_contributions
                WHERE contribution_type = 'Color' AND (product_id, color_code, version) IN %s;
            """, (tuple(color_del_keys),))
            
        if size_colorwise_del_keys:
            cur.execute("""
                DELETE FROM planning_contributions
                WHERE contribution_type = 'Size' AND color_code IS NOT NULL AND (product_id, color_code, size_id, version) IN %s;
            """, (tuple(size_colorwise_del_keys),))
            
        if size_overall_del_keys:
            cur.execute("""
                DELETE FROM planning_contributions
                WHERE contribution_type = 'Size' AND color_code IS NULL AND (product_id, size_id, version) IN %s;
            """, (tuple(size_overall_del_keys),))
            
        # 6. Perform Bulk INSERTs with RETURNING
        if insert_rows:
            insert_query = """
                INSERT INTO planning_contributions (
                    contribution_type, product_id, color_code, size_id, brand_id,
                    manual_pct, fixed_percentage,
                    version, status, created_by, last_updated, updated_by
                ) VALUES %s
                RETURNING id, contribution_type, product_id, color_code, size_id, manual_pct, fixed_percentage, last_updated, updated_by;
            """
            ret_rows = execute_values(cur, insert_query, insert_rows, fetch=True)
            for ret in ret_rows:
                saved_records.append({
                    'id': ret[0],
                    'contribution_type': ret[1],
                    'product_id': ret[2],
                    'color_code': ret[3],
                    'size_id': ret[4],
                    'manual_pct': float(ret[5]) if ret[5] is not None else 0.0,
                    'fixed_percentage': float(ret[6]) if ret[6] is not None else 0.0,
                    'last_updated': ret[7].strftime('%d-%b-%Y %I:%M:%S %p') if ret[7] else None,
                    'updated_by': ret[8]
                })
                
        conn.commit()
        cur.close()
        return jsonify({
            'success': True,
            'message': 'Bulk contributions fixed successfully.',
            'saved_records': saved_records
        })
    except Exception as e:
        if conn: conn.rollback()
        if cur: cur.close()
        return jsonify({'success': False, 'message': f'Error executing bulk save: {str(e)}'}), 500
    finally:
        release_db_connection(conn)


# --- NEXT QTY DERIVATION ENDPOINTS ---
def validate_contribution_sums(cur, version, from_month=None, from_year=None, to_month=None, to_year=None):
    import time
    t_start = time.time()
    warnings = []
    
    # 1. Product validation
    t_p_start = time.time()
    cur.execute("""
        SELECT product_id, COALESCE(fixed_percentage, manual_pct)
        FROM planning_contributions 
        WHERE contribution_type = 'Product' AND version = %s
        ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
    """, (version,))
    product_contrib_dict = {}
    for pid, pct in cur.fetchall():
        if pid not in product_contrib_dict:
            product_contrib_dict[pid] = float(pct) if pct is not None else 0.0

    cur.execute("SELECT id, product_name FROM product_master WHERE status = 'Active';")
    active_products = cur.fetchall()
    p_sum_val = sum(product_contrib_dict.get(p[0], 0.0) for p in active_products)
    has_p = len(product_contrib_dict) > 0
    
    if has_p:
        if p_sum_val == 0.0:
            warnings.append("⚠ Product Contribution is exactly 0%. Qty will be 0.")
        elif abs(p_sum_val - 100.0) >= 0.01:
            diff = 100.0 - p_sum_val
            warnings.append(f"⚠ Product Contribution = {p_sum_val:.2f}%\nRemaining Contribution = {diff:.2f}%\nQty Derived using available contribution.")
    t_p = (time.time() - t_p_start) * 1000

    # 2. Get active products with non-zero contribution
    contributing_products = [p for p in active_products if product_contrib_dict.get(p[0], 0.0) > 0.0]
    
    if not contributing_products:
        t_total = (time.time() - t_start) * 1000
        logger.debug("[PERF] Validation total: %.2f ms" % t_total)
        return True, "\n".join(warnings)
        
    t_preload_start = time.time()
    product_ids = [p[0] for p in contributing_products]
    
    # 3. Bulk load mapped colors (preserving query result order)
    cur.execute("""
        SELECT product_id, global_color_code 
        FROM product_color_mapping 
        WHERE product_id = ANY(%s);
    """, (product_ids,))
    prod_mapped_colors = {}
    for pid, col in cur.fetchall():
        prod_mapped_colors.setdefault(pid, []).append(col)
        
    # 4. Bulk load mapped sizes
    cur.execute("""
        SELECT DISTINCT product_id, size_id 
        FROM product_dia_mapping 
        WHERE product_id = ANY(%s) AND size_id IS NOT NULL;
    """, (product_ids,))
    prod_mapped_sizes = {}
    for pid, sz in cur.fetchall():
        prod_mapped_sizes.setdefault(pid, set()).add(sz)
        
    # 5. Bulk load color display map (preserve first occurrence to mimic database LIMIT 1)
    cur.execute("SELECT global_color_code, display_color FROM color_master;")
    color_display_map = {}
    for code, disp in cur.fetchall():
        if code not in color_display_map:
            color_display_map[code] = disp
    
    # 6. Bulk load Color contributions
    cur.execute("""
        SELECT product_id, color_code, COALESCE(fixed_percentage, manual_pct)
        FROM planning_contributions
        WHERE contribution_type = 'Color' AND version = %s AND product_id = ANY(%s)
        ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
    """, (version, product_ids))
    color_contribs_map = {}
    for pid, col, pct in cur.fetchall():
        if pid not in color_contribs_map:
            color_contribs_map[pid] = {}
        if col not in color_contribs_map[pid]:
            color_contribs_map[pid][col] = float(pct) if pct is not None else 0.0
        
    # 7. Bulk load Color-wise size existence
    cur.execute("""
        SELECT DISTINCT product_id
        FROM planning_contributions
        WHERE contribution_type = 'Size' AND color_code IS NOT NULL AND version = %s AND product_id = ANY(%s);
    """, (version, product_ids))
    products_with_colorwise_sizes = {row[0] for row in cur.fetchall()}
    
    # 8. Bulk load Size contributions (colorwise and overall)
    cur.execute("""
        SELECT product_id, color_code, size_id, COALESCE(fixed_percentage, manual_pct)
        FROM planning_contributions
        WHERE contribution_type = 'Size' AND color_code IS NOT NULL AND version = %s AND product_id = ANY(%s)
        ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
    """, (version, product_ids))
    size_colorwise_map = {}
    for pid, col, sz, pct in cur.fetchall():
        key = (pid, col)
        if key not in size_colorwise_map:
            size_colorwise_map[key] = {}
        if sz not in size_colorwise_map[key]:
            size_colorwise_map[key][sz] = float(pct) if pct is not None else 0.0
        
    cur.execute("""
        SELECT product_id, size_id, COALESCE(fixed_percentage, manual_pct)
        FROM planning_contributions
        WHERE contribution_type = 'Size' AND color_code IS NULL AND version = %s AND product_id = ANY(%s)
        ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
    """, (version, product_ids))
    size_overall_map = {}
    for pid, sz, pct in cur.fetchall():
        if pid not in size_overall_map:
            size_overall_map[pid] = {}
        if sz not in size_overall_map[pid]:
            size_overall_map[pid][sz] = float(pct) if pct is not None else 0.0
        
    t_preload = (time.time() - t_preload_start) * 1000
    
    # 9. Python-side Validation Loops
    t_val_start = time.time()
    for p_id, p_name in contributing_products:
        mapped_colors = sorted(prod_mapped_colors.get(p_id, []))
        has_colors = len(mapped_colors) > 0
        
        # Check colors
        if has_colors:
            prod_color_contribs = color_contribs_map.get(p_id, {})
            c_sum_val = sum(prod_color_contribs.get(col_code, 0.0) for col_code in mapped_colors)
            
            if c_sum_val == 0.0:
                warnings.append(f"⚠ Color Contribution sum for product \"{p_name}\" is exactly 0%. Qty will be 0.")
            elif abs(c_sum_val - 100.0) >= 0.01:
                diff = 100.0 - c_sum_val
                warnings.append(f"⚠ Color Contribution for product \"{p_name}\" = {c_sum_val:.2f}%\nRemaining Contribution = {diff:.2f}%\nQty Derived using available contribution.")

        # Check sizes
        mapped_sizes = prod_mapped_sizes.get(p_id, set())
        has_sizes = len(mapped_sizes) > 0
        if has_sizes:
            has_colorwise_sizes = p_id in products_with_colorwise_sizes
            
            if has_colorwise_sizes and has_colors:
                for col_code in mapped_colors:
                    col_sizes = size_colorwise_map.get((p_id, col_code), {})
                    s_sum_val = sum(col_sizes.get(sz_id, 0.0) for sz_id in mapped_sizes)
                    
                    c_disp = color_display_map.get(col_code, col_code)
                    
                    if s_sum_val == 0.0:
                        warnings.append(f"⚠ Size Contribution sum for product \"{p_name}\" and color \"{c_disp}\" is exactly 0%. Qty will be 0.")
                    elif abs(s_sum_val - 100.0) >= 0.01:
                        diff = 100.0 - s_sum_val
                        warnings.append(f"⚠ Size Contribution for product \"{p_name}\" and color \"{c_disp}\" = {s_sum_val:.2f}%\nRemaining Contribution = {diff:.2f}%\nQty Derived using available contribution.")
            else:
                prod_sizes = size_overall_map.get(p_id, {})
                s_sum_val = sum(prod_sizes.get(sz_id, 0.0) for sz_id in mapped_sizes)
                if s_sum_val == 0.0:
                    warnings.append(f"⚠ Overall Size Contribution sum for product \"{p_name}\" is exactly 0%. Qty will be 0.")
                elif abs(s_sum_val - 100.0) >= 0.01:
                    diff = 100.0 - s_sum_val
                    warnings.append(f"⚠ Size Contribution for product \"{p_name}\" = {s_sum_val:.2f}%\nRemaining Contribution = {diff:.2f}%\nQty Derived using available contribution.")
                    
    t_val = (time.time() - t_val_start) * 1000
    t_total = (time.time() - t_start) * 1000
    
    logger.debug("[PERF] Validation total: %.2f ms (prod=%.2fms, preload=%.2fms, val=%.2fms)" % (t_total, t_p, t_preload, t_val))
    return True, "\n".join(warnings)

@app.route('/api/planning-qty-derivation/meta', methods=['GET'])
@login_required
def get_qty_derivation_meta():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT plan_name, financial_year FROM planning_headers WHERE is_latest = TRUE ORDER BY plan_name, financial_year;")
        plans = [{'plan_name': r[0], 'financial_year': r[1]} for r in cur.fetchall()]
        
        cur.execute("SELECT DISTINCT version FROM planning_contributions ORDER BY version;")
        contrib_versions = [r[0] for r in cur.fetchall()]
        if 'Standard' not in contrib_versions:
            contrib_versions.insert(0, 'Standard')
            
        cur.execute("SELECT DISTINCT version FROM monthly_qty_derivation ORDER BY version;")
        deriv_versions = [r[0] for r in cur.fetchall()]
        if 'v1' not in deriv_versions:
            deriv_versions.insert(0, 'v1')
            
        cur.execute("SELECT id, brand_name FROM brand_master WHERE status = 'Active' ORDER BY brand_name;")
        brands = [{'id': r[0], 'brand_name': r[1]} for r in cur.fetchall()]
        
        cur.execute("SELECT DISTINCT product_type FROM product_master WHERE status = 'Active' ORDER BY product_type;")
        categories = [r[0] for r in cur.fetchall()]
        
        cur.execute("SELECT id, product_name, brand_id, product_type FROM product_master WHERE status = 'Active' ORDER BY product_name;")
        products = [{'id': r[0], 'product_name': r[1], 'brand_id': r[2], 'product_type': r[3]} for r in cur.fetchall()]
        
        cur.close()
        return jsonify({
            'success': True,
            'plans': plans,
            'contribution_versions': contrib_versions,
            'derivation_versions': deriv_versions,
            'brands': brands,
            'categories': categories,
            'products': products
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading metadata: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/planning-qty-derivation/load-data', methods=['GET'])
@login_required
def get_qty_derivation_load_data():
    version = request.args.get('contribution_version', 'Standard').strip() or 'Standard'
    plan_val = request.args.get('plan_id', '').strip() # Can be "Plan Name|FY" or just "Plan Name|FY"
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Resolve plan_id if format is "Plan Name|FY" or if plan_val is plan_name|financial_year
        plan_id = None
        plan_qty = 0
        month_qtys = {}
        if plan_val:
            if '|' in plan_val:
                p_name, f_year = plan_val.split('|')
                cur.execute("""
                    SELECT id FROM planning_headers 
                    WHERE plan_name = %s AND financial_year = %s AND is_latest = TRUE 
                    LIMIT 1;
                """, (p_name.strip(), f_year.strip()))
                row = cur.fetchone()
                if row:
                    plan_id = row[0]
            else:
                try:
                    plan_id = int(plan_val)
                except ValueError:
                    pass
            
            if plan_id:
                cur.execute("""
                    SELECT month, final_qty
                    FROM planning_details
                    WHERE planning_id = %s;
                """, (plan_id,))
                for m_row in cur.fetchall():
                    month_qtys[m_row[0]] = int(m_row[1])
                plan_qty = sum(month_qtys.values())

        # 1. Fetch active products
        cur.execute("""
            SELECT p.id, p.product_name, p.brand_id, b.brand_name, p.product_type, p.color_category
            FROM product_master p
            JOIN brand_master b ON p.brand_id = b.id
            WHERE p.status = 'Active'
            ORDER BY p.product_name ASC;
        """)
        products_rows = cur.fetchall()
        
        # 2. Fetch all mapped colors for active products
        cur.execute("""
            SELECT m.product_id, c.global_color_code, c.display_color
            FROM product_color_mapping m
            JOIN color_master c ON m.global_color_code = c.global_color_code
            JOIN product_master p ON m.product_id = p.id
            WHERE p.status = 'Active' AND c.category = p.color_category AND c.status = 'Active'
            ORDER BY c.display_color;
        """)
        color_rows = cur.fetchall()
        prod_colors = {}
        for pid, c_code, c_name in color_rows:
            color_display = f"{c_code} — {c_name}" if c_code and c_name and c_code.upper() != c_name.upper() else (c_name or c_code)
            prod_colors.setdefault(pid, []).append({'color_code': c_code, 'color_name': color_display, 'display_color': c_name, 'global_color_code': c_code})
            
        # 3. Fetch all mapped sizes for active products
        cur.execute("""
            SELECT DISTINCT m.product_id, s.id, s.size, s.size_code
            FROM product_dia_mapping m
            JOIN size_master s ON m.size_id = s.id
            JOIN product_master p ON m.product_id = p.id
            WHERE p.status = 'Active' AND s.status = 'Active'
            ORDER BY s.size;
        """)
        size_rows = cur.fetchall()
        prod_sizes = {}
        for pid, s_id, sz, sz_code in size_rows:
            prod_sizes.setdefault(pid, []).append({'size_id': s_id, 'size_name': sz, 'size_code': sz_code})
            
        # 4. Fetch authoritative saved contributions for the selected version
        cur.execute("""
            SELECT product_id, color_code, size_id, COALESCE(fixed_percentage, manual_pct), contribution_type
            FROM planning_contributions
            WHERE version = %s
            ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
        """, (version,))
        all_contribs = cur.fetchall()

        product_contribs = {}
        color_contribs = {}
        size_color_contribs = {}
        size_overall_contribs = {}

        for p_id, col_code, sz_id, pct, c_type in all_contribs:
            pct_val = float(pct) if pct is not None else 0.0
            if c_type == 'Product':
                if p_id not in product_contribs:
                    product_contribs[p_id] = pct_val
            elif c_type == 'Color':
                key = (p_id, col_code)
                if key not in color_contribs:
                    color_contribs[key] = pct_val
            elif c_type == 'Size':
                if col_code:
                    key = (p_id, col_code, sz_id)
                    if key not in size_color_contribs:
                        size_color_contribs[key] = pct_val
                else:
                    key = (p_id, sz_id)
                    if key not in size_overall_contribs:
                        size_overall_contribs[key] = pct_val
                
        # 5. Assemble hierarchy
        products = []
        for p_id, p_name, brand_id, brand_name, p_type, color_cat in products_rows:
            p_pct = product_contribs.get(p_id, 0.0)
            
            colors_list = prod_colors.get(p_id, [])
            sizes_list = prod_sizes.get(p_id, [])
            
            has_color_contrib = any((p_id, c['color_code']) in color_contribs for c in colors_list)
            
            colors = []
            for c in colors_list:
                col_code = c['color_code']
                col_name = c['color_name']
                col_pct = color_contribs.get((p_id, col_code), 0.0)
                
                sizes = []
                for s in sizes_list:
                    sz_id = s['size_id']
                    sz_name = s['size_name']
                    sz_code = s['size_code']
                    
                    sz_pct = size_color_contribs.get((p_id, col_code, sz_id))
                    if sz_pct is None:
                        sz_pct = size_overall_contribs.get((p_id, sz_id), 0.0)
                        
                    sizes.append({
                        'size_id': sz_id,
                        'size_name': sz_name,
                        'size_code': sz_code,
                        'contribution_pct': sz_pct
                    })
                    
                colors.append({
                    'color_code': col_code,
                    'color_name': col_name,
                    'contribution_pct': col_pct,
                    'sizes': sizes
                })
                
            products.append({
                'product_id': p_id,
                'product_name': p_name,
                'brand_id': brand_id,
                'brand_name': brand_name,
                'product_type': p_type,
                'product_contribution_pct': p_pct,
                'colors': colors,
                'has_contributions': has_color_contrib
            })
            
        cur.close()
        return jsonify({
            'success': True,
            'products': products,
            'plan_qty': plan_qty,
            'month_qtys': month_qtys
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/planning-qty-derivation/save-contributions', methods=['POST'])
@login_required
def save_qty_derivation_contributions():
    import time
    from psycopg2.extras import execute_values
    
    t_start = time.time()
    conn = None
    
    try:
        data = request.get_json(silent=True) or {}
        raw_version = data.get('version')
        if raw_version and isinstance(raw_version, str):
            version = raw_version.strip() or 'Standard'
        else:
            version = 'Standard'
            
        product_contribs = data.get('product_contributions') or data.get('product_contribs') or []
        color_contribs = data.get('color_contributions') or data.get('color_contribs') or []
        size_contribs = data.get('size_contributions') or data.get('size_contribs') or []
        
        t_prep_start = time.time()
        username = session.get('username', 'admin')
        
        # 1. Gather all unique target product IDs from the payload safely
        candidate_product_ids = set()
        for pc in product_contribs:
            if isinstance(pc, dict) and pc.get('product_id') is not None:
                try:
                    candidate_product_ids.add(int(pc['product_id']))
                except (ValueError, TypeError):
                    pass
        for cc in color_contribs:
            if isinstance(cc, dict) and cc.get('product_id') is not None:
                try:
                    candidate_product_ids.add(int(cc['product_id']))
                except (ValueError, TypeError):
                    pass
        for sc in size_contribs:
            if isinstance(sc, dict) and sc.get('product_id') is not None:
                try:
                    candidate_product_ids.add(int(sc['product_id']))
                except (ValueError, TypeError):
                    pass
            
        candidate_product_ids_list = list(candidate_product_ids)
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 2. Bulk Metadata Lookup & Validation against master tables
        t_meta_start = time.time()
        brand_map = {}
        if candidate_product_ids_list:
            cur.execute("SELECT id, brand_id FROM product_master WHERE id = ANY(%s);", (candidate_product_ids_list,))
            brand_map = {row[0]: row[1] for row in cur.fetchall()}
            
        valid_product_ids = set(brand_map.keys())
        product_ids_list = [pid for pid in candidate_product_ids_list if pid in valid_product_ids]
        
        # Validate size IDs against size_master
        candidate_size_ids = set()
        for sc in size_contribs:
            if isinstance(sc, dict) and sc.get('size_id') is not None:
                try:
                    candidate_size_ids.add(int(sc['size_id']))
                except (ValueError, TypeError):
                    pass
        valid_size_ids = set()
        if candidate_size_ids:
            cur.execute("SELECT id FROM size_master WHERE id = ANY(%s);", (list(candidate_size_ids),))
            valid_size_ids = {row[0] for row in cur.fetchall()}
            
        t_meta = (time.time() - t_meta_start) * 1000
        
        # 3. Build insert rows
        product_insert_rows = []
        color_insert_rows = []
        size_insert_rows = []
        
        # Helper for safe float conversion
        def parse_pct(v):
            if v is None:
                return 0.0
            try:
                f = float(v)
                if math.isnan(f) or math.isinf(f):
                    return 0.0
                return max(0.0, min(100.0, f))
            except (ValueError, TypeError):
                return 0.0

        current_time = datetime.now()
        
        # Process Product Contributions
        seen_product_keys = set()
        for pc in product_contribs:
            if not isinstance(pc, dict):
                continue
            try:
                p_id = int(pc.get('product_id'))
            except (ValueError, TypeError):
                continue
            if p_id not in valid_product_ids or p_id in seen_product_keys:
                continue
            seen_product_keys.add(p_id)
            
            pct = parse_pct(pc.get('manual_pct'))
            b_id = brand_map.get(p_id)
            product_insert_rows.append((
                'Product', p_id, None, None, b_id, pct, version, 'Draft', username,
                pct, current_time, username
            ))
            
        # Process Color Contributions
        seen_color_keys = set()
        for cc in color_contribs:
            if not isinstance(cc, dict):
                continue
            try:
                p_id = int(cc.get('product_id'))
            except (ValueError, TypeError):
                continue
            col_code = cc.get('color_code')
            if not col_code or p_id not in valid_product_ids:
                continue
            col_code = str(col_code).strip()
            if not col_code:
                continue
                
            key = (p_id, col_code)
            if key in seen_color_keys:
                continue
            seen_color_keys.add(key)
            
            pct = parse_pct(cc.get('manual_pct'))
            b_id = brand_map.get(p_id)
            color_insert_rows.append((
                'Color', p_id, col_code, None, b_id, pct, version, 'Draft', username,
                pct, current_time, username
            ))
            
        # Process Size Contributions
        seen_size_colorwise_keys = set()
        seen_size_overall_keys = set()
        for sc in size_contribs:
            if not isinstance(sc, dict):
                continue
            try:
                p_id = int(sc.get('product_id'))
            except (ValueError, TypeError):
                continue
            if p_id not in valid_product_ids:
                continue
                
            raw_sz = sc.get('size_id')
            try:
                sz_id = int(raw_sz) if raw_sz is not None else None
            except (ValueError, TypeError):
                sz_id = None
                
            if sz_id is not None and sz_id not in valid_size_ids:
                sz_id = None
                
            col_code = sc.get('color_code')
            if col_code:
                col_code = str(col_code).strip()
                if not col_code:
                    col_code = None
                    
            pct = parse_pct(sc.get('manual_pct'))
            b_id = brand_map.get(p_id)
            
            if col_code:
                key = (p_id, col_code, sz_id)
                if key in seen_size_colorwise_keys:
                    continue
                seen_size_colorwise_keys.add(key)
                size_insert_rows.append((
                    'Size', p_id, col_code, sz_id, b_id, pct, version, 'Draft', username,
                    pct, current_time, username
                ))
            else:
                key = (p_id, sz_id)
                if key in seen_size_overall_keys:
                    continue
                seen_size_overall_keys.add(key)
                size_insert_rows.append((
                    'Size', p_id, None, sz_id, b_id, pct, version, 'Draft', username,
                    pct, current_time, username
                ))
                
        t_prep = (time.time() - t_prep_start) * 1000
        
        # 4. Perform Bulk DELETE for target products and version
        t_del_start = time.time()
        del_count = 0
        if product_ids_list:
            cur.execute("""
                DELETE FROM planning_contributions
                WHERE product_id = ANY(%s) AND version = %s;
            """, (product_ids_list, version))
            del_count = cur.rowcount
        t_del = (time.time() - t_del_start) * 1000
        
        # 5. Perform Bulk INSERTs
        t_ins_start = time.time()
        insert_query = """
            INSERT INTO planning_contributions (
                contribution_type, product_id, color_code, size_id, brand_id,
                manual_pct, version, status, created_by,
                fixed_percentage, last_updated, updated_by
            ) VALUES %s;
        """
        
        ins_count = 0
        if product_insert_rows:
            execute_values(cur, insert_query, product_insert_rows, page_size=1000)
            ins_count += len(product_insert_rows)
        if color_insert_rows:
            execute_values(cur, insert_query, color_insert_rows, page_size=1000)
            ins_count += len(color_insert_rows)
        if size_insert_rows:
            execute_values(cur, insert_query, size_insert_rows, page_size=1000)
            ins_count += len(size_insert_rows)
            
        t_ins = (time.time() - t_ins_start) * 1000
        
        # 6. Commit transaction
        t_commit_start = time.time()
        conn.commit()
        t_commit = (time.time() - t_commit_start) * 1000
        
        t_total = (time.time() - t_start) * 1000
        logger.info(f"[QTY_DERIVATION] Saved contributions successfully for version '{version}': {ins_count} rows inserted, {del_count} rows deleted in {t_total:.2f}ms")
        
        cur.close()
        return jsonify({
            'success': True,
            'message': 'Contributions saved successfully.',
            'perf_log': {
                'payload_prep_ms': t_prep,
                'metadata_lookup_ms': t_meta,
                'bulk_delete_ms': t_del,
                'bulk_insert_ms': t_ins,
                'commit_ms': t_commit,
                'total_save_ms': t_total
            }
        })
        
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.error(f"Error saving planning contributions: {e}", exc_info=True)
        return jsonify({'success': False, 'message': f'Error saving contributions: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

@app.route('/api/planning-qty-derivation/validate', methods=['GET'])

@login_required
def get_qty_derivation_validate():
    version = request.args.get('contribution_version', 'Standard').strip()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        valid, message = validate_contribution_sums(cur, version)
        return jsonify({'success': True, 'valid': valid, 'message': message})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error validating: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/planning-qty-derivation/generate', methods=['POST'])
@login_required
def generate_qty_derivation():
    data = request.json or {}
    plan_name = data.get('plan_name', '').strip()
    financial_year = data.get('financial_year', '').strip()
    contrib_version = data.get('contribution_version', 'Standard').strip()
    deriv_version = data.get('derivation_version', 'v1').strip() or 'v1'
    overwrite = bool(data.get('overwrite', False))
    
    if not plan_name or not financial_year or not contrib_version:
        return jsonify({'success': False, 'message': 'Plan Name, Financial Year, and Contribution Version are required.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # 1. Run validations (blocking only if valid is False, which indicates exactly 0% contribution)

        valid, val_msg = validate_contribution_sums(cur, contrib_version)
        if not valid:
            cur.close()
            return jsonify({'success': False, 'message': val_msg}), 400
        warning = val_msg if val_msg else None
            
        # 2. Check for existing records
        cur.execute("""
            SELECT EXISTS(
                SELECT 1 FROM monthly_qty_derivation 
                WHERE plan_name = %s AND financial_year = %s AND version = %s
            );
        """, (plan_name, financial_year, deriv_version))
        already_exists = cur.fetchone()[0]
        
        if already_exists and not overwrite:
            cur.close()
            return jsonify({
                'success': True,
                'already_exists': True,
                'message': f"Derivation records already exist for Plan '{plan_name}' ({financial_year}) and Version '{deriv_version}'. Do you want to overwrite?"
            })
            
        # 3. Fetch plan header
        cur.execute("""
            SELECT id, financial_year 
            FROM planning_headers 
            WHERE plan_name = %s AND financial_year = %s AND is_latest = TRUE 
            LIMIT 1;
        """, (plan_name, financial_year))
        plan_hdr = cur.fetchone()
        if not plan_hdr:
            cur.close()
            return jsonify({'success': False, 'message': f"Plan Name '{plan_name}' ({financial_year}) not found."}), 404
            
        plan_id, financial_year = plan_hdr
        
        # Fetch monthly planned quantities
        cur.execute("""
            SELECT month, final_qty 
            FROM planning_details 
            WHERE planning_id = %s;
        """, (plan_id,))
        month_qtys = {r[0]: int(r[1]) for r in cur.fetchall()}
        
        # If overwrite is True, delete existing
        if already_exists:
            cur.execute("""
                DELETE FROM monthly_qty_derivation 
                WHERE plan_name = %s AND financial_year = %s AND version = %s;
            """, (plan_name, financial_year, deriv_version))
            
        # 4. Optimized Derivation Calculations
        # Load products
        cur.execute("""
            SELECT p.id, p.product_name, b.brand_name, p.product_type 
            FROM product_master p 
            JOIN brand_master b ON p.brand_id = b.id 
            WHERE p.status = 'Active';
        """)
        active_products = cur.fetchall()
        active_product_ids = [p[0] for p in active_products]
        
        if not active_products:
            cur.close()
            return jsonify({'success': False, 'message': 'No active products found.'}), 400
            
        # Load product colors mapping
        cur.execute("SELECT product_id, global_color_code FROM product_color_mapping;")
        prod_colors_raw = cur.fetchall()
        prod_colors = {}
        for p_id, c_code in prod_colors_raw:
            prod_colors.setdefault(p_id, []).append(c_code)
            
        # Load product size mapping
        cur.execute("SELECT DISTINCT product_id, size_id FROM product_dia_mapping WHERE size_id IS NOT NULL;")
        prod_sizes_raw = cur.fetchall()
        prod_sizes = {}
        for p_id, s_id in prod_sizes_raw:
            prod_sizes.setdefault(p_id, []).append(s_id)
            
        # Baseline fallback: global_color_code -> display_color
        cur.execute("SELECT global_color_code, display_color FROM color_master ORDER BY category DESC;")
        fallback_color_map = {r[0]: r[1] for r in cur.fetchall()}
        
        # Precise map: (product_id, global_color_code) -> display_color
        cur.execute("""
            SELECT m.product_id, c.global_color_code, c.display_color
            FROM product_color_mapping m
            JOIN color_master c ON m.global_color_code = c.global_color_code
            JOIN product_master p ON m.product_id = p.id
            WHERE c.category = p.color_category AND c.status = 'Active';
        """)
        precise_color_map = {(r[0], r[1]): r[2] for r in cur.fetchall()}
        
        # Size Master map (id -> size name)
        cur.execute("SELECT id, size FROM size_master;")
        size_name_map = {r[0]: r[1] for r in cur.fetchall()}
        
        # Load contributions (ordered by authoritative recency)
        # Product
        cur.execute("""
            SELECT product_id, COALESCE(fixed_percentage, manual_pct) 
            FROM planning_contributions 
            WHERE contribution_type = 'Product' AND version = %s AND product_id = ANY(%s)
            ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
        """, (contrib_version, active_product_ids))
        product_contrib_dict = {}
        for pid, pct in cur.fetchall():
            if pid not in product_contrib_dict:
                product_contrib_dict[pid] = float(pct) if pct is not None else 0.0
        
        # Color
        cur.execute("""
            SELECT product_id, color_code, COALESCE(fixed_percentage, manual_pct) 
            FROM planning_contributions 
            WHERE contribution_type = 'Color' AND version = %s AND product_id = ANY(%s)
            ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
        """, (contrib_version, active_product_ids))
        color_contrib_dict = {}
        for pid, col, pct in cur.fetchall():
            key = (pid, col)
            if key not in color_contrib_dict:
                color_contrib_dict[key] = float(pct) if pct is not None else 0.0
        
        # Size (Color-wise)
        cur.execute("""
            SELECT product_id, color_code, size_id, COALESCE(fixed_percentage, manual_pct) 
            FROM planning_contributions 
            WHERE contribution_type = 'Size' AND color_code IS NOT NULL AND version = %s AND product_id = ANY(%s)
            ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
        """, (contrib_version, active_product_ids))
        size_color_contrib_dict = {}
        for pid, col, sz, pct in cur.fetchall():
            key = (pid, col, sz)
            if key not in size_color_contrib_dict:
                size_color_contrib_dict[key] = float(pct) if pct is not None else 0.0
        
        # Size (Overall)
        cur.execute("""
            SELECT product_id, size_id, COALESCE(fixed_percentage, manual_pct) 
            FROM planning_contributions 
            WHERE contribution_type = 'Size' AND color_code IS NULL AND version = %s AND product_id = ANY(%s)
            ORDER BY COALESCE(last_updated, updated_at, created_at) DESC, id DESC;
        """, (contrib_version, active_product_ids))
        size_overall_contrib_dict = {}
        for pid, sz, pct in cur.fetchall():
            key = (pid, sz)
            if key not in size_overall_contrib_dict:
                size_overall_contrib_dict[key] = float(pct) if pct is not None else 0.0
        
        # Helper to resolve calendar year
        def get_calendar_year(fy_str, month_name):
            try:
                import re
                digits = re.findall(r'\d+', fy_str)
                if len(digits) >= 2:
                    start_yr = int(digits[0])
                    if len(digits[1]) == 2:
                        end_yr = (start_yr // 100) * 100 + int(digits[1])
                    else:
                        end_yr = int(digits[1])
                elif len(digits) == 1:
                    start_yr = int(digits[0])
                    end_yr = start_yr + 1
                else:
                    start_yr = 2026
                    end_yr = 2027
            except:
                start_yr = 2026
                end_yr = 2027
                
            MONTH_YEAR_MAP = {
                'April': start_yr, 'May': start_yr, 'June': start_yr,
                'July': start_yr, 'August': start_yr, 'September': start_yr,
                'October': start_yr, 'November': start_yr, 'December': start_yr,
                'January': end_yr, 'February': end_yr, 'March': end_yr
            }
            return MONTH_YEAR_MAP.get(month_name, start_yr)
            
        records_to_insert = []
        username = session.get('username', 'admin')
        
        for month_name, overall_qty in month_qtys.items():
            cal_year = get_calendar_year(financial_year, month_name)
            
            for p_id, p_name, brand_name, p_type in active_products:
                p_pct = product_contrib_dict.get(p_id, 0.0)
                if p_pct <= 0.0:
                    continue
                    
                p_qty = float(overall_qty) * (p_pct / 100.0)
                colors_mapped = prod_colors.get(p_id, [])
                
                if colors_mapped:
                    for col_code in colors_mapped:
                        col_pct = color_contrib_dict.get((p_id, col_code), 0.0)
                        if col_pct <= 0.0:
                            continue
                            
                        col_qty = p_qty * (col_pct / 100.0)
                        col_name = precise_color_map.get((p_id, col_code))
                        if not col_name:
                            col_name = fallback_color_map.get(col_code, col_code)
                        sizes_mapped = prod_sizes.get(p_id, [])
                        
                        for sz_id in sizes_mapped:
                            sz_pct = size_color_contrib_dict.get((p_id, col_code, sz_id))
                            if sz_pct is None:
                                sz_pct = size_overall_contrib_dict.get((p_id, sz_id), 0.0)
                                
                            if sz_pct <= 0.0:
                                continue
                                
                            sz_qty = col_qty * (sz_pct / 100.0)
                            sz_name = size_name_map.get(sz_id, str(sz_id))
                            
                            records_to_insert.append((
                                plan_name, financial_year, deriv_version, month_name, cal_year,
                                brand_name, p_type, p_name, p_pct, p_qty,
                                col_name, col_pct, col_qty,
                                sz_name, sz_pct, sz_qty,
                                username
                            ))
                            
        if records_to_insert:
            from psycopg2.extras import execute_values
            insert_query = """
                INSERT INTO monthly_qty_derivation (
                    plan_name, financial_year, version, month, year, brand, category, product,
                    product_contribution, product_qty, color, color_contribution, color_qty,
                    size, size_contribution, final_qty, generated_by
                ) VALUES %s;
            """
            execute_values(cur, insert_query, records_to_insert, page_size=2000)
            
            # Invalidate balance qty cache for this plan and version
            cur.execute("""
                DELETE FROM balance_qty_cache 
                WHERE plan_name = %s AND financial_year = %s AND version = %s;
            """, (plan_name, financial_year, deriv_version))
            
        conn.commit()
        cur.close()
        return jsonify({
            'success': True,
            'count': len(records_to_insert),
            'warning': warning,
            'message': f"Derived and stored {len(records_to_insert)} quantity records successfully." + (f"\n\nWarning: {warning}" if warning else "")
        })
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'success': False, 'message': f'Error generating quantity derivation: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/planning-qty-derivation/data', methods=['GET'])
@login_required
def get_qty_derivation_data():
    plan_name = request.args.get('plan_name', '').strip()
    financial_year = request.args.get('financial_year', '').strip()
    version = request.args.get('version', 'v1').strip()
    brand = request.args.get('brand', '').strip()
    category = request.args.get('category', '').strip()
    product = request.args.get('product', '').strip()
    month = request.args.get('month', '').strip()
    season = request.args.get('season', '').strip()
    
    try:
        page = int(request.args.get('page', 1))
        if page < 1: page = 1
    except:
        page = 1
        
    try:
        per_page = int(request.args.get('per_page', 50))
        if per_page < 1: per_page = 50
    except:
        per_page = 50
        
    offset = (page - 1) * per_page
    
    if not plan_name or not financial_year or not version:
        return jsonify({'success': True, 'rows': [], 'total_count': 0, 'summary': {
            'overall_planned_qty': 0,
            'product_qty_total': 0,
            'color_qty_total': 0,
            'size_qty_total': 0,
            'difference': 0
        }})
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Build WHERE clause
        where_clauses = ["plan_name = %s", "financial_year = %s", "version = %s"]
        where_params = [plan_name, financial_year, version]
        
        if brand:
            where_clauses.append("brand = %s")
            where_params.append(brand)
        if category:
            where_clauses.append("category = %s")
            where_params.append(category)
        if product:
            where_clauses.append("product = %s")
            where_params.append(product)
        if month:
            where_clauses.append("month = %s")
            where_params.append(month)
        if season:
            where_clauses.append("plan_name ILIKE %s")
            where_params.append(f"%{season}%")
            
        where_str = " AND ".join(where_clauses)
        
        # 1. Total Count
        cur.execute(f"SELECT COUNT(*) FROM monthly_qty_derivation WHERE {where_str};", tuple(where_params))
        total_count = cur.fetchone()[0]
        
        # 2. Paginated Rows
        cur.execute(f"""
            SELECT id, month, plan_name, financial_year, product, product_contribution, product_qty,
                   color, color_contribution, color_qty, size, size_contribution, final_qty
            FROM monthly_qty_derivation
            WHERE {where_str}
            ORDER BY id
            LIMIT %s OFFSET %s;
        """, tuple(where_params + [per_page, offset]))
        
        db_rows = cur.fetchall()
        cols = ['id', 'month', 'plan_name', 'financial_year', 'product', 'product_contribution', 'product_qty',
                'color', 'color_contribution', 'color_qty', 'size', 'size_contribution', 'final_qty']
        rows = [serialize_row(r, cols) for r in db_rows]
        
        # 3. Summary Section (Calculated over the entire unfiltered version scope)
        # Overall Planned Qty
        cur.execute("""
            SELECT SUM(final_qty) 
            FROM planning_details 
            WHERE planning_id = (SELECT id FROM planning_headers WHERE plan_name = %s AND financial_year = %s AND is_latest = TRUE LIMIT 1);
        """, (plan_name, financial_year))
        overall_planned = float(cur.fetchone()[0] or 0.0)
        
        # Product Qty Sum
        cur.execute("""
            SELECT SUM(p_qty) FROM (
                SELECT DISTINCT month, product, product_qty AS p_qty 
                FROM monthly_qty_derivation 
                WHERE plan_name = %s AND financial_year = %s AND version = %s
            ) t;
        """, (plan_name, financial_year, version))
        product_qty_total = float(cur.fetchone()[0] or 0.0)
        
        # Color Qty Sum
        cur.execute("""
            SELECT SUM(c_qty) FROM (
                SELECT DISTINCT month, product, color, color_qty AS c_qty 
                FROM monthly_qty_derivation 
                WHERE plan_name = %s AND financial_year = %s AND version = %s
            ) t;
        """, (plan_name, financial_year, version))
        color_qty_total = float(cur.fetchone()[0] or 0.0)
        
        # Size Qty Sum (Final Qty)
        cur.execute("""
            SELECT SUM(final_qty) 
            FROM monthly_qty_derivation 
            WHERE plan_name = %s AND financial_year = %s AND version = %s;
        """, (plan_name, financial_year, version))
        size_qty_total = float(cur.fetchone()[0] or 0.0)
        
        diff = overall_planned - size_qty_total
        
        summary = {
            'overall_planned_qty': overall_planned,
            'product_qty_total': product_qty_total,
            'color_qty_total': color_qty_total,
            'size_qty_total': size_qty_total,
            'difference': diff
        }
        
        cur.close()
        return jsonify({
            'success': True,
            'rows': rows,
            'total_count': total_count,
            'summary': summary
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading derivation data: {str(e)}'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/planning-qty-derivation/export', methods=['GET'])
@login_required
def export_qty_derivation():
    plan_name = request.args.get('plan_name', '').strip()
    financial_year = request.args.get('financial_year', '').strip()
    contrib_version = request.args.get('contrib_version', 'Standard').strip() or 'Standard'
    brand_filter = request.args.get('brand', '').strip()
    category_filter = request.args.get('category', '').strip()
    product_filter = request.args.get('product', '').strip()
    month_filter = request.args.get('month', '').strip()
    season_filter = request.args.get('season', '').strip()
    
    if not plan_name or not financial_year:
        return "Plan Name and Financial Year are required for export.", 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Get plan header
        cur.execute("""
            SELECT id FROM planning_headers 
            WHERE plan_name = %s AND financial_year = %s AND is_latest = TRUE 
            LIMIT 1;
        """, (plan_name, financial_year))
        plan_hdr = cur.fetchone()
        if not plan_hdr:
            cur.close()
            return f"Plan Name '{plan_name}' ({financial_year}) not found.", 404
        plan_id = plan_hdr[0]
        
        # Fetch month-wise planned quantities
        cur.execute("""
            SELECT month, final_qty 
            FROM planning_details 
            WHERE planning_id = %s;
        """, (plan_id,))
        month_qtys = {r[0]: int(r[1]) for r in cur.fetchall()}
        
        # Load products
        cur.execute("""
            SELECT p.id, p.product_name, b.brand_name, p.product_type 
            FROM product_master p 
            JOIN brand_master b ON p.brand_id = b.id 
            WHERE p.status = 'Active';
        """)
        active_products = cur.fetchall()
        active_product_ids = [p[0] for p in active_products]
        
        if not active_products:
            cur.close()
            return "No active products found.", 400
            
        # Load product colors mapping
        cur.execute("""
            SELECT m.product_id, c.global_color_code, c.display_color
            FROM product_color_mapping m
            JOIN color_master c ON m.global_color_code = c.global_color_code
            JOIN product_master p ON m.product_id = p.id
            WHERE p.status = 'Active' AND c.category = p.color_category AND c.status = 'Active';
        """)
        prod_colors = {}
        for p_id, c_code, c_disp in cur.fetchall():
            prod_colors.setdefault(p_id, []).append((c_code, c_disp))
            
        # Load product size mapping
        cur.execute("""
            SELECT DISTINCT m.product_id, s.id, s.size
            FROM product_dia_mapping m
            JOIN size_master s ON m.size_id = s.id
            JOIN product_master p ON m.product_id = p.id
            WHERE p.status = 'Active' AND s.status = 'Active';
        """)
        prod_sizes = {}
        for p_id, s_id, s_name in cur.fetchall():
            prod_sizes.setdefault(p_id, []).append((s_id, s_name))
            
        # Load contributions
        # Product
        cur.execute("""
            SELECT product_id, manual_pct 
            FROM planning_contributions 
            WHERE contribution_type = 'Product' AND version = %s AND product_id = ANY(%s);
        """, (contrib_version, active_product_ids))
        product_contrib_dict = {r[0]: float(r[1]) for r in cur.fetchall()}
        
        # Color
        cur.execute("""
            SELECT product_id, color_code, manual_pct 
            FROM planning_contributions 
            WHERE contribution_type = 'Color' AND version = %s AND product_id = ANY(%s);
        """, (contrib_version, active_product_ids))
        color_contrib_dict = {(r[0], r[1]): float(r[2]) for r in cur.fetchall()}
        
        # Size (Color-wise)
        cur.execute("""
            SELECT product_id, color_code, size_id, manual_pct 
            FROM planning_contributions 
            WHERE contribution_type = 'Size' AND color_code IS NOT NULL AND version = %s AND product_id = ANY(%s);
        """, (contrib_version, active_product_ids))
        size_color_contrib_dict = {(r[0], r[1], r[2]): float(r[3]) for r in cur.fetchall()}
        
        # Size (Overall)
        cur.execute("""
            SELECT product_id, size_id, manual_pct 
            FROM planning_contributions 
            WHERE contribution_type = 'Size' AND color_code IS NULL AND version = %s AND product_id = ANY(%s);
        """, (contrib_version, active_product_ids))
        size_overall_contrib_dict = {(r[0], r[1]): float(r[2]) for r in cur.fetchall()}
        
        # Determine statuses for products and colors
        product_statuses = {}
        color_statuses = {}
        
        for p_id, p_name, brand_name, p_type in active_products:
            # Color sum must be 100%
            colors_mapped = prod_colors.get(p_id, [])
            c_sum = sum(color_contrib_dict.get((p_id, c_code), 0.0) for c_code, _ in colors_mapped)
            is_product_completed = abs(c_sum - 100.0) < 0.01
            product_statuses[p_id] = is_product_completed
            
            # Size sums must be 100% for each color
            sizes_mapped = prod_sizes.get(p_id, [])
            for c_code, c_disp in colors_mapped:
                has_colorwise = any((p_id, c_code, sz_id) in size_color_contrib_dict for sz_id, _ in sizes_mapped)
                if has_colorwise:
                    s_sum = sum(size_color_contrib_dict.get((p_id, c_code, sz_id), 0.0) for sz_id, _ in sizes_mapped)
                else:
                    s_sum = sum(size_overall_contrib_dict.get((p_id, sz_id), 0.0) for sz_id, _ in sizes_mapped)
                
                color_statuses[(p_id, c_code)] = abs(s_sum - 100.0) < 0.01
        
        import io, csv
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write headers
        writer.writerow([
            'Month', 'Plan Name', 'Financial Year', 'Brand', 'Category', 'Product', 'Product %', 'Product Qty',
            'Color', 'Color %', 'Color Qty', 'Size', 'Size %', 'Final Qty'
        ])
        
        MONTH_ORDER = {
            'April': 1, 'May': 2, 'June': 3, 'July': 4, 'August': 5, 'September': 6,
            'October': 7, 'November': 8, 'December': 9, 'January': 10, 'February': 11, 'March': 12
        }
        
        sorted_months = sorted(month_qtys.keys(), key=lambda m: MONTH_ORDER.get(m, 13))
        
        for month_name in sorted_months:
            if month_filter and month_name.lower() != month_filter.lower():
                continue
                
            overall_qty = float(month_qtys[month_name])
            
            for p_id, p_name, brand_name, p_type in active_products:
                if brand_filter and brand_name.lower() != brand_filter.lower():
                    continue
                if category_filter and p_type.lower() != category_filter.lower():
                    continue
                if product_filter and p_name.lower() != product_filter.lower():
                    continue
                if season_filter and season_filter.lower() not in plan_name.lower():
                    continue
                    
                p_pct = product_contrib_dict.get(p_id, 0.0)
                
                colors_mapped = prod_colors.get(p_id, [])
                if not colors_mapped:
                    continue
                
                p_qty = overall_qty * (p_pct / 100.0)
                
                for c_code, c_disp in colors_mapped:
                    col_pct = color_contrib_dict.get((p_id, c_code), 0.0)
                    col_qty = p_qty * (col_pct / 100.0)
                    
                    sizes_mapped = prod_sizes.get(p_id, [])
                    for sz_id, sz_name in sizes_mapped:
                        sz_pct = size_color_contrib_dict.get((p_id, c_code, sz_id))
                        if sz_pct is None:
                            sz_pct = size_overall_contrib_dict.get((p_id, sz_id), 0.0)
                            
                        final_qty = col_qty * (sz_pct / 100.0)
                        
                        writer.writerow([
                             month_name, plan_name, financial_year, brand_name, p_type, p_name,
                             f"{p_pct:.2f}%", round(p_qty, 2),
                             c_disp, f"{col_pct:.2f}%", round(col_qty, 2),
                             sz_name, f"{sz_pct:.2f}%", round(final_qty, 2)
                        ])
                        
        cur.close()
        
        from flask import Response
        response = Response(output.getvalue(), mimetype='text/csv')
        response.headers["Content-Disposition"] = f"attachment; filename=Qty_Derivation_{plan_name}_{financial_year.replace(' ', '_')}.csv"
        return response
    except Exception as e:
        return f"Error exporting derivation data: {str(e)}", 500
    finally:
        release_db_connection(conn)

# --- AI PLANNING ASSISTANT SUPPORT ---
import requests

def get_ai_planning_context():
    conn = get_db_connection()
    cur = conn.cursor()
    context = {}
    try:
        # 1. Master Stats
        cur.execute("SELECT COUNT(*) FROM brand_master WHERE status = 'Active';")
        context['active_brands_count'] = cur.fetchone()[0] or 0
        
        cur.execute("SELECT COUNT(*) FROM fabric_master WHERE status = 'Active';")
        context['active_fabrics_count'] = cur.fetchone()[0] or 0
        
        cur.execute("SELECT COUNT(*) FROM color_master WHERE status = 'Active';")
        context['active_colors_count'] = cur.fetchone()[0] or 0
        
        cur.execute("SELECT COUNT(*) FROM size_master WHERE status = 'Active';")
        context['active_sizes_count'] = cur.fetchone()[0] or 0
        
        cur.execute("SELECT COUNT(*) FROM product_master WHERE status = 'Active';")
        context['active_products_count'] = cur.fetchone()[0] or 0

        # 2. Latest Plan Header and Details
        cur.execute("SELECT id, plan_name, financial_year, planning_method, status, version, remarks FROM planning_headers WHERE is_latest = TRUE LIMIT 1;")
        hdr = cur.fetchone()
        if hdr:
            plan_id, plan_name, fy, method, status, version, remarks = hdr
            context['active_plan'] = {
                'id': plan_id,
                'plan_name': plan_name,
                'financial_year': fy,
                'planning_method': method,
                'status': status,
                'version': version,
                'remarks': remarks
            }
            cur.execute("""
                SELECT month, last_year_qty, growth_percent, sales_target, average_sale_value, calculated_qty, manual_adjustment, festival_qty, new_store_qty, final_qty, remarks, locked
                FROM planning_details
                WHERE planning_id = %s
                ORDER BY CASE month 
                    WHEN 'April' THEN 1 WHEN 'May' THEN 2 WHEN 'June' THEN 3 WHEN 'July' THEN 4
                    WHEN 'August' THEN 5 WHEN 'September' THEN 6 WHEN 'October' THEN 7 WHEN 'November' THEN 8
                    WHEN 'December' THEN 9 WHEN 'January' THEN 10 WHEN 'February' THEN 11 WHEN 'March' THEN 12
                END;
            """, (plan_id,))
            details = []
            cols = ['month', 'last_year_qty', 'growth_percent', 'sales_target', 'average_sale_value', 'calculated_qty', 'manual_adjustment', 'festival_qty', 'new_store_qty', 'final_qty', 'remarks', 'locked']
            for row in cur.fetchall():
                row_dict = {}
                for col, val in zip(cols, row):
                    if isinstance(val, (float, int)) or (val is not None and hasattr(val, 'as_tuple')): # handle numeric/decimal
                        row_dict[col] = float(val)
                    else:
                        row_dict[col] = val
                details.append(row_dict)
            context['active_plan_details'] = details
        else:
            context['active_plan'] = None

        # 3. Product sales mapping & fabric consumption
        cur.execute("""
            SELECT p.product_name, b.brand_name, f.fabric_name, f.uom, p.fabric_consumption, p.production_type
            FROM product_master p
            JOIN brand_master b ON p.brand_id = b.id
            JOIN fabric_master f ON p.fabric_id = f.id
            WHERE p.status = 'Active'
            LIMIT 100;
        """)
        products_info = []
        for row in cur.fetchall():
            products_info.append({
                'product_name': row[0],
                'brand_name': row[1],
                'fabric_name': row[2],
                'uom': row[3],
                'fabric_consumption': float(row[4] or 0.0),
                'production_type': row[5]
            })
        context['products_info'] = products_info

        # 4. Check for Contribution Validation errors
        cur.execute("SELECT DISTINCT version FROM planning_contributions LIMIT 10;")
        contrib_versions = [r[0] for r in cur.fetchall()]
        context['contribution_versions'] = contrib_versions
        
        val_results = {}
        versions_to_validate = list(set(contrib_versions + ['Standard']))
        for ver in versions_to_validate:
            valid, msg = validate_contribution_sums(cur, ver)
            val_results[ver] = {'valid': valid, 'message': msg}
        context['contribution_validation'] = val_results

        # 5. Derived Qty Derivation Totals
        cur.execute("""
            SELECT plan_name, financial_year, version, SUM(final_qty) as total_derived_qty, COUNT(DISTINCT product) as products_count
            FROM monthly_qty_derivation
            GROUP BY plan_name, financial_year, version;
        """)
        derivations = []
        for row in cur.fetchall():
            derivations.append({
                'plan_name': row[0],
                'financial_year': row[1],
                'version': row[2],
                'total_derived_qty': float(row[3]) if row[3] else 0.0,
                'products_count': row[4]
            })
        context['derivations'] = derivations

        # 5.5. Balance Required Qty Totals
        cur.execute("""
            SELECT plan_name, financial_year, version, SUM(bal_required_qty) as total_bal_qty, COUNT(DISTINCT product) as products_count
            FROM balance_qty_cache
            WHERE production_type IN ('Stand Alone', 'Common')
            GROUP BY plan_name, financial_year, version;
        """)
        balances = []
        for row in cur.fetchall():
            balances.append({
                'plan_name': row[0],
                'financial_year': row[1],
                'version': row[2],
                'total_bal_qty': float(row[3]) if row[3] else 0.0,
                'products_count': row[4]
            })
        context['balances'] = balances

        cur.execute("""
            SELECT product, color, size, calculated_qty, finished_goods_qty, production_wip_qty, pending_production_qty, bal_required_qty, production_type
            FROM balance_qty_cache
            WHERE production_type IN ('Stand Alone', 'Common')
            LIMIT 20;
        """)
        balance_sample = []
        for row in cur.fetchall():
            balance_sample.append({
                'product': row[0],
                'color': row[1],
                'size': row[2],
                'calculated_qty': float(row[3]),
                'finished_goods_qty': float(row[4]),
                'production_wip_qty': float(row[5]),
                'pending_production_qty': float(row[6]),
                'bal_required_qty': float(row[7]),
                'production_type': row[8]
            })
        context['balance_sample'] = balance_sample

        # 6. Sales Data Summary
        cur.execute('SELECT SUM("Qty") FROM sales_data;')
        total_sales_qty = cur.fetchone()[0] or 0
        context['sales_summary'] = {
            'total_sales_qty': int(total_sales_qty)
        }

    except Exception as e:
        logger.error(f"Error fetching AI planning context: {e}", exc_info=True)
        context['error'] = 'Failed to load AI planning context'
    finally:
        cur.close()
        release_db_connection(conn)
    return context

@app.route('/api/ai/check-key', methods=['GET'])
@login_required
def check_ai_key():
    has_key = bool(os.environ.get('OPENROUTER_API_KEY'))
    return jsonify({'success': True, 'has_key': has_key})

@app.route('/api/ai/chat', methods=['POST'])
@login_required
def ai_chat():
    data = request.json or {}
    user_message = data.get('message', '').strip()
    custom_key = request.headers.get('X-OpenRouter-Key', '').strip() or data.get('apiKey', '').strip()
    active_tab = data.get('active_tab', 'overview').strip()
    
    api_key = custom_key or os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        return jsonify({
            'success': False, 
            'message': 'OpenRouter API Key not configured. Please enter your API key in the settings panel.'
        }), 400
        
    if not user_message:
        return jsonify({'success': False, 'message': 'Message is required.'}), 400
        
    ctx = get_ai_planning_context()
    
    system_instruction = f"""You are the AI Planning Manager for Srinithi Garments ERP, an intelligent garment planning system.
You help planning managers make decisions, analyze calculations, and plan material/fabric requirements.

CRITICAL INSTRUCTIONS:
1. You must NEVER modify database data automatically. Only analyze data and provide suggestions.
2. All planning calculations must continue to use the existing Python rule engine. You act as a guide/advisor, not a replacement for the execution engine.
3. Be data-driven, professional, and thorough. Format responses beautifully with Markdown (tables, headings, bold text, bullet points).
4. Do NOT say you have updated the database or will edit the database. Emphasize that the user should review your suggestion and save/edit manually.

CURRENT ERP DATABASE STATE AND CONTEXT:
- Total Master Counts:
  * Active Brands: {ctx.get('active_brands_count', 0)}
  * Active Fabrics: {ctx.get('active_fabrics_count', 0)}
  * Active Colors: {ctx.get('active_colors_count', 0)}
  * Active Sizes: {ctx.get('active_sizes_count', 0)}
  * Active Products/Styles: {ctx.get('active_products_count', 0)}
- Active Plan Overview: {ctx.get('active_plan', 'None')}
- Active Plan Monthly Details: {ctx.get('active_plan_details', 'None')}
- Contribution Sum Validation Status: {ctx.get('contribution_validation', {})}
- Derived Quantities Totals: {ctx.get('derivations', [])}
- Net Balance Quantities Totals (used for Fabric Requirements): {ctx.get('balances', [])}
- Sample Net Balance Calculations (SKU level): {ctx.get('balance_sample', [])}
- Historical Sales Total Qty: {ctx.get('sales_summary', {}).get('total_sales_qty', 0)}
- Sample Active Products & Fabric Spec: {ctx.get('products_info', [])[:20]} (shows fabric name, UOM, fabric consumption (kgs/pieces), and production type)
 
Active Tab context: User is currently viewing the "{active_tab}" tab in the ERP.
 
If the user asks:
- "Suggest Overall Qty Planning": Provide monthly suggestions (April to March) based on historical base + reasonable growth % (e.g. 10-15%) and identify months with high demand (like festivals) where manual adjustments should be added. Format as a table.
- "Explain why a month's quantity is high": Check the monthly details above. Find which month is high and break down how much is calculated base qty vs manual adjustment vs festival qty vs new store additions.
- "Suggest Product/Color/Size Contribution %": Explain that they should look at historical ratios and recommend percentages that sum to exactly 100%. Use historical sales trends.
- "Find products whose contribution is not 100%": Query the "Contribution Sum Validation Status" provided in the context. List any versions or products/colors/sizes whose contributions do not sum to 100% based on the validation reports.
- "Explain planning calculations": Explain the two formulas used in the system:
  1. Calculated Qty = Last Year Qty * (1 + Growth % / 100)
  2. Final Qty = Calculated Qty + Manual Adjustment + Festival Qty + New Store Qty
  Also explain that contributions divide this quantity down: Brand -> Product -> Color -> Size.
- "Suggest production quantities": Recommend production quantities based on the derived quantities totals or net balance quantities. Suggest manufacturing batches.
- "Suggest purchase quantities": Calculate the fabric purchase requirements by multiplying each product's Balance Required Qty (from the Balance Required Qty engine) by its fabric consumption (fabric_consumption) from the product master, and summarize by fabric name and UOM. Format as a beautiful table.
- "Generate planning remarks": Provide copy-pasteable planning remarks for the current version.
- "Explain shortages": Identify shortages or gaps in contributions or quantities.
- "Generate management summaries": Summarize the active plan's total volume, growth, top products, net balance quantities, fabric consumption, and highlight any contribution validation warnings.

Always structure your responses clearly. Proceed to write your suggestions."""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5050",
        "X-Title": "Srinithi Garments Planning ERP"
    }
    
    model_name = data.get('model', 'google/gemini-2.5-flash')
    
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.3
    }
    
    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=45
        )
        
        if response.status_code != 200:
            err_msg = response.text
            try:
                err_json = response.json()
                if 'error' in err_json:
                    err_msg = err_json['error'].get('message', err_msg)
            except:
                pass
            return jsonify({'success': False, 'message': f'OpenRouter API Error: {err_msg}'}), response.status_code
            
        res_json = response.json()
        ai_reply = res_json['choices'][0]['message']['content']
        return jsonify({'success': True, 'reply': ai_reply, 'model': model_name})
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Request failed: {str(e)}'}), 500

# =====================================================================
# BALANCE REQUIRED QUANTITY PLANNING ENGINE & APIS
# =====================================================================

import calendar
from datetime import datetime, date

MONTH_NAME_TO_NUM = {
    'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
    'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
}
MONTH_NUM_TO_NAME = {v: k for k, v in MONTH_NAME_TO_NUM.items()}

def get_overlapping_months(from_date, to_date):
    overlapping = []
    curr_year = from_date.year
    curr_month = from_date.month
    
    end_year = to_date.year
    end_month = to_date.month
    
    while (curr_year, curr_month) <= (end_year, end_month):
        month_name = MONTH_NUM_TO_NAME[curr_month]
        days_in_month = calendar.monthrange(curr_year, curr_month)[1]
        month_start = date(curr_year, curr_month, 1)
        month_end = date(curr_year, curr_month, days_in_month)
        
        overlap_start = max(from_date, month_start)
        overlap_end = min(to_date, month_end)
        overlap_days = (overlap_end - overlap_start).days + 1
        
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

def calculate_balance_qty(cur, plan_name, financial_year, version, from_date_str, to_date_str):
    from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
    to_date = datetime.strptime(to_date_str, '%Y-%m-%d').date()

    # Advisory lock to serialize concurrent calculations for this exact period slice
    lock_key = f"bal_qty_{plan_name}_{financial_year}_{version}_{from_date_str}_{to_date_str}"
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s));", (lock_key,))

    # 1. Clear old cache entries for this period
    cur.execute("""
        DELETE FROM balance_qty_cache 
        WHERE plan_name = %s AND financial_year = %s AND version = %s
          AND from_date = %s AND to_date = %s;
    """, (plan_name, financial_year, version, from_date, to_date))

    # 2. Get overlapping months
    overlapping_info = get_overlapping_months(from_date, to_date)
    if not overlapping_info:
        return 0

    # Fetch monthly derivation rows for overlapping months
    clauses = []
    params = [plan_name, financial_year, version]
    for m in overlapping_info:
        clauses.append("(month = %s AND year = %s)")
        params.extend([m['month'], m['year']])
        
    query = f"""
        SELECT month, year, brand, category, product, color, size, final_qty
        FROM monthly_qty_derivation
        WHERE plan_name = %s AND financial_year = %s AND version = %s
          AND ({" OR ".join(clauses)});
    """
    cur.execute(query, params)
    deriv_rows = cur.fetchall()

    if not deriv_rows:
        return 0

    # Extract active products, colors, sizes for filtering stock tables
    active_products = list(set(row[4].lower().strip() for row in deriv_rows))
    active_colors = list(set(row[5].lower().strip() for row in deriv_rows))
    active_sizes = list(set(row[6].lower().strip() for row in deriv_rows))

    # Fetch Product Master details for active products
    cur.execute("""
        SELECT LOWER(TRIM(p.product_name)), p.production_type, cpm.common_production_name, f.fabric_name
        FROM product_master p
        LEFT JOIN common_production_master cpm ON p.common_production_id = cpm.id
        LEFT JOIN fabric_master f ON p.fabric_id = f.id
        WHERE LOWER(TRIM(p.product_name)) = ANY(%s);
    """, (active_products,))
    product_config = {}
    active_common_groups = set()
    for r in cur.fetchall():
        prod_key = r[0]
        prod_type = r[1] or 'Stand Alone'
        common_name = r[2]
        fab_name = r[3]
        product_config[prod_key] = {
            'production_type': prod_type,
            'common_production_name': common_name,
            'fabric_name': fab_name
        }
        if prod_type == 'Common' and common_name:
            active_common_groups.add(common_name.lower().strip())

    # Map display_color -> global_color_code
    cur.execute("SELECT LOWER(TRIM(display_color)), global_color_code, category FROM color_master;")
    color_rows = cur.fetchall()
    display_to_code = {r[0]: r[1] for r in color_rows}
    color_categories = {r[0]: r[2] for r in color_rows}
    primary_color_by_code = {r[1].lower().strip(): r[0] for r in color_rows if r[2] == 'Primary'}

    # Map product_name -> color_category
    cur.execute("SELECT LOWER(TRIM(product_name)), color_category FROM product_master;")
    product_color_cat = {r[0]: r[1] or 'Primary' for r in cur.fetchall()}

    # Map (category, global_color_code) -> display_color
    cur.execute("SELECT category, global_color_code, display_color FROM color_master;")
    cat_code_to_display = {}
    for cat, code, disp in cur.fetchall():
        cat_code_to_display[(cat, code)] = disp

    # Build fallback display map: global_color_code -> display_color
    cur.execute("SELECT global_color_code, display_color FROM color_master ORDER BY category DESC;")
    fallback_display = {r[0]: r[1] for r in cur.fetchall()}

    # 3. Fetch Finished Goods Stock for active SKUs
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
            resolved_color = cat_code_to_display.get((cat, g_code))
            if not resolved_color:
                resolved_color = fallback_display.get(g_code, g_code)
            
            resolved_key = (prod_name_lower, resolved_color.lower().strip(), size_lower)
            fg_map[resolved_key] = fg_map.get(resolved_key, 0.0) + qty
        else:
            resolved_key = (prod_name_lower, stock_color_lower, size_lower)
            fg_map[resolved_key] = fg_map.get(resolved_key, 0.0) + qty

    # 4. Fetch Production WIP Stock for active SKUs (only VALID rows)
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
            resolved_color = cat_code_to_display.get((cat, g_code))
            if not resolved_color:
                resolved_color = fallback_display.get(g_code, g_code)
            
            resolved_key = (prod_name_lower, resolved_color.lower().strip(), size_lower)
            wip_sku_map[resolved_key] = wip_sku_map.get(resolved_key, 0.0) + qty
        else:
            resolved_key = (prod_name_lower, stock_color_lower, size_lower)
            wip_sku_map[resolved_key] = wip_sku_map.get(resolved_key, 0.0) + qty

    # Fetch Production WIP by Production Group/Product Name and Size (for active Common Production groups) (only VALID rows)
    wip_group_map = {}
    if active_common_groups:
        cur.execute("""
            SELECT LOWER(TRIM(product_name)), LOWER(TRIM(size)), SUM(qty)
            FROM production_wip
            WHERE LOWER(TRIM(product_name)) = ANY(%s)
              AND LOWER(TRIM(size)) = ANY(%s)
              AND validation_status = 'VALID'
            GROUP BY LOWER(TRIM(product_name)), LOWER(TRIM(size));
        """, (list(active_common_groups), active_sizes))
        wip_group_map = {(r[0], r[1]): float(r[2] or 0.0) for r in cur.fetchall()}

    # 5. Fetch Pending Production for active SKUs
    cur.execute("""
        SELECT LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size)), SUM(qty)
        FROM pending_orders
        WHERE LOWER(TRIM(product_name)) = ANY(%s)
          AND LOWER(TRIM(size)) = ANY(%s)
        GROUP BY LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size));
    """, (active_products, active_sizes))
    pending_sku_map = {}
    for r in cur.fetchall():
        prod_name_lower = r[0]
        stock_color_lower = r[1]
        size_lower = r[2]
        qty = float(r[3] or 0.0)
        
        g_code = display_to_code.get(stock_color_lower)
        if g_code:
            cat = product_color_cat.get(prod_name_lower, 'Primary')
            resolved_color = cat_code_to_display.get((cat, g_code))
            if not resolved_color:
                resolved_color = fallback_display.get(g_code, g_code)
            
            resolved_key = (prod_name_lower, resolved_color.lower().strip(), size_lower)
            pending_sku_map[resolved_key] = pending_sku_map.get(resolved_key, 0.0) + qty
        else:
            resolved_key = (prod_name_lower, stock_color_lower, size_lower)
            pending_sku_map[resolved_key] = pending_sku_map.get(resolved_key, 0.0) + qty

    # Aggregate required qty by SKU proportionally using full precision
    sku_req_map = {}
    overlap_map = {(m['month'], m['year']): m for m in overlapping_info}
    
    for row in deriv_rows:
        month, year, brand, category, product, color, size, final_qty = row
        info = overlap_map.get((month, year))
        if not info:
            continue
        monthly_qty = float(final_qty or 0.0)
        per_day = monthly_qty / info['days_in_month']
        prop_qty = per_day * info['overlap_days']
        
        sku_key = (brand, category, product, color, size)
        sku_req_map[sku_key] = sku_req_map.get(sku_key, 0.0) + prop_qty

    # 6. Classification and routing
    standalone_records = []
    common_groups = {}

    for sku_key, req_qty_raw in sku_req_map.items():
        brand, category, product, color, size = sku_key
        prod_key = product.lower().strip()
        config = product_config.get(prod_key, {'production_type': 'Stand Alone', 'common_production_name': None, 'fabric_name': None})
        p_type = config.get('production_type', 'Stand Alone')
        common_name = config.get('common_production_name')
        fab_name = config.get('fabric_name')

        sku_lookup_key = (prod_key, color.lower().strip(), size.lower().strip())
        fg_raw = fg_map.get(sku_lookup_key, 0.0)
        wip_raw = wip_sku_map.get(sku_lookup_key, 0.0)
        pending_raw = pending_sku_map.get(sku_lookup_key, 0.0)

        if p_type == 'Common' and common_name:
            group_key = (common_name.lower().strip(), size.lower().strip())
            if group_key not in common_groups:
                common_groups[group_key] = {
                    'common_name': common_name,
                    'size': size,
                    'members': []
                }
            common_groups[group_key]['members'].append({
                'brand': brand,
                'category': category,
                'product': product,
                'color': color,
                'req_qty_raw': req_qty_raw,
                'fg_raw': fg_raw,
                'wip_raw': wip_raw,
                'pending_raw': pending_raw,
                'fabric_name': fab_name
            })
        else:
            # Round only final values
            req_qty = round(req_qty_raw)
            fg = round(fg_raw)
            wip = round(wip_raw)
            pending = round(pending_raw)
            bal_qty = max(0, round(req_qty_raw - fg_raw - wip_raw + pending_raw))

            standalone_records.append((
                plan_name, financial_year, version, from_date, to_date, brand, category, product, color, size,
                req_qty, fg, wip, pending, bal_qty, 'Stand Alone', None, fab_name
            ))

    # 7. Calculate Common Production Group Balances
    common_records = []
    for g_key, g_data in common_groups.items():
        c_name_lower, sz_lower = g_key
        common_name = g_data['common_name']
        size = g_data['size']
        members = g_data['members']

        # Perform calculations in raw precision first
        total_req_raw = sum(m['req_qty_raw'] for m in members)
        total_fg_raw = sum(m['fg_raw'] for m in members)
        total_wip_raw = wip_group_map.get((c_name_lower, sz_lower), 0.0)
        total_pending_raw = sum(m['pending_raw'] for m in members)

        # Round final values
        total_req = round(total_req_raw)
        total_fg = round(total_fg_raw)
        total_wip = round(total_wip_raw)
        total_pending = round(total_pending_raw)
        common_bal = max(0, round(total_req_raw - total_fg_raw - total_wip_raw + total_pending_raw))

        brand = members[0]['brand'] if members else 'Common Group'
        category = members[0]['category'] if members else 'Common Group'
        group_fabric_name = members[0]['fabric_name'] if members else None

        # Insert Group Row (color is 'All Colors')
        common_records.append((
            plan_name, financial_year, version, from_date, to_date, brand, category, common_name, 'All Colors', size,
            total_req, total_fg, total_wip, total_pending, common_bal, 'Common', common_name, group_fabric_name
        ))

        # Insert Member SKU details
        for m in members:
            m_req = round(m['req_qty_raw'])
            m_fg = round(m['fg_raw'])
            m_wip = round(m['wip_raw'])
            m_pending = round(m['pending_raw'])
            m_bal = max(0, round(m['req_qty_raw'] - m['fg_raw'] - m['wip_raw'] + m['pending_raw']))
            common_records.append((
                plan_name, financial_year, version, from_date, to_date, m['brand'], m['category'], m['product'], m['color'], size,
                m_req, m_fg, m_wip, m_pending, m_bal, 'Common Member', common_name, m['fabric_name']
            ))
    # 7.5. Query valid Production WIP for active common groups, resolve colors and append parent WIP records
    if active_common_groups:
        cur.execute("""
            SELECT LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size)), SUM(qty)
            FROM production_wip
            WHERE LOWER(TRIM(product_name)) = ANY(%s)
              AND LOWER(TRIM(size)) = ANY(%s)
              AND validation_status = 'VALID'
            GROUP BY LOWER(TRIM(product_name)), LOWER(TRIM(color)), LOWER(TRIM(size));
        """, (list(active_common_groups), active_sizes))
        wip_group_rows = cur.fetchall()
        for c_prod, wip_col, wip_sz, wip_qty in wip_group_rows:
            # Resolve Secondary Color -> Primary Color
            resolved_color = wip_col
            g_code = display_to_code.get(wip_col.lower().strip())
            if g_code:
                category = color_categories.get(wip_col.lower().strip(), 'Primary')
                if category == 'Secondary':
                    prim_name = primary_color_by_code.get(g_code.lower().strip())
                    if prim_name:
                        resolved_color = prim_name.lower().strip()
            
            # Find the original Common Production name with exact casing
            original_common_name = c_prod
            for g_data in common_groups.values():
                if g_data['common_name'].lower().strip() == c_prod:
                    original_common_name = g_data['common_name']
                    break
            
            # Resolve brand/category/fabric from first matching member or fallback
            brand = 'Common Group'
            category = 'Common Group'
            wip_fabric_name = None
            for g_key, g_data in common_groups.items():
                if g_data['common_name'].lower().strip() == c_prod:
                    if g_data['members']:
                        brand = g_data['members'][0]['brand']
                        category = g_data['members'][0]['category']
                        wip_fabric_name = g_data['members'][0]['fabric_name']
                        break
            
            # Find size matching original case
            resolved_size = wip_sz
            for g_key, g_data in common_groups.items():
                if g_data['common_name'].lower().strip() == c_prod and g_data['size'].lower().strip() == wip_sz:
                    resolved_size = g_data['size']
                    break
                    
            common_records.append((
                plan_name, financial_year, version, from_date, to_date, brand, category, original_common_name, resolved_color, resolved_size,
                0.0, 0.0, float(wip_qty), 0.0, 0.0, 'Common Parent WIP', original_common_name, wip_fabric_name
            ))

    # 8. Write calculated records to cache table
    all_records = standalone_records + common_records
    if all_records:
        from psycopg2.extras import execute_values
        insert_query = """
            INSERT INTO balance_qty_cache (
                plan_name, financial_year, version, from_date, to_date, brand, category, product, color, size,
                calculated_qty, finished_goods_qty, production_wip_qty, pending_production_qty, bal_required_qty,
                production_type, common_production_name, fabric_name
            ) VALUES %s;
        """
        execute_values(cur, insert_query, all_records)
    
    return len(all_records)

@app.route('/api/balance-qty/meta', methods=['GET'])
@login_required
def get_balance_qty_meta():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT DISTINCT plan_name, financial_year, version 
            FROM monthly_qty_derivation 
            ORDER BY plan_name, version;
        """)
        rows = cur.fetchall()
        
        plans_map = {}
        for p_name, fy, ver in rows:
            plans_map.setdefault(f"{p_name}|{fy}", []).append(ver)
            
        plans = [{'plan_name': k.split('|')[0], 'financial_year': k.split('|')[1], 'versions': v} for k, v in plans_map.items()]
        
        return jsonify({'success': True, 'plans': plans})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading metadata: {str(e)}'}), 500
    finally:
        cur.close()
        release_db_connection(conn)

def parse_bool_query_param(val, default=True):
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    s = str(val).strip().lower()
    if s in ('1', 'true', 'yes', 't'):
        return True
    if s in ('0', 'false', 'no', 'f'):
        return False
    return default

@app.route('/api/balance-qty/data', methods=['GET'])
@login_required
def get_balance_qty_data():
    plan_name = request.args.get('plan_name', '').strip()
    financial_year = request.args.get('financial_year', '').strip()
    version = request.args.get('version', '').strip()
    from_date_str = request.args.get('from_date', '').strip()
    to_date_str = request.args.get('to_date', '').strip()
    brand = request.args.get('brand', '').strip()
    category = request.args.get('category', '').strip()
    product = request.args.get('product', '').strip()
    search = request.args.get('search', '').strip()
    recalculate = request.args.get('recalculate', 'false').lower() == 'true'
    
    consider_fg = parse_bool_query_param(request.args.get('consider_fg'), True)
    consider_wip = parse_bool_query_param(request.args.get('consider_wip'), True)
    consider_pending = parse_bool_query_param(request.args.get('consider_pending'), True)

    tab = request.args.get('tab', 'standalone').strip().lower()
    all_records = request.args.get('all', 'false').lower() == 'true'
    
    if not plan_name or not financial_year or not version:
        return jsonify({'success': True, 'rows': [], 'total_count': 0})
        
    if not from_date_str or not to_date_str:
        return jsonify({'success': False, 'message': 'Both From Date and To Date are mandatory.'}), 400
        
    try:
        from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
        to_date = datetime.strptime(to_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'success': False, 'message': 'Invalid date format. Use YYYY-MM-DD.'}), 400
        
    if from_date > to_date:
        return jsonify({'success': False, 'message': 'From Date cannot be greater than To Date.'}), 400
        
    try:
        page = int(request.args.get('page', 1))
        if page < 1: page = 1
    except:
        page = 1
        
    try:
        per_page = int(request.args.get('per_page', 50))
        if per_page < 1: per_page = 50
    except:
        per_page = 50
        
    offset = (page - 1) * per_page
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s));", (f"bal_qty_{plan_name}_{financial_year}_{version}_{from_date_str}_{to_date_str}",))
        cur.execute("""
            SELECT COUNT(*) FROM balance_qty_cache 
            WHERE plan_name = %s AND financial_year = %s AND version = %s
              AND from_date = %s AND to_date = %s;
        """, (plan_name, financial_year, version, from_date, to_date))
        cache_count = cur.fetchone()[0]
        
        if cache_count == 0 or recalculate:
            calculate_balance_qty(cur, plan_name, financial_year, version, from_date_str, to_date_str)
            conn.commit()
            
        where_clauses = [
            "p.plan_name = %s",
            "p.financial_year = %s",
            "p.version = %s",
            "p.from_date = %s",
            "p.to_date = %s"
        ]
        params = [plan_name, financial_year, version, from_date, to_date]
        
        if tab == 'common':
            where_clauses.append("p.common_production_name IS NOT NULL AND p.common_production_name <> ''")
            where_clauses.append("p.color <> 'All Colors'")
            where_clauses.append("p.production_type IN ('Common Member', 'Common Parent WIP')")
        else:
            where_clauses.append("(p.common_production_name IS NULL OR p.common_production_name = '')")
            
        if brand:
            where_clauses.append("p.brand = %s")
            params.append(brand)
        if category:
            where_clauses.append("p.category = %s")
            params.append(category)
        if product:
            if tab == 'common':
                where_clauses.append("p.common_production_name = %s")
            else:
                where_clauses.append("p.product = %s")
            params.append(product)
            
        if search:
            search_pattern = f"%{search}%"
            if tab == 'common':
                where_clauses.append("(p.common_production_name ILIKE %s OR p.color ILIKE %s OR p.size ILIKE %s OR p.brand ILIKE %s)")
                params.extend([search_pattern, search_pattern, search_pattern, search_pattern])
            else:
                where_clauses.append("(p.product ILIKE %s OR p.color ILIKE %s OR p.size ILIKE %s OR p.brand ILIKE %s)")
                params.extend([search_pattern, search_pattern, search_pattern, search_pattern])
                
        where_str = " AND ".join(where_clauses)
        
        if tab == 'common':
            cur.execute(f"""
                WITH color_map AS (
                    SELECT DISTINCT ON (LOWER(TRIM(display_color)))
                        LOWER(TRIM(display_color)) AS color_key,
                        global_color_code
                    FROM color_master
                    ORDER BY LOWER(TRIM(display_color)), (category = 'Primary') DESC, id ASC
                ),
                primary_color_map AS (
                    SELECT DISTINCT ON (LOWER(TRIM(global_color_code)))
                        LOWER(TRIM(global_color_code)) AS code_key,
                        display_color AS primary_display_color
                    FROM color_master
                    WHERE category = 'Primary'
                    ORDER BY LOWER(TRIM(global_color_code)), id ASC
                )
                SELECT COUNT(*) FROM (
                    SELECT 1 
                    FROM balance_qty_cache p 
                    LEFT JOIN color_map cm ON LOWER(TRIM(p.color)) = cm.color_key
                    LEFT JOIN primary_color_map pcm ON LOWER(TRIM(COALESCE(cm.global_color_code, p.color))) = pcm.code_key
                    WHERE {where_str}
                    GROUP BY p.common_production_name, LOWER(TRIM(COALESCE(pcm.primary_display_color, cm.global_color_code, p.color))), p.size
                ) as sub;
            """, tuple(params))
        else:
            cur.execute(f"SELECT COUNT(*) FROM balance_qty_cache p WHERE {where_str};", tuple(params))
        total_count = cur.fetchone()[0]
        
        if tab == 'common':
            fg_sum_expr = "SUM(p.finished_goods_qty)" if consider_fg else "0.0"
            wip_sum_expr = "SUM(p.production_wip_qty)" if consider_wip else "0.0"
            pending_sum_expr = "SUM(p.pending_production_qty)" if consider_pending else "0.0"

            query_str = f"""
                WITH color_map AS (
                    SELECT DISTINCT ON (LOWER(TRIM(display_color)))
                        LOWER(TRIM(display_color)) AS color_key,
                        global_color_code
                    FROM color_master
                    ORDER BY LOWER(TRIM(display_color)), (category = 'Primary') DESC, id ASC
                ),
                primary_color_map AS (
                    SELECT DISTINCT ON (LOWER(TRIM(global_color_code)))
                        LOWER(TRIM(global_color_code)) AS code_key,
                        display_color AS primary_display_color
                    FROM color_master
                    WHERE category = 'Primary'
                    ORDER BY LOWER(TRIM(global_color_code)), id ASC
                )
                SELECT 
                    MIN(p.id) as id,
                    p.from_date,
                    p.to_date,
                    MIN(p.brand) as brand,
                    MIN(p.category) as category,
                    p.common_production_name as product,
                    COALESCE(MAX(pcm.primary_display_color), MAX(cm.global_color_code), MIN(p.color)) as color,
                    p.size,
                    SUM(p.calculated_qty) as calculated_qty,
                    SUM(p.finished_goods_qty) as finished_goods_qty,
                    SUM(p.production_wip_qty) as production_wip_qty,
                    SUM(p.pending_production_qty) as pending_production_qty,
                    GREATEST(0.0, SUM(p.calculated_qty) - {fg_sum_expr} - {wip_sum_expr} + {pending_sum_expr}) as bal_required_qty,
                    'Common' as production_type,
                    p.common_production_name,
                    MIN(p.fabric_name) as fabric_name,
                    COALESCE(MAX(cm.global_color_code), MIN(p.color)) as global_color_code
                FROM balance_qty_cache p
                LEFT JOIN color_map cm ON LOWER(TRIM(p.color)) = cm.color_key
                LEFT JOIN primary_color_map pcm ON LOWER(TRIM(COALESCE(cm.global_color_code, p.color))) = pcm.code_key
                WHERE {where_str}
                GROUP BY p.from_date, p.to_date, p.common_production_name, LOWER(TRIM(COALESCE(pcm.primary_display_color, cm.global_color_code, p.color))), p.size
                ORDER BY p.common_production_name ASC, p.size ASC, color ASC
            """
            if not all_records:
                query_str += " LIMIT %s OFFSET %s;"
                cur.execute(query_str, tuple(params + [per_page, offset]))
            else:
                query_str += ";"
                cur.execute(query_str, tuple(params))
        else:
            fg_expr = "p.finished_goods_qty" if consider_fg else "0.0"
            wip_expr = "p.production_wip_qty" if consider_wip else "0.0"
            pending_expr = "p.pending_production_qty" if consider_pending else "0.0"

            query_str = f"""
                SELECT id, from_date, to_date, brand, category, product, color, size,
                       calculated_qty, finished_goods_qty, production_wip_qty, pending_production_qty,
                       GREATEST(0.0, p.calculated_qty - {fg_expr} - {wip_expr} + {pending_expr}) as bal_required_qty,
                       production_type, common_production_name, fabric_name
                FROM balance_qty_cache p
                WHERE {where_str}
                ORDER BY p.product ASC, p.size ASC
            """
            if not all_records:
                query_str += " LIMIT %s OFFSET %s;"
                cur.execute(query_str, tuple(params + [per_page, offset]))
            else:
                query_str += ";"
                cur.execute(query_str, tuple(params))
            
        rows = cur.fetchall()
        
        serialized_rows = []
        cols = [
            'id', 'from_date', 'to_date', 'brand', 'category', 'product', 'color', 'size',
            'calculated_qty', 'finished_goods_qty', 'production_wip_qty', 'pending_production_qty', 'bal_required_qty',
            'production_type', 'common_production_name', 'fabric_name'
        ]
        if tab == 'common':
            cols.append('global_color_code')
        from decimal import Decimal
        for r in rows:
            serialized = {}
            for col, val in zip(cols, r):
                if isinstance(val, Decimal):
                    serialized[col] = float(val)
                elif isinstance(val, (date, datetime)):
                    serialized[col] = val.strftime('%Y-%m-%d')
                else:
                    serialized[col] = val
            serialized_rows.append(serialized)
            
        response = jsonify({
            'success': True,
            'rows': serialized_rows,
            'total_count': total_count
        })
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading balance qty data: {str(e)}'}), 500
    finally:
        cur.close()
        release_db_connection(conn)

@app.route('/api/balance-qty/members', methods=['GET'])
@login_required
def get_balance_qty_members():
    plan_name = request.args.get('plan_name', '').strip()
    financial_year = request.args.get('financial_year', '').strip()
    version = request.args.get('version', '').strip()
    from_date_str = request.args.get('from_date', '').strip()
    to_date_str = request.args.get('to_date', '').strip()
    common_name = request.args.get('common_production_name', '').strip()
    size = request.args.get('size', '').strip()
    
    consider_fg = parse_bool_query_param(request.args.get('consider_fg'), True)
    consider_wip = parse_bool_query_param(request.args.get('consider_wip'), True)
    consider_pending = parse_bool_query_param(request.args.get('consider_pending'), True)

    if not plan_name or not version or not common_name or not size or not from_date_str or not to_date_str:
        return jsonify({'success': False, 'message': 'Missing parameters.'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        fg_expr = "p.finished_goods_qty" if consider_fg else "0.0"
        wip_expr = "p.production_wip_qty" if consider_wip else "0.0"
        pending_expr = "p.pending_production_qty" if consider_pending else "0.0"

        cur.execute(f"""
            WITH color_map AS (
                SELECT DISTINCT ON (LOWER(TRIM(display_color)))
                    LOWER(TRIM(display_color)) AS color_key,
                    global_color_code,
                    category
                FROM color_master
                ORDER BY LOWER(TRIM(display_color)), (category = 'Primary') DESC, id ASC
            ),
            prod_map AS (
                SELECT DISTINCT ON (LOWER(TRIM(product_name)))
                    LOWER(TRIM(product_name)) AS prod_key,
                    color_category
                FROM product_master
                ORDER BY LOWER(TRIM(product_name)), id ASC
            )
            SELECT DISTINCT ON (LOWER(TRIM(p.product)), LOWER(TRIM(p.color)), LOWER(TRIM(p.size)))
                   p.id, p.from_date, p.to_date, p.brand, p.category, p.product, p.color, p.size,
                   p.calculated_qty, p.finished_goods_qty, p.production_wip_qty, p.pending_production_qty,
                   GREATEST(0.0, p.calculated_qty - {fg_expr} - {wip_expr} + {pending_expr}) as bal_required_qty,
                   p.production_type, p.common_production_name,
                   COALESCE(cm.global_color_code, p.color) as global_color_code,
                   COALESCE(pm.color_category, cm.category, 'Primary') as color_category,
                   p.fabric_name
            FROM balance_qty_cache p
            LEFT JOIN color_map cm ON LOWER(TRIM(p.color)) = cm.color_key
            LEFT JOIN prod_map pm ON LOWER(TRIM(p.product)) = pm.prod_key
            WHERE p.plan_name = %s AND p.financial_year = %s AND p.version = %s
              AND p.from_date = %s AND p.to_date = %s AND p.common_production_name = %s AND p.size = %s
              AND p.color <> 'All Colors' AND p.production_type = 'Common Member'
            ORDER BY LOWER(TRIM(p.product)) ASC, LOWER(TRIM(p.color)) ASC, LOWER(TRIM(p.size)) ASC, p.id DESC;
        """, (plan_name, financial_year, version, from_date_str, to_date_str, common_name, size))
        rows = cur.fetchall()
        
        serialized_rows = []
        cols = [
            'id', 'from_date', 'to_date', 'brand', 'category', 'product', 'color', 'size',
            'calculated_qty', 'finished_goods_qty', 'production_wip_qty', 'pending_production_qty', 'bal_required_qty',
            'production_type', 'common_production_name', 'global_color_code', 'color_category', 'fabric_name'
        ]
        from decimal import Decimal
        for r in rows:
            serialized = {}
            for col, val in zip(cols, r):
                if isinstance(val, Decimal):
                    serialized[col] = float(val)
                elif isinstance(val, (date, datetime)):
                    serialized[col] = val.strftime('%Y-%m-%d')
                else:
                    serialized[col] = val
            serialized_rows.append(serialized)
            
        return jsonify({'success': True, 'members': serialized_rows})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading member data: {str(e)}'}), 500
    finally:
        cur.close()
        release_db_connection(conn)

def _get_fabric_req_details_raw(cur, plan_name, financial_year, version, from_date_str, to_date_str, consider_fg=True, consider_wip=True, consider_pending=True):
    from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
    to_date = datetime.strptime(to_date_str, '%Y-%m-%d').date()

    fg_expr = "p.finished_goods_qty" if consider_fg else "0.0"
    wip_expr = "p.production_wip_qty" if consider_wip else "0.0"
    pending_expr = "p.pending_production_qty" if consider_pending else "0.0"

    # 1. Standalone Query
    # Prioritizes size-specific mappings in product_dia_mapping, and falls back to NULL size_id.
    cur.execute(f"""
        WITH dia_size_map AS (
            SELECT DISTINCT ON (product_id, size_id)
                product_id, size_id, dia
            FROM product_dia_mapping
            WHERE size_id IS NOT NULL
            ORDER BY product_id, size_id, id ASC
        ),
        dia_common_map AS (
            SELECT DISTINCT ON (product_id)
                product_id, dia
            FROM product_dia_mapping
            WHERE size_id IS NULL
            ORDER BY product_id, id ASC
        ),
        prod_master_map AS (
            SELECT DISTINCT ON (LOWER(TRIM(product_name)))
                LOWER(TRIM(product_name)) as prod_key,
                id,
                fabric_id,
                fabric_consumption
            FROM product_master
            ORDER BY LOWER(TRIM(product_name)), id ASC
        ),
        size_map AS (
            SELECT DISTINCT ON (LOWER(TRIM(size)))
                LOWER(TRIM(size)) as size_key,
                id
            FROM size_master
            ORDER BY LOWER(TRIM(size)), id ASC
        )
        SELECT 
            'Stand Alone Product' as source_type,
            p.product as name,
            p.brand,
            p.category,
            p.color,
            p.size,
            GREATEST(0.0, p.calculated_qty - {fg_expr} - {wip_expr} + {pending_expr}) as bal_required_qty,
            fm.fabric_name,
            COALESCE(pdm.dia, pdm_common.dia) as dia,
            pm.fabric_consumption
        FROM balance_qty_cache p
        JOIN prod_master_map pm ON LOWER(TRIM(p.product)) = pm.prod_key
        LEFT JOIN fabric_master fm ON pm.fabric_id = fm.id
        LEFT JOIN size_map sm ON LOWER(TRIM(p.size)) = sm.size_key
        LEFT JOIN dia_size_map pdm ON pm.id = pdm.product_id AND pdm.size_id = sm.id
        LEFT JOIN dia_common_map pdm_common ON pm.id = pdm_common.product_id
        WHERE p.plan_name = %s AND p.financial_year = %s AND p.version = %s
          AND p.from_date = %s AND p.to_date = %s
          AND p.production_type = 'Stand Alone';
    """, (plan_name, financial_year, version, from_date, to_date))
    standalone_rows = cur.fetchall()

    fg_sum_expr = "SUM(p.finished_goods_qty)" if consider_fg else "0.0"
    wip_sum_expr = "SUM(p.production_wip_qty)" if consider_wip else "0.0"
    pending_sum_expr = "SUM(p.pending_production_qty)" if consider_pending else "0.0"

    # 2. Common Production Query
    # For common production, we group the members in the cache by common_production_name, global color code, and size.
    cur.execute(f"""
        WITH color_map AS (
            SELECT DISTINCT ON (LOWER(TRIM(display_color)))
                LOWER(TRIM(display_color)) AS color_key,
                global_color_code
            FROM color_master
            ORDER BY LOWER(TRIM(display_color)), (category = 'Primary') DESC, id ASC
        ),
        primary_color_map AS (
            SELECT DISTINCT ON (LOWER(TRIM(global_color_code)))
                LOWER(TRIM(global_color_code)) AS code_key,
                display_color AS primary_display_color
            FROM color_master
            WHERE category = 'Primary'
            ORDER BY LOWER(TRIM(global_color_code)), id ASC
        ),
        common_prod_map AS (
            SELECT DISTINCT ON (LOWER(TRIM(common_production_name)))
                LOWER(TRIM(common_production_name)) as cp_key,
                id,
                fabric_id,
                fabric_consumption,
                common_dia
            FROM common_production_master
            ORDER BY LOWER(TRIM(common_production_name)), id ASC
        ),
        size_map AS (
            SELECT DISTINCT ON (LOWER(TRIM(size)))
                LOWER(TRIM(size)) as size_key,
                id
            FROM size_master
            ORDER BY LOWER(TRIM(size)), id ASC
        ),
        cp_dia_map AS (
            SELECT DISTINCT ON (common_production_id, size_id)
                common_production_id,
                size_id,
                dia
            FROM common_production_dia_mapping
            ORDER BY common_production_id, size_id
        )
        SELECT 
            'Common Production Product' as source_type,
            sub.common_production_name as name,
            sub.brand,
            sub.category,
            sub.color,
            sub.size,
            sub.bal_required_qty,
            fm.fabric_name,
            COALESCE(cpdm.dia, cpm.common_dia) as dia,
            cpm.fabric_consumption
        FROM (
            SELECT 
                p.common_production_name,
                MIN(p.brand) as brand,
                MIN(p.category) as category,
                COALESCE(MAX(pcm.primary_display_color), MAX(cm.global_color_code), MIN(p.color)) as color,
                p.size,
                GREATEST(0.0, SUM(p.calculated_qty) - {fg_sum_expr} - {wip_sum_expr} + {pending_sum_expr}) as bal_required_qty,
                COALESCE(MAX(cm.global_color_code), MIN(p.color)) as global_color_code
            FROM balance_qty_cache p
            LEFT JOIN color_map cm ON LOWER(TRIM(p.color)) = cm.color_key
            LEFT JOIN primary_color_map pcm ON LOWER(TRIM(COALESCE(cm.global_color_code, p.color))) = pcm.code_key
            WHERE p.plan_name = %s AND p.financial_year = %s AND p.version = %s
              AND p.from_date = %s AND p.to_date = %s
              AND p.common_production_name IS NOT NULL AND p.common_production_name <> ''
              AND p.color <> 'All Colors'
              AND p.production_type IN ('Common Member', 'Common Parent WIP')
            GROUP BY p.common_production_name, LOWER(TRIM(COALESCE(pcm.primary_display_color, cm.global_color_code, p.color))), p.size
        ) sub
        JOIN common_prod_map cpm ON LOWER(TRIM(sub.common_production_name)) = cpm.cp_key
        LEFT JOIN fabric_master fm ON cpm.fabric_id = fm.id
        LEFT JOIN size_map sm ON LOWER(TRIM(sub.size)) = sm.size_key
        LEFT JOIN cp_dia_map cpdm ON cpm.id = cpdm.common_production_id AND cpdm.size_id = sm.id;
    """, (plan_name, financial_year, version, from_date, to_date))
    common_rows = cur.fetchall()

    return standalone_rows + common_rows

@app.route('/api/fabric-req/data', methods=['GET'])
@login_required
def get_fabric_req_data():
    plan_name = request.args.get('plan_name', '').strip()
    financial_year = request.args.get('financial_year', '').strip()
    version = request.args.get('version', '').strip()
    from_date_str = request.args.get('from_date', '').strip()
    to_date_str = request.args.get('to_date', '').strip()

    brand_filter = request.args.get('brand', '').strip()
    category_filter = request.args.get('category', '').strip()
    product_filter = request.args.get('product', '').strip()
    fabric_filter = request.args.get('fabric_name', '').strip() or request.args.get('fabric', '').strip()
    color_filter = request.args.get('color', '').strip()
    dia_filter = request.args.get('dia', '').strip()
    search_filter = request.args.get('search', '').strip()

    consider_fg = parse_bool_query_param(request.args.get('consider_fg'), True)
    consider_wip = parse_bool_query_param(request.args.get('consider_wip'), True)
    consider_pending = parse_bool_query_param(request.args.get('consider_pending'), True)

    recalculate = request.args.get('recalculate', 'false').lower() == 'true'
    all_records = request.args.get('all', 'false').lower() == 'true'

    if not plan_name or not financial_year or not version:
        return jsonify({'success': True, 'rows': [], 'total_count': 0, 'totals': {'fabric_req': 0, 'fabric_stock': 0, 'fabric_wip': 0, 'bal_required_fab': 0}})

    if not from_date_str or not to_date_str:
        return jsonify({'success': False, 'message': 'Both From Date and To Date are mandatory.'}), 400

    try:
        page = int(request.args.get('page', 1))
        if page < 1: page = 1
    except:
        page = 1

    try:
        per_page = int(request.args.get('per_page', 50))
        if per_page < 1: per_page = 50
    except:
        per_page = 50

    offset = (page - 1) * per_page

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Check if the cache needs to be calculated first
        cur.execute("""
            SELECT COUNT(*) FROM balance_qty_cache 
            WHERE plan_name = %s AND financial_year = %s AND version = %s
              AND from_date = %s AND to_date = %s;
        """, (plan_name, financial_year, version, datetime.strptime(from_date_str, '%Y-%m-%d').date(), datetime.strptime(to_date_str, '%Y-%m-%d').date()))
        cache_count = cur.fetchone()[0]
        if cache_count == 0 or recalculate:
            calculate_balance_qty(cur, plan_name, financial_year, version, from_date_str, to_date_str)
            conn.commit()

        # Fetch detail rows
        all_details = _get_fabric_req_details_raw(cur, plan_name, financial_year, version, from_date_str, to_date_str, consider_fg, consider_wip, consider_pending)

        # Preload Stock & WIP
        stock_dict = {}
        cur.execute("SELECT LOWER(TRIM(fabric_name)), LOWER(TRIM(color)), dia, SUM(weight_mtr) FROM fabric_stock GROUP BY 1, 2, 3")
        for fab, col, d, qty in cur.fetchall():
            d_val = float(d) if d is not None else 0.0
            stock_dict[(fab, col, d_val)] = float(qty)

        wip_dict = {}
        cur.execute("SELECT LOWER(TRIM(fabric_name)), LOWER(TRIM(color)), dia, SUM(weight_mtr) FROM fabric_wip GROUP BY 1, 2, 3")
        for fab, col, d, qty in cur.fetchall():
            d_val = float(d) if d is not None else 0.0
            wip_dict[(fab, col, d_val)] = float(qty)

        # Process details & apply filters in Python
        detail_items = []
        for r in all_details:
            src_type = r[0]
            name = r[1]
            brand = r[2]
            category = r[3]
            color = r[4]
            size = r[5]
            bal_req_qty = float(r[6]) if r[6] is not None else 0.0
            fabric_name = r[7] or '-'
            dia = float(r[8]) if r[8] is not None else 0.0
            fabric_consumption = float(r[9]) if r[9] is not None else 0.0
            fabric_requirement = bal_req_qty * fabric_consumption

            # Apply filters
            if brand_filter and brand_filter.lower().strip() != (brand or '').lower().strip():
                continue
            if category_filter and category_filter.lower().strip() != (category or '').lower().strip():
                continue
            if product_filter and product_filter.lower().strip() != name.lower().strip():
                continue
            if fabric_filter and fabric_filter.lower().strip() != fabric_name.lower().strip():
                continue
            if color_filter and color_filter.lower().strip() != (color or '').lower().strip():
                continue
            if dia_filter:
                try:
                    if float(dia_filter) != dia:
                        continue
                except ValueError:
                    pass
            if search_filter:
                s = search_filter.lower().strip()
                if s not in name.lower() and \
                   s not in (brand or '').lower() and \
                   s not in (color or '').lower() and \
                   s not in size.lower():
                    continue

            detail_items.append({
                'source_type': src_type,
                'name': name,
                'brand': brand,
                'category': category,
                'color': color,
                'size': size,
                'bal_req_qty': bal_req_qty,
                'fabric_name': fabric_name,
                'dia': dia,
                'fabric_consumption': fabric_consumption,
                'fabric_requirement': fabric_requirement
            })

        # Group by fabric_name, color, dia
        summary_map = {}
        for item in detail_items:
            key = (item['fabric_name'].upper().strip(), (item['color'] or '').upper().strip(), item['dia'])
            if key not in summary_map:
                summary_map[key] = {
                    'fabric_name': item['fabric_name'],
                    'color': item['color'],
                    'dia': item['dia'],
                    'fabric_req': 0.0,
                    'fabric_stock': 0.0,
                    'fabric_wip': 0.0,
                    'bal_required_fab': 0.0
                }
            summary_map[key]['fabric_req'] += item['fabric_requirement']

        # Subtract stock & WIP exactly once per summary row
        summary_rows = []
        for key, val in summary_map.items():
            fab_name_lower = val['fabric_name'].lower().strip()
            color_lower = (val['color'] or '').lower().strip()
            dia_val = val['dia']

            val['fabric_stock'] = stock_dict.get((fab_name_lower, color_lower, dia_val), 0.0)
            val['fabric_wip'] = wip_dict.get((fab_name_lower, color_lower, dia_val), 0.0)
            raw_balance = val['fabric_req'] - val['fabric_stock'] - val['fabric_wip']
            val['bal_required_fab'] = max(raw_balance, 0.0)
            val['excess_qty'] = max(-raw_balance, 0.0)

            summary_rows.append(val)

        # Sort summary rows
        summary_rows.sort(key=lambda x: (x['fabric_name'].lower(), (x['color'] or '').lower(), x['dia']))

        # Calculate Totals of the filtered summary dataset
        total_req = sum(x['fabric_req'] for x in summary_rows)
        total_stock = sum(x['fabric_stock'] for x in summary_rows)
        total_wip = sum(x['fabric_wip'] for x in summary_rows)
        total_bal = sum(x['bal_required_fab'] for x in summary_rows)
        total_excess = sum(x['excess_qty'] for x in summary_rows)

        # Paginate
        total_count = len(summary_rows)
        if all_records:
            paginated_rows = summary_rows
        else:
            paginated_rows = summary_rows[offset : offset + per_page]

        return jsonify({
            'success': True,
            'rows': paginated_rows,
            'total_count': total_count,
            'totals': {
                'fabric_req': total_req,
                'fabric_stock': total_stock,
                'fabric_wip': total_wip,
                'bal_required_fab': total_bal,
                'excess_qty': total_excess
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error calculating fabric requirement: {str(e)}'}), 500
    finally:
        cur.close()
        release_db_connection(conn)

@app.route('/api/fabric-req/details', methods=['GET'])
@login_required
def get_fabric_req_details():
    plan_name = request.args.get('plan_name', '').strip()
    financial_year = request.args.get('financial_year', '').strip()
    version = request.args.get('version', '').strip()
    from_date_str = request.args.get('from_date', '').strip()
    to_date_str = request.args.get('to_date', '').strip()

    brand_filter = request.args.get('brand', '').strip()
    category_filter = request.args.get('category', '').strip()
    product_filter = request.args.get('product', '').strip()
    fabric_filter = request.args.get('fabric_name', '').strip()
    color_filter = request.args.get('color', '').strip()
    dia_filter = request.args.get('dia', '').strip()
    search_filter = request.args.get('search', '').strip()

    consider_fg = parse_bool_query_param(request.args.get('consider_fg'), True)
    consider_wip = parse_bool_query_param(request.args.get('consider_wip'), True)
    consider_pending = parse_bool_query_param(request.args.get('consider_pending'), True)

    # Target key filters for specific detail row breakdown
    target_fabric = request.args.get('target_fabric_name', '').strip()
    target_color = request.args.get('target_color', '').strip()
    target_dia_str = request.args.get('target_dia', '').strip()

    if not plan_name or not financial_year or not version or not from_date_str or not to_date_str:
        return jsonify({'success': False, 'message': 'Missing plan or date parameters.'}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Fetch details
        all_details = _get_fabric_req_details_raw(cur, plan_name, financial_year, version, from_date_str, to_date_str, consider_fg, consider_wip, consider_pending)

        # Process and filter in Python
        detail_items = []
        for r in all_details:
            src_type = r[0]
            name = r[1]
            brand = r[2]
            category = r[3]
            color = r[4]
            size = r[5]
            bal_req_qty = float(r[6]) if r[6] is not None else 0.0
            fabric_name = r[7] or '-'
            dia = float(r[8]) if r[8] is not None else 0.0
            fabric_consumption = float(r[9]) if r[9] is not None else 0.0
            fabric_requirement = bal_req_qty * fabric_consumption

            # Apply general filters
            if brand_filter and brand_filter.lower().strip() != (brand or '').lower().strip():
                continue
            if category_filter and category_filter.lower().strip() != (category or '').lower().strip():
                continue
            if product_filter and product_filter.lower().strip() != name.lower().strip():
                continue
            if fabric_filter and fabric_filter.lower().strip() != fabric_name.lower().strip():
                continue
            if color_filter and color_filter.lower().strip() != (color or '').lower().strip():
                continue
            if dia_filter:
                try:
                    if float(dia_filter) != dia:
                        continue
                except ValueError:
                    pass
            if search_filter:
                s = search_filter.lower().strip()
                if s not in name.lower() and \
                   s not in (brand or '').lower() and \
                   s not in (color or '').lower() and \
                   s not in size.lower():
                    continue

            # Apply target fabric/color/dia filters for inline breakdown (if passed)
            if target_fabric and target_fabric.lower().strip() != fabric_name.lower().strip():
                continue
            if target_color and target_color.lower().strip() != (color or '').lower().strip():
                continue
            if target_dia_str:
                try:
                    if float(target_dia_str) != dia:
                        continue
                except ValueError:
                    pass

            detail_items.append({
                'source_type': src_type,
                'name': name,
                'brand': brand,
                'category': category,
                'color': color,
                'size': size,
                'bal_req_qty': bal_req_qty,
                'fabric_name': fabric_name,
                'dia': dia,
                'fabric_consumption': fabric_consumption,
                'fabric_requirement': fabric_requirement
            })

        return jsonify({'success': True, 'details': detail_items})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading fabric requirement details: {str(e)}'}), 500
    finally:
        cur.close()
        release_db_connection(conn)

@app.route('/api/balance-qty/export', methods=['GET'])
@login_required
def export_balance_qty():
    plan_name = request.args.get('plan_name', '').strip()
    financial_year = request.args.get('financial_year', '').strip()
    version = request.args.get('version', '').strip()
    from_date_str = request.args.get('from_date', '').strip()
    to_date_str = request.args.get('to_date', '').strip()
    brand = request.args.get('brand', '').strip()
    category = request.args.get('category', '').strip()
    product = request.args.get('product', '').strip()
    search = request.args.get('search', '').strip()
    
    consider_fg = parse_bool_query_param(request.args.get('consider_fg'), True)
    consider_wip = parse_bool_query_param(request.args.get('consider_wip'), True)
    consider_pending = parse_bool_query_param(request.args.get('consider_pending'), True)

    tab = request.args.get('tab', 'standalone').strip().lower()
    
    if not plan_name or not financial_year or not version or not from_date_str or not to_date_str:
        return "Missing plan metadata or period parameters.", 400
        
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        where_clauses = [
            "p.plan_name = %s",
            "p.financial_year = %s",
            "p.version = %s",
            "p.from_date = %s",
            "p.to_date = %s"
        ]
        params = [plan_name, financial_year, version, from_date_str, to_date_str]
        
        if tab == 'common':
            where_clauses.append("p.common_production_name IS NOT NULL AND p.common_production_name <> ''")
            where_clauses.append("p.color <> 'All Colors'")
            where_clauses.append("p.production_type = 'Common Member'")
        else:
            where_clauses.append("p.common_production_name IS NULL OR p.common_production_name = '')")
            
        if brand:
            where_clauses.append("p.brand = %s")
            params.append(brand)
        if category:
            where_clauses.append("p.category = %s")
            params.append(category)
        if product:
            if tab == 'common':
                where_clauses.append("p.common_production_name = %s")
            else:
                where_clauses.append("p.product = %s")
            params.append(product)
            
        if search:
            search_pattern = f"%{search}%"
            if tab == 'common':
                where_clauses.append("(p.common_production_name ILIKE %s OR p.color ILIKE %s OR p.size ILIKE %s OR p.brand ILIKE %s)")
                params.extend([search_pattern, search_pattern, search_pattern, search_pattern])
            else:
                where_clauses.append("(p.product ILIKE %s OR p.color ILIKE %s OR p.size ILIKE %s OR p.brand ILIKE %s)")
                params.extend([search_pattern, search_pattern, search_pattern, search_pattern])
                
        where_str = " AND ".join(where_clauses)
        
        if tab == 'common':
            fg_sum_expr = "SUM(p.finished_goods_qty)" if consider_fg else "0.0"
            wip_sum_expr = "SUM(p.production_wip_qty)" if consider_wip else "0.0"
            pending_sum_expr = "SUM(p.pending_production_qty)" if consider_pending else "0.0"

            query_str = f"""
                WITH color_map AS (
                    SELECT DISTINCT ON (LOWER(TRIM(display_color)))
                        LOWER(TRIM(display_color)) AS color_key,
                        global_color_code
                    FROM color_master
                    ORDER BY LOWER(TRIM(display_color)), (category = 'Primary') DESC, id ASC
                ),
                primary_color_map AS (
                    SELECT DISTINCT ON (LOWER(TRIM(global_color_code)))
                        LOWER(TRIM(global_color_code)) AS code_key,
                        display_color AS primary_display_color
                    FROM color_master
                    WHERE category = 'Primary'
                    ORDER BY LOWER(TRIM(global_color_code)), id ASC
                )
                SELECT p.from_date, p.to_date, MIN(p.brand) as brand, MIN(p.category) as category, p.common_production_name as product,
                       COALESCE(MAX(pcm.primary_display_color), MAX(cm.global_color_code), MIN(p.color)) as color, p.size,
                       SUM(p.calculated_qty) as calculated_qty, SUM(p.finished_goods_qty) as finished_goods_qty,
                       SUM(p.production_wip_qty) as production_wip_qty, SUM(p.pending_production_qty) as pending_production_qty,
                       GREATEST(0.0, SUM(p.calculated_qty) - {fg_sum_expr} - {wip_sum_expr} + {pending_sum_expr}) as bal_required_qty,
                       'Common' as production_type, p.common_production_name
                FROM balance_qty_cache p
                LEFT JOIN color_map cm ON LOWER(TRIM(p.color)) = cm.color_key
                LEFT JOIN primary_color_map pcm ON LOWER(TRIM(COALESCE(cm.global_color_code, p.color))) = pcm.code_key
                WHERE {where_str}
                GROUP BY p.from_date, p.to_date, p.common_production_name, LOWER(TRIM(COALESCE(pcm.primary_display_color, cm.global_color_code, p.color))), p.size
                ORDER BY p.common_production_name ASC, p.size ASC, color ASC;
            """
        else:
            fg_expr = "p.finished_goods_qty" if consider_fg else "0.0"
            wip_expr = "p.production_wip_qty" if consider_wip else "0.0"
            pending_expr = "p.pending_production_qty" if consider_pending else "0.0"

            query_str = f"""
                SELECT from_date, to_date, brand, category, product, color, size,
                       calculated_qty, finished_goods_qty, production_wip_qty, pending_production_qty,
                       GREATEST(0.0, p.calculated_qty - {fg_expr} - {wip_expr} + {pending_expr}) as bal_required_qty,
                       production_type, common_production_name
                FROM balance_qty_cache p
                WHERE {where_str}
                ORDER BY p.product ASC, p.size ASC;
            """
        cur.execute(query_str, tuple(params))
        rows = cur.fetchall()
        
        import io, csv
        from flask import Response
        
        output = io.StringIO()
        writer = csv.writer(output)
        
        writer.writerow([
            'From Date', 'To Date', 'Brand', 'Category', 'Product / Common Group', 'Color', 'Size',
            'Calculated Required Qty', 'Finished Goods Qty', 'Production WIP Qty', 'Pending Production Qty', 'Balance Required Qty',
            'Production Type', 'Common Production Name'
        ])
        
        for r in rows:
            writer.writerow([
                r[0].strftime('%Y-%m-%d') if isinstance(r[0], (date, datetime)) else r[0],
                r[1].strftime('%Y-%m-%d') if isinstance(r[1], (date, datetime)) else r[1],
                r[2], r[3], r[4], r[5], r[6],
                int(r[7]), int(r[8]), int(r[9]), int(r[10]), int(r[11]),
                r[12], r[13] or ''
            ])
            
        csv_data = output.getvalue()
        output.close()
        
        response = Response(csv_data, mimetype='text/csv')
        response.headers["Content-Disposition"] = f"attachment; filename=Balance_Required_Qty_{plan_name.replace(' ', '_')}_{version}.csv"
        return response
    except Exception as e:
        return f"Error exporting balance required qty data: {str(e)}", 500
    finally:
        cur.close()
        release_db_connection(conn)

# =====================================================================
# PLANNING STOCK / WIP / PENDING ORDER MODULE APIS
# =====================================================================

@app.route('/api/planning-stock/data', methods=['GET'])
@login_required
def get_planning_stock_data():
    tab = request.args.get('tab', '').strip()
    if tab not in ['fabric-stock', 'fabric-wip', 'production-wip', 'pending-orders', 'finished-goods']:
        return jsonify({'success': False, 'message': 'Invalid tab parameter.'}), 400
        
    table_name = tab.replace('-', '_')
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        if tab in ['fabric-stock', 'fabric-wip']:
            cur.execute(f"""
                SELECT id, fabric_name, gsm, dia, color, uom, weight_mtr, validation_status, validation_message, 
                       created_at, updated_at, created_by, updated_by 
                FROM {table_name}
                ORDER BY id DESC;
            """)
            rows = cur.fetchall()
            cols = ['id', 'fabric_name', 'gsm', 'dia', 'color', 'uom', 'weight_mtr', 'validation_status', 'validation_message', 
                    'created_at', 'updated_at', 'created_by', 'updated_by']
        elif tab == 'production-wip':
            cur.execute(f"""
                SELECT id, product_name, color, size, production_type, production_group, qty, validation_status, validation_message, 
                       created_at, updated_at, created_by, updated_by 
                FROM {table_name}
                ORDER BY id DESC;
            """)
            rows = cur.fetchall()
            cols = ['id', 'product_name', 'color', 'size', 'production_type', 'production_group', 'qty', 'validation_status', 'validation_message', 
                    'created_at', 'updated_at', 'created_by', 'updated_by']
        else: # pending-orders, finished-goods
            cur.execute(f"""
                SELECT id, product_name, color, size, qty, validation_status, validation_message, 
                       created_at, updated_at, created_by, updated_by 
                FROM {table_name}
                ORDER BY id DESC;
            """)
            rows = cur.fetchall()
            cols = ['id', 'product_name', 'color', 'size', 'qty', 'validation_status', 'validation_message', 
                    'created_at', 'updated_at', 'created_by', 'updated_by']
            
        serialized_rows = []
        from decimal import Decimal
        for row in rows:
            serialized = {}
            for col, val in zip(cols, row):
                if isinstance(val, (datetime, date)):
                    serialized[col] = val.isoformat()
                elif isinstance(val, Decimal):
                    serialized[col] = float(val)
                else:
                    serialized[col] = val
            serialized_rows.append(serialized)
            
        cur.close()
        return jsonify({'success': True, 'data': serialized_rows})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Database error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

def fetch_stock_wip_master_data(cur):
    cur.execute("SELECT fabric_name, gsm, uom, id FROM fabric_master;")
    fabric_master_rows = cur.fetchall()
    fabric_map = { r[0].lower().strip(): {'gsm': r[1], 'uom': r[2], 'id': r[3]} for r in fabric_master_rows }
    
    cur.execute("SELECT display_color, global_color_code, id, category FROM color_master;")
    color_master_rows = cur.fetchall()
    color_map = { r[0].lower().strip(): {'code': r[1], 'id': r[2], 'category': r[3]} for r in color_master_rows }
    color_code_map = { r[1].lower().strip(): {'display': r[0], 'id': r[2], 'category': r[3]} for r in color_master_rows }
    
    primary_color_by_code = {}
    for r in color_master_rows:
        disp_col = r[0]
        g_code = r[1]
        category = r[3]
        if category == 'Primary':
            primary_color_by_code[g_code.lower().strip()] = disp_col.lower().strip()
            
    cur.execute("SELECT product_name, id, production_type, common_production_id FROM product_master;")
    product_rows = cur.fetchall()
    product_db_map = { r[0].lower().strip(): {'id': r[1], 'production_type': r[2], 'common_production_id': r[3]} for r in product_rows }
    product_map = { r[0].lower().strip(): r[1] for r in product_rows }
    
    cur.execute("SELECT id, LOWER(TRIM(common_production_name)) FROM common_production_master;")
    common_prod_rows = cur.fetchall()
    common_prod_map = { r[1]: r[0] for r in common_prod_rows }
    
    cur.execute("SELECT product_id, LOWER(TRIM(global_color_code)) FROM product_color_mapping;")
    product_color_set = { (r[0], r[1]) for r in cur.fetchall() }
    
    cur.execute("SELECT product_id, size_id FROM product_dia_mapping;")
    product_size_set = { (r[0], r[1]) for r in cur.fetchall() }

    cur.execute("SELECT size, size_code, id FROM size_master;")
    size_master_rows = cur.fetchall()
    size_map = { r[0].lower().strip(): {'code': r[1], 'id': r[2]} for r in size_master_rows }
    size_code_map = { r[1].lower().strip(): {'size': r[0], 'id': r[2]} for r in size_master_rows }
    
    cur.execute("SELECT fabric_id, dia FROM fabric_dia_mapping;")
    fabric_dia_rows = cur.fetchall()
    fabric_dia_set = { (r[0], float(r[1])) for r in fabric_dia_rows }
    
    fabric_dias_map = {}
    for r in fabric_dia_rows:
        fabric_dias_map.setdefault(r[0], []).append(float(r[1]))

    return {
        'fabric_map': fabric_map,
        'fabric_master_rows': fabric_master_rows,
        'color_map': color_map,
        'color_code_map': color_code_map,
        'primary_color_by_code': primary_color_by_code,
        'product_db_map': product_db_map,
        'product_map': product_map,
        'product_rows': product_rows,
        'common_prod_map': common_prod_map,
        'product_color_set': product_color_set,
        'product_size_set': product_size_set,
        'size_map': size_map,
        'size_code_map': size_code_map,
        'fabric_dia_set': fabric_dia_set,
        'fabric_dias_map': fabric_dias_map
    }

def validate_stock_wip_rows_internal(cur, tab_slug, rows, master_data=None):
    if not master_data:
        master_data = fetch_stock_wip_master_data(cur)
        
    fabric_map = master_data['fabric_map']
    color_map = master_data['color_map']
    color_code_map = master_data['color_code_map']
    product_db_map = master_data['product_db_map']
    product_map = master_data['product_map']
    product_rows = master_data['product_rows']
    common_prod_map = master_data['common_prod_map']
    product_color_set = master_data['product_color_set']
    product_size_set = master_data['product_size_set']
    size_map = master_data['size_map']
    size_code_map = master_data['size_code_map']
    fabric_dia_set = master_data['fabric_dia_set']
    
    normalized_tab = tab_slug.lower().replace(' ', '-').replace('_', '-')
    
    seen_keys = set()
    validated_rows = []
    
    for idx, row in enumerate(rows):
        errors = []
        row_copy = dict(row)
        is_duplicate = False
        
        if normalized_tab in ['fabric-stock', 'fabric-wip']:
            fabric_name = str(row.get('Fabric Name', row.get('fabric_name', ''))).strip()
            gsm_val = str(row.get('GSM', row.get('gsm', ''))).strip()
            dia_val = str(row.get('DIA', row.get('dia', ''))).strip()
            color_name = str(row.get('Color', row.get('color', ''))).strip()
            weight_val = str(row.get('Weight', row.get('weight_mtr', ''))).strip()
            
            dup_key = (fabric_name.lower(), gsm_val, dia_val, color_name.lower())
            if dup_key in seen_keys and any(dup_key):
                is_duplicate = True
                errors.append(f"Duplicate Row: '{fabric_name}' / '{color_name}' / DIA {dia_val} already exists in this sheet.")
            else:
                if any(dup_key):
                    seen_keys.add(dup_key)
            
            fabric_id = None
            fab_gsm = None
            fab_uom = 'KGS'
            
            if not fabric_name:
                errors.append("Fabric Name is required. Suggested: Select an active Fabric from Fabric Master.")
            elif fabric_name.lower() not in fabric_map:
                errors.append(f"Fabric '{fabric_name}' not found in Fabric Master. Suggested: Select a valid Fabric Master value.")
            else:
                fab_info = fabric_map[fabric_name.lower()]
                fabric_id = fab_info['id']
                fab_gsm = fab_info['gsm']
                fab_uom = fab_info['uom'] or 'KGS'
                
            if not gsm_val:
                errors.append("GSM is required.")
            else:
                try:
                    parsed_gsm = int(float(gsm_val))
                    if fab_gsm is not None and parsed_gsm != int(float(fab_gsm)):
                        errors.append(f"GSM ({parsed_gsm}) does not match Fabric Master ({int(float(fab_gsm))}). Suggested: Enter valid GSM.")
                except ValueError:
                    errors.append(f"Invalid numeric GSM '{gsm_val}'.")
                    
            if not dia_val:
                errors.append("DIA is required.")
            else:
                try:
                    parsed_dia = float(dia_val)
                    if fabric_id is not None and (fabric_id, parsed_dia) not in fabric_dia_set:
                        errors.append(f"DIA {dia_val} is not mapped to fabric '{fabric_name}'. Suggested: Select a valid mapped DIA.")
                except ValueError:
                    errors.append(f"Invalid numeric DIA '{dia_val}'.")
                    
            if not color_name:
                errors.append("Color is required.")
            elif color_name.lower() not in color_map and color_name.lower() not in color_code_map:
                errors.append(f"Color '{color_name}' not found in Color Master. Suggested: Select an active Color Master value.")
                
            if not weight_val:
                errors.append("Weight is required and should be greater than zero.")
            else:
                try:
                    parsed_weight = float(weight_val)
                    if parsed_weight <= 0:
                        errors.append("Weight must be greater than zero.")
                except ValueError:
                    errors.append(f"Invalid numeric Weight '{weight_val}'.")
                    
            row_copy['fabric_name'] = fabric_name
            row_copy['gsm'] = gsm_val
            row_copy['dia'] = dia_val
            row_copy['color'] = color_name
            row_copy['uom'] = fab_uom
            row_copy['weight_mtr'] = weight_val
            
        elif normalized_tab == 'production-wip':
            product_name = str(row.get('Product Name', row.get('product_name', ''))).strip()
            color_name = str(row.get('Color', row.get('color', ''))).strip()
            size_name = str(row.get('Size', row.get('size', ''))).strip()
            prod_type = str(row.get('Production Type', row.get('production_type', ''))).strip()
            prod_group = str(row.get('Production Group', row.get('production_group', ''))).strip()
            qty_val = str(row.get('Qty', row.get('qty', ''))).strip()
            
            dup_key = (product_name.lower(), color_name.lower(), size_name.lower(), prod_type.lower(), prod_group.lower())
            if dup_key in seen_keys and any(dup_key):
                is_duplicate = True
                errors.append(f"Duplicate Row: '{product_name}' / '{color_name}' / '{size_name}' already exists in this sheet.")
            else:
                if any(dup_key):
                    seen_keys.add(dup_key)
                
            if not product_name:
                errors.append("Product Name is required.")
            if not color_name:
                errors.append("Color is required.")
            if not size_name:
                errors.append("Size is required.")
                
            if not qty_val:
                errors.append("Qty is required and should be greater than zero.")
            else:
                try:
                    parsed_qty = int(float(qty_val))
                    if parsed_qty <= 0:
                        errors.append("Qty must be greater than zero.")
                except ValueError:
                    errors.append(f"Invalid numeric Qty '{qty_val}'.")

            resolved_g_code = None
            if color_name:
                col_info = None
                if color_name.lower() in color_map:
                    col_info = color_map[color_name.lower()]
                elif color_name.lower() in color_code_map:
                    col_info = color_code_map[color_name.lower()]
                
                if not col_info:
                    errors.append(f"Color '{color_name}' not found in Color Master. Suggested: Select a valid Color.")
                else:
                    g_code = col_info['code'].lower().strip()
                    resolved_g_code = g_code

            wip_size_id = None
            if size_name:
                if size_name.lower() in size_map:
                    wip_size_id = size_map[size_name.lower()]['id']
                elif size_name.lower() in size_code_map:
                    wip_size_id = size_code_map[size_name.lower()]['id']
                else:
                    errors.append(f"Size '{size_name}' not found in Size Master. Suggested: Select an active Size.")

            if not errors and product_name:
                prod_name_lower = product_name.lower().strip()
                if prod_name_lower in common_prod_map:
                    common_id = common_prod_map[prod_name_lower]
                    members = [p for p in product_rows if p[3] == common_id]
                    if not members:
                        errors.append(f"No member products configured in Common Production '{product_name}'.")
                    else:
                        valid_member_found = False
                        for m in members:
                            m_id = m[1]
                            has_size = (m_id, wip_size_id) in product_size_set
                            has_color = (m_id, resolved_g_code) in product_color_set
                            if has_size and has_color:
                                valid_member_found = True
                                break
                        if not valid_member_found:
                            errors.append(f"Color '{color_name}' or Size '{size_name}' is not configured for any member in Common Production '{product_name}'.")
                else:
                    if prod_name_lower in product_db_map:
                        p_info = product_db_map[prod_name_lower]
                        if p_info['production_type'] != 'Stand Alone':
                            errors.append(f"Product '{product_name}' is not configured as Stand Alone.")
                        else:
                            prod_id = p_info['id']
                            has_size = (prod_id, wip_size_id) in product_size_set
                            has_color = (prod_id, resolved_g_code) in product_color_set
                            if not has_size:
                                errors.append(f"Size '{size_name}' not mapped for Product '{product_name}'.")
                            elif not has_color:
                                errors.append(f"Color '{color_name}' not mapped for Product '{product_name}'.")
                    else:
                        errors.append(f"Product '{product_name}' not found in Product Master. Suggested: Select an existing Product.")
                        
            row_copy['product_name'] = product_name
            row_copy['color'] = color_name
            row_copy['size'] = size_name
            row_copy['production_type'] = prod_type or 'Common'
            row_copy['production_group'] = prod_group or 'Group A'
            row_copy['qty'] = qty_val
            
        else: # pending-orders, finished-goods
            product_name = str(row.get('Product Name', row.get('product_name', ''))).strip()
            color_name = str(row.get('Color', row.get('color', ''))).strip()
            size_name = str(row.get('Size', row.get('size', ''))).strip()
            qty_val = str(row.get('Qty', row.get('qty', ''))).strip()
            
            dup_key = (product_name.lower(), color_name.lower(), size_name.lower())
            if dup_key in seen_keys and any(dup_key):
                is_duplicate = True
                errors.append(f"Duplicate Row: '{product_name}' / '{color_name}' / '{size_name}' already exists in this sheet.")
            else:
                if any(dup_key):
                    seen_keys.add(dup_key)
                
            if not product_name:
                errors.append("Product Name is required.")
            elif product_name.lower() not in product_map:
                errors.append(f"Product '{product_name}' not found in Product Master.")
                
            if not color_name:
                errors.append("Color is required.")
            elif color_name.lower() not in color_map and color_name.lower() not in color_code_map:
                errors.append(f"Color '{color_name}' not found in Color Master.")
                
            if not size_name:
                errors.append("Size is required.")
            elif size_name.lower() not in size_map and size_name.lower() not in size_code_map:
                errors.append(f"Size '{size_name}' not found in Size Master.")
                
            if not qty_val:
                errors.append("Qty is required and should be greater than zero.")
            else:
                try:
                    parsed_qty = int(float(qty_val))
                    if parsed_qty <= 0:
                        errors.append("Qty must be greater than zero.")
                except ValueError:
                    errors.append(f"Invalid numeric Qty '{qty_val}'.")
                    
            row_copy['product_name'] = product_name
            row_copy['color'] = color_name
            row_copy['size'] = size_name
            row_copy['qty'] = qty_val
        
        if is_duplicate:
            row_copy['validation_status'] = 'DUPLICATE'
            row_copy['validation_message'] = errors[0] if errors else 'Duplicate Row'
        elif errors:
            row_copy['validation_status'] = 'INVALID'
            row_copy['validation_message'] = errors[0]
        else:
            row_copy['validation_status'] = 'VALID'
            row_copy['validation_message'] = 'Valid'
            
        validated_rows.append(row_copy)
        
    return validated_rows

# Stock WIP Live Counts API (For Delete All confirmation and toolbar status)
@app.route('/api/planning-stock/counts', methods=['GET'])
@app.route('/api/stock-wip/counts', methods=['GET'])
@login_required
def get_planning_stock_counts():
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Consolidated multi-subquery count for all 5 stock & WIP tables
        cur.execute("""
            SELECT 
                (SELECT COUNT(*) FROM fabric_stock) AS fabric_stock,
                (SELECT COUNT(*) FROM fabric_wip) AS fabric_wip,
                (SELECT COUNT(*) FROM production_wip) AS production_wip,
                (SELECT COUNT(*) FROM pending_orders) AS pending_orders,
                (SELECT COUNT(*) FROM finished_goods) AS finished_goods;
        """)
        row = cur.fetchone()
        counts = {
            'fabric_stock': int(row[0] or 0),
            'fabric_wip': int(row[1] or 0),
            'production_wip': int(row[2] or 0),
            'pending_orders': int(row[3] or 0),
            'finished_goods': int(row[4] or 0),
            'total': int(sum(row[i] or 0 for i in range(5)))
        }
        cur.close()
        return jsonify({'success': True, 'counts': counts})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error fetching counts: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Delete Stock & WIP Data API (Supports selective table deletion or all tables)
@app.route('/api/planning-stock/delete-all', methods=['DELETE', 'POST'])
@app.route('/api/stock-wip/delete-all', methods=['DELETE', 'POST'])
@login_required
def delete_all_planning_stock():
    data = request.json or {}
    selected_tabs = data.get('tabs') or data.get('tables')
    
    valid_map = {
        'fabric-stock': 'fabric_stock',
        'fabric_stock': 'fabric_stock',
        'fabric-wip': 'fabric_wip',
        'fabric_wip': 'fabric_wip',
        'production-wip': 'production_wip',
        'production_wip': 'production_wip',
        'pending-orders': 'pending_orders',
        'pending_orders': 'pending_orders',
        'finished-goods': 'finished_goods',
        'finished_goods': 'finished_goods'
    }
    
    if selected_tabs:
        tables = []
        for t in selected_tabs:
            if t in valid_map and valid_map[t] not in tables:
                tables.append(valid_map[t])
    else:
        tables = ['fabric_stock', 'fabric_wip', 'production_wip', 'pending_orders', 'finished_goods']
        
    if not tables:
        return jsonify({'success': False, 'message': 'No valid tables selected for deletion.'}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        counts = {}
        total_deleted = 0
        
        for tbl in tables:
            cur.execute(f"SELECT COUNT(*) FROM {tbl};")
            cnt = cur.fetchone()[0]
            counts[tbl] = cnt
            total_deleted += cnt
            cur.execute(f"DELETE FROM {tbl};")
            
        if any(t in ['production_wip', 'pending_orders', 'finished_goods'] for t in tables):
            cur.execute("DELETE FROM balance_qty_cache;")
            
        conn.commit()
        cur.close()
        
        return jsonify({
            'success': True,
            'message': 'Selected Stock & WIP records deleted successfully.',
            'deleted_counts': counts,
            'total_deleted': total_deleted
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database delete error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Master Options API (For inline dropdowns / autocomplete in Bulk Feed UI)
@app.route('/api/planning-stock/master-options', methods=['GET'])
@app.route('/api/stock-wip/master-options', methods=['GET'])
@login_required
def get_stock_wip_master_options():
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        master_data = fetch_stock_wip_master_data(cur)
        
        fabrics = []
        for r in master_data['fabric_master_rows']:
            fab_name = r[0]
            gsm = float(r[1]) if r[1] is not None else 0
            uom = r[2] or 'KGS'
            fab_id = r[3]
            dias = master_data['fabric_dias_map'].get(fab_id, [])
            fabrics.append({'fabric_name': fab_name, 'gsm': gsm, 'uom': uom, 'dias': dias})
            
        colors = []
        cur.execute("SELECT display_color, global_color_code, category FROM color_master WHERE status = 'Active' OR status IS NULL ORDER BY display_color ASC;")
        for r in cur.fetchall():
            colors.append({'display_color': r[0], 'global_color_code': r[1], 'category': r[2]})
            
        sizes = []
        cur.execute("SELECT size, size_code FROM size_master WHERE status = 'Active' OR status IS NULL ORDER BY size ASC;")
        for r in cur.fetchall():
            sizes.append({'size': r[0], 'size_code': r[1]})
            
        products = []
        cur.execute("SELECT product_name, production_type FROM product_master WHERE status = 'Active' OR status IS NULL ORDER BY product_name ASC;")
        for r in cur.fetchall():
            products.append({'product_name': r[0], 'production_type': r[1]})
            
        # Common production names
        cur.execute("SELECT common_production_name FROM common_production_master ORDER BY common_production_name ASC;")
        common_prods = [r[0] for r in cur.fetchall()]
        
        cur.close()
        return jsonify({
            'success': True,
            'fabrics': fabrics,
            'colors': colors,
            'sizes': sizes,
            'products': products,
            'common_productions': common_prods
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading master options: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Clean 5-Sheet Bulk Feed Template Generation
@app.route('/api/planning-stock/bulk-feed-template', methods=['GET'])
@app.route('/api/stock-wip/bulk-feed-template', methods=['GET'])
def download_bulk_feed_template():
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        import io
        from flask import send_file
        
        wb = Workbook()
        wb.remove(wb.active) # Remove default sheet
        
        sheets_config = [
            ('Fabric Stock', ['Fabric Name', 'GSM', 'DIA', 'Color', 'Weight']),
            ('Fabric WIP', ['Fabric Name', 'GSM', 'DIA', 'Color', 'Weight']),
            ('Production WIP', ['Product Name', 'Color', 'Size', 'Production Type', 'Production Group', 'Qty']),
            ('Pending Orders', ['Product Name', 'Color', 'Size', 'Qty']),
            ('Finished Goods', ['Product Name', 'Color', 'Size', 'Qty'])
        ]
        
        header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
        header_fill = PatternFill(start_color='1E3A8A', end_color='1E3A8A', fill_type='solid') # Navy / Dark Blue
        thin_border = Border(
            left=Side(style='thin', color='CBD5E1'),
            right=Side(style='thin', color='CBD5E1'),
            top=Side(style='thin', color='CBD5E1'),
            bottom=Side(style='thin', color='CBD5E1')
        )
        
        for sheet_name, headers in sheets_config:
            ws = wb.create_sheet(title=sheet_name)
            ws.append(headers)
            ws.row_dimensions[1].height = 25
            
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=1, column=col_num)
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = thin_border
                ws.column_dimensions[cell.column_letter].width = max(len(header) + 6, 16)
                
            ws.freeze_panes = 'A2'
            
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name='Stock_WIP_Bulk_Feed_Template.xlsx'
        )
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error generating bulk template: {str(e)}'}), 500

# Single-Tab Validate API
@app.route('/api/planning-stock/validate', methods=['POST'])
@app.route('/api/stock-wip/validate', methods=['POST'])
@login_required
def validate_planning_stock_data():
    data = request.json or {}
    tab = data.get('tab', '').strip()
    rows = data.get('rows', [])
    
    if tab not in ['fabric-stock', 'fabric-wip', 'production-wip', 'pending-orders', 'finished-goods']:
        return jsonify({'success': False, 'message': 'Invalid tab parameter.'}), 400
        
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        validated_rows = validate_stock_wip_rows_internal(cur, tab, rows)
        cur.close()
        return jsonify({'success': True, 'rows': validated_rows})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Validation error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Single-Tab Save API
@app.route('/api/planning-stock/save', methods=['POST'])
@app.route('/api/stock-wip/save', methods=['POST'])
@login_required
def save_planning_stock_data():
    data = request.json or {}
    tab = data.get('tab', '').strip()
    rows = data.get('rows', [])
    
    if tab not in ['fabric-stock', 'fabric-wip', 'production-wip', 'pending-orders', 'finished-goods']:
        return jsonify({'success': False, 'message': 'Invalid tab parameter.'}), 400
        
    table_name = tab.replace('-', '_')
    username = session.get('username', 'system')
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Backend re-validation
        validated_rows = validate_stock_wip_rows_internal(cur, tab, rows)
        valid_rows = [r for r in validated_rows if r.get('validation_status') == 'VALID']
        invalid_rows = [r for r in validated_rows if r.get('validation_status') != 'VALID']
        
        if not valid_rows:
            cur.close()
            return jsonify({
                'success': True,
                'message': 'No valid records to save.',
                'saved_count': 0,
                'remaining_rows': invalid_rows
            })
            
        if tab in ['fabric-stock', 'fabric-wip']:
            data_to_insert = [
                (
                    r.get('fabric_name'),
                    int(float(r.get('gsm', 0))),
                    float(r.get('dia', 0)),
                    r.get('color'),
                    r.get('uom', 'KGS'),
                    float(r.get('weight_mtr', 0)),
                    'VALID',
                    'Valid',
                    username,
                    username
                )
                for r in valid_rows
            ]
            psycopg2.extras.execute_values(
                cur,
                f"""
                    INSERT INTO {table_name} (fabric_name, gsm, dia, color, uom, weight_mtr, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                    VALUES %s;
                """,
                data_to_insert,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
            )
        elif tab == 'production-wip':
            data_to_insert = [
                (
                    r.get('product_name'),
                    r.get('color'),
                    r.get('size'),
                    r.get('production_type'),
                    r.get('production_group'),
                    int(float(r.get('qty', 0))),
                    'VALID',
                    'Valid',
                    username,
                    username
                )
                for r in valid_rows
            ]
            psycopg2.extras.execute_values(
                cur,
                f"""
                    INSERT INTO {table_name} (product_name, color, size, production_type, production_group, qty, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                    VALUES %s;
                """,
                data_to_insert,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
            )
        else: # pending-orders, finished-goods
            data_to_insert = [
                (
                    r.get('product_name'),
                    r.get('color'),
                    r.get('size'),
                    int(float(r.get('qty', 0))),
                    'VALID',
                    'Valid',
                    username,
                    username
                )
                for r in valid_rows
            ]
            psycopg2.extras.execute_values(
                cur,
                f"""
                    INSERT INTO {table_name} (product_name, color, size, qty, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                    VALUES %s;
                """,
                data_to_insert,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
            )
                
        if tab in ['production-wip', 'pending-orders', 'finished-goods']:
            cur.execute("DELETE FROM balance_qty_cache;")
            
        conn.commit()
        cur.close()
        
        return jsonify({
            'success': True,
            'message': 'Only valid records were saved.',
            'saved_count': len(valid_rows),
            'remaining_rows': invalid_rows
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Database save error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Bulk Feed Validate API (Validates CURRENT rows across all 5 sheets)
@app.route('/api/planning-stock/bulk-feed/validate', methods=['POST'])
@app.route('/api/stock-wip/bulk-feed/validate', methods=['POST'])
@login_required
def validate_bulk_feed_data():
    data = request.json or {}
    sheets_data = data.get('sheets', {})
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        master_data = fetch_stock_wip_master_data(cur)
        
        expected_sheets = {
            'Fabric Stock': 'fabric-stock',
            'Fabric WIP': 'fabric-wip',
            'Production WIP': 'production-wip',
            'Pending Orders': 'pending-orders',
            'Finished Goods': 'finished-goods'
        }
        
        validated_sheets = {}
        summary = {
            'total': 0,
            'valid': 0,
            'invalid': 0,
            'duplicate': 0,
            'sheets': {}
        }
        
        for sheet_title, tab_slug in expected_sheets.items():
            # Allow lookup by sheet title or slug
            rows = sheets_data.get(sheet_title) or sheets_data.get(tab_slug) or []
            val_rows = validate_stock_wip_rows_internal(cur, tab_slug, rows, master_data=master_data)
            validated_sheets[sheet_title] = val_rows
            
            s_total = len(val_rows)
            s_valid = len([r for r in val_rows if r.get('validation_status') == 'VALID'])
            s_invalid = len([r for r in val_rows if r.get('validation_status') == 'INVALID'])
            s_duplicate = len([r for r in val_rows if r.get('validation_status') == 'DUPLICATE'])
            
            summary['sheets'][sheet_title] = {
                'total': s_total,
                'valid': s_valid,
                'invalid': s_invalid,
                'duplicate': s_duplicate
            }
            summary['total'] += s_total
            summary['valid'] += s_valid
            summary['invalid'] += s_invalid
            summary['duplicate'] += s_duplicate
            
        cur.close()
        return jsonify({
            'success': True,
            'sheets': validated_sheets,
            'summary': summary
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Bulk validation error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# Bulk Feed Atomic Save API (Revalidates CURRENT rows & executes single-transaction insert)
@app.route('/api/planning-stock/bulk-feed/save', methods=['POST'])
@app.route('/api/stock-wip/bulk-feed/save', methods=['POST'])
@login_required
def save_bulk_feed_data():
    data = request.json or {}
    sheets_data = data.get('sheets', {})
    username = session.get('username', 'system')
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        master_data = fetch_stock_wip_master_data(cur)
        
        sheet_mapping = {
            'Fabric Stock': ('fabric_stock', 'fabric-stock'),
            'Fabric WIP': ('fabric_wip', 'fabric-wip'),
            'Production WIP': ('production_wip', 'production-wip'),
            'Pending Orders': ('pending_orders', 'pending-orders'),
            'Finished Goods': ('finished_goods', 'finished-goods')
        }
        
        validated_sheets = {}
        total_rows = 0
        total_invalid = 0
        total_duplicate = 0
        
        total_valid = 0
        
        # 1. Independent Backend Re-Validation
        for sheet_title, (table_name, tab_slug) in sheet_mapping.items():
            rows = sheets_data.get(sheet_title) or sheets_data.get(tab_slug) or []
            val_rows = validate_stock_wip_rows_internal(cur, tab_slug, rows, master_data=master_data)
            validated_sheets[sheet_title] = val_rows
            
            total_rows += len(val_rows)
            total_invalid += len([r for r in val_rows if r.get('validation_status') == 'INVALID'])
            total_duplicate += len([r for r in val_rows if r.get('validation_status') == 'DUPLICATE'])
            total_valid += len([r for r in val_rows if r.get('validation_status') == 'VALID'])
            
        if total_rows == 0:
            cur.close()
            return jsonify({'success': False, 'message': 'No records found in any of the 5 sheets to save.'}), 400
            
        if total_valid == 0:
            cur.close()
            return jsonify({
                'success': False,
                'message': 'No valid records found to save. Please correct invalid records and re-validate.',
                'invalid_count': total_invalid,
                'duplicate_count': total_duplicate
            }), 400
            
        # 2. Atomic Multi-Table Insertion
        inserted_counts = {}
        total_inserted = 0
        
        for sheet_title, (table_name, tab_slug) in sheet_mapping.items():
            val_rows = validated_sheets[sheet_title]
            valid_rows = [r for r in val_rows if r.get('validation_status') == 'VALID']
            
            if valid_rows:
                if tab_slug in ['fabric-stock', 'fabric-wip']:
                    data_to_insert = [
                        (
                            r.get('fabric_name'),
                            int(float(r.get('gsm', 0))),
                            float(r.get('dia', 0)),
                            r.get('color'),
                            r.get('uom', 'KGS'),
                            float(r.get('weight_mtr', 0)),
                            'VALID',
                            'Valid',
                            username,
                            username
                        )
                        for r in valid_rows
                    ]
                    psycopg2.extras.execute_values(
                        cur,
                        f"""
                            INSERT INTO {table_name} (fabric_name, gsm, dia, color, uom, weight_mtr, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                            VALUES %s;
                        """,
                        data_to_insert,
                        template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
                    )
                elif tab_slug == 'production-wip':
                    data_to_insert = [
                        (
                            r.get('product_name'),
                            r.get('color'),
                            r.get('size'),
                            r.get('production_type', 'Common'),
                            r.get('production_group', 'Group A'),
                            int(float(r.get('qty', 0))),
                            'VALID',
                            'Valid',
                            username,
                            username
                        )
                        for r in valid_rows
                    ]
                    psycopg2.extras.execute_values(
                        cur,
                        f"""
                            INSERT INTO {table_name} (product_name, color, size, production_type, production_group, qty, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                            VALUES %s;
                        """,
                        data_to_insert,
                        template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
                    )
                else: # pending-orders, finished-goods
                    data_to_insert = [
                        (
                            r.get('product_name'),
                            r.get('color'),
                            r.get('size'),
                            int(float(r.get('qty', 0))),
                            'VALID',
                            'Valid',
                            username,
                            username
                        )
                        for r in valid_rows
                    ]
                    psycopg2.extras.execute_values(
                        cur,
                        f"""
                            INSERT INTO {table_name} (product_name, color, size, qty, validation_status, validation_message, created_by, updated_by, created_at, updated_at)
                            VALUES %s;
                        """,
                        data_to_insert,
                        template="(%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
                    )
                    
            inserted_counts[sheet_title] = len(valid_rows)
            total_inserted += len(valid_rows)
            
        cur.execute("DELETE FROM balance_qty_cache;")
        
        conn.commit()
        cur.close()
        
        return jsonify({
            'success': True,
            'message': 'Bulk Feed completed successfully.',
            'inserted_counts': inserted_counts,
            'total_inserted': total_inserted
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'message': f'Atomic bulk save error: {str(e)}'}), 500
    finally:
        if conn:
            release_db_connection(conn)

# =====================================================================
# PENDING QTY PLANNING MODULE APIS (ISOLATED & PRODUCTION-SAFE)
# =====================================================================
from pending_qty_service import (
    calculate_pending_qty_engine, get_pending_plan_meta, get_pending_plan_summary,
    get_pending_plan_data, get_cutting_plan_data, get_fab_required_data,
    get_fabric_pool_consumers, get_common_production_members,
    update_plan_line_priority, save_manual_allocation, confirm_pending_plan,
    export_pending_plan_csv
)

@app.route('/api/pending-qty-plan/meta', methods=['GET'])
@login_required
def api_pending_qty_plan_meta():
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        data = get_pending_plan_meta(cur)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching pending plan meta: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

def resolve_or_get_latest_plan_id(cur, plan_id_arg=None, username="System"):
    if plan_id_arg and str(plan_id_arg).strip() not in ('null', 'undefined', '', 'None'):
        try:
            return int(plan_id_arg)
        except ValueError:
            pass
    cur.execute("SELECT id FROM pending_qty_plans ORDER BY id DESC LIMIT 1;")
    row = cur.fetchone()
    if row:
        return row[0]
    res = calculate_pending_qty_engine(cur, username=username)
    return res.get('plan_id')

@app.route('/api/pending-qty-plan/summary', methods=['GET'])
@login_required
def api_pending_qty_plan_summary():
    plan_id = request.args.get('plan_id')
    plan_name = request.args.get('plan_name') or 'LIVE_PENDING_ORDERS'
    financial_year = request.args.get('financial_year') or 'CURRENT'
    version = request.args.get('version') or 'v1'
    from_date = request.args.get('from_date') or '2020-01-01'
    to_date = request.args.get('to_date') or '2099-12-31'

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        resolved_pid = resolve_or_get_latest_plan_id(cur, plan_id)
        data = get_pending_plan_summary(cur, plan_name, financial_year, version, from_date, to_date, plan_id=resolved_pid)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching pending plan summary: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/calculate', methods=['POST'])
@login_required
def api_pending_qty_plan_calculate():
    payload = request.json or {}
    plan_name = payload.get('plan_name') or 'LIVE_PENDING_ORDERS'
    financial_year = payload.get('financial_year') or 'CURRENT'
    version = payload.get('version') or 'v1'
    from_date = payload.get('from_date') or '2020-01-01'
    to_date = payload.get('to_date') or '2099-12-31'

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        username = session.get('username', 'System')
        res = calculate_pending_qty_engine(cur, plan_name, financial_year, version, from_date, to_date, username=username)
        conn.commit()
        return jsonify(res)
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error calculating pending plan: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/pending-plan', methods=['GET'])
@login_required
def api_pending_qty_plan_pending():
    plan_id_raw = request.args.get('plan_id')
    filters = {
        'brand': request.args.get('brand', ''),
        'category': request.args.get('category', ''),
        'product_type': request.args.get('product_type', 'All'),
        'common_production_name': request.args.get('common_production_name', ''),
        'product': request.args.get('product', ''),
        'color': request.args.get('color', ''),
        'size': request.args.get('size', ''),
        'fabric_name': request.args.get('fabric_name', ''),
        'fabric_color': request.args.get('fabric_color', ''),
        'status': request.args.get('status', 'All'),
        'search': request.args.get('search', '')
    }
    page = int(request.args.get('page', 1))
    try:
        per_page = int(request.args.get('per_page', 50))
    except (ValueError, TypeError):
        per_page = 50
    all_records = (per_page == -1 or per_page >= 100000)

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        plan_id = resolve_or_get_latest_plan_id(cur, plan_id_raw)
        if not plan_id:
            return jsonify({'success': True, 'rows': [], 'total_count': 0, 'page': page, 'per_page': per_page, 'totals': {'requirement_qty': 0, 'fg_qty': 0, 'wip_qty': 0, 'already_planned_qty': 0, 'net_pending_qty': 0}})
        data = get_pending_plan_data(cur, int(plan_id), filters, page=page, per_page=per_page, all_records=all_records)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching pending plan table: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/cutting-plan', methods=['GET'])
@login_required
def api_pending_qty_plan_cutting():
    plan_id_raw = request.args.get('plan_id')
    filters = {
        'brand': request.args.get('brand', ''),
        'category': request.args.get('category', ''),
        'product_type': request.args.get('product_type', 'All'),
        'common_production_name': request.args.get('common_production_name', ''),
        'product': request.args.get('product', ''),
        'color': request.args.get('color', ''),
        'size': request.args.get('size', ''),
        'fabric_name': request.args.get('fabric_name', ''),
        'fabric_color': request.args.get('fabric_color', ''),
        'status': request.args.get('status', 'All'),
        'search': request.args.get('search', '')
    }
    page = int(request.args.get('page', 1))
    try:
        per_page = int(request.args.get('per_page', 50))
    except (ValueError, TypeError):
        per_page = 50
    all_records = (per_page == -1 or per_page >= 100000)

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        plan_id = resolve_or_get_latest_plan_id(cur, plan_id_raw)
        if not plan_id:
            return jsonify({'success': True, 'rows': [], 'total_count': 0, 'page': page, 'per_page': per_page, 'totals': {'net_pending_qty': 0, 'fabric_required_kg': 0, 'allocated_fabric_kg': 0, 'cuttable_qty': 0, 'hold_qty': 0, 'shortage_kg': 0}})
        data = get_cutting_plan_data(cur, int(plan_id), filters, page=page, per_page=per_page, all_records=all_records)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching cutting plan table: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/fab-required', methods=['GET'])
@login_required
def api_pending_qty_plan_fab_required():
    plan_id_raw = request.args.get('plan_id')
    filters = {
        'fabric_name': request.args.get('fabric_name', ''),
        'fabric_color': request.args.get('fabric_color', ''),
        'status': request.args.get('status', 'All')
    }
    page = int(request.args.get('page', 1))
    try:
        per_page = int(request.args.get('per_page', 50))
    except (ValueError, TypeError):
        per_page = 50
    all_records = (per_page == -1 or per_page >= 100000)

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        plan_id = resolve_or_get_latest_plan_id(cur, plan_id_raw)
        if not plan_id:
            return jsonify({'success': True, 'rows': [], 'total_count': 0, 'page': page, 'per_page': per_page, 'totals': {'required_fabric_kg': 0, 'available_stock_kg': 0, 'allocated_fabric_kg': 0, 'shortage_kg': 0}})
        data = get_fab_required_data(cur, int(plan_id), filters, page=page, per_page=per_page, all_records=all_records)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching fab required table: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/pool-consumers', methods=['GET'])
@login_required
def api_pending_qty_plan_pool_consumers():
    plan_id = request.args.get('plan_id')
    fabric_name = request.args.get('fabric_name', '').strip()
    fabric_color = request.args.get('fabric_color', '').strip()
    dia = request.args.get('dia', 0.0)
    gsm = request.args.get('gsm')

    if not plan_id or not fabric_name:
        return jsonify({'success': False, 'message': 'plan_id and fabric_name are required.'}), 400

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        gsm_val = int(gsm) if gsm and str(gsm).isdigit() else None
        data = get_fabric_pool_consumers(cur, int(plan_id), fabric_name, fabric_color, float(dia), gsm=gsm_val)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching pool consumers: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/members', methods=['GET'])
@login_required
def api_pending_qty_plan_members():
    plan_id = request.args.get('plan_id')
    common_name = request.args.get('common_name', '').strip()
    color = request.args.get('color', '').strip()
    size = request.args.get('size', '').strip()

    if not plan_id or not common_name:
        return jsonify({'success': False, 'message': 'plan_id and common_name are required.'}), 400

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        data = get_common_production_members(cur, int(plan_id), common_name, color, size)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error fetching common production members: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/update-priority', methods=['POST'])
@login_required
def api_pending_qty_plan_update_priority():
    payload = request.json or {}
    plan_id = payload.get('plan_id')
    line_id = payload.get('line_id')
    priority = payload.get('priority')

    if not plan_id or not line_id or priority is None:
        return jsonify({'success': False, 'message': 'plan_id, line_id, and priority are required.'}), 400

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        username = session.get('username', 'Planner')
        res = update_plan_line_priority(cur, int(plan_id), int(line_id), int(priority), username=username)
        conn.commit()
        return jsonify(res)
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error updating priority: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/manual-allocation', methods=['POST'])
@login_required
def api_pending_qty_plan_manual_allocation():
    payload = request.json or {}
    plan_id = payload.get('plan_id')
    fabric_name = payload.get('fabric_name', '').strip()
    fabric_color = payload.get('fabric_color', '').strip()
    dia = payload.get('dia', 0.0)
    gsm = payload.get('gsm', 0)
    allocations = payload.get('allocations', [])

    if not plan_id or not fabric_name or not allocations:
        return jsonify({'success': False, 'message': 'plan_id, fabric_name, and allocations list are required.'}), 400

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        username = session.get('username', 'Planner')
        res = save_manual_allocation(cur, int(plan_id), fabric_name, fabric_color, float(dia), int(gsm), allocations, username=username)
        if not res.get('success'):
            conn.rollback()
            return jsonify(res), 400
        conn.commit()
        return jsonify(res)
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error saving manual allocation: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/confirm', methods=['POST'])
@login_required
def api_pending_qty_plan_confirm():
    payload = request.json or {}
    plan_id = payload.get('plan_id')
    if not plan_id:
        return jsonify({'success': False, 'message': 'plan_id is required.'}), 400

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        username = session.get('username', 'Planner')
        res = confirm_pending_plan(cur, int(plan_id), username=username)
        conn.commit()
        return jsonify(res)
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error confirming plan: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending-qty-plan/export', methods=['GET'])
@login_required
def api_pending_qty_plan_export():
    from flask import Response
    plan_id = request.args.get('plan_id')
    export_type = request.args.get('tab', 'pending-plan')

    if not plan_id:
        return "plan_id is required.", 400

    filters = {
        'brand': request.args.get('brand', ''),
        'category': request.args.get('category', ''),
        'product_type': request.args.get('product_type', 'All'),
        'common_production_name': request.args.get('common_production_name', ''),
        'product': request.args.get('product', ''),
        'color': request.args.get('color', ''),
        'size': request.args.get('size', ''),
        'fabric_name': request.args.get('fabric_name', ''),
        'fabric_color': request.args.get('fabric_color', ''),
        'status': request.args.get('status', 'All'),
        'search': request.args.get('search', '')
    }

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        csv_data = export_pending_plan_csv(cur, export_type, int(plan_id), filters)
        response = Response(csv_data, mimetype='text/csv')
        filename = f"Pending_Qty_{export_type}_{plan_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        response.headers["Content-Disposition"] = f"attachment; filename={filename}"
        return response
    except Exception as e:
        logger.error(f"Error exporting pending qty csv: {e}", exc_info=True)
        return f"Error exporting CSV: {str(e)}", 500
# =====================================================================
# LEAD DAYS MASTER MODULE (PREPARATION FOR FUTURE BASE STOCK MODULE)
# STRICTLY ISOLATED & 100% READ-ONLY DATABASE ACCESS
# PERSISTENCE VIA config/lead_days_config.json
# =====================================================================
import json
import threading

_lead_days_file_lock = threading.Lock()

def get_lead_days_config_path():
    config_dir = os.path.join(os.path.dirname(__file__), 'config')
    os.makedirs(config_dir, exist_ok=True)
    return os.path.join(config_dir, 'lead_days_config.json')

def load_lead_days_config():
    config_file = get_lead_days_config_path()
    with _lead_days_file_lock:
        if not os.path.exists(config_file):
            return {"fabric": {}, "production": {"standalone": {}, "common_production": {}}}
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    data = {}
                data.setdefault("fabric", {})
                data.setdefault("production", {})
                data["production"].setdefault("standalone", {})
                data["production"].setdefault("common_production", {})
                return data
        except Exception as e:
            logger.error(f"Error reading lead_days_config.json: {e}")
            return {"fabric": {}, "production": {"standalone": {}, "common_production": {}}}

def save_lead_days_config(data):
    config_file = get_lead_days_config_path()
    config_dir = os.path.dirname(config_file)
    temp_file = os.path.join(config_dir, 'lead_days_config.json.tmp')
    with _lead_days_file_lock:
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        os.replace(temp_file, config_file)

def resolve_fabric_lead_days(fabric_id):
    """Concept helper for future Base Stock module (Read-only from JSON)"""
    if fabric_id is None:
        return None
    config = load_lead_days_config()
    return config.get("fabric", {}).get(str(fabric_id))

def resolve_production_lead_days(product_id, cur):
    """Concept helper for future Base Stock module (Read-only from DB + JSON)"""
    if product_id is None:
        return None
    config = load_lead_days_config()
    cur.execute("SELECT common_production_id FROM product_master WHERE id = %s;", (int(product_id),))
    row = cur.fetchone()
    if row and row[0]:
        cp_id = str(row[0])
        return config.get("production", {}).get("common_production", {}).get(cp_id)
    else:
        p_id = str(product_id)
        return config.get("production", {}).get("standalone", {}).get(p_id)

@app.route('/api/masters/lead-days/fabric', methods=['GET'])
@login_required
def api_get_fabric_lead_days():
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                f.id, f.fabric_name, f.gsm, f.uom, f.status,
                COALESCE(ARRAY_AGG(fd.dia ORDER BY fd.dia) FILTER (WHERE fd.dia IS NOT NULL), '{}') as dias
            FROM fabric_master f
            LEFT JOIN fabric_dia_mapping fd ON f.id = fd.fabric_id
            WHERE f.status = 'Active'
            GROUP BY f.id, f.fabric_name, f.gsm, f.uom, f.status
            ORDER BY f.fabric_name ASC;
        """)
        rows = cur.fetchall()
        config = load_lead_days_config()
        fabric_config = config.get("fabric", {})

        result = []
        for r in rows:
            f_id = r[0]
            f_name = r[1]
            gsm = float(r[2]) if r[2] is not None else 0
            uom = r[3] or 'KGS'
            dias_raw = r[5] or []
            dia_list = [float(d) for d in dias_raw]
            lead_days = fabric_config.get(str(f_id))

            result.append({
                'id': f_id,
                'fabric_name': f_name,
                'gsm': gsm,
                'uom': uom,
                'dias': dia_list,
                'lead_days': lead_days
            })
        return jsonify({'success': True, 'fabrics': result})
    except Exception as e:
        logger.error(f"Error fetching fabric lead days: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/lead-days/fabric', methods=['POST'])
@login_required
def api_save_fabric_lead_days():
    payload = request.json or {}
    fabric_id = payload.get('fabric_id')
    lead_days = payload.get('lead_days')

    if fabric_id is None:
        return jsonify({'success': False, 'message': 'fabric_id is required.'}), 400

    if lead_days is not None:
        try:
            val = int(lead_days)
            if val < 0:
                return jsonify({'success': False, 'message': 'Lead Days must be 0 or greater.'}), 400
            lead_days = val
        except (ValueError, TypeError):
            return jsonify({'success': False, 'message': 'Lead Days must be a valid integer.'}), 400

    config = load_lead_days_config()
    str_id = str(fabric_id)
    if lead_days is None:
        config["fabric"].pop(str_id, None)
    else:
        config["fabric"][str_id] = lead_days

    save_lead_days_config(config)
    return jsonify({'success': True, 'message': 'Fabric Lead Days saved successfully.', 'fabric_id': fabric_id, 'lead_days': lead_days})

@app.route('/api/masters/lead-days/production', methods=['GET'])
@login_required
def api_get_production_lead_days():
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # 1. Fetch Stand-Alone Products (where common_production_id IS NULL)
        cur.execute("""
            SELECT 
                p.id, p.product_name, p.product_type, p.production_type,
                b.brand_name, b.brand_code, pd.product_description, pd.description_code
            FROM product_master p
            LEFT JOIN brand_master b ON p.brand_id = b.id
            LEFT JOIN product_description_master pd ON p.product_description_id = pd.id
            WHERE p.status = 'Active' AND p.common_production_id IS NULL
            ORDER BY p.product_name ASC;
        """)
        sa_rows = cur.fetchall()

        # 2. Fetch Common Production Groups with aggregate member count
        cur.execute("""
            SELECT 
                cpm.id, cpm.common_production_name,
                COUNT(p.id) as member_count,
                ARRAY_AGG(p.product_name ORDER BY p.product_name) FILTER (WHERE p.id IS NOT NULL) as member_products
            FROM common_production_master cpm
            LEFT JOIN product_master p ON p.common_production_id = cpm.id AND p.status = 'Active'
            WHERE cpm.status = 'Active'
            GROUP BY cpm.id, cpm.common_production_name
            ORDER BY cpm.common_production_name ASC;
        """)
        cp_rows = cur.fetchall()

        config = load_lead_days_config()
        sa_config = config.get("production", {}).get("standalone", {})
        cp_config = config.get("production", {}).get("common_production", {})

        standalone_list = []
        for r in sa_rows:
            p_id = r[0]
            p_name = r[1]
            p_type = r[2] or 'Standard'
            brand_name = r[4] or '-'
            brand_code = r[5] or ''
            desc_code = r[7] or ''
            code = brand_code or desc_code or f"P{p_id}"
            lead_days = sa_config.get(str(p_id))

            standalone_list.append({
                'type': 'Stand Alone',
                'id': p_id,
                'name': p_name,
                'code': code,
                'brand_name': brand_name,
                'lead_days': lead_days
            })

        common_list = []
        for r in cp_rows:
            cp_id = r[0]
            cp_name = r[1]
            member_count = r[2] or 0
            members = r[3] or []
            lead_days = cp_config.get(str(cp_id))

            common_list.append({
                'type': 'Common Production',
                'id': cp_id,
                'name': cp_name,
                'member_count': member_count,
                'member_products': members,
                'lead_days': lead_days
            })

        return jsonify({
            'success': True,
            'standalone': standalone_list,
            'common_production': common_list
        })
    except Exception as e:
        logger.error(f"Error fetching production lead days: {e}", exc_info=True)
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/masters/lead-days/production', methods=['POST'])
@login_required
def api_save_production_lead_days():
    payload = request.json or {}
    item_type = payload.get('type') # 'standalone' or 'common_production'
    item_id = payload.get('id')
    lead_days = payload.get('lead_days')

    if not item_type or item_id is None:
        return jsonify({'success': False, 'message': 'type and id are required.'}), 400

    if item_type not in ('standalone', 'common_production'):
        return jsonify({'success': False, 'message': 'type must be standalone or common_production.'}), 400

    if lead_days is not None:
        try:
            val = int(lead_days)
            if val < 0:
                return jsonify({'success': False, 'message': 'Lead Days must be 0 or greater.'}), 400
            lead_days = val
        except (ValueError, TypeError):
            return jsonify({'success': False, 'message': 'Lead Days must be a valid integer.'}), 400

    config = load_lead_days_config()
    str_id = str(item_id)
    if lead_days is None:
        config["production"][item_type].pop(str_id, None)
    else:
        config["production"][item_type][str_id] = lead_days

    save_lead_days_config(config)
    return jsonify({'success': True, 'message': 'Production Lead Days saved successfully.', 'type': item_type, 'id': item_id, 'lead_days': lead_days})

# Route to serve the main HTML index page
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/fabric-requirement-detail')
def fabric_requirement_detail():
    return send_from_directory(app.static_folder, 'fabric-detail.html')

# Production Error Handlers
@app.errorhandler(404)
def handle_not_found(e):
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'message': 'API endpoint not found'}), 404
    return send_from_directory(app.static_folder, 'index.html'), 404

@app.errorhandler(400)
def handle_bad_request(e):
    return jsonify({'success': False, 'message': 'Invalid request parameters or payload'}), 400

@app.errorhandler(500)
def handle_internal_server_error(e):
    logger.error(f"Internal Server Error on {request.path}: {e}", exc_info=True)
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'message': 'An internal server error occurred. Please try again later.'}), 500
    return send_from_directory(app.static_folder, 'index.html'), 500

@app.errorhandler(Exception)
def handle_unhandled_exception(e):
    logger.error(f"Unhandled Exception on {request.path}: {e}", exc_info=True)
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'message': 'An unexpected error occurred. Please try again later.'}), 500
    return send_from_directory(app.static_folder, 'index.html'), 500

if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5050))
    debug = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')

    # Initialize connection pool & setup database tables on startup
    init_db_pool()
    setup_database()
    logger.info(f"Starting Srinithi Garment ERP on http://{host}:{port} (debug={debug})...")
    app.run(host=host, port=port, debug=debug, use_reloader=False)
