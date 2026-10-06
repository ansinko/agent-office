/**
 * What a feature makes of the seats with its flag (see useSeatAs in index.ts), and the keys the hint
 * bar lists while you sit on one. Pure, so the tests reach it without a page.
 */
import type { SeatDef } from '../../../shared/layout';
import type { DeskKey } from '../../interaction';

/** The flags a seat in SEATING can carry (see SeatDef): what it's for besides sitting. */
export type SeatFlag = { [K in keyof SeatDef]-?: NonNullable<SeatDef[K]> extends boolean ? K : never }[keyof SeatDef];

/** A key besides E that does something while you sit on a seat (B for the issues board on the toilet). */
export interface SeatKey {
  key: Exclude<DeskKey, 'E'>;
  /** What it does, for the hint bar. */
  label: string;
  use(seat: SeatDef): void;
}

/** What a feature makes of the seats with its flag (see useSeatAs): E while sitting there, and getting up. */
export interface SeatUse {
  /** What E does while you sit there, for the hint bar. */
  label(seat: SeatDef): string;
  /** E while you sit there. */
  use(seat: SeatDef): void;
  /** One more key while you sit there, listed after E in the hint bar. */
  extra?: SeatKey;
  /**
   * Whether you may get up now, by E or by walking off. False keeps you seated, and the feature calls
   * `getUp` once you may (after asking you, say).
   */
  mayGetUp?(seat: SeatDef, getUp: () => void): boolean;
}

/**
 * The keys the hint bar lists while you sit, as [key, what it does]: E for `use` (getting up when the
 * seat has no use), then `extra`'s key, then W A S D to get up.
 */
export function sittingKeys(use: string, extra?: Pick<SeatKey, 'key' | 'label'>): [string, string][] {
  const more: [string, string][] = extra ? [[extra.key, extra.label]] : [];
  return use ? [['E', use], ...more, ['W A S D', 'Get up']] : [['E', 'Get up'], ...more];
}
