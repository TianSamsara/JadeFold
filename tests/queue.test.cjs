const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runLanes } = require('../electron/queue.cjs');

test('GPU and CPU lanes overlap, take each file once, and never share a lane', async () => {
  const jobs = Array.from({ length: 7 }, (_, id) => ({ id }));
  const busy = new Set(); const seen = []; let maximum = 0;
  await runLanes(jobs, ['gpu', 'cpu'], async (job, lane) => {
    assert.ok(!busy.has(lane)); busy.add(lane); maximum = Math.max(maximum, busy.size);
    seen.push(job.id);
    await new Promise(resolve => setTimeout(resolve, lane === 'gpu' ? 3 : 7));
    busy.delete(lane);
  }, new AbortController().signal);
  assert.equal(maximum, 2);
  assert.deepEqual(seen.toSorted((a, b) => a - b), jobs.map(job => job.id));
});

test('cancellation reaches both running files and leaves waiting files untouched', async () => {
  const controller = new AbortController(); const started = []; const cancelled = [];
  const run = runLanes([1, 2, 3, 4], ['gpu', 'cpu'], async (job, lane) => {
    started.push(job);
    await new Promise(resolve => controller.signal.addEventListener('abort', () => { cancelled.push(lane); resolve(); }, { once: true }));
  }, controller.signal);
  controller.abort(); await run;
  assert.deepEqual(started, [1, 2]); assert.deepEqual(cancelled.toSorted(), ['cpu', 'gpu']);
});

test('one lane retains sequential queue behavior', async () => {
  const seen = [];
  await runLanes([1, 2, 3], ['cpu'], async job => { seen.push(job); }, new AbortController().signal);
  assert.deepEqual(seen, [1, 2, 3]);
});
