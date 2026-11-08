const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const engine = require('../electron/engine.cjs');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.test-artifacts/modes', String(Date.now()));
async function wait(page, predicate) { const end=Date.now()+60000; while(Date.now()<end){ const state=await page.evaluate(()=>window.frame.getState()); if(predicate(state)) return state; await new Promise(r=>setTimeout(r,80)); } throw Error('Mode workflow timed out'); }
(async()=>{
  await fs.mkdir(dir,{recursive:true}); const input=path.join(dir,'模式验证.mp4'); const output=path.join(dir,'output'); await fs.mkdir(output);
  await engine.run(engine.binaryPaths().ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=500:sample_rate=48000','-t','2','-c:v','libx264','-crf','16','-c:a','aac',input]);
  const env={...process.env,FRAME_TEST_DATA:dir}; delete env.ELECTRON_RUN_AS_NODE; delete env.FRAME_DEV_URL;
  const app=await electron.launch({args:process.env.FRAME_PACKAGED_EXE?[]:[root],executablePath:process.env.FRAME_PACKAGED_EXE||undefined,env});
  try {
    const page=await app.firstWindow(); page.setDefaultTimeout(10000); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.getByRole('heading',{name:'凝影阁',exact:true}).waitFor(); await wait(page,s=>!s.hardware.detecting);
    const mode=name=>page.getByRole('button',{name,exact:true}); const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('baiyujing-ningying-options')));
    assert.equal(await mode('自动压缩').getAttribute('aria-pressed'),'true'); assert.equal(await page.getByLabel('加速方式',{exact:true}).count(),0);
    await page.setViewportSize({width:1440,height:960}); await page.waitForTimeout(220); await page.screenshot({path:path.join(root,'.test-artifacts/workspace-080.png')});
    await mode('手动调画质').click(); await page.locator('.advanced-settings summary').click();
    await page.getByLabel('音频处理',{exact:true}).selectOption('mute'); await page.getByLabel('分辨率',{exact:true}).selectOption('480');
    await page.getByLabel('编码方案',{exact:true}).selectOption('maruko'); assert.equal((await saved()).speed,'veryslow');
    await mode('快速压缩').click(); assert.equal((await saved()).audio,'keep'); assert.equal((await saved()).resolution,'original'); assert.equal((await saved()).strategy,'standard');
    await page.getByRole('button',{name:'使用 CPU',exact:true}).click(); assert.equal(await page.getByRole('switch').count(),0);
    await mode('指定大小').click(); assert.equal(await page.getByRole('slider').count(),0); assert.equal(await page.getByLabel('加速方式',{exact:true}).count(),0);
    await app.evaluate(({dialog},x)=>{dialog.showOpenDialog=async(_w,o)=>({canceled:false,filePaths:[o.properties.includes('openDirectory')?x.output:x.input]});},{input,output});
    await page.getByRole('button',{name:'添加视频',exact:true}).click(); await wait(page,s=>s.jobs.length===1&&!s.importing);
    await page.locator('.directory-path').click(); await wait(page,s=>s.outputDirectory===output);
    await page.getByLabel('目标大小 MB',{exact:true}).fill(''); assert.equal(await page.locator('.start-button').isDisabled(),true);
    await page.getByLabel('目标大小 MB',{exact:true}).fill('0.15'); assert.equal(await page.locator('.start-button').isEnabled(),true);
    await mode('兼容播放').click(); const compatible=await saved(); assert.equal(compatible.codec,'h264');assert.equal(compatible.audio,'keep');assert.equal(compatible.format,'mp4');assert.equal(compatible.bitDepth,'8');assert.equal(compatible.rateControl,'quality');
    await page.getByRole('button',{name:'使用 CPU',exact:true}).click();
    for(const width of [390,960,1440]){ await page.setViewportSize({width,height:width===390?844:960}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`); await page.waitForTimeout(220); await page.screenshot({path:path.join(root,`.test-artifacts/modes-${width}.png`)}); }
    await page.emulateMedia({reducedMotion:'reduce'}); await mode('快速压缩').focus(); await page.keyboard.press('Tab'); assert.equal(await mode('兼容播放').evaluate(e=>e===document.activeElement),true); assert.ok(await mode('兼容播放').evaluate(e=>getComputedStyle(e).outlineStyle!=='none'));
    await page.locator('.start-button').click(); const result=await wait(page,s=>!s.busy&&s.jobs[0].status!=='queued'); assert.equal(result.jobs[0].status,'completed',result.jobs[0].error);
    const media=await engine.probeMedia(result.jobs[0].output); assert.equal(media.codec,'h264');assert.equal(media.audioCodec,'aac');assert.equal(media.pixelFormat,'yuv420p');
    await page.getByRole('button',{name:'处理记录',exact:true}).click(); assert.equal(await page.getByRole('complementary',{name:'压缩设置'}).count(),0); assert.deepEqual(errors,[]);
    await page.evaluate(o=>localStorage.setItem('baiyujing-ningying-options',JSON.stringify({...o,strategy:'standard',rateControl:'size',targetMB:25,encoder:'auto',parallel:true,crf:27})),compatible);
    await page.reload(); await page.getByRole('button',{name:'指定大小',exact:true}).waitFor();
    assert.equal(await mode('指定大小').getAttribute('aria-pressed'),'true');
    await page.locator('.advanced-settings summary').click(); assert.equal(await page.getByLabel('编码方案',{exact:true}).inputValue(),'efficient');
    assert.equal((await saved()).encoder,'cpu'); assert.equal((await saved()).targetMB,25); assert.equal((await saved()).crf,27);
    console.log(JSON.stringify({passed:true,packaged:!!process.env.FRAME_PACKAGED_EXE,modes:5,viewports:[390,960,1440],compatible:{codec:media.codec,audio:media.audioCodec},path:dir}));
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1});
