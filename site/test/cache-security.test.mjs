import test from 'node:test';
import assert from 'node:assert/strict';
import CachePolicy from 'http-cache-semantics';
const request = {url:'https://example.test/image',method:'GET',headers:{host:'example.test'}};
for (const directive of ['private', 'no-store', 'no-cache', 'proxy-revalidate']) {
  test(`max-stale cannot bypass ${directive}`, () => {
    const policy = new CachePolicy(request, {status:200,headers:{'cache-control':directive + ', max-age=0'}});
    const next = {...request, headers:{...request.headers,'cache-control':'max-stale'}};
    assert.equal(policy.satisfiesWithoutRevalidation(next), false);
    assert.equal(policy.evaluateRequest(next).response, undefined);
  });
}
test('public cacheable images still hit', () => {
  const policy = new CachePolicy(request, {status:200,headers:{'cache-control':'public, max-age=600'}});
  assert.equal(policy.satisfiesWithoutRevalidation(request), true);
});
