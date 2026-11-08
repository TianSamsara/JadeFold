const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateOptions, videoEncoderArgs } = require('../electron/engine.cjs');
const api = import('../src/modes.ts');
test('every purpose clears incompatible previous settings and reaches the engine', async () => {
  const { modes, modeOf, selectMode, defaultOptions } = await api;
  for (const from of modes) for (const to of modes) {
    const previous = { ...selectMode(defaultOptions, from.id), audio: 'mute', resolution: '480', parallel: true, targetMB: 999 };
    const next = selectMode(previous, to.id);
    assert.equal(modeOf(next), to.id); assert.doesNotThrow(() => validateOptions(next));
    assert.equal(next.parallel, false); assert.equal(next.audio, 'keep'); assert.equal(next.resolution, 'original'); assert.equal(next.targetMB, 50);
    if (['smart', 'size', 'quality'].includes(to.id)) assert.equal(next.encoder, 'cpu');
  }
});
test('classic profile works with quality and size without leaking into fast or compatibility', async () => {
  const { selectMode, selectProfile, defaultOptions } = await api;
  for (const mode of ['quality', 'size']) {
    const classic = selectProfile(selectMode(defaultOptions, mode), 'maruko');
    assert.doesNotThrow(() => validateOptions(classic)); assert.equal(classic.codec, 'h264'); assert.equal(classic.speed, 'veryslow');
    assert.equal(classic.rateControl, mode === 'size' ? 'size' : 'quality');
    assert.equal(selectMode(classic, 'fast').strategy, 'standard');
  }
});
test('compatibility intent is enforced in the backend', async () => {
  const { selectMode, defaultOptions } = await api;
  const compatible = selectMode(defaultOptions, 'compatible');
  for (const patch of [{codec:'h265'}, {format:'mkv'}, {audio:'mute'}, {bitDepth:'10'}, {rateControl:'size'}, {content:'animation'}]) assert.throws(() => validateOptions({...compatible,...patch}));
  assert.ok(videoEncoderArgs({...compatible,encoder:'cpu'}).includes('libx264'));
  assert.ok(videoEncoderArgs({...compatible,encoder:'nvenc'}).includes('h264_nvenc'));
});
test('legacy options keep intentional settings while repairing conflicting mode combinations', async () => {
  const { loadOptions, defaultOptions, modeOf } = await api;
  const old = {...defaultOptions,strategy:'standard',codec:'h264',bitDepth:'8',encoder:'auto',crf:25};
  assert.equal(loadOptions(JSON.stringify(old)).crf,25); assert.equal(modeOf(loadOptions(JSON.stringify(old))), 'fast');
  const size = loadOptions(JSON.stringify({...old,rateControl:'size',parallel:true}));
  assert.equal(size.encoder,'cpu'); assert.equal(size.parallel,false); assert.equal(size.rateControl,'size'); assert.equal(size.strategy,'efficient');
  assert.deepEqual(loadOptions('{'),defaultOptions);
  assert.equal(loadOptions(JSON.stringify({...old,speed:'veryslow'})).speed,'slow');
});

test('CPU and GPU choices persist in automatic and manual quality workflows', async () => {
  const { selectMode, selectDevice, loadOptions, defaultOptions } = await api;
  for (const mode of ['smart', 'quality', 'fast', 'compatible']) {
    for (const encoder of ['cpu', 'auto', 'nvenc', 'qsv', 'amf']) {
      const chosen = selectDevice(selectMode(defaultOptions, mode), encoder);
      assert.doesNotThrow(() => validateOptions(chosen));
      assert.equal(loadOptions(JSON.stringify(chosen)).encoder, encoder);
      if (encoder !== 'cpu') assert.equal(chosen.bitDepth, '8');
    }
  }
  assert.equal(selectDevice(selectMode(defaultOptions, 'size'), 'nvenc').encoder, 'cpu');
  assert.throws(() => validateOptions({ ...defaultOptions, qualityPreference: 'unknown' }));
  assert.throws(() => validateOptions({ ...defaultOptions, parallel: true }));
});
