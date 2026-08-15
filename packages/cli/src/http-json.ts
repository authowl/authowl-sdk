const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1_024;

export async function readJsonObject(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<Record<string, unknown>> {
  const serialized = await readLimitedText(response, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    value = null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_json_response");
  }
  return value as Record<string, unknown>;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    result += decoder.decode(value, { stream: true });
  }
}
