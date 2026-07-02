// Full-bleed photo + violet brand tint behind a section's content — the
// same treatment on every page (Hero has its own bespoke version), just a
// different photo per page. Always the first child so it paints behind
// everything else in the section via normal DOM stacking order.
export default function PageBackdrop({ image }) {
  return (
    <div className="page-bg" aria-hidden="true">
      <div className="page-bg__photo" style={{ backgroundImage: `url(${image})` }} />
      <div className="page-bg__tint" />
    </div>
  );
}
