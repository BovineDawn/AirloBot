// Real local inference with synthetic tools. No tool handler executes any action.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AirloService } from '../electron/core.mjs';
import { loadLiveModel } from './live-model.mjs';

const service = new AirloService(path.resolve('test-results/tool-probe-' + Date.now()));
const report = { date: new Date().toISOString(), cases: [] };
const tool = (name, properties, required) => ({ type: 'function', function: {
  name, description: `Synthetic ${name} evaluation. Request only; no real execution.`,
  parameters: { type: 'object', properties, required, additionalProperties: false }
} });
const read = tool('read_file', { path: { type: 'string' } }, ['path']);
const spawn = tool('spawn_agent', { role: { type: 'string', enum: ['reviewer'] }, task: { type: 'string' } }, ['role', 'task']);
const system = { role: 'system', content: 'You are AirloBot. Request exactly the specified tool when needed. Never invent a tool result. A denied tool must not be retried or delegated; explain the denial. Be concise.' };
async function complete(messages, tools) {
  const start = Date.now();
  const response = await (await service.runtime.fetch('/v1/chat/completions', {
    method: 'POST', body: JSON.stringify({ model: service.state.settings.model, messages, tools, tool_choice: 'auto', temperature: 0, max_tokens: 1024, stream: false }),
    signal: AbortSignal.timeout(120000)
  })).json();
  return { message: response.choices[0].message, finishReason: response.choices[0].finish_reason, elapsedMs: Date.now() - start };
}
try {
  report.model = (await loadLiveModel(service)).key;
  const messages = [system, { role: 'user', content: 'Use read_file to inspect README.txt before explaining what this project does.' }];
  const first = await complete(messages, [read]);
  const calls = first.message.tool_calls || [];
  let args; try { args = JSON.parse(calls[0]?.function?.arguments); } catch {}
  const passed = calls.length === 1 && calls[0].function.name === 'read_file' && args?.path === 'README.txt' && Object.keys(args).length === 1;
  report.cases.push({ name: 'Structured file-read request', passed, ...first });
  if (passed) {
    const denied = await complete([...messages, first.message, { role: 'tool', tool_call_id: calls[0].id, content: JSON.stringify({ error: 'Permission denied by user. Do not retry this action.' }) }], [read]);
    report.cases.push({ name: 'Stop requesting calls after synthetic denial', passed: !(denied.message.tool_calls?.length) && /denied|permission|access|cannot|unable/i.test(denied.message.content || ''), ...denied });
  }
  const delegated = await complete([system, { role: 'user', content: 'Request spawn_agent with role reviewer and task "Review the proposed diff for bugs". Do not claim the helper has run.' }], [spawn]);
  const spawned = delegated.message.tool_calls || [];
  let spec; try { spec = JSON.parse(spawned[0]?.function?.arguments); } catch {}
  report.cases.push({ name: 'Structured helper request', passed: spawned.length === 1 && spawned[0].function.name === 'spawn_agent' && spec?.role === 'reviewer' && spec?.task === 'Review the proposed diff for bugs' && Object.keys(spec).length === 2, ...delegated });
  report.passed = report.cases.length === 3 && report.cases.every(c => c.passed);
} catch (error) { report.error = error.message; report.passed = false; }
finally {
  await service.shutdown(); await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/tool-probe.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
