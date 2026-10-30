import { Link } from 'react-router';
import { Card, PageTitle } from '../components/Layout';
import { Icon } from '../components/Icon';
import { useMoreNav } from '../layout/nav';

export function More() {
  const moreNav = useMoreNav();
  return (
    <div className="page">
      <PageTitle kicker="Everything else">More</PageTitle>
      <ul className="more-list">
        {moreNav.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="more-item">
              <span className="more-item__icon">
                <Icon name={item.icon} size={22} />
              </span>
              <span className="more-item__text">
                <span className="more-item__title">{item.label}</span>
                <span className="muted more-item__blurb">{item.blurb}</span>
              </span>
              <Icon name="chevron-right" size={18} />
            </Link>
          </li>
        ))}
      </ul>
      <Card tone="inset" className="more-foot">
        <p className="faint small">Kadode is a private planning home for one household. Nothing here contacts anyone, books anything or files anything on your behalf.</p>
      </Card>
    </div>
  );
}
