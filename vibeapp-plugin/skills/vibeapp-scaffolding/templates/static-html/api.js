// api.js — runtime-agnostic handler. Secrets come from env (scoped role injects them).
export async function hello() {
  return { message: 'Hello from your VibeApp API', model: process.env.VIBEAPP_DEFAULT_MODEL || 'unset' };
}

// LLM calls MUST go through the AI Gateway, never Bedrock directly:
export async function ask(prompt) {
  const res = await fetch(`${process.env.VIBEAPP_GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VIBEAPP_GATEWAY_TOKEN}` },
    body: JSON.stringify({ model: process.env.VIBEAPP_DEFAULT_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  return res.json();
}
