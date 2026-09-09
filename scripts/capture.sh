#!/bin/sh
# Screenshots docs/media/frames/*.html with Chrome: the window at 2x, the
# side bar and status bar close-ups cut from it, and the story as a GIF.
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd "$(dirname "$0")/.."
node scripts/showcase.mjs
M=docs/media
F=$M/frames
shot() { "$CHROME" --headless=new --hide-scrollbars --disable-gpu --force-device-scale-factor="$3" --window-size=1600,1000 --screenshot="$PWD/$2" "file://$PWD/$1" >/dev/null 2>&1; }

shot $F/hero.html $M/window.png 2
# Close-ups, in 2x pixels: the side bar with the tree, the status bar with the item, the toast.
magick $M/window.png -crop 816x560+0+72 +repage $M/sessions.png
magick $M/window.png -crop 1200x44+0+1956 +repage $M/statusbar.png
magick $M/window.png -crop 870x190+2300+1736 +repage $M/toast.png
magick $M/window.png -resize 1600x1000 $M/window.png

shot $F/quickpick.html $M/quickpick@2x.png 2
magick $M/quickpick@2x.png -crop 1400x720+900+40 +repage $M/quickpick.png
rm -f $M/quickpick@2x.png

for i in 0 1 2 3 4 5; do shot $F/story-$i.html $F/story-$i.png 1; done
magick -delay 140 -loop 0 $F/story-*.png -layers Optimize $M/story.gif
rm -rf $F
ls -la $M
