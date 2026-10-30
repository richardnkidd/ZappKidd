import { useState } from 'react';
import { ZONE_OPTIONS } from '@shared/labels';
import { SUPPORTED_ZONES, type IanaZone } from '@shared/types';
import { Button, Field, Select } from '../components/Controls';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { PersonBadge, useDir } from '../components/People';
import { useAuth, useMe } from '../state/auth';
import { usePrefs } from '../state/prefs';

export function AccountMenu() {
  const me = useMe();
  const { signOut } = useAuth();
  const { zone, setZone } = usePrefs();
  const dir = useDir();
  const [open, setOpen] = useState(false);
  const person = dir.me ?? me.person;
  const zoneShort = ZONE_OPTIONS.find((z) => z.zone === zone)?.short ?? '';

  return (
    <>
      <button type="button" className="account-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <PersonBadge person={person} size={28} />
        <span className="account-btn__text">
          <span className="account-btn__name">{person.display_name}</span>
          <span className="account-btn__zone faint">{zoneShort} time</span>
        </span>
        <span className="visually-hidden">Account and display time zone</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="You" size="sm">
        <div className="stack">
          <p className="account-who">
            <PersonBadge person={person} size={36} />
            <span>
              Signed in as <strong>{person.display_name}</strong>
              {me.dev_identities_enabled && <span className="faint"> (development identity)</span>}
            </span>
          </p>
          <Field label="Show times in" hint="Changes how times of day are shown. Calendar dates never move.">
            <Select value={zone} onChange={(e) => setZone(e.target.value as IanaZone)}>
              {SUPPORTED_ZONES.map((z) => (
                <option key={z} value={z}>
                  {ZONE_OPTIONS.find((o) => o.zone === z)?.label ?? z}
                </option>
              ))}
            </Select>
          </Field>
          <div className="row-actions">
            <Button
              variant="secondary"
              icon="logout"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
            >
              {me.dev_identities_enabled ? 'Switch person' : 'Sign out'}
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
          {me.dev_identities_enabled && (
            <p className="faint small">
              <Icon name="info" size={14} /> Development identities are for trying the app on this computer. They are not real sign-in.
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
