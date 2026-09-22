/** Negotiate only an explicitly accepted Brotli representation; q=0 must remain excluded. */
export function acceptsBrotli(value: string | null): boolean {
  return (value ?? "").split(",").some(part => {
    const [encoding, ...parameters] = part.trim().toLowerCase().split(";");
    if (encoding.trim() !== "br") return false;
    const quality = parameters.map(item => item.trim()).find(item => item.startsWith("q="));
    return !quality || (Number(quality.slice(2)) > 0 && Number(quality.slice(2)) <= 1);
  });
}

export function staticAssetParts(parts: string[]): boolean {
  return parts.length > 0 && parts.every(part => /^[a-zA-Z0-9_.@()[\]-]+$/.test(part) && part !== "." && part !== "..")
    && /\.(js|css)$/.test(parts.at(-1) ?? "");
}
