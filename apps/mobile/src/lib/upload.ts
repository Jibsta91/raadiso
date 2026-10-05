/**
 * Multipart upload of a local file on iOS and Android. Expo's fetch (expo/fetch) only takes
 * Blob parts in FormData; React Native's XMLHttpRequest still sends `{ uri, name, type }` parts
 * natively, streaming the file from disk. Resolves with a Response so callers treat it like fetch.
 */
export function uploadForm(
  url: string,
  form: FormData,
  headers: Record<string, string> = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.onload = () =>
      resolve(
        new Response(xhr.responseText || null, {
          status: xhr.status,
          headers: { 'content-type': xhr.getResponseHeader('content-type') ?? 'text/plain' },
        }),
      );
    xhr.onerror = () => reject(new Error('upload failed: network error'));
    xhr.ontimeout = () => reject(new Error('upload failed: timeout'));
    xhr.timeout = 60_000;
    xhr.send(form);
  });
}
