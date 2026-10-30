import { diffDays } from '@shared/dates';
import type { DeadlineState } from '@shared/engine-contracts';
import type { TaskLink } from '@shared/types';
import { civil, dayIn } from '../lib/format';
import { isOpenWork, type Indexes } from '../lib/records';
import { useOptionalSnapshot } from '../state/snapshot';
import { usePrefs } from '../state/prefs';
import { DateText, DeadlineBadge } from './Badges';

/** One task-list entry's date line. A proposal that has not been added is never "in the task list" and never overdue. */
export function TaskDateLine({ t, today, asOfDay }: { t: TaskLink; today?: string; asOfDay: string | null }) {
  if (!t.due) return null;
  const past = today ? diffDays(today, t.due) < 0 : false;
  if (t.sync_state === 'pending_capture') {
    return (
      <p className="linked-line">
        <span className="linked-line__label">Proposed for your task list · not added yet</span>
        <span className="chip chip--kin chip--sm">Waiting to be added</span>
        {past ? (
          <span className="faint">
            Still waiting to be added — its date was <time dateTime={t.due}>{civil(t.due, 'short')}</time>
          </span>
        ) : (
          <DateText date={t.due} today={today} />
        )}
      </p>
    );
  }
  const state: DeadlineState | undefined = past ? (t.sync_state === 'snapshot' ? 'historical' : 'overdue') : undefined;
  return (
    <p className="linked-line">
      <span className="linked-line__label">In your task list</span>
      <DateText date={t.due} today={today} state={state} />
      {t.sync_state === 'snapshot' && (
        <span className="faint small">
          (copy as of {asOfDay ? civil(asOfDay, 'short') : 'an unknown date'}
          {state === 'historical' ? ' — check the task list' : ''})
        </span>
      )}
    </p>
  );
}

/**
 * The OTHER dates that touch a milestone, for its own page only: existing commitments that point at it ("Recorded
 * date"), and dates held by task-list entries. Cards show one date; these never become the milestone's own target.
 */
export function LinkedDates({ milestoneId, today }: { milestoneId: string; today?: string }) {
  const ctx = useOptionalSnapshot();
  const { zone } = usePrefs();
  const idx: Indexes | null | undefined = ctx?.idx;
  const rec = idx?.byId.get(milestoneId);
  if (!idx || !rec || rec.type !== 'milestone') return null;
  const asOfDay = dayIn(ctx?.snapshot?.settings?.task_adapter?.as_of ?? null, zone);

  const commitments = (idx.commitmentsByMilestoneKey.get(rec.key) ?? []).filter((c) => c.data?.recorded_date && isOpenWork(c.status));
  const tasks = (idx.taskLinksByRecord.get(rec.id) ?? []).filter((t) => t.status === 'open' && t.due);
  if (commitments.length === 0 && tasks.length === 0) return null;

  return (
    <div className="linked-dates">
      {commitments.map((c) => {
        // A past recorded date proves nothing either way, so it is shown neutrally rather than as overdue.
        const old = c.data.historical || (today && c.data.recorded_date ? diffDays(today, c.data.recorded_date) < 0 : false);
        return (
          <p key={c.id} className="linked-line">
            <span className="linked-line__label">Recorded date</span>
            <DateText date={c.data.recorded_date} state={old ? 'historical' : undefined} />
            {!old && <DeadlineBadge kind={c.data.deadline_kind} />}
          </p>
        );
      })}
      {tasks.map((t) => (
        <TaskDateLine key={t.id} t={t} today={today} asOfDay={asOfDay} />
      ))}
    </div>
  );
}
