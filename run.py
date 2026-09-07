import os
import sys
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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

from app import app, init_db_pool, setup_database

# Initialize connection pool & setup database tables on startup
init_db_pool()
setup_database()

if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 5050))
    debug = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')

    logging.info(f"Starting Srinithi Garment ERP on http://{host}:{port} (debug={debug})...")
    app.run(host=host, port=port, debug=debug, use_reloader=False)
