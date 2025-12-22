import http.server
import socketserver
import os
import re

PORT = 8000

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Redirect /dashboard/1, /dashboard/2, etc. to index.html
        if re.match(r'^/dashboard/\d+$', self.path):
            self.path = '/index.html'
        # Serve static files from /dashboard/* from root instead
        elif self.path.startswith('/dashboard/'):
            self.path = self.path.replace('/dashboard/', '/', 1)
        return super().do_GET()

os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
    print(f"Server running at http://localhost:{PORT}")
    httpd.serve_forever()
