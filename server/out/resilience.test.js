"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const resilience_1 = require("./resilience");
(0, node_test_1.test)('withTimeout: resolves before deadline', async () => {
    const fn = (0, resilience_1.withTimeout)(100)(async () => 'ok');
    node_assert_1.default.strictEqual(await fn(), 'ok');
});
(0, node_test_1.test)('withTimeout: rejects with TimeoutError after deadline', async () => {
    const fn = (0, resilience_1.withTimeout)(10)(async () => {
        await new Promise(r => setTimeout(r, 100));
        return 'slow';
    });
    await node_assert_1.default.rejects(fn(), resilience_1.TimeoutError);
});
(0, node_test_1.test)('withRetry: retries transient failures then succeeds', async () => {
    let attempts = 0;
    const fn = (0, resilience_1.withRetry)(3, { delayMs: 1, backoff: 'linear' })(async () => {
        attempts++;
        if (attempts < 3)
            throw new Error('transient');
        return 'ok';
    });
    node_assert_1.default.strictEqual(await fn(), 'ok');
    node_assert_1.default.strictEqual(attempts, 3);
});
(0, node_test_1.test)('withRetry: never retries AbortError', async () => {
    let attempts = 0;
    const fn = (0, resilience_1.withRetry)(3, { delayMs: 1, backoff: 'linear' })(async () => {
        attempts++;
        throw new resilience_1.AbortError();
    });
    await node_assert_1.default.rejects(fn(), resilience_1.AbortError);
    node_assert_1.default.strictEqual(attempts, 1);
});
(0, node_test_1.test)('withFallback: returns fallback on failure', async () => {
    const fn = (0, resilience_1.withFallback)(() => 'fallback')(async () => {
        throw new Error('boom');
    });
    node_assert_1.default.strictEqual(await fn(), 'fallback');
});
(0, node_test_1.test)('withFallback: does not swallow AbortError', async () => {
    const fn = (0, resilience_1.withFallback)(() => 'fallback')(async () => {
        throw new resilience_1.AbortError();
    });
    await node_assert_1.default.rejects(fn(), resilience_1.AbortError);
});
(0, node_test_1.test)('withCache: deduplicates concurrent identical calls', async () => {
    let calls = 0;
    const fn = (0, resilience_1.withCache)(async (x) => {
        calls++;
        await new Promise(r => setTimeout(r, 10));
        return x * 2;
    });
    const [a, b] = await Promise.all([fn(1), fn(1)]);
    node_assert_1.default.strictEqual(a, 2);
    node_assert_1.default.strictEqual(b, 2);
    node_assert_1.default.strictEqual(calls, 1);
});
(0, node_test_1.test)('withMaxConcurrency: caps concurrent executions', async () => {
    let active = 0;
    let maxActive = 0;
    const fn = (0, resilience_1.withMaxConcurrency)(2)(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, 10));
        active--;
    });
    await Promise.all([fn(), fn(), fn(), fn(), fn()]);
    node_assert_1.default.ok(maxActive <= 2);
});
(0, node_test_1.test)('combinators: nestable (timeout + retry + fallback)', async () => {
    let attempts = 0;
    const composed = (0, resilience_1.withFallback)(() => 'gave up')((0, resilience_1.withRetry)(2, { delayMs: 1, backoff: 'linear' })((0, resilience_1.withTimeout)(50)(async () => {
        attempts++;
        throw new Error('always fails');
    })));
    node_assert_1.default.strictEqual(await composed(), 'gave up');
    node_assert_1.default.strictEqual(attempts, 2);
});
//# sourceMappingURL=resilience.test.js.map