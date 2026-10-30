import { diffDays } from '@shared/dates';
import type { DeadlineState } from '@shared/engine-contracts';
import { civil, dayIn } from '../lib/format';
import { usePrefs } from '../state/prefs';
import { isOpenWork, type Indexes } from '../lib/records';
import { useOptionalSnapshot } from '../state/snapshot';
import { DateText, DeadlineBadge } from './Badges';

/**
 * Dates that belong to OTHER things but touch this milestone, shown separately and never as the milestone's own
 * target: existing commitments that point at it ("Recorded date") and dates held by linked task-list entries
 * ("In your task list", with the date of the copy when it is read-only).
 */
export function LinkedDates({ milestoneId, today }: { milestoneId: string; today?: string }) {
  const ctx = useOptionalSnapshot();
  const { zone } = usePrefs();
  const idx: Indexes | null | undefined = ctx?.idx;
  const rec = idx?.byId.get(milestoneId);
  if (!idx || !rec || rec.type !== 'milestone') return null;
  const asOf = ctx?.snapshot?.settings?.task_adapter?.as_of ?? null;
  const asOfDay = dayIn(asOf, zone);

  const commitments = (idx.commitmentsByMilestoneKey.get(rec.key) ?? []).filter((c) => c.data?.recorded_date && isOpenWork(c.status));
  const tasks = (idx.taskLinksByRecord.get(rec.id) ?? []).filter((t) => t.status === 'open' && t.due);
  if (commitments.length === 0 && tasks.length === 0) return null;

  return (
    <div className="linked-dates">
      {commitments.map((c) => (
        <p key={c.id} className="linked-line">
          <span className="linked-line__label">Recorded date</span>
          {/* A past recorded date proves nothing either way, so it is shown neutrally rather than as overdue. */}
          {(() => {
            const old = c.data.historical || (today && c.data.recorded_date ? diffDays(today, c.data.recorded_date) < 0 : false);
            return (
              <>
                <DateText date={c.data.recorded_date} state={old ? 'historical' : undefined} />
                {!old && <DeadlineBadge kind={c.data.deadline_kind} />}
              </>
            );
          })()}
        </p>
      ))}
      {tasks.map((t) => {
        const past = today && t.due ? diffDays(today, t.due) < 0 : false;
        const state: DeadlineState | undefined = past ? (t.sync_state === 'snapshot' ? 'historical' : 'overdue') : undefined;
        return (
          <p key={t.id} className="linked-line">
            <span className="linked-line__label">In your task list</span>
            <DateText date={t.due} today={today} state={state} />
            {t.sync_state === 'snapshot' && <span className="faint small">(copy as of {asOfDay ? civil(asOfDay, 'short') : 'an unknown date'}{state === 'historical' ? ' — check the task list' : ''})</span>}
          </p>
        );
      })}
    </div>
  );
}
