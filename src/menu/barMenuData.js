// Барная карта бара «Пижама кота» — ЕДИНЫЙ ИСТОЧНИК контента меню.
//
// ⚠️ ФАЙЛ СГЕНЕРИРОВАН: devtools/gen_menu_data.mjs из выверенного бумажного
// меню (Пижама_кота_основное_меню_2.0.pdf, 36 страниц, сверено владельцем
// постранично). Руками не править — правь JSON и перегенерируй, иначе правка
// потеряется при следующей генерации.
//
// Из карты 2026-09-05 УБРАНЫ (решение владельца): все разделы вин
// (белые/красные/розовые/игристые/безалкогольные/портвейн и херес) и страница
// «Авторские коктейли» со старыми ценами 750/700/850 ₽ — их позиции переехали
// в «Коктейли» и «Бестселлеры» с актуальными 880/980 ₽.
//
// Структура: группы → разделы → позиции { name, origin?, volume?, price? }.
//   origin   — состав коктейля или страна (курсивом под названием);
//   volume   — объём позиции; пуст → берётся unit раздела;
//   subtitle — единая цена раздела («880 ₽»), у позиций цены нет;
//   kind:'text' — страница без списка: приветствие и «мы в сети»; такой раздел
//                 всегда занимает отдельный лист и не даёт пузыря (nav: false).
//
// Раскладка по страницам книги считается в рантайме по РЕАЛЬНЫМ замерам
// вёрстки (src/menu/paginate.js) — «сколько влезает» здесь не задаётся.

// Тексты «О разделе» — необязательная надстройка сайта, в бумажном меню их
// нет. Пусто по решению владельца 2026-09-05: книга на сайте должна совпадать
// с печатной картой один в один. Владелец добавляет свои тексты через админку
// (ключ — точное название раздела).
export const CATEGORY_STORIES = {};

