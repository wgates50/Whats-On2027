"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

const TABS = [
  { href: "/", label: "Calendar", icon: Icon.calendar, match: (p: string) => p === "/" },
  { href: "/feed/", label: "Feed", icon: Icon.feed, match: (p: string) => p.startsWith("/feed") },
  { href: "/discover/", label: "Discover", icon: Icon.discover, match: (p: string) => p.startsWith("/discover") },
  { href: "/places/", label: "Places", icon: Icon.places, match: (p: string) => p.startsWith("/places") || p.startsWith("/person") },
  { href: "/saved/", label: "Saved", icon: Icon.saved, match: (p: string) => p.startsWith("/saved") },
];

export function TabBar() {
  const path = usePathname() ?? "/";
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => {
        const active = t.match(path);
        return (
          <Link key={t.href} href={t.href} className={`tabbar__tab${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
            {t.icon}
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
