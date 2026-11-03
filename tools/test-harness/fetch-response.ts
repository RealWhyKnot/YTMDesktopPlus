export async function fetchResponse(start: (signal: AbortSignal) => Promise<Response>, milliseconds: number, label: string): Promise<Response> {
  const controller = new AbortController();
  const request = start(controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout after ${milliseconds}ms: ${label}`));
      controller.abort();
    }, milliseconds);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
