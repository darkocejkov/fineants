"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Overview"],
  ["/transactions", "Transactions"],
  ["/spending", "Spending"],
  ["/explorer", "Explorer"],
  ["/settings", "Settings"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="masthead">
      <Link href="/" className="wordmark">
        fineants
      </Link>
      <nav className="navlinks">
        {links.map(([href, label]) => {
          // An account page has no nav item of its own, and it is reached from Overview's
          // account list, so Overview keeps the underline while you are looking at one.
          const current =
            path === href || (href !== "/" && path.startsWith(href)) || (href === "/" && path.startsWith("/accounts/"));
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={current ? "navlink navlink-current" : "navlink"}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
