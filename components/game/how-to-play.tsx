'use client';
import type { ReactNode } from 'react';
import {
  Flag,
  Gem,
  MousePointerClick,
  Move,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { TACTICAL_BUILDINGS } from '@/lib/tactics';

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Flag,
    title: 'Capture their flags',
    text: 'You win by carrying every enemy flag back to your own. Guard yours: lose it and the operation ends.',
  },
  {
    icon: Zap,
    title: 'Build power',
    text: `Structures run on power. Start with a ${TACTICAL_BUILDINGS.reactor.name} near your command station.`,
  },
  {
    icon: Gem,
    title: 'Refine ore',
    text: `An ${TACTICAL_BUILDINGS.refinery.name.toLowerCase()} comes with a harvester that mines ore and earns credits on its own.`,
  },
  {
    icon: Users,
    title: 'Train troops',
    text: `Build a ${TACTICAL_BUILDINGS.barracks.name} for infantry or ${TACTICAL_BUILDINGS.factory.name} for vehicles, then queue troops in the sidebar.`,
  },
  {
    icon: MousePointerClick,
    title: 'Command them',
    text: 'Click a troop or drag a box to select. Click land to move, click an enemy to attack.',
  },
  {
    icon: Move,
    title: 'Move the camera',
    text: 'WASD, arrow keys or screen edges scroll. Scroll to zoom, right-drag to pan. Touch: drag and pinch.',
  },
];

/** The six illustrated steps of the core loop, shared by the launcher and the field manual. */
export function HowToPlaySteps() {
  return (
    <ol className="how-to-play-steps">
      {STEPS.map(({ icon: Icon, title, text }, i) => (
        <li key={title}>
          <span className="how-to-play-icon" aria-hidden="true">
            <Icon size={22} />
            <b>{i + 1}</b>
          </span>
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The launcher's how-to-play sheet. */
export function HowToPlayDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tac-help how-to-play">
        <DialogTitle>How to play</DialogTitle>
        <DialogDescription>
          Build a base, grow an army and take the enemy&apos;s flags. Your first
          solo match walks you through it step by step.
        </DialogDescription>
        <HowToPlaySteps />
        {children}
      </DialogContent>
    </Dialog>
  );
}
