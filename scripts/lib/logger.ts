type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const v = (process.env.INDIEATLAS_LOG_LEVEL ?? 'info') as Level;
  return ORDER[v] ?? ORDER.info;
}

function log(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const line = fields ? `${message} ${JSON.stringify(fields)}` : message;
  if (level === 'error' || level === 'warn') console.error(`[${level}] ${line}`);
  else console.log(`[${level}] ${line}`);
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => log('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => log('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => log('error', m, f),
};
