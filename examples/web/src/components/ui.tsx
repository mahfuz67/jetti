import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-neutral-800 bg-neutral-900/50 p-6",
        className,
      )}
      {...props}
    />
  );
}

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none transition focus:border-neutral-600",
        className,
      )}
      {...props}
    />
  );
}
