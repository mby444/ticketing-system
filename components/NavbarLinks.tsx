"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

type NavLinkProps = ComponentProps<typeof Link>;

const NavLink = ({ href, className, children, ...props }: NavLinkProps) => {
  const pathname = usePathname();
  const path = typeof href === "string" ? href : (href.pathname ?? "");

  const isActive =
    path === "/"
      ? pathname === "/"
      : pathname === path || pathname.startsWith(`${path}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 ${
        isActive
          ? "bg-indigo-50 text-indigo-700"
          : "text-slate-700 hover:bg-slate-100 hover:text-indigo-600"
      } ${className ?? ""}`}
      {...props}
    >
      {children}
    </Link>
  );
};

export default NavLink;
