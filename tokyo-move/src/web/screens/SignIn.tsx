import { useEffect, useState, type FormEvent } from 'react';
import { api, describeError, type DevIdentity } from '../api/client';
import { Button, Field, TextInput } from '../components/Controls';
import { ErrorBanner } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { Skeleton } from '../components/Layout';
import { useAuth } from '../state/auth';

type IdentitiesState = { kind: 'loading' } | { kind: 'dev'; identities: DevIdentity[] } | { kind: 'password' };

export function SignIn() {
  const { completeSignIn } = useAuth();
  const [state, setState] = useState<IdentitiesState>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .identities()
      .then((identities) => {
        if (alive) setState(identities.length > 0 ? { kind: 'dev', identities } : { kind: 'password' });
      })
      .catch(() => {
        if (alive) setState({ kind: 'password' });
      });
    return () => {
      alive = false;
    };
  }, []);

  const devLogin = async (identity: DevIdentity) => {
    setBusy(identity.person_id);
    setError(null);
    try {
      await api.devLogin(identity.person_id);
      await completeSignIn();
    } catch (e) {
      setError(describeError(e));
      setBusy(null);
    }
  };

  const passwordLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy('password');
    setError(null);
    try {
      await api.login(String(form.get('username') ?? ''), String(form.get('password') ?? ''));
      await completeSignIn();
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  };

  return (
    <div className="signin">
      <main className="signin__card" id="main">
        <p className="wordmark-lockup">
          <span className="wordmark wordmark--lg">Kadode</span>
          <span className="wordmark-jp wordmark-jp--lg" lang="ja">門出</span>
        </p>
        <h1 className="signin__title">Welcome back</h1>
        <p className="muted">A private planning home for your move.</p>

        {error && <ErrorBanner title="That did not work">{error}</ErrorBanner>}

        {state.kind === 'loading' && <Skeleton lines={3} height={44} />}

        {state.kind === 'dev' && (
          <section aria-labelledby="dev-id" className="stack">
            <h2 id="dev-id" className="signin__sub">
              Choose who you are <span className="faint">(local preview identity)</span>
            </h2>
            <ul className="stack stack--tight">
              {state.identities.map((i) => (
                <li key={i.person_id}>
                  <button type="button" className="identity-btn" onClick={() => devLogin(i)} disabled={busy !== null} aria-busy={busy === i.person_id || undefined}>
                    <span className="identity-btn__initial" aria-hidden="true">
                      {i.display_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="identity-btn__name">{i.display_name}</span>
                    <Icon name="arrow-right" size={20} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="faint small signin__note">
              <Icon name="info" size={14} /> This is a development identity for trying the app on this computer. It is not real
              authentication and is never available on a shared copy.
            </p>
          </section>
        )}

        {state.kind === 'password' && (
          <form onSubmit={passwordLogin} className="stack" aria-label="Sign in">
            <Field label="Username">
              <TextInput name="username" autoComplete="username" required autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Password">
              <TextInput name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Button type="submit" variant="primary" busy={busy === 'password'}>
              Sign in
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
