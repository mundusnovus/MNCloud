#!/bin/sh
# Brands a checkout of nextcloud/desktop as MNCloud: names, vendor, the fixed server address, colours and
# icons. Used by .github/workflows/desktop.yml. Nextcloud desktop: GPL-2.0-or-later; this file: Mundus Novus
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
sub APPLICATION_NAME "MNCloud"
sub APPLICATION_SHORTNAME "MNCloud"
sub APPLICATION_EXECUTABLE "mncloud"
sub APPLICATION_DOMAIN "mundusnovus.org"
sub APPLICATION_VENDOR "Mundus Novus"
# never empty: the build drops empty values and theme.cpp then fails to compile (the updater itself is off)
sub APPLICATION_UPDATE_URL "https://mundusnovus.org/downloads/"
sub APPLICATION_SERVER_URL "https://cloud.mundusnovus.org"
sub APPLICATION_REV_DOMAIN "org.mundusnovus.cloud"
sub APPLICATION_REV_DOMAIN_DBUS "cloud.mundusnovus.org"
sub APPLICATION_VIRTUALFILE_SUFFIX "mncloud"
sub LINUX_PACKAGE_SHORTNAME "mncloud"
sub NEXTCLOUD_BACKGROUND_COLOR "#17449a"
# icons: the name the build looks for on each platform
for name in MNCloud org.mundusnovus.cloud.mncloud; do
  cp "$ICON" "$SRC/theme/colored/$name-icon.svg"
  cp "$ICON" "$SRC/theme/colored/$name-sidebar-icon.svg" 2>/dev/null || true
done
echo "branded $SRC as MNCloud"
