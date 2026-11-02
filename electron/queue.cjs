// Each lane takes a whole file. A single file is never split across encoders.
async function runLanes(jobs, lanes, execute, signal) {
  const pending = jobs.slice();
  let next = 0;
  const results = await Promise.allSettled(lanes.map(async lane => {
    while (!signal.aborted && next < pending.length) {
      const job = pending[next++];
      await execute(job, lane);
    }
  }));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

module.exports = { runLanes };
