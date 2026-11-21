import nodemailer from "nodemailer";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { logger } from "../utils/logger.js";

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,48}$/;
const safe = (v) => (typeof v === "string" && SAFE_CODE.test(v) ? v : undefined);

/**
 * Turns a nodemailer error into a coarse class so the log says WHAT failed (connect timeout vs auth vs TLS vs rejection).
 * Pure function over error *codes*; the SMTP error text (which can contain account details) is never logged.
 */
export function classifySmtpError(err) {
  const code = safe(err?.code) || safe(err?.name) || "unknown";
  const command = safe(err?.command);
  const responseCode = Number.isInteger(err?.responseCode) ? err.responseCode : undefined;
  const text = String(err?.message || "").toLowerCase();
  let kind = "other";
  if (code === "EAUTH" || responseCode === 535 || command === "AUTH PLAIN" || command === "AUTH LOGIN") kind = "auth";
  else if (code === "ETLS" || /ssl|tls|certificate|wrong version number|handshake/.test(text)) kind = "tls";
  else if (code === "ETIMEDOUT" && (command === "CONN" || !command)) kind = "connect-timeout";
  else if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") kind = "timeout";
  else if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "ESOCKET", "ECONNECTION"].includes(code)) kind = "connection";
  else if (["EENVELOPE", "EMESSAGE"].includes(code) || (responseCode && responseCode >= 500)) kind = "rejected";
  return { kind, code, command, responseCode };
}

const HINTS = {
  "connect-timeout": "The TCP connection to the SMTP server timed out. Render free web services block outbound ports 25/465/587; use EMAIL_PROVIDER=resend|brevo (HTTPS) or a paid instance. Also check SMTP_HOST/SMTP_PORT.",
  timeout: "The SMTP server accepted the connection but stopped responding.",
  connection: "Could not reach the SMTP server (refused, DNS failure or network unreachable). Check SMTP_HOST and SMTP_PORT.",
  auth: "The SMTP server rejected SMTP_USER/SMTP_PASS (many providers need an API key or app password, not the account password).",
  tls: "TLS negotiation failed. Port 465 needs SMTP_SECURE=true; ports 587/2525 need SMTP_SECURE=false (STARTTLS).",
  rejected: "The server refused the message or recipient. Check that SMTP_FROM is a verified sender.",
};

/** Same idea for the HTTPS API providers: status plus the provider's own short error name/code. */
export function classifyApiFailure({ status, errorName, networkCode }) {
  let kind = "other";
  if (networkCode) kind = networkCode === "TimeoutError" || networkCode === "ETIMEDOUT" || networkCode === "UND_ERR_CONNECT_TIMEOUT" ? "timeout" : "connection";
  else if (status === 401 || status === 403) kind = "auth";
  else if (status === 429) kind = "rate-limited";
  else if (status >= 500) kind = "provider-error";
  else if (status >= 400) kind = "rejected";
  return { kind, status, errorName: safe(errorName), networkCode: safe(networkCode) };
}
const API_HINTS = {
  auth: "The email API key was refused. Check EMAIL_API_KEY (and that it has sending permission).",
  rejected: "The API rejected the request. Usually EMAIL_FROM is not a verified sender/domain with the provider.",
  "rate-limited": "The email provider's rate or daily limit was reached.",
  "provider-error": "The email provider had a server error; retry shortly.",
  timeout: "The request to the email API timed out.",
  connection: "Could not reach the email API over HTTPS.",
};

const API_TIMEOUT_MS = 10_000;

/** Splits `Name <a@b.c>` into its parts (Brevo wants them separately). */
function parseFrom(from) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  return m ? { name: (m[1] || "").trim() || undefined, email: m[2] } : { email: from.trim() };
}

function createApiSender({ emailApi, fetchImpl }) {
  const { provider, apiKey, from } = emailApi;
  return async function send({ to, subject, text, html }) {
    let res;
    try {
      if (provider === "resend") {
        res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, text, html }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
      } else {
        const sender = parseFrom(from);
        res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
      }
    } catch (err) {
      throw Object.assign(new Error("email api request failed"), { api: classifyApiFailure({ networkCode: err?.cause?.code || err?.code || err?.name || "network" }) });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error("email api rejected"), { api: classifyApiFailure({ status: res.status, errorName: body?.name || body?.code }) });
    }
  };
}

/**
 * Sends the sign-in code. Delivery is one of (first match wins):
 *  - an injected `transport` (tests use a capturing/JSON transport, so no network is touched);
 *  - an HTTPS e-mail API (EMAIL_PROVIDER=resend|brevo), which works where outbound SMTP is blocked;
 *  - SMTP through nodemailer (default).
 * Neither the code, API keys nor SMTP credentials are ever logged.
 */
export function createMailer({ smtp, emailApi, transport, fetchImpl = fetch } = {}) {
  let tx = transport || null;
  let api = null;
  let from = smtp?.from || "Watch Party <no-reply@localhost>";
  let describe = "injected transport";

  if (!tx && emailApi?.enabled) {
    api = createApiSender({ emailApi, fetchImpl });
    from = emailApi.from;
    describe = `HTTPS API (${emailApi.provider})`;
  } else if (!tx && smtp?.enabled) {
    tx = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    describe = `SMTP ${smtp.host}:${smtp.port} (${smtp.secure ? "implicit TLS" : "STARTTLS"})`;
  }
  const configured = Boolean(tx || api);

  return {
    enabled: configured,
    describe,
    async sendOtp({ to, code, ttlMinutes }) {
      if (!tx && !api) throw new AppError(ERROR_CODES.EMAIL_UNAVAILABLE, "Email sign-in is not available right now.", 503);
      const message = {
        subject: `${code} is your Watch Party code`,
        text: `Your Watch Party sign-in code is ${code}.\n\nIt expires in ${ttlMinutes} minutes and can be used once. If you didn't ask for it, you can ignore this email.`,
        html: `<p>Your Watch Party sign-in code is:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>It expires in ${ttlMinutes} minutes and can be used once. If you didn't ask for it, you can ignore this email.</p>`,
      };
      try {
        if (api) await api({ to, ...message });
        else await tx.sendMail({ from, to, ...message });
      } catch (err) {
        // Only codes/classes are logged: provider error text can contain hostnames, addresses or account details.
        if (err?.api) {
          const a = err.api;
          logger.error(`Email API send failed: class=${a.kind}${a.status ? ` status=${a.status}` : ""}${a.errorName ? ` error=${a.errorName}` : ""}${a.networkCode ? ` code=${a.networkCode}` : ""} provider=${emailApi.provider} hint="${API_HINTS[a.kind] || "see provider dashboard"}"`);
        } else {
          const c = classifySmtpError(err);
          const target = smtp?.host ? ` target=${smtp.host}:${smtp.port}` : "";
          logger.error(`SMTP send failed: class=${c.kind} code=${c.code}${c.command ? ` command=${c.command}` : ""}${c.responseCode ? ` responseCode=${c.responseCode}` : ""}${target}${HINTS[c.kind] ? ` hint="${HINTS[c.kind]}"` : ""}`);
        }
        throw new AppError(ERROR_CODES.EMAIL_UNAVAILABLE, "We couldn't send the email. Please try again shortly.", 503);
      }
    },
  };
}
