// These hints guide recovery, never permissions. Only recorded tool calls can
// prepare changes, and the existing review/path checks still govern every write.
const continuation = /^(?:(?:okay|ok|please|yes|thanks|thank you)[,.!\s]+)*(?:proceed|continue\b|go ahead\b|what(?:'s| is|s) next\b|apply (?:the |these )?changes\b|make (?:the |these )?changes\b|retry\b|try again\b)/i;
export function changeRequirement(goal) {
  if (/\b(?:do not|don't|without) (?:create|write|change|edit)|\b(?:explain|show me how|how (?:do|can|would)|are you capable|can you explain|if (?:needed|warranted|necessary))\b/i.test(goal)) return null;
  if (!/\b(?:create|build|code|implement|write|save|replace|update|fix|edit|modify|change)\b/i.test(goal)) return null;
  if (/\b(?:app|application|calculator|gui|program|script|file|document|readme|website|page)\b|\.[a-z]{1,6}\b/i.test(goal)) return 'file';
  return /\b(?:folder|directory)\b/i.test(goal) ? 'directory' : null;
}
export function taskContext(task) {
  const runs = task.runs || [], continuing = continuation.test(task.goal);
  const prior = [...runs].reverse().find(r => r.objective || !continuation.test(r.goal));
  const objective = continuing && prior ? prior.objective || prior.goal : task.goal;
  const requirement = changeRequirement(objective);
  // Retain user instructions, including older folder choices, without treating
  // an assistant's narrative as evidence of filesystem operations.
  const pinned = runs.filter(r => changeRequirement(r.goal) || /\b(?:work (?:out of|in)|use (?:the )?(?:folder|directory))\b/i.test(r.goal)).slice(-4).map(r => r.goal.slice(0, 1500));
  return { objective, requirement, continuing, pinned };
}
export const pendingChanges = task => [...task.runs || [], task].flatMap(r => r.proposals || []).filter(p => p.status === 'pending');
export function missingCreation(task, context) {
  if (!context.requirement) return false;
  const changes = context.continuing ? [...task.runs || [], task].filter(r => r === task || (r.objective || r.goal) === context.objective).flatMap(r => r.proposals || []) : task.proposals;
  return !changes.some(p => ['pending', 'applied'].includes(p.status) && (context.requirement === 'directory' ? p.operation === 'mkdir' : p.operation !== 'mkdir'));
}
