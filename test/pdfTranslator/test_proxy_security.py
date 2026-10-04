import http.client
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'addon/scripts'))
from aidea_bridge import OAuthCompatProxyServer, _rewrite_openai_base_url

class ProxySecurity(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.proxy = OAuthCompatProxyServer({'provider':'openai-compatible','apiKey':'fake-test-key'})
        self.proxy.handle_chat_completion = lambda payload: self.calls.append(payload) or 'mock'
        self.proxy.start()
    def tearDown(self):
        self.proxy.stop()
    def request(self, headers=None, body=None):
        values={'Host':f'127.0.0.1:{self.proxy.port}','Authorization':f'Bearer {self.proxy.token}','Content-Type':'application/json'}
        values.update(headers or {})
        conn = http.client.HTTPConnection('127.0.0.1', self.proxy.port,timeout=3)
        conn.request('POST','/v1/chat/completions',body=body or json.dumps({'model':'test','messages':[]}),headers=values)
        response=conn.getresponse();response.read();conn.close();return response.status
    def test_invalid_callers_never_use_credentials(self):
        for headers,status in [({'Authorization':''},401),({'Authorization':'Bearer invalid'},401),({'Host':'evil.test'},403),({'Origin':'https://evil.test'},403),({'Content-Type':'text/plain'},415),({'Content-Length':str(4*1024*1024+1)},413)]:
            self.assertEqual(self.request(headers),status)
        self.assertEqual(self.calls,[])
    def test_valid_authenticated_client(self):
        self.assertEqual(self.request(),200)
        self.assertEqual(len(self.calls),1)
    def test_proxy_key_is_written_to_client_config(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'config.toml';path.write_text('openai_compatible_base_url = "https://example.test"\nopenai_compatible_api_key = "placeholder"\n')
            _rewrite_openai_base_url(path,self.proxy.base_url,self.proxy.token)
            self.assertIn(json.dumps(self.proxy.token),path.read_text())
            self.assertNotIn('fake-test-key',path.read_text())
if __name__ == '__main__': unittest.main()
