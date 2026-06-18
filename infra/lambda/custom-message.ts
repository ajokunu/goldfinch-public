/**
 * Cognito CustomMessage trigger: GoldFinch-branded sign-in code email.
 *
 * The user pool signs users in with EMAIL_OTP (and passkey). Without this
 * trigger Cognito sends the one-time code via its plain default template; this
 * function replaces the body (and subject) of the code-bearing emails with a
 * clean, inline-CSS, GoldFinch-branded HTML message.
 *
 * Contract (AWS docs, "Custom message Lambda trigger"):
 *   - The verification/OTP code is delivered as the placeholder string
 *     event.request.codeParameter (literally "{####}"). emailMessage MUST
 *     contain that exact placeholder; Cognito substitutes the real code at
 *     send time. We always reference event.request.codeParameter rather than
 *     hardcoding "{####}", per AWS best practice.
 *   - Response fields are response.emailSubject / response.emailMessage /
 *     response.smsMessage. emailMessage may contain HTML. The email body limit
 *     is 20,000 UTF-8 characters (our template is well under 4 KB).
 *   - Code-bearing trigger sources: CustomMessage_Authentication (sign-in MFA /
 *     EMAIL_OTP), CustomMessage_SignUp, CustomMessage_ResendCode,
 *     CustomMessage_ForgotPassword, CustomMessage_VerifyUserAttribute,
 *     CustomMessage_UpdateUserAttribute, and CustomMessage_AdminCreateUser
 *     (which also carries usernameParameter).
 *
 * This function is infra-owned: tiny, no dependencies beyond the runtime, and
 * needs no IAM beyond basic CloudWatch Logs. Cognito is granted invoke.
 */

interface CustomMessageRequest {
  /** Placeholder for the verification code (the literal "{####}"). */
  readonly codeParameter?: string;
  /** Placeholder for the user name (present for AdminCreateUser). */
  readonly usernameParameter?: string;
  readonly userAttributes?: Record<string, string>;
  readonly clientMetadata?: Record<string, string>;
}

interface CustomMessageResponse {
  smsMessage?: string;
  emailMessage?: string;
  emailSubject?: string;
}

export interface CustomMessageEvent {
  readonly version: string;
  readonly region?: string;
  readonly userPoolId: string;
  readonly userName: string;
  readonly triggerSource: string;
  readonly request: CustomMessageRequest;
  response: CustomMessageResponse;
}

/**
 * Trigger sources whose email carries a one-time code in codeParameter and
 * should therefore receive the branded template. Sources NOT in this set are
 * passed through untouched so we never strip a placeholder Cognito expects
 * (e.g. AdminCreateUser also needs usernameParameter, which our generic code
 * template does not render, so it is intentionally excluded here).
 */
const OTP_TRIGGER_SOURCES: ReadonlySet<string> = new Set([
  'CustomMessage_Authentication',
  'CustomMessage_SignUp',
  'CustomMessage_ResendCode',
  'CustomMessage_ForgotPassword',
  'CustomMessage_VerifyUserAttribute',
  'CustomMessage_UpdateUserAttribute',
]);

export const SIGN_IN_SUBJECT = 'Your GoldFinch sign-in code';

/** Meridian-green brand accent (design-spec tokens.md, meridian light accent). */
const MERIDIAN_GREEN = '#1E4D3F';
const ON_ACCENT = '#F6F3EA';
const PAGE_BG = '#F4F1E9';
const SURFACE = '#FFFEFB';
const BORDER = '#E2DBCB';
const TEXT = '#1A2420';
const DIM = '#6B7268';
const FAINT = '#9A9C8F';

/**
 * Build the branded HTML email body. `codePlaceholder` is the value of
 * event.request.codeParameter (the "{####}" token Cognito replaces at send
 * time); it MUST appear verbatim in the output or Cognito rejects the message.
 * Inline CSS only — email clients strip <style>/<head> rules. No external
 * images; the wordmark is styled text so nothing has to be fetched or embedded.
 */
export function buildSignInEmail(codePlaceholder: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<body style="margin:0;padding:0;background-color:' +
      PAGE_BG +
      ';">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:' +
      PAGE_BG +
      ';margin:0;padding:0;">',
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="max-width:480px;width:100%;background-color:' +
      SURFACE +
      ';border:1px solid ' +
      BORDER +
      ';border-radius:16px;overflow:hidden;">',
    // Header: Meridian-green band with the styled wordmark.
    '<tr><td style="background-color:' +
      MERIDIAN_GREEN +
      ';padding:24px 28px;">',
    '<span style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;' +
      'font-weight:500;letter-spacing:0.2px;color:' +
      ON_ACCENT +
      ';">GoldFinch</span>',
    '</td></tr>',
    // Body: heading, large centered code, instruction line.
    '<tr><td style="padding:32px 28px 8px 28px;font-family:-apple-system,BlinkMacSystemFont,' +
      "'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">",
    '<p style="margin:0 0 20px 0;font-size:16px;line-height:1.5;color:' +
      TEXT +
      ';">Your sign-in code</p>',
    '<div style="margin:0 0 20px 0;text-align:center;font-family:-apple-system,' +
      "BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      'font-size:40px;font-weight:700;letter-spacing:8px;color:' +
      MERIDIAN_GREEN +
      ';">' +
      codePlaceholder +
      '</div>',
    '<p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:' +
      DIM +
      ';">Enter this code to sign in. It expires shortly. ' +
      'If this was not you, ignore this email.</p>',
    '</td></tr>',
    // Footer: muted line.
    '<tr><td style="padding:20px 28px 28px 28px;border-top:1px solid ' +
      BORDER +
      ';font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<p style="margin:0;font-size:12px;line-height:1.5;color:' +
      FAINT +
      ';">GoldFinch &middot; This is an automated message. Please do not reply.</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

export const handler = async (event: CustomMessageEvent): Promise<CustomMessageEvent> => {
  try {
    if (!OTP_TRIGGER_SOURCES.has(event.triggerSource)) {
      // Not a code-bearing source we brand: pass through untouched so Cognito's
      // default template (and any placeholders it requires) is preserved.
      return event;
    }

    const codePlaceholder = event.request.codeParameter;
    if (typeof codePlaceholder !== 'string' || codePlaceholder.length === 0) {
      // Defensive: every code-bearing source supplies codeParameter. If it is
      // somehow absent, do NOT emit a body — an emailMessage without the
      // placeholder is rejected by Cognito and would drop the code entirely.
      // Passing through falls back to Cognito's working default template.
      console.error('custom-message: missing codeParameter', {
        triggerSource: event.triggerSource,
        userPoolId: event.userPoolId,
      });
      return event;
    }

    event.response.emailSubject = SIGN_IN_SUBJECT;
    event.response.emailMessage = buildSignInEmail(codePlaceholder);
    return event;
  } catch (err) {
    // Never throw: a thrown CustomMessage trigger blocks the sign-in email
    // entirely. Log and return the event so Cognito sends its default message.
    console.error('custom-message: handler failed, falling back to default', {
      triggerSource: event?.triggerSource,
      error: err instanceof Error ? err.message : String(err),
    });
    return event;
  }
};
