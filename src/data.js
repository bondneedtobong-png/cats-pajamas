export const translations = {
  ru: {
    langBtn: 'EN',
    navAbout: 'О нас', navMenu: 'Меню', navEvents: 'События',
    navTeam: 'Команда', navContacts: 'Контакты',
    navLoginTg: 'Войти через Telegram', navProfile: 'Профиль',
    heroCta: 'Забронировать стол',
    heroTagline: 'Место, где джаз не заканчивается',
    heroSub: 'Самара · Коктейли · Живая музыка',

    aboutLabel: 'О баре',
    aboutQuote: '«Здесь джаз звучит даже в тишине»',
    // TODO: финальный текст и реальные факты (год открытия, точные часы) — уточнить у клиента
    aboutText: [
      'The Cat\'s Pajamas Club — джаз-бар в самом сердце Самары, на улице Куйбышева. Мы собрали под одной крышей дух нью-йоркских speakeasy эпохи Сухого закона: тёмный дуб, латунь, бархат и приглушённый свет, в котором каждый вечер звучит живая музыка.',
      'Наша карта — больше полусотни авторских и классических коктейлей: от выверенной классики до сезонных миксов, которые бармены придумывают сами. Здесь напиток — это точка зрения, а не просто рецепт, а джаз на сцене превращает обычный вечер в историю.',
      'Мы открыты каждый день до глубокой ночи: с воскресенья по четверг — до 02:00, в пятницу и субботу — до 04:00. Приходите послушать живой джаз, попробовать коктейль с характером и остаться до последнего аккорда.',
    ],
    statsYears: 'Лет', statsBartenders: 'Барменов', statsCocktails: 'Коктейлей',

    menuLabel: 'Меню', menuTitle: 'Коктейли',
    menuClassics: 'Классика', menuSignature: 'Авторский',
    menuCta: 'Забронировать столик',
    menuLoading: 'Загружаем меню…',
    menuEmpty: 'Меню скоро пополнится.',
    menuNote: '* Полное меню доступно в баре',

    eventsLabel: 'Программа', eventsTitle: 'События',
    eventsLoading: 'Загружаем события…',
    eventsEmpty: 'Ближайших событий пока нет — загляните позже.',

    galleryLabel: 'Каждый гость — своя бутылка', galleryTitle: 'Полка воспоминаний',
    galleryIntro: 'Каждый отзыв гостя становится бутылкой на нашей полке. Загляните — вдруг узнаете чей-то вечер.',

    teamLabel: 'Команда', teamTitle: 'Мастера за стойкой',
    teamSub: 'Каждый из наших барменов — это история, прожитая в коктейлях.',
    teamLoading: 'Загружаем команду…',
    teamEmpty: 'Скоро здесь появится команда.',
    teamJoinText: 'Поделись своим опытом — нам нужны лучшие бармены',
    teamJoinBtn: 'Оставить заявку',
    teamJoinName: 'Ваше имя',
    teamJoinPhone: 'Телефон',
    teamJoinExp: 'Коротко о вашем опыте',
    teamJoinSend: 'Отправить',
    teamJoinSuccess: 'Спасибо! Мы свяжемся с вами в ближайшее время.',

    reviewsLoading: 'Расставляем бутылки…',
    reviewsEmpty: 'Полка пока пуста — станьте первым, кто оставит воспоминание.',
    shelfCtaLoggedOut: 'Войдите, чтобы оставить отзыв',
    shelfCtaLoggedIn: '📝 Оставить отзыв',
    shelfModalTitle: 'Пополните полку',
    shelfModalText: 'Отзывы хранятся в нашем Telegram-обсуждении. Оставьте сообщение там — и оно появится здесь новой бутылкой.',
    shelfModalBtn: 'Оставить воспоминание',
    shelfModalClose: 'Закрыть',
    shelfReadClose: 'Закрыть',

    bookingLabel: 'Бронирование', bookingTitle: 'Забронировать',
    depositNote: 'Бронирование подтверждается депозитом 2 000 ₽ — полностью засчитывается в счёт ваших заказов в баре.',
    phoneLabel: 'Телефон',

    contactsLabel: 'Контакты', contactsTitle: 'Контакты',
    addressLabel: 'Адрес', address: 'г. Самара, ул. Куйбышева, 100',
    hoursLabel: 'Часы работы',
    daysWeek: 'Пн – Чт, Вс', daysWend: 'Пт – Сб',
    mapLabel: 'Открыть на Яндекс.Картах',
    footerBookingRules: 'Правила бронирования',
    footerPrivacy: 'Политика конфиденциальности',
    footerCopy: '© 2025 The Cat\'s Pajamas Club · Самара',
  },
  en: {
    langBtn: 'RU',
    navAbout: 'About', navMenu: 'Menu', navEvents: 'Events',
    navTeam: 'Team', navContacts: 'Contact',
    navLoginTg: 'Log in with Telegram', navProfile: 'Profile',
    heroCta: 'Reserve a Table',
    heroTagline: 'Where the Jazz Never Stops',
    heroSub: 'Samara · Cocktails · Live Music',

    aboutLabel: 'About',
    aboutQuote: '"Where jazz plays even in the silence"',
    // TODO: final copy and real facts (opening year, exact hours) — confirm with client
    aboutText: [
      'The Cat\'s Pajamas Club is a jazz bar in the heart of Samara, on Kuybysheva Street. Under one roof we\'ve gathered the spirit of New York speakeasies from the Prohibition era: dark oak, brass, velvet, and dim light filled with live music every night.',
      'Our menu holds over fifty signature and classic cocktails — from precise classics to seasonal mixes our bartenders invent themselves. Here a drink is a point of view, not just a recipe, and the jazz on stage turns an ordinary evening into a story.',
      'We\'re open every night until late: Sunday through Thursday until 2 AM, Friday and Saturday until 4 AM. Come for live jazz, a cocktail with character, and stay until the last chord.',
    ],
    statsYears: 'Years', statsBartenders: 'Bartenders', statsCocktails: 'Cocktails',

    // NB: cocktail content itself is RU-only (owner's decision) — these are
    // just the surrounding UI labels for the EN toggle.
    menuLabel: 'Menu', menuTitle: 'Cocktails',
    menuClassics: 'Classic', menuSignature: 'Signature',
    menuCta: 'Reserve a Table',
    menuLoading: 'Loading the menu…',
    menuEmpty: 'The menu is coming soon.',
    menuNote: '* Full menu available at the bar',

    eventsLabel: 'Program', eventsTitle: 'Events',
    eventsLoading: 'Loading events…',
    eventsEmpty: 'No upcoming events yet — check back soon.',

    galleryLabel: 'Every guest, their own bottle', galleryTitle: 'Shelf of Memories',
    galleryIntro: 'Every guest review becomes a bottle on our shelf. Take a look — you might recognize someone\'s evening.',

    teamLabel: 'Team', teamTitle: 'Masters Behind the Bar',
    teamSub: 'Each of our bartenders is a story lived through cocktails.',
    teamLoading: 'Loading the team…',
    teamEmpty: 'The team page is coming soon.',
    teamJoinText: 'Share your experience — we\'re looking for the best bartenders',
    teamJoinBtn: 'Apply Now',
    teamJoinName: 'Your name',
    teamJoinPhone: 'Phone',
    teamJoinExp: 'A bit about your experience',
    teamJoinSend: 'Send',
    teamJoinSuccess: 'Thank you! We\'ll be in touch soon.',

    reviewsLoading: 'Arranging the bottles…',
    reviewsEmpty: 'The shelf is empty — be the first to leave a memory.',
    shelfCtaLoggedOut: 'Sign in to leave a review',
    shelfCtaLoggedIn: '📝 Leave a review',
    shelfModalTitle: 'Fill the shelf',
    shelfModalText: 'Reviews live in our Telegram discussion. Post a message there and it will appear here as a new bottle.',
    shelfModalBtn: 'Leave a memory',
    shelfModalClose: 'Close',
    shelfReadClose: 'Close',

    bookingLabel: 'Reservations', bookingTitle: 'Reserve',
    depositNote: 'Reservations are confirmed with a 2,000 ₽ deposit — fully applied toward your order at the bar.',
    phoneLabel: 'Phone',

    contactsLabel: 'Contact', contactsTitle: 'Contact',
    addressLabel: 'Address', address: 'Samara, Kuybysheva St, 100',
    hoursLabel: 'Hours',
    daysWeek: 'Mon – Thu, Sun', daysWend: 'Fri – Sat',
    mapLabel: 'Open on Yandex Maps',
    footerBookingRules: 'Booking Rules',
    footerPrivacy: 'Privacy Policy',
    footerCopy: '© 2025 The Cat\'s Pajamas Club · Samara',
  },
};


