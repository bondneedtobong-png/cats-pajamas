"""Run an isolated nginx against the candidate and build; does not reload live nginx.
Usage (Linux): python3 ops/test_nginx_404.py candidate.conf /absolute/build/dist
"""
import pathlib, tempfile, subprocess, socket, urllib.request, urllib.error, sys, time
candidate = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')
build = pathlib.Path(sys.argv[2]).resolve()
assert (build / '404.html').is_file()
with tempfile.TemporaryDirectory(prefix='cats-nginx-404-') as tmp:
    root = pathlib.Path(tmp)
    root.chmod(0o755)  # nginx workers must read isolated fixture directories.
    (root / 'game').mkdir(); (root / 'events').mkdir()
    (root / 'game/index.html').write_text('isolated-game-fixture')
    (root / 'events/photo.jpg').write_bytes(b'isolated-event-fixture')
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
    server = candidate.split('    listen 443 ssl;', 1)[0] + '\n}\n'
    assert server.count('server {') == 1
    server = server.replace('/opt/cats-pajamas-club/dist_current', str(build))
    server = server.replace('/opt/bartender-sim/dist/', str(root / 'game') + '/')
    server = server.replace('/opt/cats-pajamas-uploads/events/', str(root / 'events') + '/')
    server = server.replace('server {', f'server {{\n listen 127.0.0.1:{port};', 1)
    conf = root / 'nginx.conf'
    conf.write_text(f'pid {root}/nginx.pid;\nerror_log {root}/error.log;\nevents {{}}\nhttp {{\n include /etc/nginx/mime.types;\n access_log off;\n{server}\n}}')
    subprocess.run(['nginx', '-t', '-c', str(conf), '-p', tmp], check=True)
    process = subprocess.Popen(['nginx', '-c', str(conf), '-p', tmp, '-g', 'daemon off;'])
    def request(path):
        try:
            response = urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=5)
        except urllib.error.HTTPError as error: response = error
        with response: return response.status, response.read(), response.headers
    try:
        for attempt in range(50):
            try: request('/'); break
            except OSError: time.sleep(.1)
        for path in ['/', '/menu/', '/booking', '/booking/', '/auth', '/profile', '/app', '/admin', '/booking-rules', '/privacy']:
            status, body, headers = request(path); assert status == 200, (path, status)
            assert b'<div id="root"' in body
        for path in ['/not-a-page', '/booking/deeper', '/assets/absent.js', '/uploads/absent.jpg', '/fonts/absent.woff2', '/404.html']:
            status, body, headers = request(path); assert status == 404, (path, status)
            assert b'noindex, nofollow' in body and b'404' in body, path
        for path in ['/game/', '/uploads/events/photo.jpg']:
            assert request(path)[0] == 200, path
        asset = next((build / 'assets').glob('*.js'))
        status, body, headers = request('/assets/' + asset.name)
        assert status == 200 and 'javascript' in headers['Content-Type']
        assert b'seo-home' in request('/')[1]
        assert 'Барная карта'.encode() in request('/menu/')[1]
        print('PASS isolated nginx: known routes, prerenders, missing routes/assets 404, game/uploads aliases, JavaScript MIME')
    finally:
        process.terminate(); process.wait(timeout=10)
