import Loader from './loader';

/** Lazy require so importing `Loaders` does not load the SDK (Jest / tree-shaking friendly). */
const loadAkeyless = function (): typeof import('akeyless') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('akeyless');
};

const normalizePath = function (p: string): string {
  return p.startsWith('/') ? p : `/${p}`;
};

const stringifySecretValue = function (value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
};

const pickSecretFromResponse = function (
  requestedPath: string,
  data: Record<string, unknown> | null | undefined
): string {
  if (!data || typeof data !== 'object') {
    throw new Error('Akeyless returned an empty secret payload');
  }
  const trimmed = requestedPath.trim();
  const candidates = [
    trimmed,
    normalizePath(trimmed),
    trimmed.replace(/^\//, ''),
  ];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const s = stringifySecretValue(data[key]);
      if (s !== '') {
        return s;
      }
    }
  }
  for (const value of Object.values(data)) {
    const s = stringifySecretValue(value);
    if (s.trim() !== '') {
      return s;
    }
  }
  throw new Error(`No value for "${requestedPath}" in Akeyless response`);
};

/**
 * AkeylessLoader loads a static secret from Akeyless via the public API or a Gateway.
 * Pattern: akeyless(optionalArgs):/path/to/static-secret
 *
 * Environment:
 * - AKEYLESS_GATEWAY_URL — API / Gateway base URL (default: https://api.akeyless.io)
 * - AKEYLESS_TOKEN — optional; if set, used instead of access-key auth
 * - AKEYLESS_ACCESS_ID and AKEYLESS_ACCESS_KEY — access_key auth when no token
 *
 * Optional loader args (comma-separated key=value), override env where noted:
 * - gateway — same as AKEYLESS_GATEWAY_URL
 * - ignore-cache — passed to get-secret-value (true/false)
 * - json — request JSON-shaped payload from API (true/false)
 * - version — secret version (number)
 */
export default class AkeylessLoader extends Loader {
  private static PATTERN =
    /^akeyless(\(([:a-zA-Z0-9_;(=),\\.\-/]*)?\))?:([a-zA-Z0-9_.\-/]+)$/;

  public canResolve(value: string): boolean {
    return value.match(AkeylessLoader.PATTERN) !== null;
  }

  public async resolve(variable: string): Promise<string> {
    const groups = variable.match(AkeylessLoader.PATTERN);
    if (groups === null) {
      throw new Error(
        'AkeylessLoader cannot parse the variable name. This should never happen \
since the client is supposed to be calling canResolve first'
      );
    }
    const args = this.getArgsFromStr(groups[2]);
    const secretPath = groups[3];

    const gateway =
      args.gateway ||
      process.env.AKEYLESS_GATEWAY_URL?.trim() ||
      'https://api.akeyless.io';

    const akeyless = loadAkeyless();
    const client = new akeyless.ApiClient();
    client.basePath = gateway.replace(/\/$/, '');
    const api = new akeyless.V2Api(client);

    let token = process.env.AKEYLESS_TOKEN?.trim();
    if (!token) {
      const accessId = process.env.AKEYLESS_ACCESS_ID?.trim();
      const accessKey = process.env.AKEYLESS_ACCESS_KEY?.trim();
      if (!accessId || !accessKey) {
        throw new Error(
          'Akeyless auth is not configured: set AKEYLESS_TOKEN, or both AKEYLESS_ACCESS_ID and AKEYLESS_ACCESS_KEY'
        );
      }
      const authBody = akeyless.Auth.constructFromObject({
        'access-id': accessId,
        'access-key': accessKey,
        'access-type': 'access_key',
      });
      const authOut = await api.auth(authBody);
      token = authOut?.token?.trim();
      if (!token) {
        throw new Error('Akeyless authentication did not return a token');
      }
    }

    const getBody: Record<string, unknown> = {
      names: [secretPath],
      token,
    };
    if (args['ignore-cache'] !== undefined) {
      getBody['ignore-cache'] =
        args['ignore-cache'] === 'true' ? 'true' : 'false';
    }
    if (args.json === 'true') {
      getBody.json = true;
    }
    if (args.version !== undefined) {
      const n = Number(args.version);
      if (!Number.isFinite(n)) {
        throw new Error('Akeyless loader "version" argument must be a number');
      }
      getBody.version = n;
    }

    const payload = akeyless.GetSecretValue.constructFromObject(getBody);
    const raw = (await api.getSecretValue(payload)) as Record<
      string,
      unknown
    >;
    return pickSecretFromResponse(secretPath, raw);
  }
}
