import { useEffect, useMemo, useState } from 'react';
import { ZONE_OPTIONS } from '@shared/labels';
import { SUPPORTED_ZONES, type IanaZone, type ScenarioSettings } from '@shared/types';
import { api, ConflictError, describeError } from '../../net/client';
import { Button, Field, SegmentedControl, Select, TextInput } from '../../components/Controls';
import { DataGate } from '../../components/DataGate';
import { ErrorBanner } from '../../components/Feedback';
import { Card, PageTitle, Section, Skeleton } from '../../components/Layout';
import { fxChangeInput, scenarioExplanation } from '../../lib/money';
import { useMe } from '../../state/auth';
import { usePrefs, type ThemePref } from '../../state/prefs';
import { useSnapshot } from '../../state/snapshot';

const zoneLabel = (z: IanaZone) => ZONE_OPTIONS.find((o) => o.zone === z)?.label ?? z;

function Display() {
  const { zone, setZone, theme, setTheme } = usePrefs();
  const me = useMe();
  const { refresh } = useSnapshot();
  const [household, setHousehold] = useState<IanaZone | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | { error: string }>('idle');

  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((r) => alive && setHousehold((r.settings.display_timezone as IanaZone) ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const makeDefault = async () => {
    setState('busy');
    try {
      await api.putSetting('display_timezone', { value: zone, base: household ?? undefined });
      setHousehold(zone);
      setState('saved');
      void refresh();
    } catch (e) {
      setState({ error: e instanceof ConflictError ? 'Someone changed this just now. Reload and try again.' : describeError(e) });
    }
  };

  return (
    <Card className="stack">
      <Field label="Show times in" hint="This device only. Calendar dates never move; only times of day change.">
        <Select value={zone} onChange={(e) => setZone(e.target.value as IanaZone)}>
          {SUPPORTED_ZONES.map((z) => (
            <option key={z} value={z}>
              {zoneLabel(z)}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <p className="muted small">
          The household’s usual setting is {household ? zoneLabel(household) : zoneLabel(me.household.display_timezone)}.
        </p>
        {household !== zone && (
          <Button variant="secondary" busy={state === 'busy'} onClick={makeDefault}>
            Make {zoneLabel(zone)} the household’s usual setting
          </Button>
        )}
        {state === 'saved' && <p role="status" className="small">Saved.</p>}
        {typeof state === 'object' && <p role="alert" className="field__error">{state.error}</p>}
      </div>
      <div>
        <p className="field__label" id="theme-label">
          Appearance
        </p>
        <SegmentedControl
          label="Appearance"
          value={theme}
          onChange={(v) => setTheme(v as ThemePref)}
          options={[
            { value: 'system', label: 'Like my device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>
    </Card>
  );
}

function Scenarios({ scenarios }: { scenarios: ScenarioSettings[] }) {
  const { refresh } = useSnapshot();
  const [stored, setStored] = useState<unknown>(null);
  const [loaded, setLoaded] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { months: string; yen: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const reset = (list: ScenarioSettings[]) =>
    setDraft(
      Object.fromEntries(
        list.map((s) => [s.key, { months: String(s.extra_us_months), yen: fxChangeInput(s.fx_factor) }]),
      ),
    );

  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((r) => {
        if (!alive) return;
        setStored(r.settings.scenarios ?? []);
        setLoaded('ready');
      })
      .catch((e) => {
        if (!alive) return;
        setErr(describeError(e));
        setLoaded('error');
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => reset(scenarios), [scenarios]);

  const parsed = useMemo(
    () =>
      scenarios.map((s) => {
        const d = draft[s.key];
        const months = Number(d?.months);
        const yen = Number(d?.yen);
        return {
          key: s.key,
          months,
          yen,
          bad: !d || !Number.isInteger(months) || months < 0 || months > 60 || !Number.isFinite(yen) || yen <= -100 || yen >= 100,
        };
      }),
    [draft, scenarios],
  );
  const anyBad = parsed.some((p) => p.bad);

  const save = async () => {
    if (anyBad) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const value = parsed.map((p) => ({ key: p.key, extra_us_months: p.months, fx_factor: Math.round((1 - p.yen / 100) * 10000) / 10000 }));
      const r = await api.putSetting('scenarios', { value, base: stored });
      setStored(r.value);
      setSaved(true);
      await refresh();
    } catch (e) {
      setErr(e instanceof ConflictError ? 'Someone changed these just now. Reload the page and try again.' : describeError(e));
    } finally {
      setSaving(false);
    }
  };

  if (loaded === 'loading') return <Skeleton lines={4} />;
  if (loaded === 'error') return <ErrorBanner title="We couldn't load the scenarios.">{err}</ErrorBanner>;

  return (
    <div className="stack">
      <p className="muted">The “what if” cases on the Money page. Change how many extra months of US costs they assume and how many fewer yen the dollar buys.</p>
      {scenarios.map((s) => {
        const d = draft[s.key] ?? { months: '', yen: '' };
        const p = parsed.find((x) => x.key === s.key);
        return (
          <Card key={s.key} as="section" aria-label={s.label}>
            <h3 className="money-h3">{s.label}</h3>
            <p className="muted small">{scenarioExplanation(s)}</p>
            <div className="form-row">
              <Field label="Extra months of US costs" error={p?.bad ? 'Whole months, 0 to 60.' : null}>
                <TextInput value={d.months} inputMode="numeric" onChange={(e) => setDraft((x) => ({ ...x, [s.key]: { ...d, months: e.target.value } }))} />
              </Field>
              <Field label="Dollar buys fewer yen by (percent)" hint="0 means no change. When the dollar buys fewer yen, costs in yen are more in dollars. A negative number means the dollar buys more yen." error={p?.bad ? 'A number from -99 up to 99.' : null}>
                <TextInput value={d.yen} inputMode="decimal" onChange={(e) => setDraft((x) => ({ ...x, [s.key]: { ...d, yen: e.target.value } }))} />
              </Field>
            </div>
          </Card>
        );
      })}
      {err && <p role="alert" className="field__error">{err}</p>}
      <div className="row-actions">
        <Button variant="primary" busy={saving} disabled={anyBad} onClick={save}>
          Save scenarios
        </Button>
        <Button variant="quiet" onClick={() => reset(scenarios)}>
          Discard changes
        </Button>
      </div>
      {saved && <p role="status" className="small">Saved.</p>}
    </div>
  );
}

export function Settings() {
  const me = useMe();
  return (
    <div className="page settings">
      <PageTitle kicker="How Kadode looks and works for you">Settings</PageTitle>
      <DataGate>
        {({ snapshot }) => (
          <div className="stack stack--loose">
            <Section title="Display" headingLevel={2}>
              <Display />
            </Section>
            <Section title="Money scenarios" headingLevel={2}>
              <Scenarios scenarios={snapshot.scenarios} />
            </Section>
            <Section title="About this copy" headingLevel={2}>
              <Card>
                <dl className="facts facts--tight">
                  <div className="fact">
                    <dt>Household</dt>
                    <dd>{me.household.name}</dd>
                  </div>
                  <div className="fact">
                    <dt>Data</dt>
                    <dd>{me.data_label}</dd>
                  </div>
                  <div className="fact">
                    <dt>Dates are kept in</dt>
                    <dd>{zoneLabel(me.household.home_timezone)}</dd>
                  </div>
                </dl>
              </Card>
            </Section>
          </div>
        )}
      </DataGate>
    </div>
  );
}
