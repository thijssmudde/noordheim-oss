'use client';

import { createContext, use, type ReactNode } from 'react';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import type { SkirmishMode } from '@/lib/skirmish-modes';

/**
 * The commander's current operation for the launcher and the debrief: its
 * summary as `operations.overview` reports it and how to withdraw from it,
 * whether Convex or this browser runs it.
 */
export type OperationSummary = NonNullable<
  FunctionReturnType<typeof api.operations.overview>['battle']
> & {
  /** Solo operations report their skirmish mission; Convex operations are standard. */
  skirmish?: SkirmishMode;
};
export type Operation = {
  battle: OperationSummary;
  withdraw: () => Promise<unknown>;
};

const OperationContext = createContext<Operation | null>(null);

export function OperationProvider({
  operation,
  children,
}: {
  operation: Operation | null;
  children: ReactNode;
}) {
  return <OperationContext value={operation}>{children}</OperationContext>;
}

/** The current operation, or null before one starts. */
export const useOperation = () => use(OperationContext);

/**
 * Whether the operation was won by this commander's side. A backend from
 * before the `'victory'` reason reports a won operation by status alone.
 */
export const isVictory = (
  battle: Pick<OperationSummary, 'status' | 'gameOver'>,
) =>
  battle.gameOver === 'victory' ||
  (battle.status === 'victory' && !battle.gameOver);
