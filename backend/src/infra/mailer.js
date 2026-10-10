import nodemailer from "nodemailer";
import { AppError, ERROR_CODES } from "../constants/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Sends the sign-in code over SMTP. `transport` can be injected (tests use nodemailer's JSON
 * transport so no network is touched). Neither the code nor SMTP credentials are ever logged.
 */
export function createMailer({ smtp, transport } = {}) {
  let tx = transport || null;
  const configured = Boolean(transport) || Boolean(smtp?.enabled);

  if (!tx && smtp?.enabled) {
    tx = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  return {
    enabled: configured,
    async sendOtp({ to, code, ttlMinutes }) {
      if (!tx) throw new AppError(ERROR_CODES.EMAIL_UNAVAILABLE, "Email sign-in is not available right now.", 503);
      try {
        await tx.sendMail({
          from: smtp?.from || "Watch Party <no-reply@localhost>",
          to,
          subject: `${code} is your Watch Party code`,
          text: `Your Watch Party sign-in code is ${code}.\n\nIt expires in ${ttlMinutes} minutes and can be used once. If you didn't ask for it, you can ignore this email.`,
          html: `<p>Your Watch Party sign-in code is:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>It expires in ${ttlMinutes} minutes and can be used once. If you didn't ask for it, you can ignore this email.</p>`,
        });
      } catch (err) {
        // Only a coarse error code: SMTP error text can contain hostnames or account details.
        logger.error(`SMTP send failed (${err?.code || err?.name || "unknown"})`);
        throw new AppError(ERROR_CODES.EMAIL_UNAVAILABLE, "We couldn't send the email. Please try again shortly.", 503);
      }
    },
  };
}
