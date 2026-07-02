/**
 * @typedef {'web'|'telegram_bot'|'phone_manual'} ReservationSource
 * @typedef {'pending'|'confirmed'|'cancelled'|'completed'|'no_show'} ReservationStatus
 * @typedef {'not_required'|'pending'|'paid_mock'|'refunded'|'partially_retained'} DepositStatus
 * @typedef {'round'|'square'|'booth'|'bar'} TableType
 *
 * @typedef {Object} Seat
 * @property {number} angle   - Degrees, 0 = top, clockwise. For booth/bar: distance along edge.
 * @property {boolean} active - Whether this seat slot is currently active (placed).
 *
 * @typedef {Object} TableConfig
 * @property {string}     id
 * @property {TableType}  type
 * @property {string}     zone
 * @property {number}     depositPrice
 * @property {Seat[]}     seats
 * @property {number}     [cx]     - Round: center x in SVG coords
 * @property {number}     [cy]     - Round: center y in SVG coords
 * @property {number}     [radius] - Round: radius in SVG coords
 * @property {number}     [x]      - Square/booth/bar: x
 * @property {number}     [y]      - Square/booth/bar: y
 * @property {number}     [w]      - Width
 * @property {number}     [h]      - Height
 *
 * @typedef {Object} Reservation
 * @property {string}            id
 * @property {string}            tableId
 * @property {string|null}       guestId
 * @property {ReservationSource} source
 * @property {ReservationStatus} status
 * @property {string}            date              - YYYY-MM-DD
 * @property {string}            timeFrom          - HH:MM
 * @property {string}            timeTo            - HH:MM
 * @property {number}            guestsCount
 * @property {number}            depositPrice
 * @property {DepositStatus}     depositStatus
 * @property {string|null}       createdByAdminId
 * @property {string}            createdAt         - ISO timestamp
 * @property {string}            updatedAt         - ISO timestamp
 * @property {string|null}       cancelledAt
 * @property {string|null}       cancellationReason
 * @property {string}            guestName
 * @property {string}            guestPhone
 * @property {string}            note
 */

export {};
