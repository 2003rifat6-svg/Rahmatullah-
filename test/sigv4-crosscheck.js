// S3 সই (SigV4) AWS-এর নিজের লাইব্রেরি botocore-এর সাথে মিলিয়ে দেখা: ৬৪টি অনুরোধ (হেডার সই ও সই করা লিংক),
// বাংলা/স্পেস/বিশেষ চিহ্নওয়ালা ফাইলনাম সহ। চালাতে Python-এ botocore লাগে:
//   python3 -m venv .venv && .venv/bin/pip install botocore && PYTHON=.venv/bin/python npm run test:sigv4
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { signRequest, presignUrl, sha256 } = require('../lib/sigv4');

const py = process.env.PYTHON || 'python3';
try { execFileSync(py, ['-I', '-c', 'import botocore']); } catch { console.log('— botocore নেই, SigV4 তুলনা বাদ (PYTHON=... দিয়ে botocore থাকা Python দেখাও)'); process.exit(0); }

const keys = ['a.png', 'uid123/abc.mp4', 'voices/Kore.wav', 'folder with space/ফাইল.jpg', 'x/y+z=1&q.txt', 'deep/a/b/c/d.webp', 'tilde~dash-und_er.bin', '(paren)!star*.png'];
const cases = [];
let i = 0;
for (const key of keys) {
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    const body = method === 'PUT' ? Buffer.from(`payload-${i++}-বাংলা`) : Buffer.alloc(0);
    const url = 'http://s3.example-region.amazonaws.com:9000/my-bucket/' + key.split('/').map(encodeURIComponent).join('/');
    const date = new Date(Date.UTC(2026, 10, 21, 5, i % 60, 7));
    const headers = method === 'PUT' ? { 'content-type': 'image/png' } : method === 'GET' ? { range: 'bytes=0-99' } : {};
    const sig = signRequest({ method, url, headers, payloadHash: sha256(body), region: 'ap-south-1', accessKey: 'AKIDTEST', secretKey: 'secret/With+Chars=', date }).signature;
    cases.push({ kind: 'header', method, url, headers, body: body.toString('base64'), date: date.toISOString(), sig });
    const presigned = presignUrl({ url, region: 'ap-south-1', accessKey: 'AKIDTEST', secretKey: 'secret/With+Chars=', date, expires: 300, extraQuery: { 'response-content-disposition': 'attachment; filename="a b.png"', 'response-content-type': 'image/png' } });
    cases.push({ kind: 'presign', url, date: date.toISOString(), presigned });
  }
}
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-')), 'cases.json');
fs.writeFileSync(file, JSON.stringify(cases));
const script = `
import json, sys, base64, datetime
from unittest import mock
from urllib.parse import urlsplit, urlunsplit, parse_qs, quote, unquote
import botocore, botocore.auth as A
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
cases = json.load(open(sys.argv[1])); creds = Credentials('AKIDTEST', 'secret/With+Chars=')
def boto_url(u):
    p = urlsplit(u); return urlunsplit((p.scheme, p.netloc, quote(unquote(p.path), safe='/~'), p.query, ''))
bad = 0
for c in cases:
    dt = datetime.datetime.fromisoformat(c['date'].replace('Z','')).replace(microsecond=0)
    with mock.patch.object(A, 'get_current_datetime', return_value=dt):
        if c['kind'] == 'header':
            req = AWSRequest(method=c['method'], url=boto_url(c['url']), data=base64.b64decode(c['body']) or None, headers=c['headers'])
            A.S3SigV4Auth(creds, 's3', 'ap-south-1').add_auth(req)
            if req.headers['Authorization'].split('Signature=')[1] != c['sig']: bad += 1; print('অমিল', c['method'], c['url'])
        else:
            q = parse_qs(urlsplit(c['presigned']).query)
            req = AWSRequest(method='GET', url=boto_url(c['url']), params={k: v[0] for k, v in q.items() if k.startswith('response-')})
            A.S3SigV4QueryAuth(creds, 's3', 'ap-south-1', expires=300).add_auth(req)
            if parse_qs(urlsplit(req.url).query)['X-Amz-Signature'][0] != q['X-Amz-Signature'][0]: bad += 1; print('অমিল presign', c['url'])
print(f"botocore {botocore.__version__}: {len(cases)}টি অনুরোধ, {bad}টি অমিল")
sys.exit(1 if bad else 0)
`;
try {
  process.stdout.write(execFileSync(py, ['-I', '-c', script, file]).toString());
} catch (e) {
  process.stdout.write(String(e.stdout || ''));
  process.exitCode = 1;
}
