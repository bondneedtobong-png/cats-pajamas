/**
 * PaymentProvider — single abstraction layer for deposit payments.
 * All payment calls in BookingService go through this interface.
 * Swap activeProvider to a real gateway (YooKassa, Stripe, etc.) without
 * touching booking business logic.
 */

const MockPaymentProvider = {
  name: 'mock',

  /**
   * Charge a deposit.
   * @param {string} reservationId
   * @param {number} amount - rubles
   * @returns {{ success: boolean, transactionId: string, method: string, amount: number }}
   */
  charge(reservationId, amount) {
    const transactionId = 'mock_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    return { success: true, transactionId, method: 'mock', amount };
  },

  /**
   * Refund a deposit (full or partial).
   * @param {string} transactionId
   * @param {number} amount - rubles
   * @returns {{ success: boolean }}
   */
  refund(transactionId, amount) {
    return { success: true };
  },
};

export default MockPaymentProvider;
