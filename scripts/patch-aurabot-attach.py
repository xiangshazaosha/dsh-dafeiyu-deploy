"""Version/hash-scoped MIT Aurabot patch. Does not install or modify SnowLuma."""
import argparse
import hashlib
import json
import os
from pathlib import Path

ORIGINAL = '4CEB2DEBC467F42A46A03E4D38104D7233B2EFBF78CEB84FED77374DB230A092'
MARKER = '// dsh-deploy: verified-attach-v2'

def digest(data):
    return hashlib.sha256(data).hexdigest().upper()

def atomic(path, data):
    tmp = path.with_name(path.name + '.deploy-tmp')
    with tmp.open('xb') as f:
        f.write(data)
    os.replace(tmp, path)  # replace inode; do not mutate pnpm shared hardlinks

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--plugin', type=Path, required=True)
    p.add_argument('--backup', type=Path)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--original-backup', type=Path, help='Verified original backup for migrating the previous local guard')
    a = p.parse_args()
    package = json.loads((a.plugin / 'package.json').read_text('utf-8-sig'))
    if package['name'] != 'dsh-aurabot-qq' or package['version'] != '1.1.24':
        raise SystemExit('Unsupported plugin version; inspect and adapt first')
    manager = a.plugin / 'src/snowluma/manager.js'
    source = manager.read_bytes()
    text = source.decode('utf-8')
    helper = Path(__file__).resolve().parent.parent / 'assets/qq-attach-guard.mjs'
    dest = manager.with_name('attach-guard.mjs')
    if MARKER in text:
        if not dest.exists() or dest.read_bytes() != helper.read_bytes():
            raise SystemExit('Patched helper differs; refuse overwrite')
        print('Already patched; no changes')
        return
    migrating = '// dsh-deploy: verified-attach-v1' in text
    if migrating:
        if not a.original_backup:
            raise SystemExit('Previous guard requires --original-backup for verified migration')
        original = (a.original_backup / 'manager.original.js').read_bytes()
        manifest = json.loads((a.original_backup / 'manifest.json').read_text('utf-8'))
        if digest(original) != ORIGINAL or digest(source) != manifest['patched_sha256']:
            raise SystemExit('Previous guard backup/hash mismatch')
        if not dest.exists() or dest.read_bytes() != helper.read_bytes():
            raise SystemExit('Previous helper differs; refuse overwrite')
        text = original.decode('utf-8')
    elif digest(source) != ORIGINAL:
        raise SystemExit('Source hash differs; refuse blind patch')
    start = text.index('    if (unverified) pendingVerify =')
    end = text.index('    return lastAttach\n  }', start)
    text = text[:start] + '''    lastAttach = await verifiedAttach(proc, bot, unverified)
    if (!lastAttach.ok && !lastAttach.pending) rejected.add(Number(proc.pid))
    log.info(lastAttach.message)
''' + text[end:]
    text = "import { createAttachVerifier } from './attach-guard.mjs'\n" + MARKER + '\n' + text
    needle = '  const base = () => `http://127.0.0.1:${cfg().webuiPort}`\n'
    if text.count(needle) != 1:
        raise SystemExit('Unexpected manager layout')
    text = text.replace(needle, needle + '''  const verifiedAttach = createAttachVerifier({
    api,
    alive: (pid) => { try { process.kill(pid, 0); return true } catch { return false } },
  })
''')
    print('Compatible source verified; patch guards unknown identities and asynchronous false success; no SnowLuma version pin or denylist')
    if not a.apply:
        print('Check only; no changes')
        return
    if not a.backup or not a.backup.is_absolute():
        raise SystemExit('--apply requires absolute --backup directory')
    if dest.exists() and not migrating:
        raise SystemExit('Unexpected existing helper; refuse overwrite')
    a.backup.mkdir(parents=True, exist_ok=False)
    (a.backup / 'manager.original.js').write_bytes(source)
    (a.backup / 'manifest.json').write_text(json.dumps({'original_sha256': digest(source), 'patched_sha256': digest(text.encode()), 'manager': str(manager)}, indent=2), encoding='utf-8')
    if not migrating:
        atomic(dest, helper.read_bytes())
    atomic(manager, text.encode('utf-8'))
    print('Applied; restart/reload the affected plugin only when it will not interrupt user tasks')

if __name__ == '__main__':
    main()
