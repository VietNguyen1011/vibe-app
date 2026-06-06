// API handler. Secrets from env. LLM via AI Gateway only.
export async function hello() {
  return { message: 'Hello from your VibeApp API', model: process.env.VIBEAPP_DEFAULT_MODEL ?? 'unset' };
}

export async function ask(prompt: string) {
  const res = await fetch(`${process.env.VIBEAPP_GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VIBEAPP_GATEWAY_TOKEN}` },
    body: JSON.stringify({ model: process.env.VIBEAPP_DEFAULT_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  return res.json();
}
