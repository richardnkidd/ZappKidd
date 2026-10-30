import { PageTitle, EmptyState, Card } from '../components/Layout';
import { ButtonLink } from '../components/Controls';
import type { IconName } from '../components/Icon';

export function ComingSoon({ title, icon, children }: { title: string; icon?: IconName; children?: string }) {
  return (
    <div className="page">
      <PageTitle>{title}</PageTitle>
      <Card>
        <EmptyState icon={icon} title="This part is being built.">
          {children ?? 'It will appear here soon. Everything else still works.'}
        </EmptyState>
        <div className="center">
          <ButtonLink to="/">Back to Home</ButtonLink>
        </div>
      </Card>
    </div>
  );
}
