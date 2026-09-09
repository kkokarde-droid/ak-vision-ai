# Test Evidence

Date: 2026-09-09

| Check | Result |
| --- | --- |
| Unknown pricing regression | Passed: HTTP 404 observed in full API suite |
| Worker claim concurrency regression | Passed: focused concurrency tests and full API suite |
| API suite | 106 passed, 0 failed |
| Providers suite | 17 passed, 0 failed |
| Worker suite | 14 passed, 0 failed |
| API typecheck | Passed |
| Providers typecheck | Passed |
| Types typecheck | Passed |
| Worker typecheck | Passed |
| Workspace build | Passed |

Notes:

- The worker suite emits an intentional `DrizzleQueryError` during the real PostgreSQL recovery fault-injection test. The test passed and asserts recovery behavior; it is expected evidence, not a failure.
- The pricing regression is protected by `unknown pricing for an otherwise valid model is rejected` in the API integration suite.