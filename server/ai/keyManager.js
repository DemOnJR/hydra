const SERVICE_NAME = "hydra-ai";
const PROVIDER_ENV_VARS = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY"
};

const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_ENV_VARS);

let keytarPromise;
let keytarUnavailableLogged = false;

function normalizeProvider(provider) {
  const normalized = provider?.trim().toLowerCase();

  if (!SUPPORTED_PROVIDERS.includes(normalized)) {
    throw new Error(`Unsupported provider "${provider}".`);
  }

  return normalized;
}

function getEnvVarName(provider) {
  return PROVIDER_ENV_VARS[normalizeProvider(provider)];
}

function maskKey(key) {
  if (!key) {
    return null;
  }

  if (key.length <= 8) {
    return "configured";
  }

  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function getKeytar() {
  if (!keytarPromise) {
    keytarPromise = import("keytar")
      .then((module) => module.default ?? module)
      .catch((error) => {
        if (!keytarUnavailableLogged) {
          console.warn(`[AI] keytar unavailable, falling back to environment variables: ${error.message}`);
          keytarUnavailableLogged = true;
        }

        return null;
      });
  }

  return keytarPromise;
}

async function getKeytarKey(provider) {
  const keytar = await getKeytar();

  if (!keytar) {
    return null;
  }

  return keytar.getPassword(SERVICE_NAME, provider);
}

export async function getKeyStorageInfo() {
  const keytar = await getKeytar();

  return {
    backend: keytar ? "keytar" : "environment",
    available: Boolean(keytar)
  };
}

export async function getProviderStatus(provider) {
  const normalized = normalizeProvider(provider);
  const envVar = getEnvVarName(normalized);
  const envValue = process.env[envVar]?.trim();

  if (envValue) {
    return {
      provider: normalized,
      configured: true,
      source: "env",
      envVar,
      maskedKey: maskKey(envValue)
    };
  }

  const storedValue = (await getKeytarKey(normalized))?.trim();

  if (storedValue) {
    process.env[envVar] = storedValue;

    return {
      provider: normalized,
      configured: true,
      source: "keytar",
      envVar,
      maskedKey: maskKey(storedValue)
    };
  }

  return {
    provider: normalized,
    configured: false,
    source: "none",
    envVar,
    maskedKey: null
  };
}

export async function getProviderStatuses() {
  return Promise.all(SUPPORTED_PROVIDERS.map((provider) => getProviderStatus(provider)));
}

export async function loadApiKeys() {
  const statuses = await getProviderStatuses();

  return {
    providers: statuses,
    storage: await getKeyStorageInfo()
  };
}

export async function saveApiKey(provider, apiKey) {
  const normalized = normalizeProvider(provider);
  const trimmed = apiKey?.trim();

  if (!trimmed) {
    throw new Error("API key is required.");
  }

  const keytar = await getKeytar();

  if (!keytar) {
    throw new Error("OS keychain is unavailable. Use environment variables for API keys.");
  }

  await keytar.setPassword(SERVICE_NAME, normalized, trimmed);
  process.env[getEnvVarName(normalized)] = trimmed;

  return getProviderStatus(normalized);
}

export async function deleteApiKey(provider) {
  const normalized = normalizeProvider(provider);
  const keytar = await getKeytar();

  if (keytar) {
    await keytar.deletePassword(SERVICE_NAME, normalized);
  }

  delete process.env[getEnvVarName(normalized)];

  return getProviderStatus(normalized);
}

export { SUPPORTED_PROVIDERS };
