"use client";

import { Toaster } from "sonner";

export function KronixToaster() {
  return (
    <Toaster
      position="bottom-right"
      theme="dark"
      closeButton
      richColors
      offset={16}
      gap={8}
      toastOptions={{
        classNames: {
          toast:
            "!bg-[#101416]/95 !border !border-white/10 !text-on-surface !shadow-xl !shadow-black/35 !backdrop-blur-md !rounded-lg",
          title: "!font-headline !text-[13px]",
          description: "!font-mono !text-[11px] !text-on-surface-variant",
          actionButton:
            "!bg-[#4dffb4] !text-[#0b0f0d] !font-headline !font-bold",
          cancelButton:
            "!bg-kx-surface-hi !text-on-surface-variant !font-headline",
          closeButton:
            "!bg-[#151b1d] !border-white/10 !text-on-surface-variant hover:!text-on-surface",
        },
      }}
    />
  );
}
