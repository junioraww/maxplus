import os
import time
import subprocess
from PIL import Image

DISPLAY = ":99"
os.environ["DISPLAY"] = DISPLAY
artifact_dir = "/home/fox/.gemini/antigravity/brain/e2115b80-67e6-4630-a2f8-4c021c09c371"

def run(cmd):
    return subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)

win_out = run("xdotool search --onlyvisible --class maxplus").stdout.strip().split("\n")
WINDOW_ID = win_out[-1]
print(f"Using Window ID: {WINDOW_ID}")

# 1. Test Narrow (450x768)
print("=== Testing Narrow (450x768) ===")
run(f"xdotool windowsize {WINDOW_ID} 450 768")
time.sleep(1.0)
# Click chat in sidebar (at 150, 340)
run("xdotool mousemove 150 340 click 1")
time.sleep(1.0)

# Focus chat scroll area (at 250, 400)
run("xdotool mousemove 250 400 click 1")
time.sleep(0.2)

# Scroll up and down
for _ in range(30):
    run("xdotool click 4")
    time.sleep(0.016)
time.sleep(0.3)
for _ in range(30):
    run("xdotool click 5")
    time.sleep(0.016)
time.sleep(0.6)

run(f"import -window {WINDOW_ID} {artifact_dir}/hud_narrow.png")
print("Saved hud_narrow.png")

# 2. Test Wide (1250x768)
print("=== Testing Wide (1250x768) ===")
run(f"xdotool windowsize {WINDOW_ID} 1250 768")
time.sleep(1.0)

# Focus chat scroll area (at 750, 400)
run("xdotool mousemove 750 400 click 1")
time.sleep(0.2)

# Scroll up and down
for _ in range(30):
    run("xdotool click 4")
    time.sleep(0.016)
time.sleep(0.3)
for _ in range(30):
    run("xdotool click 5")
    time.sleep(0.016)
time.sleep(0.6)

run(f"import -window {WINDOW_ID} {artifact_dir}/hud_wide.png")
print("Saved hud_wide.png")
