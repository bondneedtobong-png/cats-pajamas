import { readBody, ok, badRequest, unauthorized, forbidden, serverError, applyCors } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import { requestOtp, verifyOtp, updateProfile, createLoginToken, checkLoginToken, authViaTelegramWebApp, isDemoOtpEnabled } from './_lib/auth.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    if (req.method !== 'POST') return badRequest(res, 'Только POST');
    const body = await readBody(req);
    const action = body.action;

    switch (action) {
      case 'login_options': return ok(res, { demoOtpEnabled: isDemoOtpEnabled() });
      case 'request_otp': {
        const r = await requestOtp(body.phone);
        return ok(res, r);
      }
      case 'verify_otp': {
        const r = await verifyOtp(body.phone, body.code);
        return ok(res, r);
      }
      case 'start_telegram_login': {
        const username = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
        if (!username) return serverError(res, new Error('TELEGRAM_BOT_USERNAME не настроен'));
        const { token, expiresAt } = await createLoginToken();
        return ok(res, { token, expiresAt, deepLink: `https://t.me/${username}?start=login_${token}` });
      }
      case 'check_telegram_login': {
        if (!body.token) return badRequest(res, 'token обязателен');
        const r = await checkLoginToken(body.token);
        return ok(res, r);
      }
      case 'telegram_webapp': {
        // Вход из Telegram Mini App (см. src/booking/FloorPlanPage.jsx) — initData
        // подписан ботом при открытии, проверяем HMAC вместо OTP/deep-link флоу.
        const r = await authViaTelegramWebApp(body.initData);
        return ok(res, r);
      }
      case 'me': {
        const user = await getUser(req);
        if (!user) return unauthorized(res);
        return ok(res, { user });
      }
      case 'update_profile': {
        const user = await getUser(req);
        if (!user) return unauthorized(res);
        const updated = await updateProfile(user.id, { name: body.name });
        return ok(res, { user: updated });
      }
      default:
        return badRequest(res, 'Неизвестное действие');
    }
  } catch (e) {
    if (e.status === 403) return forbidden(res, e.message);
    if (/обязательн|корректн|код|Неверный|истёк|повторно|Telegram|подпись/.test(e.message)) return badRequest(res, e.message);
    // Database errors can include row values (OTP/login/session secrets).
    return serverError(res, new Error('Не удалось выполнить вход. Попробуйте позже.'));
  }
}
