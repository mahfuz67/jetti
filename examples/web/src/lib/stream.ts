// Read a Server-Sent-Events stream from a POST response, decoding `data:` frames.
export async function streamEvents<T>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.replace(/^data: /, "").trim();
      if (line) onEvent(JSON.parse(line) as T);
    }
  }
}
