const providers = new Map();

/**
 * Register a new AI provider adapter.
 * @param {string} name - The name of the provider (e.g., 'chatgpt').
 * @param {object} adapter - The adapter implementation.
 */
export function registerProvider(name, adapter) {
  providers.set(name, adapter);
  console.info(`[Injectors] Registered provider: ${name}`);
}

/**
 * Get a provider adapter by name.
 * @param {string} name - The name of the provider.
 * @returns {object|null} The adapter or null if not found.
 */
export async function getProvider(name) {
  if (providers.has(name)) {
    return providers.get(name);
  }

  // Fallback for lazy loading if needed, or just return null
  return null;
}

export function getAllProviders() {
  return Array.from(providers.keys());
}
