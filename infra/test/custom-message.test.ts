import {
  buildSignInEmail,
  CustomMessageEvent,
  handler,
  SIGN_IN_SUBJECT,
} from '../lambda/custom-message';

const CODE_PLACEHOLDER = '{####}';

function baseEvent(triggerSource: string): CustomMessageEvent {
  return {
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_TESTPOOL',
    userName: 'aaron@example.com',
    triggerSource,
    request: {
      codeParameter: CODE_PLACEHOLDER,
      userAttributes: { email: 'aaron@example.com', email_verified: 'true' },
    },
    response: {},
  };
}

describe('custom-message handler', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('sign-in EMAIL_OTP (CustomMessage_Authentication) gets branded subject + HTML with the code placeholder', async () => {
    const out = await handler(baseEvent('CustomMessage_Authentication'));
    expect(out.response.emailSubject).toBe(SIGN_IN_SUBJECT);
    expect(out.response.emailSubject).toBe('Your GoldFinch sign-in code');
    const body = out.response.emailMessage ?? '';
    expect(body).toContain(CODE_PLACEHOLDER);
    expect(body).toContain('GoldFinch');
    expect(body).toContain('Enter this code to sign in. It expires shortly.');
    expect(body).toContain('If this was not you, ignore this email.');
    // Meridian-green accent header, inline CSS, no external image fetch.
    expect(body).toContain('#1E4D3F');
    expect(body.toLowerCase()).not.toContain('<style');
    expect(body).not.toContain('<img');
    // Comfortably within the 20,000 UTF-8 character Cognito limit.
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(20000);
  });

  test.each([
    'CustomMessage_SignUp',
    'CustomMessage_ResendCode',
    'CustomMessage_ForgotPassword',
    'CustomMessage_VerifyUserAttribute',
    'CustomMessage_UpdateUserAttribute',
  ])('code-bearing source %s is branded and preserves the code placeholder', async (source) => {
    const out = await handler(baseEvent(source));
    expect(out.response.emailSubject).toBe(SIGN_IN_SUBJECT);
    expect(out.response.emailMessage ?? '').toContain(CODE_PLACEHOLDER);
  });

  test.each(['CustomMessage_AdminCreateUser', 'TokenGeneration_Authentication', 'PreSignUp_SignUp'])(
    'non-branded trigger source %s passes through untouched',
    async (source) => {
      const event = baseEvent(source);
      const out = await handler(event);
      expect(out.response.emailSubject).toBeUndefined();
      expect(out.response.emailMessage).toBeUndefined();
      // The event object is returned for Cognito to send its default template.
      expect(out).toBe(event);
    },
  );

  test('honors the literal codeParameter value rather than hardcoding {####}', async () => {
    const event = baseEvent('CustomMessage_Authentication');
    // Cognito always sends "{####}", but the handler must echo whatever it gets.
    (event.request as { codeParameter: string }).codeParameter = '{####}';
    const out = await handler(event);
    expect(out.response.emailMessage ?? '').toContain('{####}');
  });

  test('missing codeParameter on a code-bearing source falls back to the default template (no body emitted)', async () => {
    const event = baseEvent('CustomMessage_Authentication');
    delete (event.request as { codeParameter?: string }).codeParameter;
    const out = await handler(event);
    expect(out.response.emailMessage).toBeUndefined();
    expect(out.response.emailSubject).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  test('never throws, even on a malformed event', async () => {
    const malformed = {
      triggerSource: 'CustomMessage_Authentication',
      userPoolId: 'us-east-1_TESTPOOL',
      // request intentionally absent to trigger the catch path.
    } as unknown as CustomMessageEvent;
    await expect(handler(malformed)).resolves.toBeDefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  test('buildSignInEmail centers the code and includes the muted footer', () => {
    const html = buildSignInEmail(CODE_PLACEHOLDER);
    expect(html).toContain('text-align:center');
    expect(html).toContain('Please do not reply');
    expect(html).toContain(CODE_PLACEHOLDER);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});
