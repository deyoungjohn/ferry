/**
 * Minimal message lookup: defaults plus optional overrides, with {name}
 * placeholders. `useMessages` keeps the signature the swap block expects.
 */
export function useMessages<T extends Record<string, string>>(
  _namespace: string,
  defaults: T,
  overrides?: Partial<T>,
): (key: keyof T, params?: Record<string, string | number>) => string {
  const messages = { ...defaults, ...(overrides ?? {}) } as T;
  return (key, params) => {
    const template = messages[key] ?? String(key);
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`,
    );
  };
}
