function read(name: keyof ImportMetaEnv): string | undefined {
  const v = import.meta.env[name];
  if (typeof v !== "string") {
    return undefined;
  }
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export interface NakamaPublicConfig {
  serverKey: string;
  host: string;
  port: string;
  useSSL: boolean;
}

export function getNakamaPublicConfig(): NakamaPublicConfig {
  const host = read("VITE_NAKAMA_HOST");
  const port = read("VITE_NAKAMA_PORT");
  const serverKey = read("VITE_NAKAMA_SERVER_KEY");
  const sslFlag = read("VITE_NAKAMA_USE_SSL");
  const useSSL = sslFlag === "true" || sslFlag === "1";

  if (import.meta.env.PROD) {
    if (!host || !port || !serverKey || sslFlag === undefined) {
      throw new Error(
        "Set VITE_NAKAMA_HOST, VITE_NAKAMA_PORT, VITE_NAKAMA_SERVER_KEY, and VITE_NAKAMA_USE_SSL for production builds (see frontend/.env.example)."
      );
    }
    return { host, port, serverKey, useSSL };
  }

  return {
    host: host ?? "127.0.0.1",
    port: port ?? "7350",
    serverKey: serverKey ?? "defaultkey",
    useSSL: sslFlag !== undefined ? useSSL : false
  };
}
