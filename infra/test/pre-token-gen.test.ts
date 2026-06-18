import { handler, PreTokenGenV2Event } from '../lambda/pre-token-gen';

function baseEvent(): PreTokenGenV2Event {
  return {
    version: '2',
    triggerSource: 'TokenGeneration_Authentication',
    userPoolId: 'us-east-1_TESTPOOL',
    userName: 'aaron@example.com',
    request: {
      userAttributes: { sub: 'abc-123', email: 'aaron@example.com' },
      scopes: ['openid', 'goldfinch/api'],
    },
    response: {},
  };
}

describe('pre-token-gen handler', () => {
  afterEach(() => {
    delete process.env['HOUSEHOLD_ID'];
  });

  test('injects household=goldfinch-home into the ACCESS token by default', async () => {
    const out = await handler(baseEvent());
    expect(
      out.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride,
    ).toEqual({ household: 'goldfinch-home' });
  });

  test('honors the HOUSEHOLD_ID environment variable', async () => {
    process.env['HOUSEHOLD_ID'] = 'goldfinch-test';
    const out = await handler(baseEvent());
    expect(
      out.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride?.[
        'household'
      ],
    ).toBe('goldfinch-test');
  });

  test('preserves any pre-existing override details', async () => {
    const event = baseEvent();
    event.response.claimsAndScopeOverrideDetails = {
      accessTokenGeneration: {
        scopesToAdd: ['goldfinch/api'],
        claimsToAddOrOverride: { existing: 'value' },
      },
    };
    const out = await handler(event);
    const access = out.response.claimsAndScopeOverrideDetails?.accessTokenGeneration;
    expect(access?.scopesToAdd).toEqual(['goldfinch/api']);
    expect(access?.claimsToAddOrOverride).toEqual({
      existing: 'value',
      household: 'goldfinch-home',
    });
  });

  test('does not touch the ID token claims', async () => {
    const out = await handler(baseEvent());
    expect(out.response.claimsAndScopeOverrideDetails?.idTokenGeneration).toBeUndefined();
  });
});
