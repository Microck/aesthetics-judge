// "recently judged": what other visitors scanned.
// - Hover highlight slides between rows (motion-primitives AnimatedBackground).
// - Opening a row morphs its cover into a detail dialog (motion-primitives
//   MorphingDialog), with Base UI Dialog providing focus trap and Esc handling.
import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import type { FeedItem } from "../lib/feed";
import { AXES, AXIS_LABELS } from "../lib/scores";
import { SPRING_EASE } from "./motion";

const layoutTransition = { duration: 0.3, ease: SPRING_EASE };

function ago(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function Cover({ item, className }: { item: FeedItem; className: string }) {
  return item.cover_url ? (
    <img src={item.cover_url} crossOrigin="anonymous" alt="" loading="lazy" className={`object-cover ${className}`} />
  ) : (
    <div className={`bg-surface ${className}`} />
  );
}

export function Feed({ items }: { items: FeedItem[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [open, setOpen] = useState<FeedItem | null>(null);

  if (!items.length) return <p className="m-0 mt-4 text-muted">nothing yet. be first.</p>;

  return (
    <>
      <ul className="m-0 mt-3 flex list-none flex-col p-0" onMouseLeave={() => setHovered(null)}>
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={layoutTransition}
              className="relative"
              onMouseEnter={() => setHovered(item.id)}
            >
              {hovered === item.id && (
                <motion.span layoutId="feed-hover" className="absolute -inset-x-2 inset-y-0 rounded-md bg-surface" transition={{ duration: 0.15, ease: SPRING_EASE }} />
              )}
              <button onClick={() => setOpen(item)} className="relative flex w-full items-center gap-3 py-2 text-left">
                <motion.div layoutId={`cover-${item.id}`} transition={layoutTransition} className="shrink-0">
                  <Cover item={item} className="size-11" />
                </motion.div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{item.title}</span>
                  <span className="block truncate text-subtle">{item.artist}</span>
                </span>
                <span className="tabular-nums text-muted">{ago(item.created_at)}</span>
                <span className="w-14 text-right text-base tabular-nums">{item.ce.toFixed(1)}</span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <Dialog.Root open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-ground/95 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          {/* Popup is only the content box, so clicks on the backdrop close the dialog. */}
          <Dialog.Popup className="fixed left-1/2 top-1/2 w-[min(24rem,calc(100vw-3rem),calc(100svh-22rem))] min-w-64 -translate-x-1/2 -translate-y-1/2 outline-none">
            {open && (
              <div>
                <motion.div layoutId={`cover-${open.id}`} transition={layoutTransition}>
                  <Cover item={open} className="aspect-square w-full" />
                </motion.div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.1 }}>
                  <Dialog.Title className="m-0 mt-5 truncate text-base font-normal">{open.title}</Dialog.Title>
                  <Dialog.Description className="m-0 mt-1 truncate text-subtle">
                    {[open.artist, open.year].filter(Boolean).join(" · ")}
                  </Dialog.Description>
                  <div className="mt-5 flex items-end gap-3">
                    <span className="text-score leading-none tabular-nums">{open.ce.toFixed(1)}</span>
                    <span className="pb-1 text-muted">/ 10 enjoyment</span>
                  </div>
                  <dl className="m-0 mt-5 grid grid-cols-[1fr_auto] gap-y-1.5">
                    {AXES.map((axis) => (
                      <div key={axis} className="contents">
                        <dt className="text-subtle">{AXIS_LABELS[axis]}</dt>
                        <dd className="m-0 tabular-nums">{open[axis.toLowerCase() as "ce"].toFixed(2)}</dd>
                      </div>
                    ))}
                  </dl>
                  <Dialog.Close className="mt-6 min-h-10 text-muted hover:text-ink">close</Dialog.Close>
                </motion.div>
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
