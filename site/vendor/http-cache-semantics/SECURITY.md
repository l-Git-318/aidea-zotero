Upstream http-cache-semantics 4.2.0, BSD-2-Clause.

Local mitigation for GHSA-ch52-4w7c-c8xp: evaluateRequest checks storage permission and mandatory revalidation before considering max-stale. No upstream fixed version was published at remediation time. See ../../test/cache-security.test.mjs. Replace this override when upstream releases a verified fix.
