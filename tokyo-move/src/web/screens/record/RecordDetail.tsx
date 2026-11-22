import { useEffect, useRef } from 'react';
import { useNavigate, useParams, type Location } from 'react-router';
import { Button, ButtonLink } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { EmptyState, PageTitle, Skeleton, Card } from '../../components/Layout';
import { useSnapshot } from '../../state/snapshot';
import { GenericDetail } from './GenericDetail';
import { MilestoneDetail } from './MilestoneDetail';
import { hasTypedDetail, TypedDetail } from './TypedDetail';
import type { Milestone } from '../../lib/records';

function useRecordId(): string {
  const { id } = useParams();
  return id ?? '';
}

function RecordBody({ id, variant }: { id: string; variant: 'page' | 'panel' }) {
  return (
    <DataGate skeleton={<Card><Skeleton lines={6} /></Card>}>
      {({ idx, dir }) => {
        const record = idx.byId.get(id);
        if (!record) {
          return (
            <EmptyState icon="file" title="We couldn’t find that item." action={<ButtonLink to="/plan" variant="primary">Back to the plan</ButtonLink>}>
              It may have been removed, or it may be a private note that belongs to someone else.
            </EmptyState>
          );
        }
        const level = variant === 'page' ? 2 : 3;
        if (record.type === 'milestone') return <MilestoneDetail record={record as unknown as Milestone} idx={idx} dir={dir} level={level} />;
        return hasTypedDetail(record) ? <TypedDetail record={record} idx={idx} dir={dir} level={level} /> : <GenericDetail record={record} idx={idx} dir={dir} />;
      }}
    </DataGate>
  );
}

function useTitle(id: string): string {
  const { idx } = useSnapshot();
  return idx?.byId.get(id)?.title ?? 'Details';
}

/** Full-page record detail (phones, direct links). */
export function RecordPage() {
  const id = useRecordId();
  const title = useTitle(id);
  const navigate = useNavigate();
  return (
    <div className="page record-page">
      <div>
        <Button variant="quiet" icon="chevron-left" onClick={() => navigate(-1)} className="back-btn">
          Back
        </Button>
      </div>
      <PageTitle>{title}</PageTitle>
      <RecordBody id={id} variant="page" />
    </div>
  );
}

/** Side panel over the page you came from (wide screens). Escape or Close returns you there. */
export function RecordPanel({ backTo }: { backTo?: Location }) {
  const id = useRecordId();
  const title = useTitle(id);
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = () => navigate(backTo ?? '/plan');

  useEffect(() => {
    // Remember what had focus (the link that opened the panel) so closing can return there.
    if (!openerRef.current) openerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [id]);

  useEffect(() => {
    const t = headingRef.current?.textContent?.trim();
    if (t) document.title = `${t} · Kadode`;
  });

  return (
    <aside
      className="side-panel"
      aria-label="Item details"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !document.body.classList.contains('is-modal-open')) close();
      }}
    >
      <div className="side-panel__bar">
        <span className="faint small">Details</span>
        <Button variant="quiet" icon="x" onClick={close}>
          Close
        </Button>
      </div>
      <div className="side-panel__body">
        <h2 ref={headingRef} tabIndex={-1} className="panel-title">
          {title}
        </h2>
        <RecordBody id={id} variant="panel" />
      </div>
    </aside>
  );
}

