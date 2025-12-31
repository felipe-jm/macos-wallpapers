#!/bin/bash

WALLPAPER_DIR="$HOME/Pictures/Wallpapers"

# Pick a random image from the folder
IMAGE=$(find "$WALLPAPER_DIR" -type f \( -iname "*.jpg" -o -iname "*.png" -o -iname "*.jpeg" \) | sort -R | head -n 1)

# Set wallpaper using AppleScript
osascript <<EOF
tell application "System Events"
    set picture of every desktop to "$IMAGE"
end tell
EOF
