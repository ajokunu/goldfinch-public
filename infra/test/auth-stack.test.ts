import { Match, Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';
import { TEST_ENV, testApp, testConfig } from './helpers';

function synthAuthStack(context: Record<string, unknown> = {}): Template {
  const app = testApp(context);
  const stack = new AuthStack(app, 'GoldFinch-Auth-test', {
    env: TEST_ENV,
    config: testConfig(app),
  });
  return Template.fromStack(stack);
}

describe('AuthStack', () => {
  const template = synthAuthStack();

  test('user pool is Essentials with self-signup disabled', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTier: 'ESSENTIALS',
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  test('passkey and EMAIL_OTP are allowed first auth factors', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        SignInPolicy: Match.objectLike({
          // Match.arrayWith is order-sensitive; the pool synthesizes
          // [PASSWORD, EMAIL_OTP, WEB_AUTHN] (PASSWORD is mandatory at the
          // pool level, though the app client never exposes it).
          AllowedFirstAuthFactors: Match.arrayWith(['EMAIL_OTP', 'WEB_AUTHN']),
        }),
      }),
    });
  });

  test('app client is public with ALLOW_USER_AUTH only and the goldfinch/api scope', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_AUTH']),
      AllowedOAuthFlows: ['code'],
      // The resource-server scope references the UserPoolResourceServer at
      // deploy time, so it synthesizes as Fn::Join [Ref(resource server), '/api'].
      AllowedOAuthScopes: Match.arrayWith([
        'openid',
        'email',
        'profile',
        Match.objectLike({
          'Fn::Join': ['', Match.arrayWith(['/api'])],
        }),
      ]),
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      // Refresh-token hardening: 30 days expressed in minutes (was 129600/90d).
      RefreshTokenValidity: 43200,
      // Rotation enabled: every token-endpoint refresh mints a new refresh
      // token and invalidates the prior one after a 60s retry grace window.
      RefreshTokenRotation: {
        Feature: 'ENABLED',
        RetryGracePeriodSeconds: 60,
      },
    });
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    for (const client of Object.values(clients)) {
      const props = (client as { Properties: Record<string, unknown> }).Properties;
      expect(props['GenerateSecret']).toBeFalsy();
      const flows = props['ExplicitAuthFlows'] as string[];
      expect(flows).not.toContain('ALLOW_USER_PASSWORD_AUTH');
      expect(flows).not.toContain('ALLOW_ADMIN_USER_PASSWORD_AUTH');
      expect(flows).not.toContain('ALLOW_CUSTOM_AUTH');
      // With refresh-token rotation enabled the L2 omits
      // ALLOW_REFRESH_TOKEN_AUTH (the InitiateAuth REFRESH_TOKEN_AUTH path);
      // the app refreshes via the OAuth2 token endpoint, which is unaffected.
      expect(flows).not.toContain('ALLOW_REFRESH_TOKEN_AUTH');
    }
  });

  test('prod trust surface excludes plaintext localhost (CloudFront + native scheme only)', () => {
    // Mirrors the committed cdk.json prod context. The PROD callback/logout
    // allow-list must trust ONLY the CloudFront origin and the goldfinch://
    // native scheme — never plaintext http://localhost (re-added locally via a
    // non-committed override). A localhost URL on the prod client is an open
    // redirect / token-delivery surface to any process on a dev machine.
    const prodTemplate = synthAuthStack({
      'goldfinch:callbackUrls':
        'goldfinch://callback,https://d38nsjbqmk44hx.cloudfront.net/callback',
      'goldfinch:logoutUrls': 'goldfinch://signout,https://d38nsjbqmk44hx.cloudfront.net',
    });
    prodTemplate.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: [
        'goldfinch://callback',
        'https://d38nsjbqmk44hx.cloudfront.net/callback',
      ],
      LogoutURLs: ['goldfinch://signout', 'https://d38nsjbqmk44hx.cloudfront.net'],
    });
    const json = JSON.stringify(prodTemplate.toJSON());
    expect(json).not.toContain('localhost');
    expect(json).not.toContain('http://');
  });

  test('resource server "goldfinch" exposes the "api" scope', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'goldfinch',
      Scopes: [Match.objectLike({ ScopeName: 'api' })],
    });
  });

  test('pre-token-generation V2 trigger is attached', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        PreTokenGenerationConfig: Match.objectLike({ LambdaVersion: 'V2_0' }),
      }),
    });
  });

  test('custom-message trigger is attached for the branded EMAIL_OTP email', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        CustomMessage: Match.anyValue(),
      }),
    });
    // Cognito is granted invoke on the custom-message function.
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'cognito-idp.amazonaws.com',
    });
  });

  test('exactly two admin-provisioned users with suppressed invites', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolUser', 2);
    template.hasResourceProperties('AWS::Cognito::UserPoolUser', {
      MessageAction: 'SUPPRESS',
      UserAttributes: Match.arrayWith([
        Match.objectLike({ Name: 'email_verified', Value: 'true' }),
      ]),
    });
  });

  test('managed login domain uses the newer managed login branding', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      ManagedLoginVersion: 2,
    });
  });

  test('managed login branding applies the GoldFinch style, not Cognito defaults', () => {
    // No longer the plain white default: UseCognitoProvidedValues must be off
    // (false/absent) and a real Settings document must be present.
    const brandings = template.findResources('AWS::Cognito::ManagedLoginBranding');
    const entries = Object.values(brandings);
    expect(entries).toHaveLength(1);
    const props = (entries[0] as { Properties: Record<string, unknown> }).Properties;
    expect(props['UseCognitoProvidedValues']).toBeFalsy();

    // Settings document carries the GoldFinch Meridian style tokens.
    const settings = props['Settings'] as
      | {
          components?: {
            primaryButton?: { lightMode?: { defaults?: { backgroundColor?: string } } };
            form?: { borderRadius?: number };
            pageBackground?: { image?: { enabled?: boolean } };
          };
        }
      | undefined;
    expect(settings).toBeDefined();
    expect(settings?.components?.primaryButton?.lightMode?.defaults?.backgroundColor).toBe(
      '1e4d3fff',
    );
    expect(settings?.components?.form?.borderRadius).toBe(16);
    expect(settings?.components?.pageBackground?.image?.enabled).toBe(true);

    // At least one branding asset (background + form logo), with a base64 body.
    const assets = props['Assets'] as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(assets)).toBe(true);
    expect((assets ?? []).length).toBeGreaterThanOrEqual(1);
    const categories = (assets ?? []).map((a) => a['Category']);
    expect(categories).toContain('PAGE_BACKGROUND');
    expect(categories).toContain('FORM_LOGO');
    for (const a of assets ?? []) {
      expect(typeof a['Bytes']).toBe('string');
      expect((a['Bytes'] as string).length).toBeGreaterThan(0);
      expect(['LIGHT', 'DARK', 'DYNAMIC']).toContain(a['ColorMode']);
    }
  });

  test('managed login branding provides both LIGHT and DARK color modes', () => {
    const brandings = template.findResources('AWS::Cognito::ManagedLoginBranding');
    const props = (Object.values(brandings)[0] as { Properties: Record<string, unknown> })
      .Properties;

    // Light/dark differentiation lives in the Settings color tokens; both the
    // form surface and the primary button carry distinct lightMode/darkMode.
    const settings = props['Settings'] as
      | {
          components?: {
            form?: { lightMode?: { backgroundColor?: string }; darkMode?: { backgroundColor?: string } };
            primaryButton?: {
              lightMode?: { defaults?: { backgroundColor?: string } };
              darkMode?: { defaults?: { backgroundColor?: string } };
            };
          };
          categories?: { global?: { colorSchemeMode?: string } };
        }
      | undefined;
    expect(settings?.components?.form?.lightMode?.backgroundColor).toBeDefined();
    expect(settings?.components?.form?.darkMode?.backgroundColor).toBeDefined();
    expect(settings?.components?.primaryButton?.lightMode?.defaults?.backgroundColor).toBeDefined();
    expect(settings?.components?.primaryButton?.darkMode?.defaults?.backgroundColor).toBeDefined();
    // Browser-adaptive: a single DYNAMIC image asset serves both modes.
    expect(settings?.categories?.global?.colorSchemeMode).toBe('DYNAMIC');
    template.hasResourceProperties('AWS::Cognito::ManagedLoginBranding', {
      // CDK emits the literal `false` (not absent) when custom values are used.
      UseCognitoProvidedValues: false,
      Assets: Match.arrayWith([
        Match.objectLike({ Category: 'PAGE_BACKGROUND', ColorMode: 'DYNAMIC' }),
        Match.objectLike({ Category: 'FORM_LOGO', ColorMode: 'DYNAMIC' }),
      ]),
    });
  });

  test('snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
