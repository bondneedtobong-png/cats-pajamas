// One-off: выдать role='admin' двум сотрудникам (Владос, Егор) ДО их первого
// захода в бота — обычно роль присваивает ensureTelegramUser() при первом
// /start или входе через Telegram (см. api/_lib/auth.js), но здесь владелец
// попросил выдать заранее. Создаём им users-строки напрямую, ТОЙ ЖЕ формы,
// что и ensureTelegramUser() — telegram_username оставляем null, он сам
// подтянется при первом реальном заходе (см. патч telegram_username там же).
// ВАЖНО: НЕ добавляем их в TELEGRAM_ADMIN_IDS (.env) — это сделало бы их
// «владельцами» (canManageRoles=true, неснимаемая роль), а не обычными
// админами. Обычный admin — ровно то, что нужно штатному бармену (см.
// комментарии в api/_lib/guests.js / AdminPage.jsx).
// Идемпотентно: если строка уже появилась (человек успел зайти сам), просто
// патчим role в 'admin', ничего не дублируем.
//
// Запуск на сервере:
//   ssh cats-pajamas "cd /opt/cats-pajamas-club && node supabase/seeds/patch_admins_2026_07_06.mjs"
import 'dotenv/config';
const { supabase } = await import('../../api/_lib/supabase.js');

const genId = () => 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

const people = [
  { name: 'Владос', telegramId: '181013261' },
  { name: 'Егор', telegramId: '870158221' },
];

for (const p of people) {
  const { data: existing } = await supabase
    .from('users').select('id, name, role').eq('telegram_id', p.telegramId).maybeSingle();

  if (existing) {
    if (existing.role === 'admin') {
      console.log(`skip (уже admin): ${p.name} (${p.telegramId}) — id ${existing.id}`);
      continue;
    }
    const { data, error } = await supabase
      .from('users').update({ role: 'admin' }).eq('id', existing.id).select().single();
    if (error) throw new Error(error.message);
    console.log(`patched role→admin: ${p.name} (${p.telegramId}) — id ${data.id}`);
    continue;
  }

  const row = {
    id: genId(), name: p.name, phone: '',
    telegram_id: p.telegramId, telegram_username: null,
    role: 'admin', created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('users').insert(row).select().single();
  if (error) throw new Error(error.message);
  console.log(`created (role=admin): ${p.name} (${p.telegramId}) — id ${data.id}`);
}

console.log('DONE');
