"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Avatar from "@radix-ui/react-avatar";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { AccountPanel } from "@/components/auth/AccountPanel";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AccountMenu() {
  const { account, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [panelOpen, setPanelOpen] = useState(false);

  if (!account) return null;
  const isGuest = account.role === "guest";

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-2.5 rounded-full border border-white/15 bg-white/5 py-1.5 pl-1.5 pr-3 text-white transition-colors duration-200 hover:bg-white/10"
          >
            <Avatar.Root className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-primary text-[11px] font-bold text-white">
              <Avatar.Fallback>{initials(account.name)}</Avatar.Fallback>
            </Avatar.Root>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-xs font-semibold">{account.name}</span>
              <span className="block text-[10px] uppercase tracking-wide text-white/50">
                {isGuest ? "Guest" : "Advisor"}
              </span>
            </span>
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-white/50" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={10}
            className="z-50 w-64 rounded-2xl border border-border bg-surface p-1.5 text-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          >
            <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
              <Avatar.Root className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-bold text-white">
                <Avatar.Fallback>{initials(account.name)}</Avatar.Fallback>
              </Avatar.Root>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">{account.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{account.email}</p>
              </div>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => setPanelOpen(true)}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-secondary"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-muted-foreground" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
              </svg>
              Account &amp; stats
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                toggleTheme();
              }}
              className="flex cursor-pointer items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-secondary"
            >
              <span className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-muted-foreground" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.4A8.5 8.5 0 1 1 11.6 3 6.7 6.7 0 0 0 21 12.4z" strokeLinejoin="round" />
                </svg>
                Appearance
              </span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {theme === "dark" ? "Dark" : "Light"}
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => signOut()}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-severity-critical outline-none transition-colors data-[highlighted]:bg-severity-critical-bg"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {isGuest ? "Exit guest session" : "Sign out"}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <AccountPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}
