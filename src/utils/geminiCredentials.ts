/** Read application credentials from an installed CLI without embedding a copy. */
export async function readGeminiBundleCredentials(path: string): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const info = await IOUtils.stat(path);
  if (
    info.type !== "regular" ||
    typeof info.size !== "number" ||
    info.size <= 0 ||
    info.size > 256 * 1024 * 1024
  )
    return null;
  const decoder = new TextDecoder("utf-8");
  let tail = "";
  let clientId = "";
  let clientSecret = "";
  for (let offset = 0; offset < info.size;) {
    const bytes = await IOUtils.read(path, {
      offset,
      maxBytes: Math.min(64 * 1024, info.size - offset),
    });
    if (!bytes.length) break;
    offset += bytes.length;
    const text = tail + decoder.decode(bytes);
    clientId ||=
      text.match(/\d+-[a-z0-9]+\.apps\.googleusercontent\.com/)?.[0] || "";
    // Require a following delimiter: a credential split across chunks must
    // not be returned as a truncated match.
    clientSecret ||=
      text.match(/GOCSPX-[A-Za-z0-9_-]+(?=[^A-Za-z0-9_-])/)?.[0] || "";
    if (clientId && clientSecret) return { clientId, clientSecret };
    tail = text.slice(-512);
  }
  return null;
}
