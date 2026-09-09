export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-guidance">{children}</div> : null}
    </div>
  );
}
