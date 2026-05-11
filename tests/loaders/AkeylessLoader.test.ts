import AkeylessLoader from '../../src/loaders/AkeylessLoader';

const mockAuth = jest.fn();
const mockGetSecretValue = jest.fn();

jest.mock('akeyless', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({ basePath: '' })),
  V2Api: jest.fn().mockImplementation(() => ({
    auth: mockAuth,
    getSecretValue: mockGetSecretValue,
  })),
  Auth: {
    constructFromObject: (data: Record<string, unknown>) => data,
  },
  GetSecretValue: {
    constructFromObject: (data: Record<string, unknown>) => data,
  },
}));

describe('AkeylessLoader', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    mockAuth.mockReset();
    mockGetSecretValue.mockReset();
    mockAuth.mockResolvedValue({ token: 'test-token' });
    mockGetSecretValue.mockResolvedValue({ '/app/db': 'secret-value' });
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should return true on canResolve for valid patterns', () => {
    const loader = new AkeylessLoader();
    const valid = [
      'akeyless:/app/db',
      'akeyless:app/db',
      'akeyless(gateway=https://gw.example.com:8080/v2):/app/db',
      'akeyless(ignore-cache=true,json=true):/app/db',
    ];
    for (const v of valid) {
      expect(loader.canResolve(v)).toBeTruthy();
    }
  });

  it('should return false on canResolve for invalid patterns', () => {
    const loader = new AkeylessLoader();
    const invalid = [
      '',
      'akeyless:',
      'akeyless@:/x',
      'akeyless-ssm:/x',
      'aws-ssm:/x',
    ];
    for (const v of invalid) {
      expect(loader.canResolve(v)).not.toBeTruthy();
    }
  });

  it('should resolve using AKEYLESS_ACCESS_ID and AKEYLESS_ACCESS_KEY', async () => {
    process.env.AKEYLESS_ACCESS_ID = 'id';
    process.env.AKEYLESS_ACCESS_KEY = 'key';
    delete process.env.AKEYLESS_TOKEN;
    mockGetSecretValue.mockResolvedValueOnce({ '/app/db': 'from-mock' });

    const loader = new AkeylessLoader();
    const out = await loader.resolve('akeyless:/app/db');
    expect(out).toBe('from-mock');
    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(mockGetSecretValue).toHaveBeenCalledWith(
      expect.objectContaining({
        names: ['/app/db'],
        token: 'test-token',
      })
    );
  });

  it('should resolve using AKEYLESS_TOKEN without calling auth', async () => {
    process.env.AKEYLESS_TOKEN = 'pre-baked';
    delete process.env.AKEYLESS_ACCESS_ID;
    delete process.env.AKEYLESS_ACCESS_KEY;
    mockGetSecretValue.mockResolvedValueOnce({ '/app/db': 'tok-val' });

    const loader = new AkeylessLoader();
    const out = await loader.resolve('akeyless:/app/db');
    expect(out).toBe('tok-val');
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockGetSecretValue).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'pre-baked',
        names: ['/app/db'],
      })
    );
  });

  it('should pick value when response key omits leading slash', async () => {
    process.env.AKEYLESS_TOKEN = 't';
    mockGetSecretValue.mockResolvedValueOnce({ 'app/db': 'slashless' });

    const loader = new AkeylessLoader();
    const out = await loader.resolve('akeyless:app/db');
    expect(out).toBe('slashless');
  });

  it('should throw when auth is not configured', async () => {
    delete process.env.AKEYLESS_TOKEN;
    delete process.env.AKEYLESS_ACCESS_ID;
    delete process.env.AKEYLESS_ACCESS_KEY;

    const loader = new AkeylessLoader();
    await expect(loader.resolve('akeyless:/x')).rejects.toThrow(
      /AKEYLESS_TOKEN/
    );
  });

  it('should throw when response has no matching secret', async () => {
    process.env.AKEYLESS_TOKEN = 't';
    mockGetSecretValue.mockResolvedValueOnce({});

    const loader = new AkeylessLoader();
    await expect(loader.resolve('akeyless:/missing')).rejects.toThrow(
      /No value/
    );
  });

  it('should throw on invalid version argument', async () => {
    process.env.AKEYLESS_TOKEN = 't';

    const loader = new AkeylessLoader();
    await expect(
      loader.resolve('akeyless(version=not-a-number):/app/db')
    ).rejects.toThrow(/version/);
  });
});
