import { useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Select, TextArea, TextInput } from '../../components/Controls';
import { ConflictBanner } from '../../components/Feedback';
import { clearDraft, loadDraft, saveDraft } from '../../lib/drafts';
import { useSnapshot } from '../../state/snapshot';
import { useWrite } from '../../state/useWrite';

interface Props {
  label: string;
  value: string;
  display: ReactNode;
  input: 'text' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  /** Called with the new value and the record version the person started editing from. */
  onSave: (draft: string, baseVersion: number) => Promise<unknown>;
  version: number;
  /** Unique key so the global "Unsaved changes" indicator can count this form. */
  dirtyKey: string;
  placeholder?: string;
  canEdit?: boolean;
}

/** Read-mode text with an Edit button; edit-mode field with Save / Cancel, unsaved indicator and conflict choice. */
export function InlineEdit({ label, value, display, input, options, onSave, version, dirtyKey, placeholder, canEdit = true }: Props) {
  const { setDirty } = useSnapshot();
  // A draft left in this tab (a reload, a crash) comes back as an open editor.
  const [restored] = useState(() => {
    const d = loadDraft(dirtyKey);
    return d !== null && d !== value ? d : null;
  });
  const [editing, setEditing] = useState(restored !== null);
  const [draft, setDraft] = useState(restored ?? value);
  const [startVersion, setStartVersion] = useState(version);
  const w = useWrite();

  const dirty = editing && draft !== value;
  useEffect(() => {
    setDirty(dirtyKey, dirty);
    if (dirty) saveDraft(dirtyKey, draft);
    else clearDraft(dirtyKey);
    // Leaving the page on purpose discards the draft; a reload (no cleanup runs) keeps it.
    return () => {
      setDirty(dirtyKey, false);
      clearDraft(dirtyKey);
    };
  }, [dirty, draft, dirtyKey, setDirty]);

  const start = () => {
    setDraft(value);
    setStartVersion(version);
    w.clear();
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    w.clear();
  };
  const save = async () => {
    const ok = await w.run((v) => onSave(draft, v), startVersion);
    if (ok) setEditing(false);
  };

  if (!editing) {
    return (
      <div className="inline-edit">
        <div className="inline-edit__value">{display}</div>
        {canEdit && (
          <Button variant="quiet" small icon="pencil" onClick={start} aria-label={`Edit ${label.toLowerCase()}`}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="inline-edit inline-edit--editing">
      <Field label={label} hideLabel error={w.error}>
        {input === 'textarea' ? (
          <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} rows={3} data-autofocus />
        ) : input === 'select' ? (
          <Select value={draft} onChange={(e) => setDraft(e.target.value)} data-autofocus>
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} data-autofocus />
        )}
      </Field>
      {w.conflict ? (
        <ConflictBanner
          conflict={w.conflict}
          busy={w.busy}
          onKeepTheirs={() => {
            w.keepTheirs();
            setEditing(false);
          }}
          onUseMine={async () => {
            if (await w.useMine()) setEditing(false);
          }}
          onCombine={input === 'select' ? undefined : (theirs, yours) => {
            // Open the editor again on top of the newer version, with both texts one after the other.
            const next = w.conflict?.serverVersion ?? w.conflict?.server?.version ?? version;
            w.keepTheirs();
            setStartVersion(next);
            setDraft(theirs === yours ? yours : `${theirs}\n\n${yours}`);
          }}
        />
      ) : (
        <div className="row-actions">
          <Button variant="primary" busy={w.busy} disabled={!dirty} onClick={save}>
            Save
          </Button>
          <Button variant="quiet" onClick={cancel}>
            Discard
          </Button>
          {dirty && <span className="faint small inline-edit__flag">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
