const dotenv = require('dotenv');

dotenv.config();

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const DEFAULT_CORS_ORIGINS = true; // allow all origins by default
const DEFAULT_CORS_METHODS = ['GET', 'POST'];

function createConfig() {
  const config = {
    port: numberFromEnv(process.env.SYMPLE_PORT, 4500),
    sessionTTL: numberFromEnv(process.env.SYMPLE_SESSION_TTL, -1),
    authentication: booleanFromEnv(process.env.SYMPLE_AUTHENTICATION, false),
    dynamicRooms: booleanFromEnv(process.env.SYMPLE_DYNAMIC_ROOMS, true),
    redis: redisUrlFromEnv(),
    cors: buildCorsConfig()
  };

  const ssl = buildSslConfig();
  if (ssl) {
    config.ssl = ssl;
  }

  return config;
}

function numberFromEnv(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function booleanFromEnv(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = value.toString().trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
}

function redisUrlFromEnv() {
  const explicit = process.env.SYMPLE_REDIS_URL || process.env.REDIS_URL;
  if (explicit) {
    return explicit;
  }

  const protocol = process.env.SYMPLE_REDIS_PROTOCOL || 'redis';
  const host = process.env.SYMPLE_REDIS_HOST || process.env.REDIS_HOST || 'localhost';
  const port = process.env.SYMPLE_REDIS_PORT || process.env.REDIS_PORT || '6379';

  return `${protocol}://${host}:${port}`;
}

function buildCorsConfig() {
  const origins = parseCorsOrigins(process.env.SYMPLE_CORS_ORIGINS);
  const methods = parseCorsMethods(process.env.SYMPLE_CORS_METHODS);
  const credentials = parseCorsCredentials(process.env.SYMPLE_CORS_CREDENTIALS);

  const cors = {
    origin: origins,
    methods
  };

  if (credentials !== undefined) {
    cors.credentials = credentials;
  }

  return cors;
}

function parseCorsOrigins(value) {
  if (value === undefined || value === null) {
    return DEFAULT_CORS_ORIGINS;
  }

  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'true') {
    return true;
  }

  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseCorsMethods(value) {
  if (value === undefined || value === null || value.trim() === '') {
    return [...DEFAULT_CORS_METHODS];
  }

  return value
    .split(',')
    .map((method) => method.trim())
    .filter(Boolean);
}

function parseCorsCredentials(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return booleanFromEnv(value, false);
}

function buildSslConfig() {
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

  return {
    enabled: true,
    key,
    cert
  };
}

module.exports = {
  createConfig,
  defaults: {
    corsOrigins: DEFAULT_CORS_ORIGINS,
    corsMethods: DEFAULT_CORS_METHODS
  },
  utils: {
    numberFromEnv,
    booleanFromEnv,
    parseCorsOrigins,
    parseCorsMethods,
    parseCorsCredentials,
    buildCorsConfig,
    buildSslConfig,
    redisUrlFromEnv
  }
};
