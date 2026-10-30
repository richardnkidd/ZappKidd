import { useEffect, useMemo, useState } from 'react';
import { Button, Field, TextArea } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import { Section } from '../../components/Layout';
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts';
import { instant, truncate } from '../../lib/format';
import type { AnyRecord, Directory, Indexes } from '../../lib/records';
import { usePrefs } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

export function Notes({ record, idx, dir, level = 2 }: { record: AnyRecord; idx: Indexes; dir: Directory; level?: 2 | 3 }) {
  const { actions, setDirty } = useSnapshot();
  const { zone } = usePrefs();
  const w = useWrite();
  const draftKey = `note:${record.id}`;
  const [body, setBody] = useState(() => loadDraft(draftKey) ?? '');
  const [restored, setRestored] = useState(() => body.trim().length > 0);
  const [visibility, setVisibility] = useState<'household' | 'private'>('household');

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
    if (!text) return;
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
    <Section title="Notes" count={notes.length || undefined} headingLevel={level}>
      {notes.length > 0 ? (
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
      ) : (
        <p className="muted">No notes yet.</p>
      )}
      <div className="note-form">
        {restored && (
          <p className="small muted" role="status">
            Restored your unsaved text.
          </p>
        )}
        <Field label="Add a note" error={w.error}>
          <TextArea value={body} onChange={(e) => onChange(e.target.value)} rows={3} />
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
        <Button variant="secondary" icon="plus" busy={w.busy} disabled={body.trim().length === 0} onClick={add}>
          Add note
        </Button>
      </div>
    </Section>
  );
}
