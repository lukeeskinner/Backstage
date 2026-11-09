/** Backstage: real browser demo and acceptance checks. Never mocks API responses.
 * npm install --no-save playwright (in this output directory), then:
 * BASE_URL=http://127.0.0.1:5182 ORGANIZER_TOKEN=... node demo-three-minutes.mjs
 * PACE=0 runs the same checks quickly; PACE=1 (default) records a 3-minute tour.
 * A running API + worker and seeded catalog are required. Credentials stay in env.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : await import('playwright');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5182';
const token = process.env.ORGANIZER_TOKEN;
if (!token) throw new Error('Set ORGANIZER_TOKEN privately in the environment.');
const paced = process.env.PACE !== '0';
const out = path.resolve(process.env.DEMO_OUTPUT ?? 'demo-recording');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM, headless: process.env.HEADED !== '1' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', recordVideo: { dir: out, size: { width: 1440, height: 1000 } } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = { base, started_at: new Date().toISOString(), scenes: [], checks: [], mode: 'real API; builder/commit modes read from actual response' };
const start = Date.now();
const until = async seconds => { if (paced) await page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - start))); };
const check = (name, ok) => { report.checks.push({name, passed: Boolean(ok)}); if (!ok) throw Error(name); };
const shot = async name => { report.scenes.push({ name, seconds: Math.round((Date.now()-start)/1000) }); await page.screenshot({ path: path.join(out, name+'.png'), fullPage: true }); };
try {
  await page.goto(base+'/#/join');
  await page.getByRole('heading',{name:'Get a conference site built for you'}).waitFor();
  await shot('01-survey');
  await until(12);
  await page.getByRole('radio',{name:'Attendee',exact:true}).check();
  await page.getByRole('checkbox',{name:'Observability',exact:true}).check();
  await page.getByRole('checkbox',{name:'AI agents',exact:true}).check();
  await page.getByRole('radio',{name:'Practitioner',exact:true}).check();
  await page.getByRole('radio',{name:'Bold',exact:true}).check();
  await page.getByRole('checkbox',{name:'Reduced motion',exact:true}).check();
  await until(25);
  const submitted = page.waitForResponse(r => r.request().method()==='POST' && r.url().endsWith('/attendee/surveys'));
  await page.getByRole('button',{name:'Build my site',exact:true}).click();
  const response = await submitted;
  check('survey accepted',response.status()===201);
  const created = await response.json();
  report.attendee_id = created.attendee_id;
  check('six recommended sessions',created.recommendations.length===6);
  await page.waitForURL('**/#/site/'+created.attendee_id);
  await shot('02-agent-building');
  let attendee;
  const deadline=Date.now()+90000;
  do {
    const r=await context.request.get(base+'/api/v1/attendee/'+created.attendee_id);
    check('attendee read available',r.status()===200);
    attendee=await r.json();
    if (attendee.site.status==='failed') throw Error('Build failed: inspect the real agent trail.');
    if (attendee.site.status==='ready') break;
    await page.waitForTimeout(1500);
  } while (Date.now()<deadline);
  check('site ready',attendee.site.status==='ready');
  check('goal not exposed',!Object.hasOwn(attendee.answers,'goal')&&!Object.hasOwn(attendee,'traceparent'));
  report.builder=attendee.site.builder;report.commit_mode=attendee.site.commit_mode;report.commit_sha=attendee.site.commit_sha;report.run_id=attendee.site.run_id;
  await page.getByRole('heading',{name:'Your picks',exact:true}).waitFor({timeout:10000});
  await until(80);
  await page.evaluate(()=>scrollTo(0,0));
  await shot('03-personal-site');
  const tap=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/interactions'));
  await page.getByRole('button',{name:'Save',exact:true}).first().click();
  check('tap stored',(await tap).status()===202);
  for(const width of [390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    check('no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.evaluate(()=>scrollTo(0,0));
    await shot('site-'+width);
  }
  await until(105);
  await page.goto(base+'/#/trends');
  await page.getByRole('textbox',{name:'API token',exact:true}).fill(token);
  await page.getByRole('button',{name:'Use token',exact:true}).click();
  await page.getByRole('heading',{name:'Interests over time',exact:true}).waitFor({timeout:15000});
  await shot('04-live-trends');
  const trends=await context.request.get(base+'/api/v1/pivot/trends',{headers:{Authorization:'Bearer '+token}});
  check('organizer trends available',trends.status()===200);
  const data=await trends.json();report.totals=data.totals;
  await until(135);
  await page.goto(base+'/#/trail');
  await page.getByRole('searchbox',{name:'Search agent events'}).fill('schedule');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('list',{name:'Agent events',exact:true}).waitFor({timeout:15000});
  await shot('05-search-decisions');
  await until(150);
  await page.getByRole('button',{name:new RegExp('^Open run '+report.run_id+' ')}).first().click();
  await page.getByRole('list',{name:'Run timeline',exact:true}).waitFor({timeout:15000});
  await shot('06-run-evidence');
  const run=await context.request.get(base+'/api/v1/pivot/trail/runs/'+report.run_id,{headers:{Authorization:'Bearer '+token}});
  check('run detail available',run.status()===200);
  const detail=await run.json();report.trace_id=detail.trace_id;report.event_count=detail.events.length;
  const denial=await context.request.get(base+'/api/v1/pivot/trends');check('unauthenticated denied',denial.status()===401);
  check('no browser exceptions',errors.length===0);
  await until(180);
  report.completed=true;
} catch(error) {report.completed=false;report.error=error.message;await shot('failure').catch(()=>{});process.exitCode=1;}
finally {report.browser_errors=errors;report.duration_seconds=(Date.now()-start)/1000;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();console.log(JSON.stringify({completed:report.completed,attendee_id:report.attendee_id,builder:report.builder,commit_mode:report.commit_mode,duration:report.duration_seconds,error:report.error,out},null,2));}
