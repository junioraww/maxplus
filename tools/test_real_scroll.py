import os
import time
import subprocess
import json
import http.server
import socketserver
import threading

DISPLAY = ":99"
WINDOW_ID = "2097156"
os.environ["DISPLAY"] = DISPLAY

perf_reports = []

class PerfHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('content-length', 0))
        data = self.rfile.read(length)
        parsed = json.loads(data.decode())
        perf_reports.append(parsed)
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'ok')
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.end_headers()
    def log_message(self, format, *args):
        pass

server = socketserver.TCPServer(('127.0.0.1', 9876), PerfHandler)
t = threading.Thread(target=server.serve_forever, daemon=True)
t.start()

def run_cmd(cmd):
    subprocess.run(cmd, shell=True, check=True)

print("[1] Reloading webview to apply FPS probe...")
run_cmd(f"xdotool key --window {WINDOW_ID} ctrl+r")
time.sleep(2.5)

print("[2] Opening chat in sidebar at (150, 340)...")
run_cmd("xdotool mousemove 150 340 click 1")
time.sleep(1.0)

print("[3] Taking before-scroll screenshot...")
artifact_dir = "/home/fox/.gemini/antigravity/brain/e2115b80-67e6-4630-a2f8-4c021c09c371"
run_cmd(f"import -window {WINDOW_ID} {artifact_dir}/tauri_real_chat_before.png")

print("[4] Focusing chat container at (650, 400)...")
run_cmd("xdotool mousemove 650 400 click 1")
time.sleep(0.2)

print("[5] Simulating realistic desktop mouse wheel scroll up (40 ticks)...")
for i in range(40):
    run_cmd("xdotool click 4")
    time.sleep(0.02)
time.sleep(0.5)

print("[6] Simulating realistic desktop mouse wheel scroll down (40 ticks)...")
for i in range(40):
    run_cmd("xdotool click 5")
    time.sleep(0.02)
time.sleep(0.5)

run_cmd(f"import -window {WINDOW_ID} {artifact_dir}/tauri_real_chat_after_wheel.png")

print("[7] Simulating Android touch fling momentum drag...")
run_cmd("xdotool mousemove 650 550")
time.sleep(0.05)
run_cmd("xdotool mousedown 1")
time.sleep(0.02)

current_y = 550
target_y = 180
step = 18
while current_y > target_y:
    current_y -= step
    run_cmd(f"xdotool mousemove 650 {current_y}")
    time.sleep(0.016)

run_cmd("xdotool mouseup 1")
time.sleep(0.6)

run_cmd(f"import -window {WINDOW_ID} {artifact_dir}/tauri_real_chat_after_fling.png")

time.sleep(0.5)
print("PERF REPORTS COLLECTED:", json.dumps(perf_reports, indent=2))
server.shutdown()
