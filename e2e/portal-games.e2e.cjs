const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const origin = process.env.PORTAL_URL || 'http://localhost:8790';
const output = process.env.PORTAL_SHOTS || '/tmp/onlineboard-games';
(async () => {
 mkdirSync(output, { recursive: true });
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  for (const width of [360, 1440]) {
   const context = await browser.newContext({viewport:{width,height:900}});
   const page = await context.newPage();
   const errors=[];page.on('pageerror', e=>errors.push(e.message));
   await page.goto(origin);
   assert.equal(await page.locator('.game-card').count(),4);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${output}/catalog-${width}.png`,fullPage:true});
   for (const slug of ['ctrl-v','guess-who','sand-sorter']) {
    await page.locator(`.game-card[href="/${slug}/"]`).click();
    await page.waitForURL(origin+'/'+slug+'/');
    const frame = page.frameLocator('#game-frame');
    if (slug==='ctrl-v') {
     await frame.locator('[data-action="play"]').waitFor();
     await frame.locator('[data-action="play"]').click();
     await frame.locator('[data-screen="turn"]').waitFor();
    } else if (slug==='guess-who') {
     await frame.getByRole('button',{name:/Movies/}).click();
     await frame.getByRole('button',{name:'Start',exact:true}).click();
     await frame.getByTestId('character-name').waitFor();
    } else {
     await frame.locator('[data-testid="level-map-loading"]').waitFor({state:'hidden'});
     await frame.getByTestId('level-cell-1').click();
     await frame.locator('[data-testid="game-board"], [data-testid="bottle-0"], [data-testid="play-screen"]').first().waitFor();
    }
    const child=page.frames().find(f=>f!==page.mainFrame()&&f.url().includes(slug+'.'));
    assert(child,'game app must be loaded');
    console.log('Started',slug,width);
    if (await page.evaluate(()=>!!document.fullscreenElement)) await page.evaluate(()=>document.exitFullscreen());
    await page.getByRole('button',{name:'На весь экран',exact:true}).click();
    await page.getByRole('button',{name:'Выйти из полного экрана',exact:true}).waitFor();
    await page.getByRole('button',{name:'Выйти из полного экрана',exact:true}).click();
    await page.screenshot({path:`${output}/${slug}-${width}.png`});
    assert.equal(new URL(page.url()).pathname,'/'+slug+'/');
    await page.reload();await page.locator('#game-frame').waitFor();
    await page.getByRole('link',{name:'Все игры OnlineBoard'}).click();
    await page.locator('.game-card').first().waitFor();
   }
   assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('PASS catalog + all three apps, game rounds/level, fullscreen, reload and return at 360/1440; no page errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
