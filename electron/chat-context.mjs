// Keep complete turns and the current request. Saved history is never rewritten.
export function chatContext(conversation, answerId, systemPrompt, charBudget = 24000) {
  const history = conversation.messages.filter(m => m.id !== answerId && m.content && ['complete', 'stopped'].includes(m.status));
  const turns = [];
  for (const message of history) {
    if (message.role === 'user') turns.push([]);
    if (turns.length && ['user', 'assistant'].includes(message.role)) turns.at(-1).push({ role: message.role, content: message.content });
  }
  const selected = [];
  let chars = systemPrompt.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const size = turns[i].reduce((n, m) => n + m.content.length, 0);
    if (chars + size > charBudget) {
      if (!selected.length) throw new Error('This message plus your assistant instructions exceeds the local context budget. Shorten the message or instructions.');
      break;
    }
    selected.unshift(...turns[i]); chars += size;
  }
  return { messages: [{ role: 'system', content: systemPrompt }, ...selected], omitted: history.length - selected.length };
}

export function validResponseLimit(value) {
  return value === -1 || (Number.isInteger(value) && value >= 64 && value <= 32768);
}
