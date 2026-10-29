#!/bin/sh
# Brands a checkout of nextcloud/desktop as Christian Cloud: names, vendor, the fixed server address, colours and
# icons. Used by .github/workflows/desktop.yml. Nextcloud desktop: GPL-2.0-or-later; this file: Christian Systems
# License 1.0 (GPL-3.0-only), compatible with it.
set -eu
SRC="$1"; HERE=$(cd "$(dirname "$0")" && pwd); ICON="$HERE/../brand/icons/cloud-icon.svg"
f="$SRC/NEXTCLOUD.cmake"
[ -f "$f" ] || { echo "no NEXTCLOUD.cmake in $SRC" >&2; exit 1; }
sub() { python3 - "$f" "$1" "$2" <<'PY'
import re, sys
p, key, val = sys.argv[1:]
s = open(p).read()
s2, n = re.subn(r'(set\(\s*%s\s+)"[^"]*"' % re.escape(key), lambda m: m.group(1) + '"' + val + '"', s)
if n == 0: sys.exit("missing %s in NEXTCLOUD.cmake" % key)
open(p, "w").write(s2)
PY
}
sub APPLICATION_NAME "Christian Cloud"
sub APPLICATION_SHORTNAME "ChristianCloud"
sub APPLICATION_EXECUTABLE "christiancloud"
sub APPLICATION_DOMAIN "christiansystems.org"
sub APPLICATION_VENDOR "Christian Systems"
sub APPLICATION_UPDATE_URL ""
sub APPLICATION_SERVER_URL "https://cloud.christiansystems.org"
sub APPLICATION_REV_DOMAIN "org.christiansystems.cloud"
sub APPLICATION_REV_DOMAIN_DBUS "cloud.christiansystems.org"
sub APPLICATION_VIRTUALFILE_SUFFIX "christiancloud"
sub LINUX_PACKAGE_SHORTNAME "christiancloud"
sub NEXTCLOUD_BACKGROUND_COLOR "#a8151b"
# icons: the name the build looks for on each platform
for name in ChristianCloud org.christiansystems.cloud.christiancloud; do
  cp "$ICON" "$SRC/theme/colored/$name-icon.svg"
  cp "$ICON" "$SRC/theme/colored/$name-sidebar-icon.svg" 2>/dev/null || true
done
echo "branded $SRC as Christian Cloud"
