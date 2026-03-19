const dotenv = require('dotenv');

dotenv.config();

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function createConfig () {
  const config = {
    port: numberFromEnv(process.env.SYMPLE_PORT, 4500),
    sessionTTL: numberFromEnv(process.env.SYMPLE_SESSION_TTL, -1),
    authentication: booleanFromEnv(process.env.SYMPLE_AUTHENTICATION, false),
    dynamicRooms: booleanFromEnv(process.env.SYMPLE_DYNAMIC_ROOMS, true),
    redis: redisUrlFromEnv()
  };

  const ssl = buildSslConfig();
  if (ssl) {
    config.ssl = ssl;
  }

  return config;
}

function numberFromEnv (value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function booleanFromEnv (value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
}

function redisUrlFromEnv () {
  const explicit = process.env.SYMPLE_REDIS_URL || process.env.REDIS_URL;
  if (explicit) {
    return explicit;
  }

  const host = process.env.SYMPLE_REDIS_HOST || process.env.REDIS_HOST;
  const port = process.env.SYMPLE_REDIS_PORT || process.env.REDIS_PORT;
  if (!host && !port) {
    return undefined;
  }

  const protocol = process.env.SYMPLE_REDIS_PROTOCOL || 'redis';
  return `${protocol}://${host || 'localhost'}:${port || '6379'}`;
}

function buildSslConfig () {
  const enabled = booleanFromEnv(process.env.SYMPLE_SSL_ENABLED, false);
  if (!enabled) {
    return undefined;
  }

  const key = process.env.SYMPLE_SSL_KEY;
  const cert = process.env.SYMPLE_SSL_CERT;

  if (!key || !cert) {
    console.warn('SYMPLE_SSL_ENABLED is true but SYMPLE_SSL_KEY or SYMPLE_SSL_CERT are not set. Falling back to HTTP.');
    return undefined;
  }

  return { enabled: true, key, cert };
}

module.exports = {
  createConfig,
  utils: {
    numberFromEnv,
    booleanFromEnv,
    buildSslConfig,
    redisUrlFromEnv
  }
};
