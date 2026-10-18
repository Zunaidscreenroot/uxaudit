function isIPv4Literal(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
function privateIPv4(value: string): boolean {
  if (!isIPv4Literal(value)) return false;
  const [a, b, c, d] = value.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 255 && b === 255 && c === 255 && d === 255);
}
function privateAddress(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (isIPv4Literal(host)) return privateIPv4(host);
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") ||
      /^fe[89ab]/.test(host) || host.startsWith("ff") || host.startsWith("2001:db8:") || host.startsWith("2002:")) return true;
  const mappedDotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return privateIPv4(mappedDotted[1]);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16), low = Number.parseInt(mappedHex[2], 16);
    return privateIPv4([high >> 8, high & 255, low >> 8, low & 255].join("."));
  }
  return false;
}
export function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host === "metadata.google.internal" || privateAddress(host);
}
async function dnsAnswers(host: string, type: "A" | "AAAA"): Promise<string[]> {
  const response = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(host) + "&type=" + type, {
    headers: { Accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error("Public DNS verification returned HTTP " + response.status + ".");
  const data = await response.json() as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  if (data.Status !== 0 && data.Status !== 3) throw new Error("Public DNS verification failed.");
  return (data.Answer || []).filter(a => a.type === (type === "A" ? 1 : 28) && typeof a.data === "string").map(a => String(a.data));
}
export async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  if (privateHost(hostname)) return true;
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIPv4Literal(host) || host.includes(":")) return privateAddress(host);
  try {
    const [ipv4, ipv6] = await Promise.all([dnsAnswers(host, "A"), dnsAnswers(host, "AAAA")]);
    const addresses = [...ipv4, ...ipv6];
    return addresses.length === 0 || addresses.some(privateAddress);
  } catch {
    // Fail closed when a public address cannot be verified before third-party capture.
    return true;
  }
}
