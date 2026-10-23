"""Exercise the static UI: python verify.py [base_url]."""
import http.server
import json
import os
import pathlib
import shutil
import sys
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent


def verify(base_url):
    checks = []
    with sync_playwright() as p:
        options = dict(headless=True, args=['--no-sandbox'])
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        if executable:
            options['executable_path'] = executable
        browser = p.chromium.launch(**options)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            errors, outbound = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: outbound.append(r.url) if r.method == 'POST' or urlsplit(r.url).netloc != urlsplit(base_url).netloc else None)
            page.goto(base_url)
            page.wait_for_selector('.finding')
            outbound.clear()
            assert page.locator('.finding[data-kind="ignored"]').count() == 4
            assert page.locator('.finding[data-kind="blocked"]').count() == 0
            checks.append('Default example distinguishes four ignored fields from rejected settings')

            for name, code in [('integer', '15000.0'), ('stops', 'Custom stops'), ('tools', 'Forced tool calls')]:
                page.locator('#preset').select_option(name)
                page.locator('#load').click()
                assert code in page.locator('#findings').inner_text()
            checks.append('Integer, grammar/stop and forced-tool examples show the relevant rejection')

            raw = '{"model":"flint","messages":[{"role":"user","content":{"value":9007199254740993}}],"seed":18446744073709551615,"temperature":1.0,"max_tokens":1,"ignored":{"x":3}}'
            page.locator('#request').fill(raw)
            page.locator('#review').click()
            context.grant_permissions(['clipboard-read', 'clipboard-write'])
            page.locator('#copy').click()
            copied = page.evaluate('() => navigator.clipboard.readText()')
            assert '18446744073709551615' in copied and '9007199254740993' in copied and '1.0' in copied
            assert '"ignored"' not in copied
            checks.append('Clipboard preserves large integers and number spellings while dropping only unsupported fields')

            page.evaluate("() => Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(Error('denied'))},configurable:true})")
            page.locator('#copy').click()
            page.wait_for_selector('#filtered:visible')
            assert page.locator('#filtered').input_value() == copied
            checks.append('Clipboard denial reveals an exact selectable copy fallback')

            request = {'model': 'flint', 'messages': [{'role': 'user'}], 'max_tokens': 256, 'stop': ['END']}
            page.locator('#request').fill(json.dumps(request))
            page.locator('#review').click()
            assert page.locator('.finding[data-kind="blocked"]').count() == 1
            page.get_by_text('Server version and review rules', exact=True).click()
            page.locator('#grammar-default').select_option('none')
            assert page.locator('.finding[data-kind="blocked"]').count() == 0
            checks.append('Server default grammar matters only when the request omits its own grammar')

            page.locator('#request').fill('{')
            page.locator('#review').click()
            assert page.locator('#copy').is_disabled()
            assert page.locator('#summary').inner_text() == 'Check JSON'
            checks.append('Malformed JSON disables the copy action')

            page.locator('#request').fill('{"model":"flint","messages":[{"role":"user"}],"max_tokens":15000.0}')
            page.wait_for_function("() => document.getElementById('findings').textContent.includes('15000.0')")
            assert page.locator('.finding[data-kind="blocked"]').count() == 1
            checks.append('Editing the request refreshes the previous verdict without another click')

            hostile = {**request, '<img src=x onerror="window.injected=true">': 1}
            page.locator('#request').fill(json.dumps(hostile))
            page.locator('#review').click()
            assert page.locator('img').count() == 0
            assert page.evaluate('() => window.injected') is None
            assert not errors and not outbound
            checks.append('Field names render as text and local review makes no outbound requests')

            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            checks.append('Phone layout has no horizontal page overflow')
        finally:
            browser.close()
    print(json.dumps({'passed': len(checks), 'checks': checks}, indent=2))


if __name__ == '__main__':
    if len(sys.argv) > 1:
        verify(sys.argv[1].rstrip('/') + '/')
    else:
        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=str(ROOT), **kw)
            def log_message(self, *_a):
                pass
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                verify('http://127.0.0.1:' + str(server.server_port) + '/')
            finally:
                server.shutdown()
