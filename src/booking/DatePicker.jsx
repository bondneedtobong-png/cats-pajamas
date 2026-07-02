import { useState, useEffect, useRef } from 'react';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function pad(n) { return String(n).padStart(2, '0'); }
function toIso(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

export default function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const { y: selY, m: selM, d: selD } = parseIso(value);
  const [viewY, setViewY] = useState(selY);
  const [viewM, setViewM] = useState(selM);
  const rootRef = useRef(null);

  useEffect(() => {
    setViewY(selY);
    setViewM(selM);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  function shiftMonth(delta) {
    let m = viewM + delta, y = viewY;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewM(m); setViewY(y);
  }

  function selectDay(d) {
    onChange(toIso(viewY, viewM, d));
    setOpen(false);
  }

  const firstWeekday = (new Date(viewY, viewM, 1).getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const label = `${selD} ${MONTHS[selM]}`;

  return (
    <div className="bk-datepicker" ref={rootRef}>
      <button type="button" className="bk-datepicker__trigger" onClick={() => setOpen(o => !o)}>
        <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2.5" y="4" width="15" height="13" rx="1.5" />
          <path d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3" />
        </svg>
        <span>{label}</span>
      </button>

      {open && (
        <div className="bk-datepicker__pop">
          <div className="bk-datepicker__head">
            <button type="button" className="bk-datepicker__nav" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="bk-datepicker__month">{MONTHS_NOM[viewM]} {viewY}</span>
            <button type="button" className="bk-datepicker__nav" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div className="bk-datepicker__grid bk-datepicker__grid--head">
            {WEEKDAYS.map(w => <span key={w} className="bk-datepicker__wd">{w}</span>)}
          </div>
          <div className="bk-datepicker__grid">
            {cells.map((d, i) => {
              if (d === null) return <span key={i} />;
              const iso = toIso(viewY, viewM, d);
              const isSel = iso === value;
              const isToday = iso === todayIso;
              const isPast = iso < todayIso;
              return (
                <button
                  type="button"
                  key={i}
                  className={`bk-datepicker__day${isSel ? ' bk-datepicker__day--sel' : ''}${isToday && !isSel ? ' bk-datepicker__day--today' : ''}${isPast ? ' bk-datepicker__day--past' : ''}`}
                  onClick={() => selectDay(d)}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="bk-datepicker__today-btn"
            onClick={() => { onChange(todayIso); setOpen(false); }}
          >
            Сегодня
          </button>
        </div>
      )}
    </div>
  );
}
