import Link from "next/link";

const items = [
  ["general", "/settings", "General"],
  ["categories", "/settings/categories", "Categories"],
  ["rules", "/settings/rules", "Rules"],
] as const;

export function SettingsNav({ current }: { current: (typeof items)[number][0] }) {
  return (
    <nav className="subnav" aria-label="Settings sections">
      {items.map(([key, href, label]) => (
        <Link key={key} href={href} aria-current={key === current ? "page" : undefined} className={key === current ? "subnav-current" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
