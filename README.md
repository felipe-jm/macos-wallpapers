# MacOS Wallpapers

A simple script to change my wallpapers every 5 minutes.

```
# changes wallpaper every 5 minutes
*/5 * * * * change_wallpaper.sh
```

## Animated ASCII wallpapers

`ascii-wallpaper/` is a menu-bar app that plays the [ascii.rest](https://ascii.rest) scenes
(alpine dawn, kyoto dusk, tokyo rain, …) live as the desktop background on every display.
The scenes in `ascii-wallpaper/scenes/` are reworked from ascii.rest's 200×100 originals (MIT) to
320×180 cells (16:9, 6 px a dot on a 1920×1080 screen) with more realistic lighting. Each cell is a
true-colour halftone dot whose size follows its brightness, drawn with WebGL (`web/render.js`) with a
soft bloom around bright lights.

```
cd ascii-wallpaper && ./build.sh install   # needs Node/npm and Xcode command line tools
```

Installs `~/Applications/ASCII Wallpaper.app` and launches it. The dotted-grid icon in the menu bar
picks a scene, skips to the next one, rotates automatically (5 min to 1 h) and toggles opening at login.
Scenes fill the screen (exactly on 16:9; slightly cropped on other shapes); the static wallpaper (and `change_wallpaper.sh`) stays hidden underneath while the app runs.