export const BAR_MENU = [
  {
    id: 'intro',
    title: 'Приветствие',
    categories: [
      {
        title: 'The Cat’s Pajamas',
        kind: 'text',
        nav: false,
        text: 'Мы назвались «The Cat\'s Pajamas», потому что устали от серьезности и пафоса. Здесь каждый напиток — не повод напиться, а шанс прожить маленькую пьесу со вкусом. Коктейли — как коты: непредсказуемы, характерные, и если ты понравишься — останутся у тебя в сердце.\n\nНаш интерьер — это киношный кадр из жизни, которую мы бы хотели прожить. Без блесток, но с харизмой. Мы верим в культурное потребление алкоголя — не потому что модно, а потому что красиво. А красота, как известно, спасет вечер.\n\nТак что снимай броню, надевай внутреннюю пижаму и будь своим. Здесь можно смеяться громко, пить медленно, и уходить только тогда, когда ты действительно насытился — не напитками, а атмосферой.',
        sign: 'Рад познакомиться с Вами, мой дорогой гость',
        items: [],
      },
    ],
  },
  {
    id: 'kitchen',
    title: 'Кухня',
    categories: [
      {
        title: 'Закуски',
        items: [
          { name: 'Хамон', volume: '100 г', price: '800 ₽' },
          { name: 'Салями фуэт', volume: '100 г', price: '450 ₽' },
          { name: 'Сыр Бри', volume: '100 г', price: '500 ₽' },
          { name: 'Паштет с вареньем из инжира', volume: '200 г', price: '600 ₽' },
          { name: 'Ростбиф с медово-горчичным соусом', volume: '150 г', price: '650 ₽' },
          { name: 'Качотта с пажитником', volume: '100 г', price: '550 ₽' },
          { name: 'Оливки', volume: '150 г', price: '500 ₽' },
          { name: 'Фаршированные перчики', volume: '100 г', price: '550 ₽' },
          { name: 'Жареные артишоки', volume: '100 г', price: '500 ₽' },
          { name: 'Гуакамоле с начос', volume: '160 г', price: '550 ₽' },
        ],
        quote: { text: 'Без закуски пить нельзя, иначе праздник быстро закончится...', author: 'Владимир Высоцкий' },
      },
    ],
  },
  {
    id: 'cocktails',
    title: 'Коктейли',
    categories: [
      {
        title: 'Коктейли',
        subtitle: '880 ₽',
        items: [
          { name: 'Ost-Indian Negroni', origin: 'пряный ром, херес Педро Хименес, цитрусово-травяной биттер' },
          { name: 'Extravaganza Gimlet', origin: 'сухой джин, базилик, огурец, травяной аперитив, тимьян, лайм' },
          { name: 'Meadow Old Fashioned', origin: 'бурбон, донник, апельсиновый биттер' },
          { name: 'Lemon Pie', origin: 'водка, ваниль, ликёр из яичных желтков, лимон, корица' },
          { name: 'Mandarin Velvet', origin: 'джин с мандаринами, манго, ваниль, лайм' },
          { name: 'Sunset Beach', origin: 'джин с мандаринами, цитрусовый аперитив, клубника, манго, лайм' },
          { name: 'Sorrel Gimlet', origin: 'джин, щавель, сахар, лайм' },
          { name: 'Hanky Panky', origin: 'сухой джин, красный вермут, травяной ликер' },
          { name: 'Mint Candy', origin: 'текила, ликёр из мяты, ликёр из персиков, лайм' },
          { name: 'Pink Aurora', origin: 'джин с брусникой, клюква, личи, клубника, лайм' },
          { name: 'Blue Moon', origin: 'водка, ликёр из апельсинов, юдзу, ананас, лайм' },
          { name: 'Pink Lady', origin: 'джин с брусникой, ликёр из апельсинов, ягодный аперитив, лайм' },
        ],
      },
      {
        title: 'Бестселлеры',
        subtitle: '980 ₽',
        items: [
          { name: 'El Vampiro', origin: 'текила, томаты, острый соус Табаско, соус Ворчестер, соль, черный-душистый перец, лайм' },
          { name: 'Pornstar Passion', origin: 'текила, маракуйя, ликёр из горечавки, ваниль, ананас, лайм' },
          { name: 'Clover Club Special', origin: 'ботаникал джин с одуванчиком и лопухом, малина, ягодно-фруктовый аперитив, белок, лайм' },
          { name: 'Inspiration', origin: 'джин, киви, лемонграсс, лайм, белок' },
          { name: 'La Gloria', origin: 'ботаникал джин, розовый перец, кардамон, арбуз, лайм' },
        ],
      },
      {
        title: 'Безалкогольные коктейли',
        items: [
          { name: 'Negroni', price: '610 ₽' },
          { name: 'Aperol Spritz', price: '650 ₽' },
          { name: 'Gimlet', price: '600 ₽' },
          { name: 'Inspiration', price: '630 ₽' },
          { name: 'Clover Club', price: '570 ₽' },
          { name: 'The Godfather', price: '600 ₽' },
          { name: 'Whisky Sour', price: '640 ₽' },
        ],
        quote: { text: 'Ты слишком прекрасен для воды и скучных вечеров.', author: 'Пижама кота' },
      },
    ],
  },
  {
    id: 'spirits',
    title: 'Крепкий алкоголь',
    categories: [
      {
        title: 'Креплёные вина и вермуты',
        items: [
          { name: 'Cinzano Bianco', origin: 'Италия', volume: '80 мл', price: '470 ₽' },
          { name: 'Cinzano 1757 Rosso', origin: 'Италия', volume: '80 мл', price: '470 ₽' },
          { name: 'Cinzano Extra Dry', origin: 'Италия', volume: '80 мл', price: '470 ₽' },
          { name: 'Otto\'s Athens Vermouth', origin: 'Греция', volume: '40 мл', price: '490 ₽' },
          { name: 'Byrrh Grand Quinquina', origin: 'Франция', volume: '40 мл', price: '600 ₽' },
          { name: 'Infantado Porto Ruby', origin: 'Португалия', volume: '75 мл', price: '1 100 ₽' },
          { name: 'Quinta do Infantado Porto LBV', origin: 'Португалия', volume: '75 мл', price: '1 690 ₽' },
          { name: 'KWV Classic Cape Red Muscadel', origin: 'ЮАР', volume: '75 мл', price: '620 ₽' },
          { name: 'Duquesa Pedro Ximenez Jerez', origin: 'Испания', volume: '75 мл', price: '1 350 ₽' },
          { name: 'Marismeno Fino Jerez', origin: 'Испания', volume: '75 мл', price: '1 350 ₽' },
        ],
      },
      {
        title: 'Ром и кашаса',
        items: [
          { name: 'Chairman\'s Reserve Spiced', origin: 'Сент-Люсия', volume: '40 мл', price: '580 ₽' },
          { name: 'Red Bonnie Dark Rum', origin: 'Гайана', volume: '40 мл', price: '700 ₽' },
          { name: 'Velho Barrero Cachasa 3 Anos', origin: 'Бразилия', volume: '40 мл', price: '550 ₽' },
          { name: 'Angostura 7 Y.O.', origin: 'Тринидад и Тобаго', volume: '40 мл', price: '800 ₽' },
          { name: 'Beach House White Spiced', origin: 'Франция', volume: '40 мл', price: '650 ₽' },
          { name: 'Saint James VSOP Rhum Agricole AOC', origin: 'Мартиника', volume: '40 мл', price: '620 ₽' },
          { name: 'Contrabando 5 Y.O.', origin: 'Доминиканская Республика', volume: '40 мл', price: '550 ₽' },
          { name: 'Ron Cartavio XO', origin: 'Перу', volume: '40 мл', price: '1 800 ₽' },
          { name: 'Authentico Nativo Overproof 8 Y.O.', origin: 'Панама', volume: '40 мл', price: '1 150 ₽' },
          { name: 'Bumbu Original Rum 15 Y.O.', origin: 'Барбадос', volume: '40 мл', price: '790 ₽' },
          { name: 'Legendario Elexir de Cuba 7 Y.O.', origin: 'Куба', volume: '40 мл', price: '690 ₽' },
          { name: 'Matusalem Insolito Wine Cask Finish', origin: 'Доминиканская Республика', volume: '40 мл', price: '850 ₽' },
          { name: 'Tahitian Queen Pineapple Rum', origin: 'Таити', volume: '40 мл', price: '770 ₽' },
        ],
        quote: { text: 'Было бы лучше, если бы Колумб открыл бутылку рома', author: 'Виктор Пелевин' },
      },
      {
        title: 'Текила и мескаль',
        items: [
          { name: 'Espolon Blanco Tequila', volume: '40 мл', price: '660 ₽' },
          { name: 'Espolon Anejo Tequila', volume: '40 мл', price: '950 ₽' },
          { name: 'Patron Silver', volume: '40 мл', price: '1 000 ₽' },
          { name: 'Calenda Artesanal Joven Mezcal', volume: '40 мл', price: '750 ₽' },
          { name: 'Libelula Blanco Tequila', volume: '40 мл', price: '780 ₽' },
          { name: 'Pelaton De La Muerte Mezcal', volume: '40 мл', price: '840 ₽' },
          { name: 'Senor Sotol Ensamble', volume: '40 мл', price: '1 150 ₽' },
          { name: 'Estancia Raicilla', volume: '40 мл', price: '880 ₽' },
        ],
        quote: { text: '«Что есть Текила?» — «Это город»', author: 'Игорь Иртеньев' },
      },
      {
        title: 'Шотландия',
        parent: 'Виски',
        items: [
          { name: 'The Gild Blended Whisky', volume: '40 мл', price: '650 ₽' },
          { name: 'Catty Sark 12 Y.O. Blended Whisky', volume: '40 мл', price: '770 ₽' },
          { name: 'Ardbeg 10 Y.O. Single Malt Islay Whisky', volume: '40 мл', price: '1 300 ₽' },
          { name: 'Bankholl Single Rye Whisky', volume: '40 мл', price: '610 ₽' },
          { name: 'Balvenie Doublewood 12 Y.O Single Malt Whisky', volume: '40 мл', price: '1 450 ₽' },
          { name: 'Glen Scotia 10 Y.O. Single Malt Whisky', volume: '40 мл', price: '1 250 ₽' },
          { name: 'The Dalmore 12 Y.O. Single Malt Whisky', volume: '40 мл', price: '1 500 ₽' },
          { name: 'Laphroaig 10 Y.O. Single Malt Islay Whisky', volume: '40 мл', price: '1 250 ₽' },
          { name: 'Talisker 10 Y.O. Single Malt Whisky', volume: '40 мл', price: '950 ₽' },
          { name: 'Monkey Shoulder Blended Malt Whisky', volume: '40 мл', price: '720 ₽' },
        ],
        quote: { text: 'Виски — это жидкое солнышко', author: 'Джоан Флетчер' },
      },
      {
        title: 'Ирландия',
        parent: 'Виски',
        items: [
          { name: 'Bushmill\'s Original Whiskey', volume: '40 мл', price: '550 ₽' },
          { name: 'Bushmill\'s Black Bush Blended Whiskey', volume: '40 мл', price: '650 ₽' },
          { name: 'Bushmills 10 Y.O. Single Malt Whiskey', volume: '40 мл', price: '950 ₽' },
          { name: 'Born Irish Stout Whiskey', volume: '40 мл', price: '750 ₽' },
        ],
        quote: { text: 'Ирландцы вовсе не такие уж весельчаки...', author: 'Джеймс Джойс' },
      },
      {
        title: 'Америка',
        parent: 'Виски',
        items: [
          { name: 'Jack Daniel\'s Single Barrel', volume: '40 мл', price: '1 200 ₽' },
          { name: 'Maker\'s Mark Bourbon', volume: '40 мл', price: '800 ₽' },
          { name: 'Buffalo Trace Bourbon', volume: '40 мл', price: '700 ₽' },
          { name: 'Woodford Reserve Bourbon', volume: '40 мл', price: '850 ₽' },
        ],
        quote: { text: 'Я ждал её целые две бутылки бурбона и одну пачку сигарет, а она так и не пришла.', author: '' },
      },
      {
        title: 'Со всего мира',
        parent: 'Виски',
        items: [
          { name: 'Abasolo Alma de Terra Mexican Whiskey', origin: 'Мексика', volume: '40 мл', price: '980 ₽' },
          { name: 'Richard Chancellor Double Blended', origin: 'Россия', volume: '40 мл', price: '490 ₽' },
          { name: 'Shinobu Blended Whisk', origin: 'Япония', volume: '40 мл', price: '1 150 ₽' },
          { name: 'Spicebox Spiced Whisky', origin: 'Канада', volume: '40 мл', price: '560 ₽' },
          { name: 'Kapriol Whisky', origin: 'Италия', volume: '40 мл', price: '680 ₽' },
          { name: 'Heriose Le Petit Tourbe', origin: 'Франция', volume: '40 мл', price: '1 250 ₽' },
          { name: 'Royal Ranthambore Blended', origin: 'Индия', volume: '40 мл', price: '570 ₽' },
        ],
        quote: { text: 'Плохого виски не бывает. Просто некоторые сорта виски лучше других.', author: 'Джорджу Бернарду Шоу' },
      },
      {
        title: 'Джин',
        items: [
          { name: 'Porter\'s Tropical Old Tom Gin', origin: 'Шотландия', volume: '40 мл', price: '880 ₽' },
          { name: 'Bulldog Gin', origin: 'Великобритания', volume: '40 мл', price: '500 ₽' },
          { name: 'Ginster London Dry/Foxberry/Mandarin', origin: 'Австралия', volume: '40 мл', price: '490 ₽' },
          { name: 'Scapegrace Black', origin: 'Новая Зеландия', volume: '40 мл', price: '890 ₽' },
          { name: 'Citadelle Gin', origin: 'Франция', volume: '40 мл', price: '640 ₽' },
          { name: 'Wessex Saxonian Garden', origin: 'Великобритания', volume: '40 мл', price: '670 ₽' },
          { name: 'Saigon Baigur', origin: 'Вьетнам', volume: '40 мл', price: '870 ₽' },
          { name: 'Berkshire Dundelock & Burdock', origin: 'Россия', volume: '40 мл', price: '500 ₽' },
        ],
        quote: { text: '— А в Калифорнии вместо чаю пьют джин.', author: 'Чехов А.П. Мальчики, 1887' },
      },
      {
        title: 'Коньяк',
        items: [
          { name: 'Francois de Martignac VS', volume: '40 мл', price: '900 ₽' },
          { name: 'Francois de Martignac VSOP', volume: '40 мл', price: '1 150 ₽' },
          { name: 'Roullet VS', volume: '40 мл', price: '660 ₽' },
          { name: 'Courvoisier VSOP', volume: '40 мл', price: '1 150 ₽' },
          { name: 'Chateau de Montifaud 10 Y.O. Grande Champagne AOC', volume: '40 мл', price: '1 500 ₽' },
        ],
        quote: { text: 'Изготовить прекрасный коньяк легко. Всё что Вам для этого требуется — прадед, дед и отец, которые посвятили этому всю свою жизнь.', author: 'Жан-Поль Камю' },
      },
      {
        title: 'Дистилляты',
        items: [
          { name: 'Vinias De Oro Quebranta Pisco', origin: 'Перу', volume: '40 мл', price: '680 ₽' },
          { name: 'Calvados Coquerel VSOP', origin: 'Франция', volume: '40 мл', price: '790 ₽' },
          { name: 'Самовар Грушевый', origin: 'Россия', volume: '40 мл', price: '350 ₽' },
          { name: 'Chemer Barrel', origin: 'Бельгия', volume: '40 мл', price: '480 ₽' },
          { name: 'Brandy Torres 20 Y.O.', origin: 'Испания', volume: '40 мл', price: '1 150 ₽' },
        ],
        quote: { text: 'Жоан быстро поднялась... «Дай мне ещё кальвадоса», — сказала она.', author: 'Э.М. Ремарк, Триумфальная арка' },
      },
      {
        title: 'Водка',
        items: [
          { name: 'Онегин', origin: 'Россия', volume: '50 мл', price: '420 ₽' },
          { name: 'Царская Золотая', origin: 'Россия', volume: '50 мл', price: '300 ₽' },
          { name: 'Schmidt Supreme/Grapefruit/Blackcurrant', origin: 'Беларусь', volume: '50 мл', price: '390 ₽' },
          { name: 'Балчуг XXI век / без метанола', origin: 'Россия', volume: '50 мл', price: '350 ₽' },
          { name: 'Mont Blanc', origin: 'Франция', volume: '50 мл', price: '650 ₽' },
        ],
        quote: { text: 'Истина в вине, а в водке горькая правда.', author: '' },
      },
      {
        title: 'Биттеры и аперитивы',
        items: [
          { name: 'Campari', origin: 'Италия', volume: '40 мл', price: '400 ₽' },
          { name: 'Aperol', origin: 'Италия', volume: '40 мл', price: '350 ₽' },
          { name: 'Cynar', origin: 'Италия', volume: '40 мл', price: '400 ₽' },
          { name: 'Sarti Rosa', origin: 'Италия', volume: '40 мл', price: '390 ₽' },
          { name: 'Chemer Red', origin: 'Беларусь', volume: '40 мл', price: '330 ₽' },
          { name: 'Chemer Green', origin: 'Беларусь', volume: '40 мл', price: '330 ₽' },
          { name: 'Suze', origin: 'Франция', volume: '40 мл', price: '600 ₽' },
          { name: 'RinQuinQuin a la Peche', origin: 'Франция', volume: '40 мл', price: '470 ₽' },
          { name: 'Noix de la Saint Jean', origin: 'Франция', volume: '40 мл', price: '470 ₽' },
          { name: 'Absente 55', origin: 'Франция', volume: '40 мл', price: '620 ₽' },
        ],
        quote: { text: 'После первого стакана абсента видишь мир таким, каким хотел бы его видеть. После второго — таким, каков он есть. И, наконец, после третьего стакана ты видишь то, что не должен видеть…', author: '' },
      },
      {
        title: 'Ликёры и настойки',
        items: [
          { name: 'Fernet Branca', origin: 'травяной ликёр для пищеварения и апетита, Италия', volume: '40 мл', price: '410 ₽' },
          { name: 'Marolo Milla', origin: 'ромашки настоянные на граппе, Италия', volume: '40 мл', price: '720 ₽' },
          { name: 'Frangelico', origin: 'восхитительный ликёр из лесных орехов, Италия', volume: '40 мл', price: '770 ₽' },
          { name: 'Abasolo Nixta', origin: 'необычайный ликёр из молодой кукурузы, Мексика', volume: '40 мл', price: '800 ₽' },
          { name: 'Becherovka Original', origin: 'легендарный травяной ликёр из Карловых Вар, Чехия', volume: '40 мл', price: '450 ₽' },
          { name: 'Jagermeister', origin: 'тот самый травяной ликёр для охотников, Германия', volume: '40 мл', price: '450 ₽' },
          { name: 'Amaro Montenegro', origin: 'традиционный ликёр из более сорока компонентов, Италия', volume: '40 мл', price: '570 ₽' },
          { name: 'Grand Marnier Сordon Rouge', origin: 'оригинальный апельсиновый ликёр на основе коньяка, Франция', volume: '40 мл', price: '620 ₽' },
          { name: 'Малина алтайские травы', volume: '50 мл', price: '350 ₽' },
          { name: 'Вишня-попкорн', volume: '50 мл', price: '350 ₽' },
          { name: 'Фисташковый пломбир', volume: '50 мл', price: '350 ₽' },
          { name: 'Смородина-Маракуйя', volume: '50 мл', price: '350 ₽' },
        ],
        quote: { text: '«...накрыли стол, поставили поднос с шестью графинами разноцветных настоек»', author: 'Н.В. Гоголь, Мёртвые души, 1835' },
      },
    ],
  },
  {
    id: 'soft',
    title: 'Пиво и напитки',
    categories: [
      {
        title: 'Пиво и сидр',
        items: [
          { name: 'Corona Extra', origin: 'светлое, лёгкое Мексиканское', volume: '330 мл', price: '550 ₽' },
          { name: 'Corona Zero', origin: 'да-да, безалкогольная Корона', volume: '330 мл', price: '500 ₽' },
          { name: 'Kurpfalz Brau Ur-Weizen', origin: 'пшеничное, нефильтрованное пиво из Германии', volume: '500 мл', price: '750 ₽' },
          { name: 'Kurpfalz Brau Helles', origin: 'светлое настоящее пиво, сваренное в Германии', volume: '500 мл', price: '750 ₽' },
          { name: 'Жигулёвские Ворота/Быков Сидр', origin: 'восхитительный полусухой сидр из Самарской области', volume: '750 мл', price: '1 350 ₽' },
          { name: 'Guiness Irish Stout', origin: 'чёрный ирландский стаут', volume: '440 мл', price: '720 ₽' },
          { name: 'Belgian Kriek', origin: 'суперсочное, лёгкое Бельгийское вишневое', volume: '330 мл', price: '710 ₽' },
        ],
      },
      {
        title: 'Лимонады',
        unit: '500 мл',
        items: [
          { name: 'Малина-Личи', price: '420 ₽' },
          { name: 'Киви-Фейхоа', price: '420 ₽' },
          { name: 'Маракуйя-Ваниль', price: '420 ₽' },
          { name: 'Груша-Лаванда', price: '420 ₽' },
        ],
      },
      {
        title: 'Чай',
        unit: '600 мл',
        items: [
          { name: 'Ассам', price: '550 ₽' },
          { name: 'Черный с чабрецом', price: '550 ₽' },
          { name: 'Зеленый с жасмином', price: '550 ₽' },
          { name: 'Эрл Грей', price: '550 ₽' },
          { name: 'Молочный Улун', price: '550 ₽' },
          { name: 'Те Гуанинь', price: '550 ₽' },
        ],
      },
      {
        title: 'Софт-напитки',
        items: [
          { name: 'Coca Cola', volume: '330 мл', price: '350 ₽' },
          { name: 'Соки Rich', volume: '200 мл', price: '290 ₽' },
          { name: 'Roket Tonic Lavander', origin: 'тоник с соцветиями лаванды', volume: '200 мл', price: '300 ₽' },
          { name: 'Roket Tonic Hibiscus', origin: 'тоник с соцветиями гибискуса', volume: '200 мл', price: '300 ₽' },
          { name: 'The Gardenist Premium Tonic', origin: 'классический сухой тоник', volume: '200 мл', price: '300 ₽' },
          { name: 'The Gardenist Sakura Tonic', origin: 'тоник с соцветиями сакуры', volume: '200 мл', price: '300 ₽' },
          { name: 'The Gardenist Birch Tree Tonic', origin: 'тоник с березовым соком', volume: '200 мл', price: '300 ₽' },
          { name: 'The Gardenist Grapefruit Tonic', origin: 'тоник с грейпфрутом', volume: '200 мл', price: '300 ₽' },
          { name: 'Space Violet Tonic', origin: 'тоник с соцветиями фиалок', volume: '250 мл', price: '300 ₽' },
          { name: 'Space Rose Tonic', origin: 'тоник с соцветиями роз', volume: '250 мл', price: '300 ₽' },
        ],
      },
    ],
  },
  {
    id: 'outro',
    title: 'Мы в сети',
    categories: [
      {
        title: 'Оставайтесь на связи',
        kind: 'text',
        nav: false,
        text: 'Приглашаем Вас подписаться на наши социальные сети, чтобы ничего не пропустить! Оставайтесь с нами на связи и наслаждайтесь контентом',
        links: ["telegram","instagram"],
        items: [],
      },
    ],
  },
];
