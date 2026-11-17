/** Structured JSON logs (Workers Observability). Never pass secrets here. */
export function log(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, ...data });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
