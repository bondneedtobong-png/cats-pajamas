import { supabase } from './supabase.js';

// One RPC owns both writes and returns its committed order. The expected list
// detects a concurrent reorder/create/delete between this read and the lock.
export async function reorderContent(rpcName, id, direction, readAll, rowToItem, missingMessage) {
  if (direction !== 'up' && direction !== 'down') {
    throw Object.assign(new Error('Направление должно быть up или down'), { status: 400 });
  }
  if (typeof id !== 'string' || !id.trim()) {
    throw Object.assign(new Error(missingMessage), { status: 400 });
  }
  const all = await readAll({ activeOnly: false });
  if (!all.some(item => item.id === id)) throw Object.assign(new Error(missingMessage), { status: 400 });
  const { data, error } = await supabase.rpc(rpcName, {
    p_id: id,
    p_direction: direction,
    p_expected: all.map(item => ({ id: item.id, sort_order: item.sortOrder })),
  });
  if (error) {
    if (['PT409', '55P03', '40001', '40P01'].includes(error.code)) {
      throw Object.assign(new Error('Порядок уже изменён. Обновите список и повторите действие.'), { status: 409 });
    }
    if (error.code === 'PT400') throw Object.assign(new Error(error.message), { status: 400 });
    throw new Error(error.message);
  }
  if (!Array.isArray(data) || data.length !== all.length || !data.some(row => row.id === id)) {
    throw new Error('Не удалось сохранить порядок');
  }
  return data.map(rowToItem);
}
