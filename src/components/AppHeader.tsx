"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/auth/AccountMenu";

const NAV_LINKS = [
  { href: "/workbench", label: "Dashboard" },
  { href: "/visualize", label: "Visualize" },
];

export function AppHeader({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="relative shrink-0 bg-[color:var(--color-header-bg)] text-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-6 py-4">
        <Link href="/" className="flex items-center gap-3 transition-opacity duration-200 hover:opacity-80">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition-all duration-200">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 4h18v4H3zM3 12h12v8H3zM18 12h3v8h-3z" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-white underline decoration-2 decoration-[#C8503C] underline-offset-4">
              Filum
            </h1>
            <span className="hidden text-sm text-white/50 sm:inline">Pull the thread.</span>
          </div>
        </Link>

        <nav className="ml-2 flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  active ? "bg-white/12 text-white" : "text-white/55 hover:bg-white/8 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {actions}
          <div className="h-7 w-px bg-white/10" aria-hidden />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-primary to-transparent" />
    </header>
  );
}
