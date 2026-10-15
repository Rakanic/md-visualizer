#!/bin/bash
# Build mdviz.app, a native macOS app (Swift + WebKit) with the mdviz UI bundled inside. It needs no
# browser and no Node, and keeps working if this folder moves.
#   macos/build-app.sh            -> macos/build/mdviz.app
#   macos/build-app.sh --install  -> also installs it as ~/Applications/mdviz.app
# Requires the Xcode command line tools (swiftc, iconutil): xcode-select --install
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
BUILD="$HERE/build"
APP="$BUILD/mdviz.app"
VERSION="1.0"

rm -rf "$APP" "$BUILD/AppIcon.iconset"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "compiling…"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos12.0" -framework Cocoa -framework WebKit \
  "$HERE/MDViz.swift" -o "$APP/Contents/MacOS/mdviz"
swiftc -O -swift-version 5 -framework Cocoa "$HERE/make-icon.swift" -o "$BUILD/make-icon"
"$BUILD/make-icon" "$BUILD/AppIcon.iconset"
iconutil -c icns "$BUILD/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"

cp -R "$ROOT/app" "$APP/Contents/Resources/app"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>mdviz</string>
  <key>CFBundleDisplayName</key><string>mdviz</string>
  <key>CFBundleIdentifier</key><string>local.mdviz.app</string>
  <key>CFBundleExecutable</key><string>mdviz</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Turn long markdown into diagrams, slides and PDFs.</string>
  <key>CFBundleDocumentTypes</key><array>
    <dict>
      <key>CFBundleTypeName</key><string>Markdown document</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string><string>public.plain-text</string></array>
      <key>CFBundleTypeExtensions</key><array><string>md</string><string>markdown</string><string>mdx</string></array>
    </dict>
    <dict>
      <key>CFBundleTypeName</key><string>Folder</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>None</string>
      <key>LSItemContentTypes</key><array><string>public.folder</string></array>
    </dict>
  </array>
</dict></plist>
EOF

codesign --force --deep --sign - "$APP" >/dev/null 2>&1
echo "built $APP"

if [ "${1:-}" = "--install" ]; then
  DEST="$HOME/Applications/mdviz.app"
  mkdir -p "$HOME/Applications"
  osascript -e 'tell application id "local.mdviz.app" to quit' >/dev/null 2>&1 || true
  rm -rf "$DEST"
  cp -R "$APP" "$DEST"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST" || true
  echo "installed $DEST"
fi
