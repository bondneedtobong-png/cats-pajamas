import { ok, badRequest, unauthorized, forbidden, serverError, applyCors, readBody } from './_lib/http.js';
import { getUser } from './_lib/session.js';
import {
  getLoyaltyStatus, getTodaySpin, spinWheel, getCatalog, getLoyaltyHistory,
  redeemReward, confirmRedemption, getAllRewards, createReward, updateReward,
  deleteReward, getRedemptions, getLoyaltyRules, setLoyaltyRules,
} from './_lib/loyalty.js';

// Один файл на весь API лояльности (гостевой + админский), как reviews.js/
// events.js/tables.js — саб-ресурсы через query-параметры/action, а не
// отдельные serverless-пути: у server.js (VPS Express-обёртка) роуты
// регистрируются вручную по точному пути, отдельные /api/loyalty/catalog и
// т.п. потребовали бы правки server.js на каждый новый эндпоинт без пользы.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  try {
    const user = await getUser(req);
    if (!user) return unauthorized(res);

    if (req.method === 'GET') {
      if (req.query.admin_rewards) {
        if (user.role !== 'admin') return forbidden(res);
        return ok(res, { rewards: await getAllRewards() });
      }
      if (req.query.admin_redemptions) {
        if (user.role !== 'admin') return forbidden(res);
        return ok(res, { redemptions: await getRedemptions({ status: req.query.status || undefined }) });
      }
      if (req.query.admin_rules) {
        if (user.role !== 'admin') return forbidden(res);
        return ok(res, { rules: await getLoyaltyRules() });
      }
      if (req.query.catalog) return ok(res, { catalog: await getCatalog(user.id) });
      if (req.query.history) return ok(res, { transactions: await getLoyaltyHistory(user.id) });

      const [status, todaySpin] = await Promise.all([getLoyaltyStatus(user.id), getTodaySpin(user.id)]);
      return ok(res, { status, todaySpin });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      switch (body.action) {
        case 'spin':
          return ok(res, await spinWheel(user.id));

        case 'redeem':
          return ok(res, await redeemReward(user.id, body.rewardId));

        case 'confirm_redemption': {
          if (user.role !== 'admin') return forbidden(res);
          return ok(res, await confirmRedemption(body.code, user.telegramId || null));
        }

        case 'create_reward':
          if (user.role !== 'admin') return forbidden(res);
          return ok(res, { reward: await createReward(body.data || {}) });

        case 'update_reward':
          if (user.role !== 'admin') return forbidden(res);
          return ok(res, { reward: await updateReward(body.id, body.data || {}) });

        case 'delete_reward':
          if (user.role !== 'admin') return forbidden(res);
          await deleteReward(body.id);
          return ok(res, {});

        case 'set_rules':
          if (user.role !== 'admin') return forbidden(res);
          await setLoyaltyRules(body.rules || {});
          return ok(res, {});

        default:
          return badRequest(res, 'Неизвестное действие');
      }
    }

    return badRequest(res, 'Метод не поддерживается');
  } catch (e) {
    if (e.message === 'ALREADY_SPUN') return badRequest(res, 'Колесо сегодня уже крутили — приходите завтра!');
    if (/не найден|обязательн|Недостаточно баллов|Нужен уровень|уже погашено|истёк|Код не найден|не доступна/i.test(e.message)) {
      return badRequest(res, e.message);
    }
    return serverError(res, e);
  }
}
