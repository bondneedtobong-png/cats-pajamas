// One-off patch (2026-08-27): владелец залил в public/uploads/team/ новые кадры
// («…_Работает» — слева, «…_Улыбка» — справа, латиница — основной портрет) и
// попросил добавить в команду Лелю.
//
// Файлы уже переименованы в латиницу и сжаты до 853×1280 (было 3–6 МБ каждый).
// Скрипт идемпотентен: Леля добавляется только если её ещё нет.
//
// Запуск из корня cats-pajamas-club:
//   node supabase/seeds/patch_team_photos_2026_08_27.mjs
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { getTeamMembers, updateTeamMember, createTeamMember } = await import('../../api/_lib/team.js');

const P = '/uploads/team/';
// Ключ — имя участника в БД, значение — базовое имя файлов.
const SHOTS = {
  'Александр': { work: 'aleksey_work.jpg' },
  'Владислав': { work: 'vladislav_work.jpg', fun: 'vladislav_fun.jpg' },
  'Денис':     { work: 'denis_work.jpg' },
  'Дмитрий':   { work: 'dmitriy_work.jpg', fun: 'dmitriy_fun.jpg' },
  'Егор':      { work: 'egor_work.jpg',    fun: 'egor_fun.jpg' },
  'Леля':      { work: 'lelya_work.jpg',   fun: 'lelya_fun.jpg' },
};

const members = await getTeamMembers({ activeOnly: false });

if (!members.some(m => m.name === 'Леля')) {
  // Должность/стаж/биографию владелец заполнит в админке — выдумывать факты о
  // живом человеке нельзя, поэтому здесь только имя, роль и фото.
  const created = await createTeamMember({
    name: 'Леля',
    role: 'Бармен',
    photoUrl: P + 'lelya.jpg',
    photoWorkUrl: P + SHOTS['Леля'].work,
    photoFunUrl: P + SHOTS['Леля'].fun,
  });
  console.log('created:', created.id, created.name);
  members.push(created);
} else {
  console.log('Леля уже есть — пропускаем создание');
}

for (const m of members) {
  const s = SHOTS[m.name];
  if (!s) continue;
  const patch = {};
  if (s.work && m.photoWorkUrl !== P + s.work) patch.photoWorkUrl = P + s.work;
  if (s.fun  && m.photoFunUrl  !== P + s.fun)  patch.photoFunUrl  = P + s.fun;
  if (!Object.keys(patch).length) continue;
  await updateTeamMember(m.id, patch);
  console.log('patched:', m.name, JSON.stringify(patch));
}
console.log('DONE');
