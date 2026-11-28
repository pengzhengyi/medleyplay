#!/bin/sh
set -eu

if [ "$(uname -s)" != Darwin ] || [ "$#" -ne 1 ]; then
    printf 'Usage on macOS: sh tools/macos/share/build.sh /path/to/Medleyplay\\ Share.app\n' >&2
    exit 2
fi

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bundle=$1
case "$bundle" in
    /*.app) ;;
    *) printf 'Give an absolute path ending in .app.\n' >&2; exit 2 ;;
esac
mkdir -- "$bundle"
cleanup() {
    rm -f -- "$bundle/Contents/MacOS/medleyplay-share" "$bundle/Contents/Info.plist" \
        "$bundle/Contents/_CodeSignature/CodeResources"
    rmdir -- "$bundle/Contents/_CodeSignature" "$bundle/Contents/MacOS" \
        "$bundle/Contents" "$bundle" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p -- "$bundle/Contents/MacOS"
cp -- "$source_dir/Info.plist" "$bundle/Contents/Info.plist"
CGO_ENABLED=0 GOTOOLCHAIN=local GOWORK=off GOPROXY=off go build -trimpath \
    -o "$bundle/Contents/MacOS/medleyplay-share" "$source_dir/main.go"
/usr/bin/codesign --sign - "$bundle"
/usr/bin/codesign --verify --strict "$bundle"
trap - EXIT
printf '%s\n' "$bundle"
