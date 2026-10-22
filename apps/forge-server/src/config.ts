export type ForgeServerConfig = Readonly<{
  databaseUrl: string;
  host: string;
  port: number;
  /** Optional PXN control-plane base URL for HttpPxnBridge. */
  pxnBaseUrl?: string;
}>;

export function loadForgeServerConfig(env: NodeJS.ProcessEnv = process.env): ForgeServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  const rawPort = env.PORT ?? '3080';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT_INVALID');
  const pxnBaseUrl = env.PXN_BASE_URL?.trim();
  return Object.freeze({
    databaseUrl,
    host: env.HOST ?? '127.0.0.1',
    port,
    ...(pxnBaseUrl ? { pxnBaseUrl } : {}),
  });
}
