// Exact natural-language acceptance test. Uses an isolated project and local model.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AirloService } from '../electron/core.mjs';

if (!process.argv[2]) throw new Error('Pass an existing local GGUF path.');
const root = path.resolve('test-results/project-build-' + Date.now()), project = path.join(root,'project');
await fs.mkdir(project,{recursive:true});
const report={status:'running',checks:[],runs:[]};
let last='';
const service=new AirloService(path.join(root,'state'),()=>{
  const task=service.state.tasks[0], event=task?.events.at(-1);
  const progress=task && `${task.turns}:${event?.type}:${task.currentAction?.tool || ''}`;
  if(progress && progress!==last) { last=progress; console.log('Local task:',progress); }
});
try {
  await service.init(); const model=await service.registerModel(path.resolve(process.argv[2]));
  await service.settings({offline:true,contextTokens:16384,taskMaxTurns:40,taskMaxMinutes:8});
  await service.loadModel(model.key); await service.selectProject(project);
  const id=await service.startTask({goal:'Create a folder named calculator_app.'}); await service.agentPromise;
  let task=service.state.tasks[0];
  assert.equal(task.status,'awaiting_review',task.error || task.result);
  const folder=task.proposals.find(p=>p.operation==='mkdir' && p.path==='calculator_app'); assert.ok(folder,'Folder proposal missing');
  assert.equal(await fs.stat(path.join(project,'calculator_app')).then(()=>true,()=>false),false);
  await service.reviewChange({taskId:id,proposalId:folder.id,decision:'apply'});
  report.checks.push('folder is created only after explicit review');
  await service.startTask({taskId:id,goal:'Amazing. Just to test your coding ability. I want you to code a calculator app in python and make it have a gui that I can use. simple calulator is fine for now'});
  await service.agentPromise;task=service.state.tasks[0];
  if(!process.argv.includes('--baseline')) {
    assert.equal(task.status,'awaiting_review',task.error || task.result);
    const python=task.proposals.filter(p=>p.operation!=='mkdir' && p.path.endsWith('.py'));
    assert.ok(python.length,'No Python file proposals');
    assert.ok(python.every(p=>p.path.startsWith('calculator_app/')),'Calculator escaped its requested folder');
    assert.equal((await fs.readdir(path.join(project,'calculator_app'))).length,0,'Agent wrote files without review');
    // Apply only this disposable test's reviewed proposals. Execution is a separate check.
    for(const p of task.proposals) await service.reviewChange({taskId:id,proposalId:p.id,decision:'apply'});
    for(const p of python) assert.equal(await fs.readFile(path.join(project,p.path),'utf8'),p.after);
    report.checks.push('exact calculator request creates real Python proposals in the same conversation; explicit apply writes matching files');
  }
  report.status=process.argv.includes('--baseline') ? 'baseline-recorded' : 'passed';
} catch(error) {report.status='failed'; report.error=error.message;process.exitCode=1;}
finally {
  await service.shutdown();
  report.runs=service.state.tasks.map(t=>[...(t.runs||[]),t].map(r=>({status:r.status,turns:r.turns,result:r.result,error:r.error,files:r.proposals.map(p=>({path:p.path,operation:p.operation,status:p.status})),tools:r.events.filter(e=>e.type==='tool').map(e=>e.detail.split(' ')[0])})));
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,output:path.relative(process.cwd(),root),runs:report.runs.map(r=>r.map(({result,...rest})=>rest))},null,2));
}
