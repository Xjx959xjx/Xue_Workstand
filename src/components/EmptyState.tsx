import Link from "next/link";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="panel empty-state-panel">
      <div className="panel-inner">
        <h2>{title}</h2>
        <p className="subtle">{body}</p>
        {action ? (
          <Link className="btn primary" href={action.href}>
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
