import http.server
import socketserver
import os
import re
import json
import configparser
import urllib.request
import urllib.parse
from datetime import datetime
import threading

PORT = 8000
CONFIG_FILE = 'config.ini'
RECORDINGS_DIR = 'recordings'

if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)

# Booth to port mapping (must match script.js)
BOOTH_PORTS = {
    1: 5000,
    2: 5005,
    3: 5010
}

def record_stream(booth_id, duration=10):
    port = BOOTH_PORTS.get(booth_id)
    if not port: return
    
    url = f"http://localhost:{port}/video_feed"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(RECORDINGS_DIR, f"booth_{booth_id}_{timestamp}.raw")
    
    try:
        print(f"Starting recording for booth {booth_id} to {filename}")
        with urllib.request.urlopen(url) as response, open(filename, 'wb') as f:
            start_time = datetime.now()
            while (datetime.now() - start_time).seconds < duration:
                chunk = response.read(1024 * 16)
                if not chunk: break
                f.write(chunk)
        print(f"Finished recording for booth {booth_id}")
    except Exception as e:
        print(f"Recording error: {e}")

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_path.query)
        path = parsed_path.path

        # API: Get current config for a specific booth
        if path == '/config':
            booth_id = query.get('booth', ['1'])[0]
            section = f'booth_{booth_id}'
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            config = configparser.ConfigParser()
            config.read(CONFIG_FILE)
            
            res = {}
            if section in config:
                for key in config[section]:
                    res[key] = [float(x.strip()) for x in config[section][key].split(',')]
            
            self.wfile.write(json.dumps(res).encode())
            return

        # API: Record raw stream
        if path == '/rec_raw':
            booth_id = int(query.get('booth', ['1'])[0])
            # Run recording in a separate thread to not block the server
            thread = threading.Thread(target=record_stream, args=(booth_id,))
            thread.start()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'recording_started', 'booth': booth_id}).encode())
            return

        # Redirect /adjust_vid to adjust.html
        if path == '/adjust_vid':
            self.path = '/adjust.html'
            return super().do_GET()

        # Redirect /dashboard/1, /dashboard/2, etc. to index.html
        if re.match(r'^/dashboard/\d+$', path):
            self.path = '/index.html'
            return super().do_GET()
            
        # Map /dashboard/assets back to /assets (e.g., /dashboard/styles.css -> /styles.css)
        if path.startswith('/dashboard/'):
            self.path = path.replace('/dashboard/', '/', 1)
            return super().do_GET()
            
        # Serve static files normally
        return super().do_GET()

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_path.query)
        path = parsed_path.path

        if path == '/save_config':
            booth_id = query.get('booth', ['1'])[0]
            section = f'booth_{booth_id}'
            
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            config = configparser.ConfigParser()
            config.read(CONFIG_FILE)
            
            if section not in config:
                config.add_section(section)
                
            for key, coords in data.items():
                config[section][key] = ','.join(map(str, coords))
                
            with open(CONFIG_FILE, 'w') as f:
                config.write(f)
                
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'success', 'booth': booth_id}).encode())
            return

os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
    print(f"Server running at http://localhost:{PORT}")
    httpd.serve_forever()
