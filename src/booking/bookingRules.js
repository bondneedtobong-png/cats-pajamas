/**
 * Booking rules configuration.
 * All editable text is here — do not hardcode rule text in JSX/HTML.
 * Before production: have the venue's lawyer review and finalize the wording.
 */

export const BOOKING_RULES = {
  freeCancellationHours: 2,
  depositRetentionPercent: 10,

  shortSummary: [
    'Отмена за 2+ часа до брони — депозит возвращается полностью.',
    'Отмена позже или неявка — удерживается 10% как компенсация заведению за понесённые издержки.',
    'Остаток депозита засчитывается в счёт заказа при посещении.',
  ],

  fullRulesUrl: '/booking-rules',

  consentLabel: 'Я ознакомился(ась) с',
  consentLinkText: 'Правилами бронирования',

  legalNote: 'Черновая формулировка — финальный текст оферты проходит юридическую проверку перед запуском.',
};
