import { useRef, useEffect } from 'react';

// Инлайн-редактируемый текст ПОВЕРХ реального элемента карточки: класс отображения
// (bmn-card__title, bmn-item__name …) остаётся на элементе, поэтому шрифт, кегль и
// цвет наследуются — правка идёт «как на сайте» (WYSIWYG), без параллельной формы.
//
// contentEditable держим неконтролируемым: DOM из value обновляем ТОЛЬКО когда
// элемент не в фокусе. Иначе React переписывал бы текст на каждый ввод и курсор
// прыгал бы в начало. Наружу отдаём чистый textContent (onInput → onChange).
export default function EditableText({
  value,
  onChange,
  className = '',
  tag = 'span',
  placeholder = '',
  ariaLabel,
}) {
  const ref = useRef(null);

  // Синхронизация из состояния в DOM — только для внешних изменений (открытие,
  // undo при отмене), не во время набора: активный элемент не трогаем.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== (value ?? '')) {
      el.textContent = value ?? '';
    }
  }, [value]);

  const Tag = tag;
  return (
    <Tag
      ref={ref}
      className={`bme-editable ${className}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel || placeholder}
      spellCheck={false}
      data-placeholder={placeholder}
      onInput={(e) => onChange(e.currentTarget.textContent)}
      onBlur={(e) => {
        // Если пока поле было в фокусе, value сменилось извне (переключили
        // категорию и т.п.) — эффект синхронизации это пропускал, чтобы не
        // прыгал курсор. На потере фокуса приводим текст к актуальному value.
        if (e.currentTarget.textContent !== (value ?? '')) e.currentTarget.textContent = value ?? '';
      }}
      onKeyDown={(e) => {
        // Enter не создаёт перенос строки в названиях/ценах — просто снимает фокус.
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      }}
      onPaste={(e) => {
        // Вставляем только текст — без чужих стилей/разметки из буфера.
        e.preventDefault();
        const text = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
        document.execCommand('insertText', false, text);
      }}
    />
  );
}
