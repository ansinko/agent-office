import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canLabel, cleanLabel, cleanPlan, signColor, type DeskLabel, type FloorPlan } from '../shared/floorplan.js';

/** A floor's own layout: the signs over its desks. Saved in .agent-office/floorplan.json. */
export class FloorPlanStore {
  private plan: FloorPlan;
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'floorplan.json');
    this.plan = this.load();
  }

  state(): FloorPlan {
    return { labels: { ...this.plan.labels } };
  }

  /** Hangs a sign over a desk, or takes it down (no text). What it did, for the toast, or why it couldn't. */
  label(deskId: string, text: unknown, color: unknown, by: string): { label?: DeskLabel; old?: DeskLabel } | string {
    if (!canLabel(deskId)) return 'Only a desk can have a sign over it';
    const clean = cleanLabel(text);
    const old = this.plan.labels[deskId];
    if (!clean) {
      if (!old) return {};
      delete this.plan.labels[deskId];
      this.save();
      return { old };
    }
    const label: DeskLabel = { text: clean, color: signColor(color), by, at: Date.now() };
    this.plan.labels[deskId] = label;
    this.save();
    return { label, old };
  }

  private load(): FloorPlan {
    if (!existsSync(this.file)) return cleanPlan(undefined);
    try {
      return cleanPlan(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      // a broken file just means the office as it comes
      return cleanPlan(undefined);
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.plan, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
