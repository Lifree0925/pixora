"use client";

import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComposerMenuOption {
  label: string;
  hint?: string;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export function ComposerMenu({
  label,
  value,
  open,
  onToggle,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  options: ComposerMenuOption[];
  disabled?: boolean;
}) {
  return (
    <div className="relative" data-composer-menu>
      <button
        type="button"
        aria-label={`${label}：${value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11px] transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-neutral-300 bg-[#efede7]",
        )}
      >
        <span className="font-medium text-neutral-900">{value}</span>
        <ChevronDown
          className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-2 w-56 rounded-2xl border bg-white p-1.5 shadow-xl"
        >
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitemradio"
              aria-checked={Boolean(option.selected)}
              disabled={option.disabled}
              onClick={() => {
                option.onSelect?.();
                onToggle();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors",
                option.selected ? "bg-[#f5f2ec] text-neutral-900" : "hover:bg-muted/50",
                option.disabled && "cursor-not-allowed opacity-45",
              )}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {option.selected ? <Check className="size-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{option.label}</span>
                {option.hint ? (
                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                    {option.hint}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
