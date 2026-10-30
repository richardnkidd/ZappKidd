import type { ComputedDeadline } from '@shared/engine-contracts';
import type { DeadlineRuleData } from '@shared/types';
import { deadlineVerification } from '../lib/home';
import { dataOf, type Directory, type Indexes } from '../lib/records';
import { DeadlineBadge, DeadlineWhen, VerificationNote } from './Badges';
import { Disclosure } from './Disclosure';
import { usePlain } from './People';
import { RecordLink } from './RecordLink';

/** The rule behind a computed date, when there is one. */
export function ruleOf(d: ComputedDeadline, idx: Indexes) {
  if (!d.rule_id) return null;
  return idx.byKey.get(d.rule_id) ?? idx.byId.get(`deadline_rule:${d.rule_id}`) ?? null;
}

/**
 * One computed date as a row: what it is, what it means (due by / not before / window / on / repeats), its kind, how far
 * it can be trusted, the "only if" condition and how it is counted. Used on the readiness, arrival and record pages.
 */
export function DeadlineRow({
  d,
  idx,
  today,
  dir,
  showWho = false,
  linkRecord = true,
  headingLevel = 4,
}: {
  d: ComputedDeadline;
  idx: Indexes;
  today: string;
  dir?: Directory;
  showWho?: boolean;
  linkRecord?: boolean;
  /** Level of the "How it’s counted" heading: one below the heading of the section the row sits in. */
  headingLevel?: 3 | 4;
}) {
  const plain = usePlain();
  const verification = deadlineVerification(d, idx);
  const rule = ruleOf(d, idx);
  const rd = rule ? dataOf<DeadlineRuleData>(rule) : null;
  const who = showWho && dir && d.traveler && d.traveler !== 'household' && d.traveler !== 'each_adult' ? dir.nameOf(d.traveler) : null;
  return (
    <li className="item item--flat">
      <div className="item__main">
        {rule ? (
          <RecordLink id={rule.id} className="item__title">
            {d.label}
          </RecordLink>
        ) : d.record_id && linkRecord ? (
          <RecordLink id={d.record_id} className="item__title">
            {d.label}
          </RecordLink>
        ) : (
          <span className="item__title">{d.label}</span>
        )}
        <div className="item__meta">
          <span className="item__when">
            <DeadlineWhen d={d} today={today} />
            <DeadlineBadge kind={d.kind} />
          </span>
          {who && <span className="faint small">For {who}</span>}
          {d.approximate && <span className="faint small">Approximate — holidays not counted</span>}
        </div>
        <VerificationNote verification={verification} kind={d.kind} />
        {rd?.applies_when && d.applies !== 'yes' && <p className="small muted rule-condition">{plain(rd.applies_when)}</p>}
        {rd?.inclusive_note && (
          <Disclosure title="How it’s counted" level={headingLevel} className="disclosure--flat">
            <p className="small muted preline">{plain(rd.inclusive_note)}</p>
          </Disclosure>
        )}
      </div>
    </li>
  );
}
