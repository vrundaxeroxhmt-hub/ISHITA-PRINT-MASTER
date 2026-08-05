const DEFAULT_GATEWAY_URL = "http://127.0.0.1:3001";

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("SMART PRINT gateway URL must use http://127.0.0.1");
  }
  return parsed.origin;
}

export function getGatewayBaseUrl(): string {
  const desktopUrl = typeof window !== "undefined" ? window.printDeskDesktop?.gatewayUrl : undefined;
  const configuredUrl = desktopUrl || import.meta.env.VITE_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  return normalizeBaseUrl(configuredUrl);
}

export function gatewayUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getGatewayBaseUrl()}${normalizedPath}`;
}
