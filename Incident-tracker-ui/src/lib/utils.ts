import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class lists so a caller-supplied `className` reliably overrides a component's
 * own defaults instead of losing to whichever rule Tailwind emitted last.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
