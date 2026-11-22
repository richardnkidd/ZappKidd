import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Field, TextArea } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import { More } from '../../components/More';
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts';
import { instant, truncate } from '../../lib/format';
import type { AnyRecord, Directory, Indexes } from '../../lib/records';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

/** Notes sit behind one "Notes" control, with the count in its name. The Add button is always enabled; an empty note gets a short error. */
export function Notes({ record, idx, dir }: { record: AnyRecord; idx: Indexes; dir: Directory; level?: 2 | 3 }) {
  const { actions, setDirty } = useSnapshot();
  const { zone } = usePrefs();
  const w = useWrite();
  const draftKey = `note:${record.id}`;
  const [body, setBody] = useState(() => loadDraft(draftKey) ?? '');
  const [restored, setRestored] = useState(() => body.trim().length > 0);
  const [visibility, setVisibility] = useState<'household' | 'private'>('household');
  const [empty, setEmpty] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const notes = useMemo(
    () =>
      idx.notes
        .filter((n) => n.data?.linked_record_id === record.id)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [idx, record.id],
  );

  const onChange = (v: string) => {
    setBody(v);
    setRestored(false);
    if (v.trim()) setEmpty(false);
  };

  // The unsaved flag and the tab-only draft follow the text; both go when the form is left or the note is added.
  useEffect(() => {
    const has = body.trim().length > 0;
    setDirty(draftKey, has);
    if (has) saveDraft(draftKey, body);
    else clearDraft(draftKey);
    return () => {
      setDirty(draftKey, false);
      clearDraft(draftKey);
    };
  }, [body, draftKey, setDirty]);

  const add = async () => {
    const text = body.trim();
    if (!text) {
      setEmpty(true);
      areaRef.current?.focus();
      return;
    }
    const ok = await w.run(
      () =>
        actions.createRecord({
          type: 'note',
          title: truncate(text.replace(/\s+/g, ' '), 60),
          data: { body: text, linked_record_id: record.id },
          visibility,
        }),
      0,
    );
    if (ok) {
      setBody('');
      setRestored(false);
    }
  };

  return (
    <More label={`Notes${notes.length ? ` (${notes.length})` : ''}`} defaultOpen={restored} className="rec-more">
      <section aria-label="Notes" className="stack">
        {notes.length > 0 && (
          <ul className="notes">
            {notes.map((n) => (
              <li key={n.id} className="note">
                <p className="preline">{n.data?.body}</p>
                <p className="small faint">
                  {dir.nameOf(n.created_by)} · {instant(n.created_at, zone, 'short')}
                  {n.visibility === 'private' && (
                    <>
                      {' '}
                      · <Icon name="lock" size={12} /> Only you can see this
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="note-form">
          {restored && (
            <p className="small muted" role="status">
              Restored your unsaved text.
            </p>
          )}
          <Field label="Add a note" error={empty ? 'Write a note first.' : w.error}>
            <TextArea ref={areaRef} value={body} onChange={(e) => onChange(e.target.value)} rows={3} />
          </Field>
          <fieldset>
            <legend className="visually-hidden">Who can see this note</legend>
            <div className="row">
              <label className="choice choice--inline">
                <input type="radio" name={`vis-${record.id}`} checked={visibility === 'household'} onChange={() => setVisibility('household')} />
                <span className="choice__text">Household</span>
              </label>
              <label className="choice choice--inline">
                <input type="radio" name={`vis-${record.id}`} checked={visibility === 'private'} onChange={() => setVisibility('private')} />
                <span className="choice__text">Only me</span>
              </label>
            </div>
          </fieldset>
          <Button variant="secondary" icon="plus" busy={w.busy} onClick={add}>
            Add note
          </Button>
        </div>
      </section>
    </More>
  );
}
