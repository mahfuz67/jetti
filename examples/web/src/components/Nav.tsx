"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links: [string, string][] = [
  ["/", "Send"],
  ["/track", "Track"],
  ["/conditions", "Conditions"],
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-neutral-800">
      <div className="mx-auto flex max-w-3xl items-center gap-6 px-6 py-4">
        <span className="font-semibold tracking-tight">Jetti</span>
        <div className="flex gap-1">
          {links.map(([href, label]) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-md bg-neutral-800 px-2.5 py-1 text-sm text-neutral-100"
                    : "rounded-md px-2.5 py-1 text-sm text-neutral-400 transition hover:text-neutral-100"
                }
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
