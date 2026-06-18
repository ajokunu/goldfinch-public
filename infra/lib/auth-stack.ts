import { CfnOutput, Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import {
  CfnManagedLoginBranding,
  CfnUserPoolUser,
  FeaturePlan,
  LambdaVersion,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  PasskeyUserVerification,
  ResourceServerScope,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
  UserPoolOperation,
  UserPoolResourceServer,
} from 'aws-cdk-lib/aws-cognito';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { EnvConfig } from './config';
import { GoldFinchFunction } from './goldfinch-function';
import { CUSTOM_MESSAGE_ENTRY, PRE_TOKEN_GEN_ENTRY } from './handler-paths';
import { goldFinchLoginBranding } from './login-branding';

export interface AuthStackProps extends StackProps {
  readonly config: EnvConfig;
}

/** Resource server identifier + scope per decision D2: bearer scope is "goldfinch/api". */
export const RESOURCE_SERVER_IDENTIFIER = 'goldfinch';
export const API_SCOPE_NAME = 'api';
export const FULL_API_SCOPE = `${RESOURCE_SERVER_IDENTIFIER}/${API_SCOPE_NAME}`;

/**
 * AuthStack: Cognito user pool on the Essentials plan, passkey/WebAuthn +
 * EMAIL_OTP sign-in via Managed Login, a public app client (ALLOW_USER_AUTH,
 * Authorization Code + PKCE, no secret), the "goldfinch" resource server with
 * the "api" scope, the Pre-Token-Generation V2 trigger injecting the
 * household claim into the ACCESS token, and the two admin-provisioned users.
 */
export class AuthStack extends Stack {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  /** JWT issuer URL for the HTTP API authorizer. */
  public readonly issuerUrl: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    Tags.of(this).add('Component', 'auth');

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `GoldFinch-${config.env}`,
      // Passkeys and choice-based USER_AUTH require Essentials (not Lite);
      // Plus adds per-MAU cost with no benefit at two users.
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      // Passkeys provide the primary user-verification factor. MFA is OPTIONAL
      // (TOTP) as defence-in-depth for the pool-level password first factor:
      // OPTIONAL never forces a challenge unless a user enrolls an authenticator,
      // so the passwordless passkey/EMAIL_OTP flow is unchanged for users who
      // do not opt in (AWS account-review hardening, 2026-06-12).
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      signInPolicy: {
        // Cognito requires PASSWORD to remain an allowed first factor at the
        // pool level; the app client only enables ALLOW_USER_AUTH and the
        // managed login flow offers passkey/EMAIL_OTP, so password sign-in is
        // not exposed to users.
        allowedFirstAuthFactors: {
          password: true,
          passkey: true,
          emailOtp: true,
        },
      },
      // WebAuthn relying party. The RP id is the owned domain (decision D3);
      // until the domain exists the context value is empty and the props are
      // omitted (passkeys can be enabled later without pool replacement).
      ...(config.relyingPartyId.length > 0
        ? {
            passkeyRelyingPartyId: config.relyingPartyId,
            passkeyUserVerification: PasskeyUserVerification.REQUIRED,
          }
        : {}),
      deletionProtection: config.env === 'prod',
      removalPolicy: config.removalPolicy,
    });

    // Managed Login (hosted UI) so the browser performs the WebAuthn ceremony.
    new UserPoolDomain(this, 'ManagedLoginDomain', {
      userPool: this.userPool,
      cognitoDomain: { domainPrefix: config.cognitoDomainPrefix },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // Resource server + scope (decision D2): access tokens carry goldfinch/api.
    const apiScope = new ResourceServerScope({
      scopeName: API_SCOPE_NAME,
      scopeDescription: 'Read/write access to the GoldFinch app API',
    });
    const resourceServer = new UserPoolResourceServer(this, 'ApiResourceServer', {
      userPool: this.userPool,
      identifier: RESOURCE_SERVER_IDENTIFIER,
      userPoolResourceServerName: 'GoldFinch API',
      scopes: [apiScope],
    });

    this.userPoolClient = new UserPoolClient(this, 'AppClient', {
      userPool: this.userPool,
      userPoolClientName: `goldfinch-app-${config.env}`,
      // Public client: native + web app, PKCE, no secret.
      generateSecret: false,
      // ALLOW_USER_AUTH only - explicitly not userPassword/adminUserPassword/custom.
      authFlows: { user: true },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          OAuthScope.OPENID,
          OAuthScope.EMAIL,
          OAuthScope.PROFILE,
          OAuthScope.resourceServer(resourceServer, apiScope),
        ],
        callbackUrls: config.callbackUrls,
        logoutUrls: config.logoutUrls,
      },
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      // Refresh-token hardening: 30-day TTL (was 90) shrinks the window a
      // leaked/persisted refresh token stays usable. Paired with rotation
      // below and enableTokenRevocation, a stolen refresh token is both
      // short-lived AND single-use.
      refreshTokenValidity: Duration.days(30),
      // Refresh-token rotation (Essentials supports it). Setting the grace
      // period turns on RefreshTokenRotation.feature=ENABLED: every
      // grant_type=refresh_token at the hosted-UI token endpoint mints a NEW
      // refresh token and invalidates the prior one after the grace window,
      // so a captured refresh token cannot be replayed. The client already
      // persists the rotated refresh_token from the token response
      // (app/src/auth/tokenStore.ts), so rotation is transparent to it. The
      // 60-second retry grace period keeps a brief overlap so an in-flight
      // refresh retry (e.g. flaky network) does not lock the user out.
      // NOTE: enabling rotation makes the L2 omit ALLOW_REFRESH_TOKEN_AUTH
      // from ExplicitAuthFlows. That flow gates the InitiateAuth
      // REFRESH_TOKEN_AUTH API path only; the app refreshes via the OAuth2
      // token endpoint (Expo AuthSession.refreshAsync), which is unaffected.
      refreshTokenRotationGracePeriod: Duration.seconds(60),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    // Managed Login v2 refuses to serve ANY login page for a client without a
    // branding style ("Login pages unavailable" error). This applies the
    // GoldFinch "Meridian" style (deep-green primary, gold accent, translucent
    // paper card over a glass background image) instead of Cognito's plain
    // white default. One style covers BOTH the email sign-in page and the
    // EMAIL_OTP code-entry page, since Managed Login v2 renders both from the
    // single branding document attached to this app client.
    const branding = goldFinchLoginBranding();
    new CfnManagedLoginBranding(this, 'AppClientBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: false,
      settings: branding.settings,
      assets: branding.assets,
    });

    // Pre-Token-Generation V2 trigger: injects household="goldfinch-home"
    // into the ACCESS token (KEY decision). V2 is required to edit access
    // token claims; available on Essentials.
    const preTokenGenFn = new GoldFinchFunction(this, 'PreTokenGenFn', {
      entry: PRE_TOKEN_GEN_ENTRY,
      memorySize: 128,
      timeout: Duration.seconds(5),
      environment: { HOUSEHOLD_ID: config.householdId },
      logRetention: config.logRetention,
      description: 'Injects the household claim into Cognito access tokens (pre-token-gen V2)',
    });
    this.userPool.addTrigger(
      UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenGenFn,
      LambdaVersion.V2_0,
    );

    // CustomMessage trigger: replaces Cognito's plain default body for the
    // EMAIL_OTP sign-in code (and the other code-bearing sources) with a
    // GoldFinch-branded inline-CSS HTML email. Infra-owned, no IAM beyond
    // CloudWatch Logs; addTrigger grants Cognito invoke on the function.
    const customMessageFn = new GoldFinchFunction(this, 'CustomMessageFn', {
      entry: CUSTOM_MESSAGE_ENTRY,
      memorySize: 128,
      timeout: Duration.seconds(5),
      logRetention: config.logRetention,
      description: 'Brands the GoldFinch EMAIL_OTP sign-in code email (Cognito CustomMessage)',
    });
    this.userPool.addTrigger(UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    // Closed pool: exactly two admin-provisioned users, invite email suppressed.
    // Emails are context placeholders until the real addresses are supplied.
    new CfnUserPoolUser(this, 'UserA', {
      userPoolId: this.userPool.userPoolId,
      username: config.userAEmail,
      messageAction: 'SUPPRESS',
      userAttributes: [
        { name: 'email', value: config.userAEmail },
        { name: 'email_verified', value: 'true' },
      ],
    });
    new CfnUserPoolUser(this, 'UserB', {
      userPoolId: this.userPool.userPoolId,
      username: config.userBEmail,
      messageAction: 'SUPPRESS',
      userAttributes: [
        { name: 'email', value: config.userBEmail },
        { name: 'email_verified', value: 'true' },
      ],
    });

    this.issuerUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'IssuerUrl', { value: this.issuerUrl });
    new CfnOutput(this, 'ApiScope', { value: FULL_API_SCOPE });

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-COG1',
        reason:
          'Primary sign-in is passwordless (passkey/WebAuthn with EMAIL_OTP fallback); the app client exposes only ALLOW_USER_AUTH, so no password policy surface is reachable by users.',
      },
      {
        id: 'AwsSolutions-COG2',
        reason:
          'Passkeys with required user verification provide phishing-resistant authentication; classic MFA on top of WebAuthn adds friction with no security gain for a two-user closed pool.',
      },
      {
        id: 'AwsSolutions-COG3',
        reason:
          'AdvancedSecurityMode ENFORCED requires the Plus feature plan, a per-MAU cost rejected by the cost model for a two-user closed pool with self-signup disabled.',
      },
      {
        id: 'AwsSolutions-COG8',
        reason:
          'The Plus feature plan adds per-MAU cost for threat protection that a two-user closed pool (self-signup disabled, passkey-first sign-in, admin-provisioned users only) does not need; Essentials is the deliberate cost-model choice.',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'The pre-token-generation and custom-message Lambdas use the AWS-managed AWSLambdaBasicExecutionRole policy for CloudWatch Logs only; they have no other permissions.',
      },
      {
        id: 'AwsSolutions-L1',
        reason:
          'Runtime is pinned to the Node LTS that the esbuild bundling target (node22) matches; upgrades happen deliberately in lockstep.',
      },
    ]);
  }
}
