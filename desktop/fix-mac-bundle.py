#!/usr/bin/env python3
# Makes a built Christian Cloud.app self-contained. mac-crafter only fixes the links of libraries it recognises by
# Nextcloud's own names, so with our names the sync libraries stay in Contents/MacOS and they, and the command-line
# tool, still point at folders on the build machine; the app then quits at launch. This moves every library into
# Contents/Frameworks, points every link that leaves the bundle at Frameworks, and drops build-machine search paths.
# Run before signing. Usage: fix-mac-bundle.py "Christian Cloud.app"
import os, shutil, subprocess, sys

app = sys.argv[1]
macos, frameworks, plugins = (os.path.join(app, 'Contents', d) for d in ('MacOS', 'Frameworks', 'PlugIns'))
os.makedirs(frameworks, exist_ok=True)

for name in os.listdir(macos):
    if name.endswith('.dylib'):
        shutil.move(os.path.join(macos, name), os.path.join(frameworks, name))

def macho(path):
    if os.path.islink(path) or not os.path.isfile(path): return False
    with open(path, 'rb') as f: magic = f.read(4)
    return magic in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe')

def out(*cmd): return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
def tool(*cmd): subprocess.run(['install_name_tool', *cmd], capture_output=True, text=True, check=True)

inside = lambda p: p.startswith(('@', '/System/', '/usr/lib/'))
present = set(os.listdir(frameworks))
fixed = 0
for root, _, files in os.walk(app):
    for f in files:
        path = os.path.join(root, f)
        if not macho(path): continue
        lines = out('otool', '-L', path).splitlines()[1:]
        own = out('otool', '-D', path).splitlines()[1:]
        for line in lines:
            dep = line.strip().split(' (')[0]
            if inside(dep) or dep in own: continue
            base = os.path.basename(dep)
            if base not in present: sys.exit('%s needs %s, which is not in the app' % (path, dep))
            tool('-change', dep, '@executable_path/../Frameworks/' + base, path); fixed += 1
        if own and not inside(own[0].strip()):
            tool('-id', '@rpath/' + os.path.basename(own[0].strip()), path)
        rpaths, take = [], False
        for l in out('otool', '-l', path).splitlines():
            l = l.strip()
            if l == 'cmd LC_RPATH': take = True
            elif take and l.startswith('path '): rpaths.append(l.split(' ')[1]); take = False
        for r in rpaths:
            if not inside(r): tool('-delete_rpath', r, path)
        if root == macos and '@executable_path/../Frameworks' not in rpaths:
            tool('-add_rpath', '@executable_path/../Frameworks', path)
print('fixed %d links in %s' % (fixed, app))
