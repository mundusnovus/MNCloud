#!/usr/bin/env python3
# Shows why a desktop build failed as two public notes on the run: the real error lines, and the end of the log
# (the build scripts print each command, so the end shows which one failed). Usage: why-failed.py TITLE LOG
import re, sys

title, path = sys.argv[1], sys.argv[2]
lines = [l.rstrip() for l in open(path, errors='replace')]
real = re.compile(r'(error:|error [A-Z]+\d+|CMake Error|FAILED:|fatal|No such file|not found|cannot |undefined reference|Traceback|exit code|returned \d)', re.I)
noise = re.compile(r'(-- Generate |state-error|error\.(png|svg)|-Werror|errors?\.(cpp|h|o)\b)', re.I)
found = [l for l in lines if real.search(l) and not noise.search(l) and len(l) < 500]
tail = [l for l in lines[-60:] if not noise.search(l)][-40:]

def note(name, part):
    text = '\n'.join(part)[-3500:] or '(nothing)'
    print('::error title=' + title + ' ' + name + '::' + text.replace('%', '%25').replace('\r', '').replace('\n', '%0A'))

note('errors', found[:30])
note('end of log', tail)
