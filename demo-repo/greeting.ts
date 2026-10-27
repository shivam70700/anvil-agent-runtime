/**
 * Greeting and formatting utilities for demo repository.
 */

export function formatGreeting(name: string, title?: string): string {
  const prefix = title ? `${title} ` : "";
  return `Hello, ${prefix}${name.trim()}! Welcome to Anvil.`;
}

export function formatError(message: string, code: number = 500): string {
  return `[Error ${code}] ${message}`;
}
